const $ = (id) => document.getElementById(id);
const token = location.pathname.split('/')[2];
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

const STATES = {
  AWAITING_PAYMENT: ['Waiting for the buyer to pay', 'The buyer has not paid yet.'],
  HELD: ['Payment locked in escrow', 'The sats are locked. The seller cannot take them until the buyer confirms delivery.'],
  SETTLED: ['Complete', 'The buyer confirmed. The seller has been paid.'],
  REFUNDED: ['Refunded', 'The sats went back to the buyer.'],
  CANCELLED: ['Cancelled', 'This escrow was cancelled. No money moved.'],
};

async function call(path, method = 'GET', body) {
  $('err').textContent = '';
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json();
  if (!res.ok) { $('err').textContent = data.error; throw new Error(data.error); }
  return data;
}

function render(e) {
  const [label, help] = STATES[e.state] || [e.state, ''];
  document.title = e.title;
  $('title').textContent = e.title;
  $('amount').textContent = e.amountSats.toLocaleString();
  $('state').textContent = label;
  $('help').textContent = help + (e.state === 'SETTLED' && e.payoutStatus === 'failed'
    ? ' Payout failed: seller, add a fresh payout invoice.' : '');
  const buyer = e.role === 'buyer', seller = e.role === 'seller';
  $('pay').classList.toggle('hidden', !(buyer && e.state === 'AWAITING_PAYMENT'));
  if (e.invoice) $('invoice').textContent = e.invoice;
  $('payout').classList.toggle('hidden', !(seller && (['AWAITING_PAYMENT', 'HELD'].includes(e.state) ||
    (e.state === 'SETTLED' && e.payoutStatus === 'failed'))));
  $('confirm').classList.toggle('hidden', !(buyer && e.state === 'HELD'));
  $('refund').classList.toggle('hidden', !((seller && ['AWAITING_PAYMENT', 'HELD'].includes(e.state)) ||
    (buyer && e.state === 'AWAITING_PAYMENT')));
  $('refund').textContent = buyer ? 'Cancel' : 'Refund buyer';
}

const refresh = () => call('/api/escrow').then(render).catch(() => {});
$('copy').onclick = () => navigator.clipboard?.writeText($('invoice').textContent);
$('savepay').onclick = () => call('/api/escrow/payout', 'POST', { invoice: $('payinv').value }).then((e) => { $('payinv').value = ''; render(e); }).catch(() => {});
$('confirm').onclick = () => call('/api/escrow/confirm', 'POST').then(render).catch(() => {});
$('refund').onclick = () => call('/api/escrow/refund', 'POST').then(render).catch(() => {});
$('devpay').onclick = () => call('/api/dev/pay', 'POST').then(refresh).catch(() => {});

// Dev button only exists with the mock backend.
fetch('/api/config').then((r) => r.json()).then((c) => { if (c.mock) $('devpay').classList.remove('hidden'); });
refresh();
setInterval(refresh, 8000);
