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
  $('buyer').textContent = `${location.origin}/b/${data.buyerToken}`;
  $('seller').textContent = `${location.origin}/s/${data.sellerToken}`;
  $('open').href = `/s/${data.sellerToken}`;
  $('create').classList.add('hidden');
  $('done').classList.remove('hidden');
});
