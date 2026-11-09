/**
 * LND backend using the REST API (invoicesrpc hold invoices).
 * USE REGTEST / SIGNET WHILE DEVELOPING. Needs a macaroon baked with the
 * least privilege: invoices:read/write + offchain:write (no on-chain, no admin).
 *
 * Status: scaffold. Endpoints follow LND's REST docs; verify against your LND version
 * (Polar makes a regtest node in two clicks).
 */
import { readFileSync } from 'node:fs';
import { Agent } from 'node:https';

const b64 = (hex) => Buffer.from(hex, 'hex').toString('base64');
const b64url = (hex) => b64(hex).replace(/\+/g, '-').replace(/\//g, '_');

export class LndLightning {
  constructor({ url, macaroonHex, tlsCertPath }) {
    if (!url || !macaroonHex) throw new Error('LND_REST_URL and LND_MACAROON_HEX are required');
    this.name = 'lnd';
    this.url = url.replace(/\/$/, '');
    this.macaroon = macaroonHex;
    this.agent = tlsCertPath ? new Agent({ ca: readFileSync(tlsCertPath) }) : undefined;
  }
  async #call(method, path, body) {
    // Node's fetch ignores `agent`; undici dispatcher would be needed for self-signed certs.
    // For regtest set NODE_EXTRA_CA_CERTS=<tls.cert> before starting the server.
    const res = await fetch(this.url + path, {
      method,
      headers: { 'Grpc-Metadata-macaroon': this.macaroon, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`lnd ${path} -> ${res.status}`);
    return res.json();
  }
  async createHoldInvoice({ paymentHash, amountSats, memo, expirySecs }) {
    const r = await this.#call('POST', '/v2/invoices/hodl', {
      hash: b64(paymentHash),
      value: String(amountSats),
      memo,
      expiry: String(expirySecs),
    });
    return { invoice: r.payment_request };
  }
  async lookup(paymentHash) {
    const r = await this.#call('GET', `/v2/invoices/lookup?payment_hash=${b64url(paymentHash)}`);
    return r.state; // OPEN | SETTLED | CANCELED | ACCEPTED
  }
  async settle(preimageHex) {
    await this.#call('POST', '/v2/invoices/settle', { preimage: b64(preimageHex) });
  }
  async cancel(paymentHash) {
    await this.#call('POST', '/v2/invoices/cancel', { payment_hash: b64(paymentHash) });
  }
  async payInvoice(invoice, { maxFeeSats = 50 } = {}) {
    try {
      const r = await this.#call('POST', '/v1/channels/transactions', {
        payment_request: invoice,
        fee_limit: { fixed: String(maxFeeSats) },
      });
      return r.payment_error ? { ok: false, error: r.payment_error } : { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
}
