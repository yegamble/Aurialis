# Aurialis Backend

FastAPI service that powers Smart Split (Demucs stem separation) and Deep Analysis (sections + AI mastering script). Fronted in production by a Cloudflare Worker (`backend/src/worker.ts`) that proxies to a Cloudflare Container running this image.

## Layout

```
backend/
├── main.py                    Route handlers + FastAPI app factory
├── validation.py              Audio-upload magic-byte sniff + size cap
├── separation.py              Demucs separation worker (background thread)
├── deep_analysis.py           Section detection + script generation worker
├── stem_artifacts.py          Per-stem AI-artifact analysis
├── jobs.py                    Job state store (JSON file on disk)
├── observability.py           OpenTelemetry tracing + structured logs
├── script_generator.py        MasteringScript composition
├── schemas/                   JSON Schema for the script contract
├── tests/                     pytest unit + integration tests
│   └── postman/               Postman/Newman E2E suite (this doc)
├── Dockerfile                 Python 3.11-slim + ffmpeg + libsndfile + madmom
├── requirements.txt           Python deps (uv-managed)
├── pyproject.toml             pytest config
├── wrangler.jsonc             Cloudflare Worker fronting the container
└── src/worker.ts              Worker proxy
```

## Local Dev

```bash
docker compose up backend            # Boot on http://localhost:8000
docker compose restart backend       # Reload after image rebuild
docker compose down -v               # Tear down + delete /tmp/smart-split volume
```

First build pulls PyTorch + Demucs + madmom (~6-8 min). Subsequent builds cache up to the `COPY .` layer (~30 s).

## Running pytest

```bash
cd backend
uv run pytest -q                              # Quiet, all tests
uv run pytest tests/test_validation.py -q     # Just validation
uv run pytest -q --cov=validation             # With coverage
uv run ruff check .                           # Lint
uv run ruff format .                          # Format
```

## Running Postman / Newman (Local)

```bash
# REQUIRED for the Security folder (TS-007 oversized assertion). Cap the
# backend at ~200 MB so the 250 MB oversized.bin fixture triggers a 413.
# CI sets this automatically via the workflow env block; local dev must
# export it before `docker compose up`.
export MAX_UPLOAD_BYTES_OVERRIDE=209715200

docker compose up backend -d                  # Backend must be running
cd backend
uv run python tests/postman/fixtures/generate-fixtures.py
cd ..

pnpm run test:backend:postman                 # PR Suite (Health + Happy + Edge + Security)
pnpm run test:backend:postman:long            # Long Audio (Nightly) — 10 min audio
pnpm run test:backend:postman:smoke           # Production smoke (read-only)
```

If you run `pnpm run test:backend:postman` without the env var set, TS-007 fails because the 250 MB fixture is under the 1 GB default cap and the validator rejects on magic-byte mismatch (400) instead of size (413).

The runner script (`backend/tests/postman/run-newman.sh`) supports more granular flags:

```bash
bash backend/tests/postman/run-newman.sh \
  --env local|ci|production \
  --folder "PR Suite" | "Long Audio (Nightly)" | "Production Smoke" | "Health" \
  --delay-request 2000 \
  --reporter cli-only|junit-only|both \
  --bail
```

JUnit results go to `backend/tests/postman/results/newman-results.xml` (gitignored).

## Test Scenarios

| ID | Name | Coverage |
|----|------|----------|
| TS-001 | Health Check | `GET /health` |
| TS-002 | Separate Enqueue | `POST /separate` (no GPU polling) |
| TS-003 | Deep Analyze Round-Trip | `POST /analyze/deep` polled to `done` |
| TS-004 | Cancel Job | `DELETE /jobs/{id}` idempotency |
| TS-005 | Audio Edge Cases | tiny, mono 8 kHz, mono 96 kHz |
| TS-006 | Reject Non-Audio | PDF, EXE, spoofed `.wav` |
| TS-007 | Reject Oversized | 250 MB upload → 413 |
| TS-008 | Reject Corrupted WAV | RIFF magic but bad body |
| TS-009 | Invalid Params + CRLF | bogus model/profile + filename injection |
| TS-010 | Path Traversal (pytest) | `_download_stem` rejects `../` |
| TS-011 | CORS Preflight | allowed vs disallowed origin |
| TS-012 | Long Audio (nightly) | 10-minute deep analysis |
| TS-013 | Stem Download (pytest) | happy + missing-file paths |

## CI Integration

- **PR CI** (`backend-e2e` job in `.github/workflows/ci.yml`) — boots docker compose, generates fixtures, runs `PR Suite`. Blocks merge on failure.
- **Nightly** (`.github/workflows/backend-e2e-nightly.yml`) — runs `PR Suite` + `Long Audio (Nightly)` on cron `0 7 * * *` UTC.
- **Post-deploy** (`smoke-production` job in `.github/workflows/deploy.yml`) — runs `Production Smoke` (read-only `GET /health`) against `https://aurialis-core.yosefgamble.com`.

## Adding New Postman Tests

1. Open `backend/tests/postman/aurialis-backend.postman_collection.json`.
2. Add a new item to the right folder. Use `pm.environment.set('jobId', ...)` to share state between requests.
3. For polling, follow the `setNextRequest` pattern in `TS-003: Poll Status` — Newman's `--delay-request` flag governs the actual delay (in-script `setTimeout` is a no-op).
4. For new fixtures, add a builder to `backend/tests/postman/fixtures/generate-fixtures.py` and re-run with `--clean`.

## Updating Fixtures

Generated fixtures are sha256-tracked. To regenerate after a builder change:

```bash
cd backend
uv run python tests/postman/fixtures/generate-fixtures.py --clean
```

The MP3 + M4A fixtures are committed seeds at `backend/tests/postman/fixtures/_seeds/`. Replace these with real encoded samples if you add MP3/M4A round-trip ML tests.

## Configuration

- `MAX_UPLOAD_BYTES_OVERRIDE` (env var) — overrides the 1 GB upload cap. CI sets it to ~200 MB so the 250 MB oversized fixture triggers a 413.
- `OTEL_EXPORTER_OTLP_ENDPOINT` (env var) — ship traces to an external collector instead of stdout.

## Production URL

- Backend: `https://aurialis-core.yosefgamble.com`
- Frontend: `https://aurialis.yosefgamble.com`
