import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';
import { EscrowService } from './escrow.js';
import { Store } from './store.js';
import { createLightning } from './lightning/index.js';
import { HttpError } from './util.js';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

export function buildServer({ env = process.env, ln = createLightning(env), store = new Store(env.DATA_FILE) } = {}) {
  const svc = new EscrowService({
    store, ln,
    limits: { minSats: +env.MIN_SATS || 1000, maxSats: +env.MAX_SATS || 500_000 },
  });
  const network = ln.name === 'mock' ? 'demo' : (env.LN_NETWORK || 'regtest');
  const trustProxy = env.TRUST_PROXY === '1';
  // Behind a proxy (Fly.io, Railway) every request comes from the proxy, so use the
  // client IP header it sets. Only trust it when TRUST_PROXY=1, since clients can forge it.
  const clientIp = (req) => (trustProxy
    && (req.headers['fly-client-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()))
    || req.socket.remoteAddress;
  const hits = new Map(); // naive per-IP rate limit
  const limited = (ip) => {
    const k = ip + Math.floor(Date.now() / 60000);
    hits.set(k, (hits.get(k) || 0) + 1);
    if (hits.size > 5000) hits.clear();
    return hits.get(k) > 120;
  };

  const headers = {
    'content-security-policy': "default-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'",
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer', // tokens live in URLs: never leak them
    'cache-control': 'no-store',
    ...(trustProxy && { 'strict-transport-security': 'max-age=31536000' }), // proxy terminates HTTPS
  };
  const json = (res, status, body) => {
    res.writeHead(status, { ...headers, 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const readBody = (req) => new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > 4096) { reject(new HttpError(413, 'Too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks)) : {}); } catch { reject(new HttpError(400, 'Invalid JSON')); } });
  });
  const bearer = (req) => (req.headers.authorization || '').replace(/^Bearer /, '');

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/healthz') return json(res, 200, { ok: true });
      if (limited(clientIp(req))) throw new HttpError(429, 'Too many requests. Wait a minute and try again.');

      if (url.pathname.startsWith('/api/')) {
        const p = url.pathname;
        const post = req.method === 'POST';
        if (post && p === '/api/escrows') {
          const b = await readBody(req);
          return json(res, 201, await svc.create({ title: b.title, amountSats: b.amountSats, ttlHours: b.ttlHours ?? 72 }));
        }
        if (req.method === 'GET' && p === '/api/config') return json(res, 200, { mock: ln.name === 'mock', network });
        if (req.method === 'GET' && p === '/api/escrow') return json(res, 200, await svc.get(bearer(req)));
        if (post && p === '/api/escrow/payout') return json(res, 200, await svc.setPayoutInvoice(bearer(req), (await readBody(req)).invoice));
        if (post && p === '/api/escrow/confirm') return json(res, 200, await svc.confirm(bearer(req)));
        if (post && p === '/api/escrow/refund') return json(res, 200, await svc.refund(bearer(req)));
        // Dev-only: stand-in for the buyer's wallet when using the mock backend.
        if (post && p === '/api/dev/pay' && ln.name === 'mock') {
          const { e } = svc.authenticate(bearer(req));
          return json(res, 200, { ok: ln.simulatePayment(e.paymentHash) });
        }
        throw new HttpError(404, 'Not found');
      }

      // Pages: / creates; /b/<token> buyer; /s/<token> seller (both serve escrow.html)
      let file = url.pathname === '/' ? 'index.html' : /^\/[bs]\/[0-9a-f.]+$/.test(url.pathname) ? 'escrow.html' : url.pathname.slice(1);
      file = normalize(file);
      if (file.startsWith('..') || file.includes('\0')) throw new HttpError(404, 'Not found');
      const ext = file.slice(file.lastIndexOf('.'));
      if (!TYPES[ext]) throw new HttpError(404, 'Not found');
      const body = await readFile(join(PUBLIC, file)).catch(() => { throw new HttpError(404, 'Not found'); });
      res.writeHead(200, { ...headers, 'content-type': TYPES[ext] });
      res.end(body);
    } catch (err) {
      const status = err.status || 500;
      if (status === 500) console.error('internal error', err.message); // never log tokens / request URLs
      json(res, status, { error: status === 500 ? 'Something went wrong' : err.message });
    }
  });
  const timer = setInterval(() => svc.sweep(), 30000);
  timer.unref();
  return { server, svc, ln };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Refuse to run against mainnet unless explicitly allowed: this is hackathon software.
  if (process.env.LN_NETWORK === 'mainnet' && process.env.ALLOW_MAINNET !== '1') {
    console.error('Refusing to start on mainnet without ALLOW_MAINNET=1');
    process.exit(1);
  }
  const port = +process.env.PORT || 3000;
  const { ln, server } = buildServer();
  server.listen(port, () => console.log(`Ajebo Escrow on port ${port} (lightning: ${ln.name}, network: ${process.env.LN_NETWORK || (ln.name === 'mock' ? 'demo' : 'regtest')})`));
}
