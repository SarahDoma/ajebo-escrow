import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EscrowService } from '../src/escrow.js';
import { Store } from '../src/store.js';
import { MockLightning } from '../src/lightning/mock.js';

const PAYOUT = 'lnbcrt20000n1' + 'q'.repeat(60);

function setup() {
  const ln = new MockLightning();
  let t = 1_000_000;
  const svc = new EscrowService({ store: new Store(), ln, now: () => t });
  return { svc, ln, advance: (ms) => { t += ms; } };
}
const make = (svc) => svc.create({ title: 'Ankara fabric', amountSats: 20000, ttlHours: 24 });
const hashOf = (svc, token) => svc.authenticate(token).e.paymentHash;

test('happy path: pay -> held -> payout invoice -> confirm -> seller paid', async () => {
  const { svc, ln } = setup();
  const { buyerToken, sellerToken } = await make(svc);
  assert.equal((await svc.get(buyerToken)).state, 'AWAITING_PAYMENT');
  ln.simulatePayment(hashOf(svc, buyerToken));
  assert.equal((await svc.get(buyerToken)).state, 'HELD');
  await svc.setPayoutInvoice(sellerToken, PAYOUT);
  const done = await svc.confirm(buyerToken);
  assert.equal(done.state, 'SETTLED');
  assert.equal(done.payoutStatus, 'paid');
  assert.deepEqual(ln.paid, [PAYOUT]);
});

test('seller cannot confirm; buyer cannot set payout', async () => {
  const { svc, ln } = setup();
  const { buyerToken, sellerToken } = await make(svc);
  ln.simulatePayment(hashOf(svc, buyerToken));
  await assert.rejects(svc.confirm(sellerToken), { status: 403 });
  await assert.rejects(svc.setPayoutInvoice(buyerToken, PAYOUT), { status: 403 });
});

test('cannot confirm without a payout invoice', async () => {
  const { svc, ln } = setup();
  const { buyerToken } = await make(svc);
  ln.simulatePayment(hashOf(svc, buyerToken));
  await assert.rejects(svc.confirm(buyerToken), { status: 409 });
});

test('timeout while HELD refunds the buyer', async () => {
  const { svc, ln, advance } = setup();
  const { buyerToken } = await make(svc);
  const hash = hashOf(svc, buyerToken);
  ln.simulatePayment(hash);
  assert.equal((await svc.get(buyerToken)).state, 'HELD');
  advance(25 * 3600 * 1000);
  assert.equal((await svc.get(buyerToken)).state, 'REFUNDED');
  assert.equal(await ln.lookup(hash), 'CANCELED');
});

test('seller can refund while HELD, but not after settle', async () => {
  const { svc, ln } = setup();
  const a = await make(svc);
  ln.simulatePayment(hashOf(svc, a.buyerToken));
  assert.equal((await svc.refund(a.sellerToken)).state, 'REFUNDED');

  const b = await make(svc);
  ln.simulatePayment(hashOf(svc, b.buyerToken));
  await svc.setPayoutInvoice(b.sellerToken, PAYOUT);
  await svc.confirm(b.buyerToken);
  await assert.rejects(svc.refund(b.sellerToken), { status: 409 });
});

test('buyer can cancel before paying; buyer cannot refund once HELD', async () => {
  const { svc, ln } = setup();
  const a = await make(svc);
  assert.equal((await svc.refund(a.buyerToken)).state, 'CANCELLED');
  const b = await make(svc);
  ln.simulatePayment(hashOf(svc, b.buyerToken));
  await assert.rejects(svc.refund(b.buyerToken), { status: 409 });
});

test('double confirm is rejected (no double payout)', async () => {
  const { svc, ln } = setup();
  const { buyerToken, sellerToken } = await make(svc);
  ln.simulatePayment(hashOf(svc, buyerToken));
  await svc.setPayoutInvoice(sellerToken, PAYOUT);
  const results = await Promise.allSettled([svc.confirm(buyerToken), svc.confirm(buyerToken)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(ln.paid.length, 1);
});

test('failed payout can be retried with a new invoice', async () => {
  const { svc, ln } = setup();
  const { buyerToken, sellerToken } = await make(svc);
  ln.simulatePayment(hashOf(svc, buyerToken));
  await svc.setPayoutInvoice(sellerToken, PAYOUT);
  ln.failPayouts = true;
  assert.equal((await svc.confirm(buyerToken)).payoutStatus, 'failed');
  ln.failPayouts = false;
  const retried = await svc.setPayoutInvoice(sellerToken, PAYOUT + 'x');
  assert.equal(retried.payoutStatus, 'paid');
});

test('input validation and secret hygiene', async () => {
  const { svc } = setup();
  await assert.rejects(svc.create({ title: '', amountSats: 20000 }), { status: 400 });
  await assert.rejects(svc.create({ title: 'x', amountSats: 5 }), { status: 400 });
  await assert.rejects(svc.create({ title: 'x', amountSats: 1.5e4 + 0.5 }), { status: 400 });
  await assert.rejects(svc.create({ title: 'x', amountSats: 999_999_999 }), { status: 400 });
  const { buyerToken, sellerToken, id } = await make(svc);
  await assert.rejects(svc.setPayoutInvoice(sellerToken, '<script>'), { status: 400 });
  await assert.rejects(svc.get(`${id}.wrong`), { status: 404 });
  await assert.rejects(svc.get('nonsense'), { status: 404 });
  const json = JSON.stringify(await svc.get(buyerToken)) + JSON.stringify(await svc.get(sellerToken));
  assert.ok(!json.includes(svc.store.get(id).preimage));
  assert.ok(!json.includes('Hash'));
});
