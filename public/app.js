import './banner.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n).toLocaleString('en');

async function copy(btn, text) {
  try {
    await navigator.clipboard.writeText(text);
    const old = btn.textContent;
    btn.textContent = 'Copied ✓';
    setTimeout(() => { btn.textContent = old; }, 2000);
  } catch {
    $('err').textContent = 'Could not copy. Press and hold the link to copy it.';
  }
}

function validate() {
  const title = $('title').value.trim();
  const amount = Number($('amount').value);
  if (!title) return ['title', 'Tell your buyer what you are selling.'];
  if (!Number.isInteger(amount) || amount < 1000) return ['amount', 'Enter a whole number of sats, at least 1,000.'];
  return null;
}

$('create').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  $('err').textContent = '';
  const bad = validate();
  if (bad) { $('err').textContent = bad[1]; $(bad[0]).focus(); return; }

  const btn = $('createbtn');
  btn.disabled = true;
  btn.textContent = 'Creating…';
  try {
    const res = await fetch('/api/escrows', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: $('title').value.trim(),
        amountSats: Number($('amount').value),
        ttlHours: Number($('ttl').value),
      }),
    });
    const data = await res.json().catch(() => ({ error: 'Network problem. Check your connection and try again.' }));
    if (!res.ok) { $('err').textContent = data.error; return; }

    const { title, amountSats } = data.escrow;
    const buyerUrl = `${location.origin}/b/${data.buyerToken}`;
    const sellerUrl = `${location.origin}/s/${data.sellerToken}`;
    $('done-sub').textContent = `${title} · ${fmt(amountSats)} sats`;
    $('buyer').textContent = buyerUrl;
    $('seller').textContent = sellerUrl;
    $('open').href = `/s/${data.sellerToken}`;
    const msg = `Hi! Please pay for "${title}" (${fmt(amountSats)} sats) here. Your money stays locked until you receive it: ${buyerUrl}`;
    $('wa').href = `https://wa.me/?text=${encodeURIComponent(msg)}`;
    $('copybuyer').onclick = () => copy($('copybuyer'), buyerUrl);
    $('copyseller').onclick = () => copy($('copyseller'), sellerUrl);

    $('start').classList.add('hidden');
    $('done').classList.remove('hidden');
    window.scrollTo(0, 0);
  } catch {
    $('err').textContent = 'Network problem. Check your connection and try again.';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create escrow';
  }
});
