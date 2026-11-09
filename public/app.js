const $ = (id) => document.getElementById(id);

$('create').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  $('err').textContent = '';
  const res = await fetch('/api/escrows', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: $('title').value,
      amountSats: Number($('amount').value),
      ttlHours: Number($('ttl').value),
    }),
  });
  const data = await res.json();
  if (!res.ok) { $('err').textContent = data.error; return; }
  const buyerUrl = `${location.origin}/b/${data.buyerToken}`;
  $('buyer').textContent = buyerUrl;
  const msg = `Pay for "${data.escrow.title}" (${data.escrow.amountSats.toLocaleString()} sats) with escrow. Your sats stay locked until you receive it: ${buyerUrl}`;
  $('wa').href = `https://wa.me/?text=${encodeURIComponent(msg)}`;
  $('copybuyer').onclick = async () => {
    try { await navigator.clipboard.writeText(buyerUrl); $('copybuyer').textContent = 'Copied'; }
    catch { $('err').textContent = 'Could not copy. Press and hold the link to copy it.'; }
  };
  $('seller').textContent = `${location.origin}/s/${data.sellerToken}`;
  $('open').href = `/s/${data.sellerToken}`;
  $('create').classList.add('hidden');
  $('done').classList.remove('hidden');
});
