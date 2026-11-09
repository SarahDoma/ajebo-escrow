/** Shows which network the app runs on, so nobody mistakes test sats for real money. */
const TEXT = {
  demo: 'Demo mode: payments are simulated. No real money moves.',
  regtest: 'Test network (regtest): test bitcoin only, no real money.',
  signet: 'Test network (signet): test bitcoin only, no real money.',
  mutinynet: 'Test network (Mutinynet): test bitcoin only, no real money.',
  testnet: 'Test network (testnet): test bitcoin only, no real money.',
};

export const config = fetch('/api/config').then((r) => r.json()).catch(() => ({}));

config.then(({ network }) => {
  const el = document.getElementById('banner');
  if (!el || !network || network === 'mainnet') return;
  el.textContent = TEXT[network] || `Test network (${network}): no real money.`;
  el.classList.remove('hidden');
});
