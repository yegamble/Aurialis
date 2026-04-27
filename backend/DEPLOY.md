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
