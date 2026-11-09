/**
 * In-memory Lightning backend that behaves like hold invoices.
 * Lets the whole flow run (and be tested) with no node, no funds.
 * Interface (shared with lnd.js):
 *   createHoldInvoice({ paymentHash, amountSats, memo, expirySecs }) -> { invoice }
 *   lookup(paymentHash) -> 'OPEN' | 'ACCEPTED' | 'SETTLED' | 'CANCELED'
 *   settle(preimageHex), cancel(paymentHash)
 *   payInvoice(invoice, { maxFeeSats }) -> { ok, error? }
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
  /** Dev only: simulate the buyer's wallet paying (HTLC locked, not settled). */
  simulatePayment(paymentHash) {
    const inv = this.invoices.get(paymentHash);
    if (inv && inv.state === 'OPEN') inv.state = 'ACCEPTED';
    return !!inv;
  }
}
