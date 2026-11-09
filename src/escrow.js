/**
 * Escrow state machine on top of Lightning hold invoices.
 *
 *   AWAITING_PAYMENT --buyer pays--> HELD --buyer confirms--> SETTLED (payout to seller)
 *        |                            |--seller refunds / timeout--> REFUNDED
 *        '--cancel / expiry--> CANCELLED
 *
 * While HELD, the buyer's sats are locked in an in-flight HTLC: the server cannot
 * spend them, and if it does nothing they return to the buyer when the HTLC times out.
 * Only the preimage (kept server-side, never exposed) can settle the invoice.
 */
import { randomHex, sha256hex, safeEqual, HttpError } from './util.js';

const INVOICE_RE = /^ln(bc|tb|bcrt|tbs)[0-9a-z]{20,2000}$/i;

export class EscrowService {
  constructor({ store, ln, now = () => Date.now(), limits = {}, payoutRetryDelayMs = 1500 }) {
    this.store = store;
    this.ln = ln;
    this.now = now;
    this.payoutRetryDelayMs = payoutRetryDelayMs;
    this.limits = { minSats: 1000, maxSats: 500_000, ...limits };
    this.locks = new Map();
  }

  /** Serialise operations per escrow so two requests can't race (e.g. confirm + refund). */
  async #lock(id, fn) {
    const prev = this.locks.get(id) || Promise.resolve();
    const next = prev.then(fn, fn);
    this.locks.set(id, next.catch(() => {}));
    return next;
  }

  async create({ title, amountSats, ttlHours = 72 }) {
    title = String(title ?? '').trim();
    if (title.length < 1 || title.length > 80) throw new HttpError(400, 'Title must be 1-80 characters');
    if (!Number.isInteger(amountSats) || amountSats < this.limits.minSats || amountSats > this.limits.maxSats)
      throw new HttpError(400, `Amount must be a whole number between ${this.limits.minSats} and ${this.limits.maxSats} sats`);
    if (!Number.isInteger(ttlHours) || ttlHours < 1 || ttlHours > 168)
      throw new HttpError(400, 'Hold time must be 1-168 hours');

    const id = randomHex(8);
    const preimage = randomHex(32);
    const paymentHash = sha256hex(preimage, 'hex');
    const buyerSecret = randomHex(24);
    const sellerSecret = randomHex(24);
    const expirySecs = ttlHours * 3600;
    const { invoice } = await this.ln.createHoldInvoice({
      paymentHash, amountSats, memo: `Escrow ${id}`, expirySecs: Math.min(expirySecs, 86400),
    });
    const e = {
      id, title, amountSats, state: 'AWAITING_PAYMENT', invoice,
      paymentHash, preimage, // preimage is secret: never leaves the server
      buyerHash: sha256hex(buyerSecret), sellerHash: sha256hex(sellerSecret),
      payoutInvoice: null, payoutStatus: null,
      createdAt: this.now(), expiresAt: this.now() + expirySecs * 1000,
    };
    this.store.put(e);
    return { id, buyerToken: `${id}.${buyerSecret}`, sellerToken: `${id}.${sellerSecret}`, escrow: this.view(e, 'seller') };
  }

  /** Resolve a bearer token ("<id>.<secret>") to { e, role }. */
  authenticate(token) {
    const [id, secret, extra] = String(token ?? '').split('.');
    const e = id && secret && extra === undefined ? this.store.get(id) : null;
    if (!e) throw new HttpError(404, 'Not found');
    const h = sha256hex(secret);
    if (safeEqual(h, e.buyerHash)) return { e, role: 'buyer' };
    if (safeEqual(h, e.sellerHash)) return { e, role: 'seller' };
    throw new HttpError(404, 'Not found');
  }

  /** Public, role-filtered view. Never includes preimage or token hashes. */
  view(e, role) {
    const v = {
      id: e.id, title: e.title, amountSats: e.amountSats, state: e.state, role,
      expiresAt: e.expiresAt, createdAt: e.createdAt, payoutStatus: e.payoutStatus,
      hasPayoutInvoice: !!e.payoutInvoice,
    };
    if (role === 'buyer' && e.state === 'AWAITING_PAYMENT') v.invoice = e.invoice;
    return v;
  }

  async get(token) {
    const { e, role } = this.authenticate(token);
    return this.#lock(e.id, async () => this.view(await this.#sync(e), role));
  }

  /** Reconcile with the Lightning node and apply timeouts. Call under the lock. */
  async #sync(e) {
    if (e.state === 'AWAITING_PAYMENT' || e.state === 'HELD') {
      const ln = await this.ln.lookup(e.paymentHash);
      if (e.state === 'AWAITING_PAYMENT' && ln === 'ACCEPTED') { e.state = 'HELD'; e.heldAt = this.now(); }
      else if (e.state === 'AWAITING_PAYMENT' && ln === 'CANCELED') e.state = 'CANCELLED';
      if (this.now() >= e.expiresAt && (e.state === 'AWAITING_PAYMENT' || e.state === 'HELD')) {
        await this.ln.cancel(e.paymentHash); // HTLC fails back to the buyer
        e.state = e.state === 'HELD' ? 'REFUNDED' : 'CANCELLED';
      }
      this.store.put(e);
    }
    return e;
  }

  async setPayoutInvoice(token, invoice) {
    const { e, role } = this.authenticate(token);
    if (role !== 'seller') throw new HttpError(403, 'Only the seller can set the payout invoice');
    invoice = String(invoice ?? '').trim().replace(/^lightning:/i, '');
    if (!INVOICE_RE.test(invoice)) throw new HttpError(400, 'That does not look like a Lightning invoice');
    return this.#lock(e.id, async () => {
      await this.#sync(e);
      const retry = e.state === 'SETTLED' && e.payoutStatus === 'failed';
      if (e.state !== 'AWAITING_PAYMENT' && e.state !== 'HELD' && !retry)
        throw new HttpError(409, `Cannot set payout invoice while ${e.state}`);
      e.payoutInvoice = invoice;
      this.store.put(e);
      if (retry) await this.#payout(e);
      return this.view(e, role);
    });
  }

  async confirm(token) {
    const { e, role } = this.authenticate(token);
    if (role !== 'buyer') throw new HttpError(403, 'Only the buyer can confirm delivery');
    return this.#lock(e.id, async () => {
      await this.#sync(e);
      if (e.state !== 'HELD') throw new HttpError(409, `Cannot confirm while ${e.state}`);
      if (!e.payoutInvoice) throw new HttpError(409, 'Seller has not added a payout invoice yet');
      await this.ln.settle(e.preimage);
      e.state = 'SETTLED';
      e.payoutStatus = 'pending';
      this.store.put(e);
      await this.#payout(e);
      return this.view(e, role);
    });
  }

  /**
   * Pay the seller. Retries briefly: right after settling, channel updates may still be
   * in flight. Retrying the same invoice is safe because Lightning never pays a payment
   * hash twice (LND rejects an already-paid invoice).
   */
  async #payout(e) {
    const maxFeeSats = Math.max(10, Math.floor(e.amountSats * 0.01));
    let r;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await new Promise((ok) => setTimeout(ok, this.payoutRetryDelayMs * attempt));
      r = await this.ln.payInvoice(e.payoutInvoice, { maxFeeSats });
      if (r.ok) break;
    }
    e.payoutStatus = r.ok ? 'paid' : 'failed';
    if (!r.ok) console.error(`payout failed for escrow ${e.id}: ${r.error}`); // no invoice or secrets logged
    this.store.put(e);
  }

  /** Seller refunds (any time before settle); buyer may cancel before paying. */
  async refund(token) {
    const { e, role } = this.authenticate(token);
    return this.#lock(e.id, async () => {
      await this.#sync(e);
      if (e.state === 'AWAITING_PAYMENT') {
        await this.ln.cancel(e.paymentHash);
        e.state = 'CANCELLED';
      } else if (e.state === 'HELD' && role === 'seller') {
        await this.ln.cancel(e.paymentHash);
        e.state = 'REFUNDED';
      } else {
        throw new HttpError(409, `Cannot refund while ${e.state} as ${role}`);
      }
      this.store.put(e);
      return this.view(e, role);
    });
  }

  /** Background sweep so timeouts fire even if nobody opens the page. */
  async sweep() {
    for (const e of this.store.all())
      if (e.state === 'AWAITING_PAYMENT' || e.state === 'HELD')
        await this.#lock(e.id, () => this.#sync(e)).catch(() => {});
  }
}
