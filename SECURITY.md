# Security and threat model

## Assets
- The buyer's sats while locked in the hold invoice.
- The invoice **preimage** (whoever holds it can settle).
- Seller and buyer bearer links.

## Design choices
| Risk | Mitigation |
|---|---|
| Server operator steals buyer funds | Funds sit in an in-flight HTLC. If the server does nothing, they return to the buyer at expiry. Settlement needs the preimage, which is only used after the buyer confirms. |
| Seller takes money and ships nothing | Seller cannot settle. Only the buyer's confirmation releases funds. |
| Buyer receives goods and stalls | Known limit: funds refund at timeout. See "Not solved yet". |
| Link guessing | Tokens are 192-bit random secrets. Only SHA-256 hashes are stored. Comparison is constant-time. Unknown and wrong tokens both return 404. |
| Role confusion | Seller cannot confirm, buyer cannot set payout, and the buyer cannot refund after funds are held. |
| Races (double confirm, confirm + refund) | Operations run under a per-escrow lock. Tested. |
| Secret leakage | Preimage and token hashes never appear in API responses. The server does not log URLs or tokens. `Referrer-Policy: no-referrer`, `Cache-Control: no-store`. |
| XSS | Strict CSP (`script-src 'self'`), all dynamic text set with `textContent`. |
| Abuse | Input validation (title length, integer sat limits, hold time), 4 KB body cap, per-IP rate limit. Behind a proxy the client IP header is trusted only when `TRUST_PROXY=1`, so it can't be forged elsewhere. |
| Wrong or stale payout invoice | Payout invoices are decoded by LND: the amount must equal the escrow, the network must match, and they must stay valid for at least 10 minutes. If the invoice expires while funds are held, the buyer can't confirm until the seller adds a fresh one, so the server never settles with nowhere to send the sats. |
| Running against real money by accident | A banner shows the network on every page. The server refuses to start with `LN_NETWORK=mainnet` unless `ALLOW_MAINNET=1`. |
| Container privileges | The app runs as the unprivileged `node` user. The entrypoint starts as root only to hand the mounted volume to `node` (mode 700), then drops root. Secrets come from the host's secret store, never from the image or git. |
| LND compromise blast radius | The app uses a baked macaroon limited to invoices and off-chain payments. We checked on regtest that it is denied on-chain balance, new addresses and sending coins. LND's TLS certificate is pinned (`LND_TLS_CERT_PATH`). |
| Payout lost to a transient failure | Payouts retry 3 times with backoff. Retrying is safe because Lightning never pays the same payment hash twice. If all retries fail, the seller can submit a fresh invoice. Failures are logged without the invoice or secrets. |
| Real funds during development | Default backend is `mock`. Use regtest or signet for LND. |

## Not solved yet (honest limits)
- **Disputes.** There is no arbiter. If the buyer never confirms, funds refund at timeout. A 2-of-3 arbiter flow is the next step.
- **Custodial hop on payout.** After settlement the server holds the sats briefly and pays the seller's invoice. If the payout fails, the seller can retry with a new invoice. A fully non-custodial design needs the seller's node to receive the HTLC directly.
- **Persistence** is a JSON file. Use SQLite and encrypt the preimage at rest for production.
- **Hold-invoice CLTV limits.** The hold time is capped by the HTLC's CLTV expiry on the real network. Keep it to about one day for payments on mainnet.
- **Rate limiting** is per process and in memory.
