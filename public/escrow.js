import { config } from './banner.js';

const $ = (id) => document.getElementById(id);
const token = location.pathname.split('/')[2];
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
const show = (id, on) => $(id).classList.toggle('hidden', !on);
const fmt = (n) => Number(n).toLocaleString('en');
const NET = 'Network problem. Check your connection and try again.';

// state -> [badge label, badge style, text for buyer, text for seller]
const STATES = {
  AWAITING_PAYMENT: ['Waiting for payment', 'wait',
    'Pay below. Your money will be locked, not sent to the seller yet.',
    'Waiting for the buyer to pay. Add where you want to be paid while you wait.'],
  HELD: ['Payment locked', 'held',
    'Your money is locked. The seller only gets it when you confirm the goods arrived.',
    'The buyer has paid and the money is locked. Ship the goods now. You are paid when the buyer confirms.'],
  SETTLED: ['Complete', 'done',
    'You confirmed delivery and the seller has been paid. Thank you!',
    'The buyer confirmed delivery.'],
  REFUNDED: ['Refunded', 'off',
    'Your money was returned to your wallet.',
    'The money was returned to the buyer.'],
  CANCELLED: ['Cancelled', 'off',
    'This escrow was cancelled. No money moved.',
    'This escrow was cancelled. No money moved.'],
};

function whenText(ms) {
  const diff = ms - Date.now();
  const abs = new Date(ms).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const hours = Math.round(diff / 3600000);
  const rel = Math.abs(hours) >= 24 ? rtf.format(Math.round(hours / 24), 'day') : rtf.format(hours, 'hour');
  return `${abs} (${rel})`;
}

async function call(path, method = 'GET', body) {
  $('err').textContent = '';
  let res;
  try {
    res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    $('live').textContent = 'Offline, retrying…';
    throw new Error(NET);
  }
  $('live').textContent = 'Updates automatically';
  const data = await res.json().catch(() => ({ error: NET }));
  if (!res.ok) throw new Error(data.error || NET);
  return data;
}

/** Run an action with a busy button, showing any error. */
async function act(btn, label, fn) {
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = label;
  try { await fn(); } catch (e) { $('err').textContent = e.message; }
  finally { btn.disabled = false; if (btn.textContent === label) btn.textContent = old; }
}

function renderTrack(e) {
  // How many steps are fully done, and which one is in progress.
  const pos = { AWAITING_PAYMENT: [1, 1], HELD: [2, 2], SETTLED: e.payoutStatus === 'paid' ? [4, -1] : [3, 3] }[e.state];
  const items = $('track').children;
  show('track', !!pos);
  if (!pos) return;
  [...items].forEach((li, i) => {
    li.className = i < pos[0] ? 'done' : i === pos[1] ? 'now' : '';
  });
}

let amountSats = 0;

function render(e) {
  const buyer = e.role === 'buyer', seller = e.role === 'seller';
  const [label, style, buyerText, sellerText] = STATES[e.state] || [e.state, 'wait', '', ''];
  const open = e.state === 'AWAITING_PAYMENT' || e.state === 'HELD';
  amountSats = e.amountSats;

  document.title = `${e.title} · Ajebo Escrow`;
  $('role').textContent = buyer ? 'You are the buyer' : 'You are the seller · keep this link private';
  $('title').textContent = e.title;
  $('amount').textContent = fmt(e.amountSats);
  $('payamt').textContent = fmt(e.amountSats);
  $('state').textContent = label;
  $('state').className = `status ${style}`;

  let help = buyer ? buyerText : sellerText;
  if (e.state === 'SETTLED' && seller)
    help += e.payoutStatus === 'paid' ? ' Your money has been sent to you.' : ' Sending your money failed. Add a fresh payment request below to try again.';
  $('help').textContent = help;
  const when = whenText(e.expiresAt);
  $('expires').textContent = e.state === 'HELD'
    ? (buyer
      ? `If you don't confirm by ${when}, your money comes back to you automatically.`
      : `If the buyer doesn't confirm by ${when}, the money goes back to them automatically.`)
    : e.state === 'AWAITING_PAYMENT' ? `If not paid by ${when}, this escrow closes.` : '';
  renderTrack(e);

  show('pay', buyer && e.state === 'AWAITING_PAYMENT');
  if (e.invoice) {
    $('invoice').textContent = e.invoice;
    $('openwallet').href = `lightning:${e.invoice}`;
  }
  const retry = e.state === 'SETTLED' && e.payoutStatus === 'failed';
  show('payout', seller && ((open && !e.hasPayoutInvoice) || retry));
  show('paysaved', seller && open && e.hasPayoutInvoice);
  show('payexpired', seller && e.payoutExpired);
  show('confirm', buyer && e.state === 'HELD' && e.hasPayoutInvoice);
  show('waitseller', buyer && e.state === 'HELD' && !e.hasPayoutInvoice);
  show('refund', (seller && open) || (buyer && e.state === 'AWAITING_PAYMENT'));
  $('refund').textContent = buyer || e.state === 'AWAITING_PAYMENT' ? 'Cancel this escrow' : 'Refund the buyer';
}

const refresh = () => call('/api/escrow').then(render).catch((e) => {
  if (e.message === 'Not found') {
    $('role').textContent = 'Link not found';
    $('title').textContent = 'This escrow link is not valid';
    $('help').textContent = 'Check you copied the whole link.';
  }
});

$('copy').onclick = async () => {
  try {
    await navigator.clipboard.writeText($('invoice').textContent);
    $('copy').textContent = 'Copied ✓';
    setTimeout(() => { $('copy').textContent = 'Copy payment request'; }, 2000);
  } catch { $('err').textContent = 'Could not copy. Press and hold the payment request to copy it.'; }
};
$('savepay').onclick = () => act($('savepay'), 'Checking…', async () => {
  render(await call('/api/escrow/payout', 'POST', { invoice: $('payinv').value }));
  $('payinv').value = '';
});
$('confirm').onclick = () => {
  if (!confirm('Only confirm if you have the goods in your hands. This pays the seller and cannot be undone.')) return;
  act($('confirm'), 'Releasing payment…', async () => render(await call('/api/escrow/confirm', 'POST')));
};
$('refund').onclick = () => {
  if (!confirm('This cancels the escrow. Any locked money goes back to the buyer. Continue?')) return;
  act($('refund'), 'Working…', async () => render(await call('/api/escrow/refund', 'POST')));
};
$('devpay').onclick = () => act($('devpay'), 'Paying…', async () => { await call('/api/dev/pay', 'POST'); await refresh(); });

// Demo helpers only exist with the mock backend: there is no real wallet to pay or invoice from.
$('demofill').onclick = () => {
  // A BOLT11-shaped placeholder for the right amount (n = 0.1 sat units). Only the mock accepts it.
  const tail = Array.from(crypto.getRandomValues(new Uint8Array(40)), (b) => 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'[b % 32]).join('');
  $('payinv').value = `lnbcrt${amountSats * 10}n1${tail}`;
};
config.then((c) => { if (c.mock) { show('devpay', true); show('demofill', true); } });

refresh();
setInterval(() => { if (!document.hidden) refresh(); }, 8000); // pause polling in background tabs (saves data)
