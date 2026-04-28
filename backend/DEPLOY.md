# Deploying the Aurialis backend to Cloudflare Containers

The backend (FastAPI + Demucs + madmom + librosa) runs as a Cloudflare
Container fronted by a thin Worker (`src/worker.ts`). The frontend Worker
calls it via the `NEXT_PUBLIC_DEEP_ANALYSIS_API_URL` env var.

## Prerequisites

- Cloudflare account with **Workers Paid + Containers add-on** enabled.
  - Containers free tier images are capped at 2 GB; this image is ~3.2 GB
    (PyTorch CPU + Demucs models + madmom). Paid tier allows up to 20 GB.
- `wrangler` CLI authenticated: `npx wrangler login`.
- `pnpm install` run inside `backend/` to install Worker tooling.

## First deploy

```sh
cd backend
pnpm install
pnpm wrangler deploy
```

The first deploy is slow (~6-10 minutes) because Cloudflare builds the
Docker image server-side: PyTorch (~800 MB), Demucs models (~330 MB), and
madmom from git@main (Cython compile). Subsequent deploys cache the
`pip install` layer and only rebuild from `COPY . .` onward (~30 s).

After deploy, wrangler prints the Worker URL, e.g.:

```
https://aurialis-core.<your-subdomain>.workers.dev
```

## Wire the frontend

Update `wrangler.jsonc` at the project root, replacing the localhost
placeholders:

```jsonc
"vars": {
  "NEXT_PUBLIC_SEPARATION_API_URL": "https://aurialis-core.<sub>.workers.dev",
  "NEXT_PUBLIC_DEEP_ANALYSIS_API_URL": "https://aurialis-core.<sub>.workers.dev"
}
```

Then rebuild + redeploy the frontend:

```sh
pnpm deploy   # runs OpenNext build then wrangler deploy
```

## Sizing notes

- **Instance type**: `standard` (4 vCPU / 4 GB RAM) — set in
  `wrangler.jsonc`. Demucs separation on a 4-min track uses ~3 GB peak,
  so don't drop below standard. Bumping to `enhanced` (8 vCPU / 8 GB RAM)
  ~halves separation latency at ~2× cost.
- **`max_instances: 5`**: caps horizontal scale. Each instance can serve
  one request at a time (FastAPI is single-process by default in this
  image). Raise if user load grows.
- **`sleepAfter: "10m"`**: container hibernates after 10 minutes idle to
  save cost. Cold start ~30 s while PyTorch + models load.

## Cost reality check

Standard tier billing (as of 2025-09): ~$0.000020/CPU-sec +
~$0.0000035/GB-RAM-sec. A 30-second separation at 4 vCPU + 4 GB:

```
0.00002 * 4 * 30  =  $0.0024 (CPU)
0.0000035 * 4 * 30 = $0.00042 (RAM)
total              ≈ $0.003 / separation request
```

Plus ~10 minutes of sleepAfter idle = ~$0.05/hour for the kept-warm
instance. Quiet periods cost ~$0/hour because the container sleeps.

## Direct-to-R2 upload control plane

Browsers upload audio directly to a Cloudflare R2 bucket (`aurialis-uploads`)
via S3 multipart presigned URLs. The Worker only handles the small JSON
control plane (`/upload/initiate`, `/upload/complete`, `/upload/abort`) and
mints a 10-minute presigned GET URL when forwarding `/analyze/deep` and
`/separate` to the container. R2 access keys live in Worker secrets and
never reach the container.

### One-time provisioning

1. **Create the bucket and apply lifecycle + CORS:**

   ```sh
   cd backend
   bash scripts/provision-r2.sh
   ```

   The script is idempotent. It creates `aurialis-uploads`, applies the
   48-hour object expiration + 1-day incomplete-multipart abort lifecycle
   from `r2-lifecycle.json`, and applies the CORS rules from
   `r2-cors.json`.

2. **Mint an R2 API token** at
   <https://dash.cloudflare.com/?to=/:account/r2/api-tokens>. Scope:
   *Object Read & Write* on `aurialis-uploads` only. Save the
   Access Key ID + Secret Access Key + Account ID.

3. **Store the secrets in the Worker:**

   ```sh
   cd backend
   pnpm wrangler secret put R2_ACCESS_KEY_ID
   pnpm wrangler secret put R2_SECRET_ACCESS_KEY
   pnpm wrangler secret put R2_ACCOUNT_ID
   pnpm wrangler secret put TURNSTILE_SECRET_KEY
   ```

   Verify with `pnpm wrangler secret list`.

4. **Create a Turnstile widget** at
   <https://dash.cloudflare.com/?to=/:account/turnstile>. Mode:
   *Invisible*. Hostnames: `aurialis.yosefgamble.com`, `localhost`.
   Copy the **site key** into the frontend `wrangler.jsonc` under
   `vars.NEXT_PUBLIC_TURNSTILE_SITE_KEY` and into `.env.production`.
   Copy the **secret key** into the Worker secret
   `TURNSTILE_SECRET_KEY` from step 3.

5. **Set up a Cloudflare billing alert** at
   <https://dash.cloudflare.com/?to=/:account/billing/notifications>.
   Recommended: alert at $50/day on R2 storage + Class A operations.
   The anonymous `/upload/initiate` endpoint is rate-limited per IP and
   globally, but a billing alert is the backstop.

### Verify

```sh
pnpm wrangler r2 bucket lifecycle get aurialis-uploads   # 48h + multipart abort
pnpm wrangler r2 bucket cors get aurialis-uploads        # PUT from prod + localhost
pnpm wrangler secret list                                # 4 secrets present
```

## Troubleshooting

- **`Image size exceeds limit`** during deploy → you're on free tier;
  upgrade to Workers Paid + Containers.
- **`madmom` build still failing** → confirm `gcc/g++/git` survived the
  apt-get layer; CF builds in their datacenter, so verify with `wrangler
  dispatch logs --container <id>`.
- **Worker times out at 30 s** but separation takes longer → CF
  Containers requests can run up to 30 minutes (much longer than the
  Worker fetch limit). Make sure the frontend uses the polling pattern
  (`POST /analyze/deep` + `GET /jobs/{id}/status`) — synchronous calls
  to long-running endpoints will hit the Worker timeout.
- **R2 PUT returns CORS error in browser** → re-apply CORS via
  `bash scripts/provision-r2.sh`. Browsers cache the preflight for an
  hour — if you changed `r2-cors.json`, hard-reload or wait.
- **`/upload/complete` 500s with "ETag mismatch"** → the browser stripped
  the quotes from the ETag header. Verify `r2-cors.json` has
  `"ExposeHeaders": ["ETag"]` and the frontend captures the header
  byte-for-byte (no manipulation).
