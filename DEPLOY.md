# Deploying Ajebo Escrow

The app ships as one Docker image. It needs:
- a host that keeps a **persistent volume** (escrow data includes the secrets that release held payments)
- optionally, an always-on **LND node on a test network** (signet or Mutinynet) for real Lightning

Without a node, it runs in **demo mode**: payments are simulated and a banner says so.

## 1. Fly.io, demo mode (about 10 minutes)

Install the Fly CLI (https://fly.io/docs/flyctl/install/), then from this folder:

```bash
fly auth login
```

```bash
fly launch --copy-config --no-deploy
```
When asked, keep the existing `fly.toml`. If the name `ajebo-escrow` is taken, pick another; Fly updates `fly.toml`.

```bash
fly volumes create escrow_data --size 1 --region lhr
```

```bash
fly deploy
```

```bash
fly open
```

Check that `https://<your-app>.fly.dev/healthz` returns `{"ok":true}`.

## 2. Switch to real Lightning on a test network

1. Create an **LND node on signet or Mutinynet** with a hosted provider (for example Voltage). Get test coins from the network's faucet, and open a channel so the node has both inbound liquidity (to receive buyers' payments) and outbound liquidity (to pay sellers).
2. Bake a least-privilege macaroon on that node (invoices and off-chain only, no on-chain):
   ```bash
   lncli bakemacaroon invoices:read invoices:write offchain:read offchain:write info:read
   ```
3. Set the secrets on Fly. Secrets are encrypted and never go in `fly.toml` or git:
   ```bash
   fly secrets set LND_REST_URL=https://<your-node-host>:8080 LND_MACAROON_HEX=<baked macaroon hex>
   ```
   Hosted nodes usually have a publicly trusted TLS certificate, so `LND_TLS_CERT_PATH` is not needed. For a self-signed node, add the certificate to the image and set the path.
4. In `fly.toml`, change `[env]` to:
   ```toml
   LN_BACKEND = "lnd"
   LN_NETWORK = "signet"   # or "mutinynet"
   ```
5. Deploy again:
   ```bash
   fly deploy
   ```

The banner now reads "Test network (signet)". The app refuses to start with `LN_NETWORK=mainnet` unless `ALLOW_MAINNET=1` is set.

## 3. Other hosts

Any Docker host with a volume works (Railway, a VPS). Set the same environment variables, mount a volume at `/data`, set `DATA_FILE=/data/escrows.json`, and set `TRUST_PROXY=1` only if the app sits behind a proxy that sets the client IP header.

## Environment reference

| Variable | Purpose |
|---|---|
| `LN_BACKEND` | `mock` (demo) or `lnd` |
| `LN_NETWORK` | `regtest`, `signet`, `mutinynet`, `testnet` or `mainnet`. Drives the banner and the mainnet guard |
| `LND_REST_URL`, `LND_MACAROON_HEX` | LND connection (secrets) |
| `LND_TLS_CERT_PATH` | Only for self-signed LND certificates |
| `DATA_FILE` | Where escrows are stored, on the volume |
| `TRUST_PROXY` | `1` behind Fly/Railway: use the proxy's client IP for rate limiting and send HSTS |
| `MIN_SATS`, `MAX_SATS` | Escrow amount limits |
