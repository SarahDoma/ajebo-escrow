import { config } from './banner.js';

const $ = (id) => document.getElementById(id);
const token = location.pathname.split('/')[2];
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
const show = (id, on) => $(id).classList.toggle('hidden', !on);

// [label, text for buyer, text for seller]
const STATES = {
  AWAITING_PAYMENT: ['Waiting for payment', 'You have not paid yet.', 'The buyer has not paid yet. Add your payout invoice while you wait.'],
  HELD: ['Payment locked in escrow', 'Your sats are locked. The seller gets them only when you confirm the goods arrived.', 'The buyer has paid and the sats are locked. Ship the goods. You are paid when the buyer confirms.'],
  SETTLED: ['Complete', 'You confirmed delivery and the seller has been paid.', 'The buyer confirmed delivery.'],
  REFUNDED: ['Refunded', 'Your sats went back to your wallet.', 'The sats went back to the buyer.'],
  CANCELLED: ['Cancelled', 'This escrow was cancelled. No money moved.', 'This escrow was cancelled. No money moved.'],
};

async function call(path, method = 'GET', body) {
  $('err').textContent = '';
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({ error: 'Network problem. Check your connection and try again.' }));
  if (!res.ok) { $('err').textContent = data.error; throw new Error(data.error); }
  return data;
}

function render(e) {
  const buyer = e.role === 'buyer', seller = e.role === 'seller';
  const [label, buyerText, sellerText] = STATES[e.state] || [e.state, '', ''];
  const open = e.state === 'AWAITING_PAYMENT' || e.state === 'HELD';
  document.title = e.title;
  $('role').textContent = buyer ? 'Buyer page' : 'Seller page (keep this link private)';
  $('title').textContent = e.title;
  $('amount').textContent = e.amountSats.toLocaleString();
  $('payamt').textContent = e.amountSats.toLocaleString();
  $('state').textContent = label;
  let help = buyer ? buyerText : sellerText;
  if (e.state === 'SETTLED' && seller)
    help += e.payoutStatus === 'paid' ? ' Your payout was sent.' : ' Your payout failed. Paste a fresh invoice below to retry.';
  $('help').textContent = help;
  const when = new Date(e.expiresAt).toLocaleString();
  $('expires').textContent = e.state === 'HELD'
    ? `If delivery is not confirmed by ${when}, the sats go back to the buyer automatically.`
    : e.state === 'AWAITING_PAYMENT' ? `This escrow expires on ${when}.` : '';

  show('pay', buyer && e.state === 'AWAITING_PAYMENT');
  if (e.invoice) {
    $('invoice').textContent = e.invoice;
    $('openwallet').href = `lightning:${e.invoice}`;
  }
  const retry = e.state === 'SETTLED' && e.payoutStatus === 'failed';
  show('payout', seller && ((open && !e.hasPayoutInvoice) || retry));
  show('paysaved', seller && open && e.hasPayoutInvoice);
  show('payexpired', seller && e.payoutExpired);
  amountSats = e.amountSats;
  show('confirm', buyer && e.state === 'HELD' && e.hasPayoutInvoice);
  show('waitseller', buyer && e.state === 'HELD' && !e.hasPayoutInvoice);
  show('refund', (seller && open) || (buyer && e.state === 'AWAITING_PAYMENT'));
  $('refund').textContent = buyer ? 'Cancel this escrow' : e.state === 'HELD' ? 'Refund buyer' : 'Cancel this escrow';
}

const refresh = () => call('/api/escrow').then(render).catch(() => {});
$('copy').onclick = async () => {
  try { await navigator.clipboard.writeText($('invoice').textContent); $('copy').textContent = 'Copied'; }
  catch { $('err').textContent = 'Could not copy. Press and hold the invoice to copy it.'; }
};
$('savepay').onclick = () => call('/api/escrow/payout', 'POST', { invoice: $('payinv').value })
  .then((e) => { $('payinv').value = ''; render(e); }).catch(() => {});
$('confirm').onclick = () => {
  if (!confirm('Only confirm if you have the goods in hand. This pays the seller and cannot be undone.')) return;
  call('/api/escrow/confirm', 'POST').then(render).catch(() => {});
};
$('refund').onclick = () => {
  if (!confirm('This cancels the escrow and sends any locked sats back to the buyer. Continue?')) return;
  call('/api/escrow/refund', 'POST').then(render).catch(() => {});
};
$('devpay').onclick = () => call('/api/dev/pay', 'POST').then(refresh).catch(() => {});

// Demo helpers only exist with the mock backend: there is no real wallet to pay or invoice from.
let amountSats = 0;
$('demofill').onclick = () => {
  // A BOLT11-shaped placeholder for the right amount (n = 0.1 sat units). Only the mock accepts it.
  const tail = Array.from(crypto.getRandomValues(new Uint8Array(40)), (b) => 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'[b % 32]).join('');
  $('payinv').value = `lnbcrt${amountSats * 10}n1${tail}`;
};
config.then((c) => { if (c.mock) { show('devpay', true); show('demofill', true); } });
refresh();
setInterval(refresh, 8000);
