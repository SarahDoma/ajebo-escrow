/**
 * In-memory Lightning backend that behaves like hold invoices.
 * Lets the whole flow run (and be tested) with no node, no funds.
 * Interface (shared with lnd.js):
 *   createHoldInvoice({ paymentHash, amountSats, memo, expirySecs }) -> { invoice }
 *   lookup(paymentHash) -> 'OPEN' | 'ACCEPTED' | 'SETTLED' | 'CANCELED'
 *   settle(preimageHex), cancel(paymentHash)
 *   payInvoice(invoice, { maxFeeSats }) -> { ok, error? }
 *   decodeInvoice(invoice) -> { amountSats, expiresAt }   (throws if unreadable)
 */
import { sha256hex } from '../util.js';

export class MockLightning {
  constructor() {
    this.name = 'mock';
    this.invoices = new Map(); // hash -> { state, amountSats }
    this.paid = []; // payouts made
    this.failPayouts = false; // test hook
  }
  async createHoldInvoice({ paymentHash, amountSats }) {
    this.invoices.set(paymentHash, { state: 'OPEN', amountSats });
    return { invoice: `lnbcrt${amountSats}mock${paymentHash.slice(0, 40)}` };
  }
  async lookup(paymentHash) {
    return this.invoices.get(paymentHash)?.state ?? 'CANCELED';
  }
  async settle(preimageHex) {
    const inv = this.invoices.get(sha256hex(preimageHex, 'hex'));
    if (!inv || inv.state !== 'ACCEPTED') throw new Error('cannot settle');
    inv.state = 'SETTLED';
  }
  async cancel(paymentHash) {
    const inv = this.invoices.get(paymentHash);
    if (inv && inv.state !== 'SETTLED') inv.state = 'CANCELED';
  }
  async payInvoice(invoice) {
    if (this.failPayouts) return { ok: false, error: 'no route' };
    this.paid.push(invoice);
    return { ok: true };
  }
  /**
   * Reads the amount from a BOLT11 invoice's human-readable part (e.g. lnbcrt200u1... = 20,000 sats).
   * Real backends decode the full invoice; this is enough for demo mode and tests.
   */
  async decodeInvoice(invoice) {
    const m = /^ln(?:bcrt|tbs|tb|bc)(\d+)([munp]?)1/i.exec(invoice);
    if (!m) throw new Error('no amount');
    const sats = Number(m[1]) * { '': 1e8, m: 1e5, u: 100, n: 0.1, p: 1e-4 }[m[2].toLowerCase()];
    if (!Number.isInteger(sats)) throw new Error('fractional sats');
    return { amountSats: sats, expiresAt: this.decodeExpiresAt ?? Date.now() + 7 * 86400_000 };
  }
  /** Dev only: simulate the buyer's wallet paying (HTLC locked, not settled). */
  simulatePayment(paymentHash) {
    const inv = this.invoices.get(paymentHash);
    if (inv && inv.state === 'OPEN') inv.state = 'ACCEPTED';
    return !!inv;
  }
}
