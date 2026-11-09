/**
 * End-to-end test against a real Lightning regtest network (e.g. Polar).
 * The app must be running with LN_BACKEND=lnd. A second LND node ("bob")
 * plays both the buyer's wallet and the seller's wallet.
 *
 *   APP_URL=http://localhost:3000 BOB_REST_URL=https://localhost:8082 \
 *   BOB_MACAROON_HEX=... NODE_EXTRA_CA_CERTS=bob-tls.cert node scripts/e2e-lightning.mjs
 *
 * Never point this at mainnet.
 */
const APP = process.env.APP_URL || 'http://localhost:3000';
const BOB = process.env.BOB_REST_URL;
const MAC = process.env.BOB_MACAROON_HEX;
if (!BOB || !MAC) { console.error('Set BOB_REST_URL and BOB_MACAROON_HEX'); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bob = async (method, path, body) => {
  const r = await fetch(BOB + path, { method, headers: { 'Grpc-Metadata-macaroon': MAC }, body: body && JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`bob ${path}: ${JSON.stringify(j)}`);
  return j;
};
const app = async (method, path, token, body) => {
  const r = await fetch(APP + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`app ${path}: ${r.status} ${j.error}`);
  return j;
};
const bobLocal = async () => (await bob('GET', '/v1/balance/channels')).local_balance.sat;
const waitFor = async (token, state) => {
  for (let i = 0; i < 30; i++) {
    const e = await app('GET', '/api/escrow', token);
    if (e.state === state) return e;
    await sleep(1000);
  }
  throw new Error(`timed out waiting for ${state}`);
};
/** Buyer pays. With a hold invoice the payment stays in flight, so don't await the result. */
const buyerPays = (invoice) => {
  const ac = new AbortController();
  fetch(BOB + '/v2/router/send', {
    method: 'POST', signal: ac.signal,
    headers: { 'Grpc-Metadata-macaroon': MAC },
    body: JSON.stringify({ payment_request: invoice, timeout_seconds: 60, fee_limit_sat: '100' }),
  }).then((r) => r.text()).catch(() => {});
  return ac;
};
const check = (cond, msg) => { if (!cond) throw new Error('FAILED: ' + msg); console.log('  ok -', msg); };

const AMOUNT = 25000;

console.log('1. Happy path: pay -> held -> payout invoice -> confirm -> seller paid');
{
  const start = await bobLocal();
  const c = await app('POST', '/api/escrows', null, { title: 'Ankara fabric, 6 yards', amountSats: AMOUNT, ttlHours: 24 });
  const { invoice } = await app('GET', '/api/escrow', c.buyerToken);
  check(invoice.startsWith('lnbcrt'), 'app returned a real regtest invoice');
  const pay = buyerPays(invoice);
  const held = await waitFor(c.buyerToken, 'HELD');
  check(held.state === 'HELD', 'payment is HELD (HTLC locked, not settled)');
  const duringHold = await bobLocal();
  check(+start - +duringHold >= AMOUNT, `buyer's ${AMOUNT} sats are locked in flight`);

  const { payment_request: payout } = await bob('POST', '/v1/invoices', { value: String(AMOUNT), memo: 'seller payout' });
  await app('POST', '/api/escrow/payout', c.sellerToken, { invoice: payout });
  const done = await app('POST', '/api/escrow/confirm', c.buyerToken);
  check(done.state === 'SETTLED', 'buyer confirmed: invoice settled');
  check(done.payoutStatus === 'paid', 'seller payout sent over Lightning');
  pay.abort();
  // Channel balances update a moment after the payment completes.
  let end;
  for (let i = 0; i < 20; i++) { end = await bobLocal(); if (Math.abs(+end - +start) <= 10) break; await sleep(500); }
  check(Math.abs(+end - +start) <= 10, `bob (buyer + seller) back to start balance, give or take fees (${start} -> ${end})`);
}

console.log('2. Refund path: pay -> held -> seller refunds -> buyer gets sats back');
{
  const start = await bobLocal();
  const c = await app('POST', '/api/escrows', null, { title: 'Phone case', amountSats: AMOUNT, ttlHours: 24 });
  const { invoice } = await app('GET', '/api/escrow', c.buyerToken);
  const pay = buyerPays(invoice);
  await waitFor(c.buyerToken, 'HELD');
  const r = await app('POST', '/api/escrow/refund', c.sellerToken);
  check(r.state === 'REFUNDED', 'seller refunded: hold invoice cancelled');
  pay.abort();
  let end;
  for (let i = 0; i < 20; i++) { end = await bobLocal(); if (+end === +start) break; await sleep(500); }
  check(+end === +start, `buyer's sats returned in full (${start} -> ${end})`);
}

console.log('\nAll Lightning end-to-end checks passed.');
