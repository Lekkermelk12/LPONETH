# Deploying LPONETH to Fly.io

This bot runs as a single always-on machine with a persistent volume for the subscriber list. No HTTP service — it only makes outbound connections (Infura + Telegram).

## One-time setup

1. Install flyctl: <https://fly.io/docs/hands-on/install-flyctl/>
2. `fly auth login`
3. From the project root, register the app (config already present):
   ```
   fly launch --no-deploy --copy-config --name lponeth
   ```
   Pick a different `--name` if `lponeth` is taken; update `app` in `fly.toml` to match.
4. Pick your region (same as `primary_region` in `fly.toml`, default `iad`) and create the volume for `subscribers.json`:
   ```
   fly volumes create lponeth_data --region iad --size 1
   ```
5. Push secrets (values from your local `.env`):
   ```
   fly secrets set \
     ETH_RPC_HTTP="https://mainnet.infura.io/v3/..." \
     ETH_RPC_WSS="wss://mainnet.infura.io/ws/v3/..." \
     TELEGRAM_BOT_TOKEN="123456:ABC..." \
     ETHERSCAN_API_KEY="..." \
     ADMIN_TELEGRAM_IDS="..."
   ```
6. Deploy:
   ```
   fly deploy
   ```
7. Pin to exactly one machine. The monitor keeps in-memory dedup state (`alerted` Set + caches) — a second machine would double-alert:
   ```
   fly scale count 1
   ```

## Ongoing

- `fly logs` — stream stdout/stderr
- `fly status` — machine + volume health
- `fly deploy` — redeploy after code changes (volume and secrets are preserved)
- `fly ssh console` — shell in, e.g. to inspect `/data/subscribers.json`

## Notes

- `SUBSCRIBERS_FILE=/data/subscribers.json` is set in `fly.toml`, pointing at the mounted volume so subscribers survive deploys and restarts.
- Telegraf uses long-polling, so no inbound ports are needed; the app has no `[http_service]` block on purpose.
- Memory is set to 256 MB — plenty for ethers + telegraf idle. Bump in `fly.toml` if you start seeing OOMs under heavy pair activity.
