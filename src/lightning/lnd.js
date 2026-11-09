/**
 * LND backend using the REST API (invoicesrpc hold invoices).
 * USE REGTEST / SIGNET WHILE DEVELOPING. Give it a baked macaroon with least
 * privilege: invoices:read/write + offchain:read/write (no on-chain, no admin).
 * LND's self-signed TLS cert is pinned via tlsCertPath (LND_TLS_CERT_PATH).
 *
 * Tested against LND 0.20.0 on a Polar regtest network (scripts/e2e-lightning.mjs).
 */
import { readFileSync } from 'node:fs';
import { request } from 'node:https';

const b64 = (hex) => Buffer.from(hex, 'hex').toString('base64');
const b64url = (hex) => b64(hex).replace(/\+/g, '-').replace(/\//g, '_');

export class LndLightning {
  constructor({ url, macaroonHex, tlsCertPath }) {
    if (!url || !macaroonHex) throw new Error('LND_REST_URL and LND_MACAROON_HEX are required');
    this.name = 'lnd';
    this.url = new URL(url);
    this.macaroon = macaroonHex;
    // Trust only this node's cert (plus system CAs if none given, e.g. a hosted node).
    this.ca = tlsCertPath ? readFileSync(tlsCertPath) : undefined;
  }
  #call(method, path, body) {
    const data = body ? JSON.stringify(body) : undefined;
    return new Promise((resolve, reject) => {
      const req = request(new URL(path, this.url), {
        method,
        ca: this.ca,
        timeout: 15000,
        headers: {
          'Grpc-Metadata-macaroon': this.macaroon,
          'content-type': 'application/json',
          ...(data && { 'content-length': Buffer.byteLength(data) }),
        },
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`lnd ${path.split('?')[0]} -> ${res.statusCode}`));
          try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch { reject(new Error(`lnd ${path} bad JSON`)); }
        });
      });
      req.on('timeout', () => req.destroy(new Error(`lnd ${path.split('?')[0]} timed out`)));
      req.on('error', reject);
      req.end(data);
    });
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
