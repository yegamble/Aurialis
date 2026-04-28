# Direct-to-R2 Upload Implementation Plan

Created: 2026-04-28
Author: yegamble@gmail.com
Status: PENDING
Approved: Yes
Iterations: 0
Worktree: No
Type: Feature

## Summary

**Goal:** Upload audio files directly to Cloudflare R2 (browser → R2) instead of through the Worker → DO Container path, so deep analysis and smart-split work for files larger than ~10 MB.

**Architecture:** Frontend mints S3-multipart presigned PUT URLs from the `aurialis-core` Worker (gated by Cloudflare Turnstile + per-IP rate limit + global rate limit), uploads parts directly to R2, then POSTs JSON `{key, ...}` to `/analyze/deep` and `/separate`. The Worker mints a short-lived presigned **GET** URL for the container, which downloads the object once via `httpx.stream` to local disk and never re-fetches. R2 credentials live only in the Worker; the container has no R2 keys.

**Tech Stack:** Cloudflare R2 (S3 API + R2 binding), `aws4fetch` for SigV4 in the Worker, Cloudflare Turnstile (invisible mode) for abuse control, Durable Object for per-IP and global rate limiting, R2 48-hour lifecycle rule for cleanup, FastAPI + httpx in the container.

## Scope

### In Scope

- New R2 bucket `aurialis-uploads` with **48h lifecycle rule** and CORS allowing PUT from `https://aurialis.yosefgamble.com` and `http://localhost:3000`.
- Backend Worker (`aurialis-core`): R2 binding, Turnstile verification (on **both** `/upload/initiate` and `/upload/complete`), per-IP **and** global rate-limiter Durable Objects, three new endpoints — `POST /upload/initiate`, `POST /upload/complete`, `POST /upload/abort`. Worker also mints a presigned GET when forwarding `/analyze/deep` and `/separate` to the container.
- FastAPI container: `_analyze_deep` and `_separate` accept JSON `{fetchUrl, profile|model}` instead of multipart `UploadFile`. Container downloads the object **once** to local disk via `httpx.stream` and never re-fetches. Streaming validation aborts early on bad magic bytes or oversized Content-Length. Old multipart endpoints stay through Task 9's gates, then are removed.
- Frontend: new `src/lib/api/r2-upload.ts` providing chunked S3 multipart upload (initiate → parallel part PUTs with retries → complete). `startDeepAnalysis` and `startSeparation` switch from `FormData` to `r2-upload` + JSON POST.
- Frontend Turnstile widget integration on upload entry points (master page, smart-split entry point); token re-fetched before `/upload/complete`.
- Tests: backend unit tests for the new endpoints (mocking R2 binding and Turnstile), frontend unit tests for `r2-upload`, updated E2E tests covering large-file upload + small-file path + Turnstile failure + memory ceiling.
- Observability: OTel spans for `upload.initiate`, `upload.complete`, `download.r2`, `download.r2.validation_aborted` in the container; metrics counters for `multipart_legacy_calls` (used to gate Task 9).
- Cost guardrails: Cloudflare billing alert at $50/day on the R2 account (manual setup + documented), global rate limit 1000 initiates/hr account-wide, initial soft cap `MAX_UPLOAD_BYTES = 1 GB` with env-var override to lift as usage data justifies.

### Out of Scope

- Resumable across browser refresh (we keep the multipart upload in memory only — closing the tab aborts).
- File compression (FLAC/MP3 encoding) on the client — defer.
- Replacing the DO Container architecture (the Worker→DO path stays, only the body path changes).
- Authenticated user accounts — Turnstile + rate-limit only.
- Multipart abort cleanup beyond the 48h lifecycle rule (incomplete uploads cost storage but lifecycle removes them; lifecycle does NOT cover Class A op costs — see Risks).
- Lifting `MAX_UPLOAD_BYTES` above 1 GB without an explicit follow-up (env var override exists but raising the default requires usage data + cost-envelope review).

## Approach

**Chosen:** S3 Multipart Upload via SigV4-presigned PUT URLs minted by the Worker, with R2 binding handling create/complete on the control plane.

**Why:** Direct browser → R2 bypasses the Worker body path entirely (the original bug). Multipart gives resumability per-part on flaky connections and parallel part uploads for speed. Using the R2 binding for `createMultipartUpload`/`complete` simplifies the Worker code (no XML parsing); using `aws4fetch` for per-part presigning keeps the bundle small. It costs ~250 lines of frontend chunking logic and one new Worker dependency.

**Alternatives considered:**

- **Single presigned PUT (up to 5 GB):** simpler, ~50 fewer LoC, but no resumability — a 4 GB upload that drops at 80% restarts from zero. User explicitly chose multipart.
- **Worker proxies PUT via R2 binding:** doesn't fix the bug — body still flows through the Worker, hitting the same 100 MB / DO limits.
- **Switch backend off Cloudflare Containers (move FastAPI to Fly/Render):** much larger change, loses edge benefits, deferred.

## Autonomous Decisions

The following were chosen by the implementer based on findings during planning. Flag any disagreement before approval.

- **Container reads via presigned GET (not S3 SDK):** keeps R2 credentials in the Worker only. Container does `httpx.stream("GET", fetch_url)` — no boto3 added.
- **One-shot download to local disk:** container downloads the full object once at job start to a `tempfile` and never re-fetches from R2. Eliminates lifecycle-race risk during long jobs.
- **`aws4fetch` (3 KB) over `@aws-sdk/client-s3` (~1.5 MB) for SigV4 signing:** Worker bundle stays well under 1 MB.
- **Turnstile in invisible mode, validated on BOTH `/upload/initiate` AND `/upload/complete`:** challenge runs in the background; complete-side gate caps per-session abuse (one stolen token can't drive an unbounded multipart upload).
- **Rate limit: 10 presigns / IP / hour** via a per-IP Durable Object keyed by `cf-connecting-ip`. Configurable via `RATE_LIMIT_PER_HOUR` env var.
- **Global rate limit: 1000 initiates / hour account-wide** via a separate `GlobalRateLimitDO`. Backstop against distributed botnet abuse. Configurable via `GLOBAL_RATE_LIMIT_PER_HOUR`.
- **Initial size cap: 1 GB** (`MAX_UPLOAD_BYTES = 1 * 1024**3`). Env-var override `MAX_UPLOAD_BYTES_OVERRIDE` for raising. Plan does NOT enable 5 GB by default — that requires usage data + cost-envelope review.
- **Chunk size: 16 MB.** Min R2 part size is 5 MB except the last; 16 MB gives 6 parts per 100 MB / 64 per 1 GB — well under the 10,000-part ceiling.
- **Concurrency: 4 parallel parts.** Saturates a typical home connection without thrashing R2 rate limits.
- **Retries: 3 attempts per part with exponential backoff (1 s → 2 s → 4 s).**
- **Per-part presigned URL expiry: 6 hours.** 1 GB / 6 h = 47 KB/s, comfortably below any usable connection. Bumped from 60 min to absorb the original concern about slow uplinks; eliminates the need for a `/upload/refresh-parts` endpoint.
- **Lifecycle: 48 hours** (was 24 h). Removes the lifecycle-race concern for jobs queued near hour-23. Storage cost increase is negligible at expected volumes.
- **Streaming validation order:** read first 64 KB → magic-byte sniff; read first 1 MB → soundfile-header probe. Abort the `httpx.stream` context manager on either failure. Cap full download at `Content-Length <= MAX_UPLOAD_BYTES` before streaming any bytes.
- **Old multipart endpoints stay through Task 9's explicit gates:** see Task 9 for the three-condition gate (>= 7 days bake, 0 multipart hits in trailing 48 h, CHANGELOG pre-announce).

## Context for Implementer

> Write for an implementer who has never seen the codebase.

- **Worker entry point:** `backend/src/worker.ts:36` currently does a single `stub.fetch(request)` passthrough. New endpoints (`/upload/initiate` etc.) are handled in the Worker itself before falling through to `stub.fetch` for `/analyze/deep`, `/separate`, `/jobs/...`, `/health`.
- **Patterns to follow:**
  - JSON error responses match FastAPI's shape: `{"detail": "<message>"}` with appropriate status codes (`backend/main.py:88`).
  - CORS headers come from FastAPI middleware (`backend/main.py:252`); the Worker today is transparent. New Worker-handled endpoints must set the same `access-control-allow-origin: https://aurialis.yosefgamble.com` (vary on Origin), `access-control-allow-credentials: true`, `access-control-expose-headers: traceparent`. Add a small CORS helper in the Worker.
  - Job creation pattern: see `start_deep_analysis` in `backend/deep_analysis.py:36` and `start_separation` in `backend/separation.py:25`. Both take an `input_path` and spawn a daemon thread.
  - Frontend error class: `DeepAnalysisError` (`src/lib/api/deep-analysis.ts:58`) wraps a structured `DeepErrorDetails`. The new `r2-upload.ts` should reuse the same shape so the existing error UI keeps working.
  - Environment variable plumbing: backend reads `NEXT_PUBLIC_DEEP_ANALYSIS_API_URL` / `NEXT_PUBLIC_SEPARATION_API_URL` from `process.env` at build time (`src/lib/api/deep-analysis.ts:9`), set in `wrangler.jsonc:24-27`. Add `NEXT_PUBLIC_TURNSTILE_SITE_KEY` to the frontend wrangler `vars`.
- **Conventions:**
  - Worker code is TypeScript with `@cloudflare/containers` and Cloudflare's `wrangler` typings.
  - Backend Python uses `from __future__ import annotations` + modern types (`list[X]`, `X | None`).
  - Naming: kebab-case files, camelCase JS, snake_case Python.
- **Key files:**
  - `backend/src/worker.ts` — add Worker route handling for new endpoints, keep `stub.fetch` fallthrough.
  - `backend/wrangler.jsonc` — add R2 binding + Turnstile + rate-limit DO bindings; secrets via `wrangler secret put`.
  - `backend/main.py` — add JSON variants of `_analyze_deep` and `_separate`; keep multipart variants until Task 9.
  - `backend/validation.py` — refactor `validate_audio_upload` so the existing logic also accepts raw bytes (currently takes `UploadFile`).
  - `src/lib/api/r2-upload.ts` (new) — chunked multipart upload client.
  - `src/lib/api/deep-analysis.ts` — `startDeepAnalysis` switches to R2 + JSON.
  - `src/lib/api/separation.ts` — `startSeparation` switches to R2 + JSON, plus add structured error handling parity with deep-analysis.
  - `src/components/upload/UploadScreen.tsx` and `src/components/mastering/DeepMastering.tsx` — render Turnstile widget, capture token, pass to upload helper.
  - `wrangler.jsonc` — add `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.
- **Gotchas:**
  - R2 bucket CORS is configured separately from FastAPI CORS. Browsers will block PUTs to R2 if `AllowedOrigins`, `AllowedMethods: PUT`, and `ExposeHeaders: ETag` aren't set. Configure via `wrangler r2 bucket cors put` or the dashboard.
  - The browser only sees `ETag` from each part PUT response if it's in `ExposeHeaders` — without this, multipart `complete` will fail.
  - R2 multipart upload requires every part except the last to be ≥ 5 MB. The chunker must enforce this.
  - Cloudflare Container `stub.fetch(request)` with a JSON body works fine because the body is small (KB-scale). Only multipart fell over.
  - `aws4fetch` signs the URL with `X-Amz-Date` and a 5-min default expiry; bump expiry to 60 min for parts so a slow-uploading 5 GB file doesn't have parts time out mid-upload.
  - Turnstile verification calls `https://challenges.cloudflare.com/turnstile/v0/siteverify` with the secret key. Workers can `fetch` this directly.
  - Frontend Worker (`aurialis`) is built via OpenNext — it serves Next.js but doesn't proxy uploads. All upload traffic goes directly to `aurialis-core`.
  - `MAX_UPLOAD_BYTES = 200 MB` in `backend/validation.py:22` blocks files >200 MB. Lift to 5 GB in Task 3.
- **Domain context:** Cloudflare R2 is S3-compatible. The "S3 multipart upload" protocol means: `CreateMultipartUpload` → many `UploadPart` → `CompleteMultipartUpload`. Each `UploadPart` returns an ETag; `Complete` takes the list of `(partNumber, etag)`. This is unrelated to HTTP `multipart/form-data` — different protocol entirely.

## Runtime Environment

- **Frontend:** `pnpm dev` (port 3000) for local; `wrangler deploy` for prod (Cloudflare Workers via OpenNext).
- **Backend Worker:** `cd backend && wrangler deploy`. Health: `https://aurialis-core.yosefgamble.com/health`.
- **R2 bucket:** `aurialis-uploads` (created in Task 1). Inspect via `wrangler r2 object list aurialis-uploads`.
- **Turnstile:** site at https://dash.cloudflare.com/?to=/:account/turnstile (created in Task 1).
- **Local container:** `cd backend && docker compose up` (already exists). For dev, the container reads from R2 using the same presigned-GET path — works locally as long as the Worker is reachable, OR a dev-mode bypass uses a local file path.

## Assumptions

- The Cloudflare account has R2 enabled and quota available — supported by `backend/wrangler.jsonc:1` already running on Cloudflare Containers (paid plan). Tasks 1, 2 depend on this.
- Turnstile is enabled on the account or can be enabled on the free tier — supported by Cloudflare's free Turnstile offering. Tasks 2, 6 depend on this.
- The container can make outbound HTTPS GETs to `*.r2.cloudflarestorage.com` — supported by Cloudflare Containers' default network policy (no egress restrictions documented). Task 3 depends on this.
- Browser `fetch` supports streaming a `Blob.slice(start, end)` as a PUT body without buffering the whole file — supported by all evergreen browsers. Task 4 depends on this.
- The existing `validate_audio_upload` validation logic operates on bytes (it does internally — `await file.read()` then a sync `_validate_audio_bytes`). Refactoring to a public `validate_audio_bytes(data, max_bytes)` is straightforward. Task 3 depends on this.
- E2E tests run against a live container in CI (`e2e/deep-mastering.spec.ts:28` already skips if backend unreachable). Multipart can be exercised locally with a small chunk-size override. Task 8 depends on this.

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| R2 access keys leak via Worker logs | Low | Critical | Store as Wrangler secrets, never log, never include in error responses. Code-review checklist item. |
| R2 bucket CORS misconfigured → all PUTs blocked | Medium | High | Apply CORS via `wrangler r2 bucket cors put` in Task 1; verify via E2E TS-001. |
| Turnstile fails on legitimate users | Medium | Medium | Invisible mode with managed-challenge fallback. Clear retry UI on failure. |
| ETag mismatch on multipart Complete | Low | High | Pass ETag byte-for-byte from R2 PUT response (no quote-stripping). Task 2 DoD asserts pass-through; Task 4 DoD asserts test mirrors the format R2 returns. |
| Slow upload causes part presigned URL to expire | Low | High | 6-hour per-part expiry (47 KB/s for 1 GB cap). Adequate margin for typical residential uplinks. |
| Per-IP rate limit blocks team during demo | Low | Medium | `RATE_LIMIT_PER_HOUR` env var, default 10. |
| Global rate-limit blocks legitimate traffic | Low | High | `GLOBAL_RATE_LIMIT_PER_HOUR` env var, default 1000 — comfortably above expected solo-user load. Cloudflare billing alert at $50/day catches overage before it bites. |
| Container can't reach R2 | Low | High | Health check verifies via a no-op presigned GET in Task 3. CI gate. |
| Old multipart endpoint removed while stale clients still using it | Medium | Medium | Task 9 gates: (a) ≥ 7 days since frontend deploy, (b) 0 `multipart_legacy_calls` in trailing 48 h, (c) CHANGELOG pre-announce 7 days before removal. |
| Browser memory blows up on large upload | Low | Medium | `Blob.slice(start, end)` is lazy. TS-008 explicitly asserts `performance.memory.usedJSHeapSize` stays below 200 MB at every progress checkpoint during a 1 GB upload. |
| Turnstile token reuse abuses one upload session | Medium | Medium | Token validated on **both** `initiate` and `complete` — caps per-session abuse. Combined with `MAX_UPLOAD_BYTES = 1 GB` and 1000 part ceiling, effective per-upload budget is well-bounded. |
| 24h lifecycle deletes object mid-job | Low | High | Lifecycle bumped to 48 h. Container performs **one-shot download** to local disk at job start (`httpx.stream` writes to tempfile, then closes) — no re-fetches. Even a job that runs 47 hours after upload can complete because R2 is touched only once. |
| Streaming validation accepts a 5 GB malicious download before rejection | Medium | Medium | Validate magic bytes from first 64 KB AND parse audio header from first 1 MB **before** continuing the stream. Compare `Content-Length` against `MAX_UPLOAD_BYTES` before reading any bytes. Abort the `httpx.stream` context manager on validation failure. Test in Task 8. |
| Cost-amplification via anonymous initiate | Medium | High | (a) Turnstile (invisible) on initiate AND complete; (b) per-IP rate limit 10/hr; (c) global rate limit 1000/hr account-wide; (d) `MAX_UPLOAD_BYTES = 1 GB` initial; (e) Cloudflare billing alert at $50/day on the R2 account. |
| SSRF via crafted `key` on `/analyze/deep` | Low | Critical | Worker validates key matches `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(wav\|flac\|mp3\|aiff\|aif\|ogg)$` (case-insensitive ext). `presignR2Get` hard-codes bucket = `env.UPLOADS_BUCKET_NAME` constant — never accepts bucket as parameter. Container only sees the minted `fetchUrl`, never the raw key. |
| Worker bundle exceeds Cloudflare 1 MB compressed limit | Low | High | Task 2 DoD: `wrangler deploy --dry-run` reports compressed bundle < 800 KB. CI step gates on this. Baseline current bundle size in plan during Task 2. |

## Goal Verification

### Truths

1. **A 100 MB+ deep-analysis upload completes end-to-end** — currently broken; verified by TS-001.
2. **Smart-split works for 100 MB+ files** — same fix applied; verified by TS-003 + TS-007.
3. **The browser network panel shows direct PUTs to `*.r2.cloudflarestorage.com`** — confirms the Worker is no longer in the body path; verified by manual inspection during TS-001.
4. **The container has no R2 credentials configured** — verified by `grep -r 'R2\|AWS_' backend/*.py` returning no matches and `wrangler secret list --name aurialis-core-container` showing no R2 envs.
5. **Turnstile blocks an unauthenticated `/upload/initiate` AND `/upload/complete`** — backend unit tests in Task 2 cover both endpoints (cf-connecting-ip injection makes E2E flaky — moved to backend Vitest).
6. **R2 lifecycle removes objects after 48h** — verified manually after first deploy by listing the bucket two days later. (Out of scope for the E2E suite — too long.)
7. **The Worker request body never exceeds ~50 KB on `/upload/initiate`, `/upload/complete`, `/analyze/deep`** — verified by inspecting Cloudflare Worker logs / OTel spans during TS-001.
8. **An interrupted upload (kill network mid-flight, restore, retry) resumes from the last-completed part** — verified by TS-002.
9. **Browser memory stays under 200 MB during a 1 GB upload** — verified by TS-008 capturing `performance.memory.usedJSHeapSize` at 25/50/75/100% progress checkpoints.
10. **Streaming validation aborts a malicious download before completion** — backend test in Task 8 covers a 5 GB stream that yields invalid magic bytes after the first 1 MB.
11. **Old multipart endpoints return 410 Gone after Task 9** — backend unit test in Task 9 covers the 410 path; E2E TS-006 removed (post-deploy only).

### Artifacts

- `backend/src/worker.ts` — Worker endpoints.
- `backend/main.py` — JSON `_analyze_deep_v2`, `_separate_v2`.
- `backend/validation.py` — public `validate_audio_bytes`.
- `src/lib/api/r2-upload.ts` — chunked upload client.
- `src/lib/api/deep-analysis.ts`, `src/lib/api/separation.ts` — wired through R2.
- `wrangler.jsonc` (frontend), `backend/wrangler.jsonc` — bindings + env.
- New tests: `backend/tests/test_r2_upload.py`, `backend/tests/test_main_json_endpoints.py`, `src/lib/api/__tests__/r2-upload.test.ts`, `e2e/r2-upload.spec.ts`.

## E2E Test Scenarios

### TS-001: Deep analysis on a >100 MB WAV completes

**Priority:** Critical
**Preconditions:** Backend deployed, R2 bucket with CORS, Turnstile site key valid, no in-flight job.
**Mapped Tasks:** Task 2, Task 3, Task 4, Task 5

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/master`, drop a 120 MB WAV onto the upload zone. | Upload UI shows progress 0%. Network panel shows POST to `/upload/initiate` returning `{uploadId, key, partUrls: […]}`. |
| 2 | Wait for upload to progress past 50%. | Network panel shows multiple `PUT https://*.r2.cloudflarestorage.com/...` with 200 responses. No PUT to `aurialis-core.yosefgamble.com`. |
| 3 | Wait for upload to reach 100%. | POST `/upload/complete` returns 200. Then POST `/analyze/deep` returns `{jobId, status: "queued"}`. |
| 4 | Wait for analysis to complete (poll status). | DeepProgressCard shows 100%. `MasteringScript` populates. No `DeepAnalysisError` displayed. |

### TS-002: Resumable upload — kill network mid-upload, restore

**Priority:** Critical
**Preconditions:** Same as TS-001.
**Mapped Tasks:** Task 4

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Start uploading a 200 MB WAV. | Upload starts, progress climbs. |
| 2 | At ~40%, disconnect network (Chrome DevTools → Network → Offline). | Some part PUTs fail. UI surfaces "Upload paused — retrying". |
| 3 | After ~5 s offline, restore network. | Failed parts retry with exponential backoff and succeed. Progress resumes from the last-completed part — does NOT restart from 0. |
| 4 | Upload reaches 100%. | `/upload/complete` succeeds; analysis starts. |

### TS-003: Smart-split on a small file (10 MB)

**Priority:** High
**Preconditions:** Same as TS-001.
**Mapped Tasks:** Task 4, Task 5

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/smart-split`, drop a 10 MB WAV. | Upload UI shows progress. Single chunk uploaded (file < 16 MB chunk size, but multipart still used for code uniformity). |
| 2 | Upload completes in < 5 s on a typical connection. | POST `/separate` returns `{jobId}`. Separation runs. |

### TS-004: Turnstile failure blocks initiate

**Priority:** Medium
**Preconditions:** Turnstile widget mocked to return invalid token.
**Mapped Tasks:** Task 2, Task 6

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Drop a file with mocked-invalid Turnstile token. | `/upload/initiate` returns 403 with `{detail: "Turnstile verification failed"}`. |
| 2 | UI surfaces a clear error: "Couldn't verify your browser — please refresh and try again." | No PUTs are issued to R2. |

### TS-007: Smart-split on a 200 MB stems mix

**Priority:** High
**Preconditions:** Same as TS-001.
**Mapped Tasks:** Task 4, Task 5

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Drop a 200 MB stereo WAV onto smart-split. | Upload progresses through multiple parts to R2. |
| 2 | Wait for separation to complete. | All four stems download successfully. No `network error` in console. |

### TS-008: Memory ceiling during 1 GB upload

**Priority:** High
**Preconditions:** Same as TS-001. `e2e/fixtures/large-test-1gb.wav` generated in CI pre-step.
**Mapped Tasks:** Task 4, Task 8

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Drop the 1 GB WAV onto `/master`. | Upload starts, progress climbs. |
| 2 | At 25% progress, capture `performance.memory.usedJSHeapSize` (Chrome) or `performance.measureUserAgentSpecificMemory()`. | Heap usage < 200 MB. |
| 3 | At 50%, 75%, 100%, capture again. | Each sample < 200 MB. |
| 4 | After upload completes, force GC (`window.gc()` if `--js-flags="--expose-gc"` is set). | Heap returns to baseline ± 50 MB. |

> **Rate-limit (TS-005) and 410 Gone (TS-006) coverage moved to backend test suites** — see Task 2 (`backend/src/__tests__/upload-control-plane.test.ts`) and Task 9 (`backend/tests/test_main_json_endpoints.py::test_legacy_multipart_returns_410`). E2E couldn't reliably exercise either: `cf-connecting-ip` is the test runner's shared IP, and 410 only exists post-Task-9 deploy.

## Progress Tracking

- [x] Task 1: Provision R2 bucket + Turnstile site + secrets (artifacts only — manual provisioning deferred to user)
- [x] Task 2: Backend Worker — upload control plane (initiate/complete/abort + Turnstile + rate-limit DOs + 13/13 tests passing, bundle 96 KB)
- [ ] Task 3: FastAPI — accept JSON `{fetchUrl, ...}`; bytes-aware validation; lift size cap
- [ ] Task 4: Frontend — `r2-upload.ts` chunked multipart client
- [ ] Task 5: Frontend — wire `startDeepAnalysis` and `startSeparation` to R2
- [ ] Task 6: Frontend — Turnstile widget integration
- [x] Task 7: Backend Worker — presigned GET when forwarding `/analyze/deep` and `/separate` (bundled with Task 2 — same worker.ts)
- [ ] Task 8: Tests — backend unit, frontend unit, E2E updates
- [ ] Task 9: Remove old multipart endpoints (after frontend ships and bakes)

**Total Tasks:** 9 | **Completed:** 3 | **Remaining:** 6

## Implementation Tasks

### Task 1: Provision R2 bucket + Turnstile site + secrets

**Objective:** Stand up the infrastructure that subsequent tasks depend on. Manual provisioning + scripts + documentation.

**Dependencies:** None
**Mapped Scenarios:** None (foundation)

**Files:**

- Create: `backend/r2-cors.json` — CORS rules for the R2 bucket (committed for documentation)
- Create: `backend/scripts/provision-r2.sh` — idempotent script: `wrangler r2 bucket create aurialis-uploads`, applies lifecycle + CORS
- Modify: `backend/wrangler.jsonc` — add `r2_buckets` binding (`UPLOADS` → `aurialis-uploads`), add Turnstile public site key as `vars`, add the rate-limit DO binding
- Modify: `backend/DEPLOY.md` — document the manual steps (Turnstile site creation, `wrangler secret put R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_ACCOUNT_ID/TURNSTILE_SECRET_KEY`)

**Key Decisions / Notes:**

- R2 lifecycle rule: `{"Rules":[{"Status":"Enabled","Filter":{},"Expiration":{"Days":2}}]}` (48h) applied via `wrangler r2 bucket lifecycle put aurialis-uploads --file=lifecycle.json`. Captured in script.
- CORS JSON:
  ```json
  [{"AllowedOrigins":["https://aurialis.yosefgamble.com","http://localhost:3000"],
    "AllowedMethods":["PUT"],
    "AllowedHeaders":["content-type","content-length","x-amz-content-sha256","x-amz-date"],
    "ExposeHeaders":["ETag"],
    "MaxAgeSeconds":3600}]
  ```
- Turnstile widget site key is public (frontend env). Secret key is a Worker secret.
- R2 access key/secret created via Cloudflare dashboard → R2 → Manage R2 API Tokens → "Object Read & Write" scoped to `aurialis-uploads` only.
- **Cloudflare billing alert** at $50/day on the R2 account — manual setup via dash → Billing → Alerts. Document the URL + setup walkthrough in `backend/DEPLOY.md`.

**Definition of Done:**

- [ ] `wrangler r2 bucket list` shows `aurialis-uploads`.
- [ ] `wrangler r2 bucket lifecycle get aurialis-uploads` shows the **48h** expiration rule.
- [ ] `wrangler r2 bucket cors get aurialis-uploads` shows the CORS rules above.
- [ ] `wrangler secret list --name aurialis-core` shows `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`, `TURNSTILE_SECRET_KEY`.
- [ ] `backend/scripts/provision-r2.sh` runs idempotently (re-running doesn't error).
- [ ] `backend/DEPLOY.md` documents (a) manual Turnstile site creation, (b) `wrangler secret put` invocations, (c) Cloudflare billing alert setup at $50/day.

**Verify:**

- `bash backend/scripts/provision-r2.sh && wrangler r2 bucket cors get aurialis-uploads`

### Task 2: Backend Worker — upload control plane

**Objective:** Add `POST /upload/initiate`, `POST /upload/complete`, `POST /upload/abort` to the `aurialis-core` Worker. Verify Turnstile on initiate AND complete, rate-limit per IP and globally, mint SigV4-presigned PUT URLs for parts via `aws4fetch`, and use the R2 binding for create/complete. Strict bucket-name lock prevents SSRF.

**Dependencies:** Task 1
**Mapped Scenarios:** TS-001 (worker tests cover Turnstile + rate-limit — moved out of E2E)

**Files:**

- Modify: `backend/src/worker.ts` — add route table, per-endpoint handlers, fall through to `stub.fetch` for everything else
- Create: `backend/src/r2-presign.ts` — SigV4 presign of `UploadPart` URLs (uses `aws4fetch`); bucket name is hard-coded from `env.UPLOADS_BUCKET_NAME` constant — no parameterization
- Create: `backend/src/turnstile.ts` — verifies a Turnstile token via `https://challenges.cloudflare.com/turnstile/v0/siteverify`
- Create: `backend/src/rate-limit-do.ts` — `RateLimitDO` (per-IP) and `GlobalRateLimitDO` (account-wide) Durable Object classes with sliding-window counter; bindings `RATE_LIMIT_PER_IP` and `RATE_LIMIT_GLOBAL`
- Create: `backend/src/metrics.ts` — `incrementCounter(env, name)` helper that bumps a Workers Analytics Engine counter (used by `multipart_legacy_calls` in Task 9)
- Create: `backend/src/cors.ts` — CORS helper that emits the same headers as the FastAPI middleware
- Modify: `backend/wrangler.jsonc` — add both DO bindings + migrations (new SQLite classes for `RateLimitDO`, `GlobalRateLimitDO`); add Workers Analytics Engine binding
- Modify: `backend/package.json` — add `aws4fetch` dep; add `vitest`, `@cloudflare/vitest-pool-workers`, and a `test:worker` script
- Create: `backend/vitest.worker.config.ts` — Vitest config using `@cloudflare/vitest-pool-workers` so worker tests run alongside the existing pytest suite without conflict
- Test: `backend/src/__tests__/upload-control-plane.test.ts` — covers Turnstile pass/fail, rate-limit (per-IP + global) via injected `cf-connecting-ip`, SSRF key validation (invalid UUID/ext/path-traversal/cross-bucket), presign URL shape, abort path, OPTIONS preflight

**Key Decisions / Notes:**

- Endpoint shapes:
  - `POST /upload/initiate` body `{token, contentType, size}` → response `{uploadId, key, partUrls: [{partNumber, url}], chunkSize}`. Worker: verifies Turnstile (action=`upload-initiate`), checks per-IP and global rate limits, generates `key = uuid + ext` (no filename, ext from `contentType`), calls `env.UPLOADS.createMultipartUpload(key)`, computes part count from `Math.ceil(size / chunkSize)` (chunkSize = 16 MB), mints a presigned PUT URL per part via SigV4 with **6-hour** expiry. Rejects `size > MAX_UPLOAD_BYTES` env var (default 1 GB).
  - `POST /upload/complete` body `{token, key, uploadId, parts: [{partNumber, etag}]}` → response `{key}`. Worker: **also verifies Turnstile** (action=`upload-complete`), validates `key` matches `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(wav|flac|mp3|aiff|aif|ogg)$` case-insensitive, then `env.UPLOADS.resumeMultipartUpload(key, uploadId).complete(parts)`. ETags pass through byte-for-byte (no quote stripping).
  - `POST /upload/abort` body `{key, uploadId}` → response `204`. Worker: `env.UPLOADS.resumeMultipartUpload(key, uploadId).abort()`. No Turnstile here — abort is a cleanup path, denying it just leaks storage.
- CORS: every Worker-handled response includes the same headers as FastAPI. OPTIONS preflight handled by the helper.
- Errors return JSON `{detail}` with appropriate status (400 invalid input, 403 Turnstile failed, 413 size cap exceeded, 429 rate limited, 500 R2 error). Match FastAPI's shape so frontend error handling stays uniform.
- `RateLimitDO`: keyed by IP (`request.headers.get("cf-connecting-ip")`), sliding 1-hour window stored in DO storage. Configurable via env `RATE_LIMIT_PER_HOUR` (default 10). Returns `Retry-After` header.
- `GlobalRateLimitDO`: single instance (`idFromName("global")`), sliding 1-hour window. Configurable via env `GLOBAL_RATE_LIMIT_PER_HOUR` (default 1000). Checked AFTER per-IP — global cap hits before per-IP only when there's distributed abuse.
- **Bucket lock:** `presignR2Get(env, key, expirySec)` and `presignR2Put(env, key, partNumber, uploadId, expirySec)` both reference `env.UPLOADS_BUCKET_NAME` from a hard-coded `vars` entry in `wrangler.jsonc`. No call site passes a bucket name. SSRF mitigation hinges on this invariant — code-review checklist item.
- **Performance:** the Worker only handles small JSON bodies (KB-scale). No streaming, no large allocations. Each presign call is O(1) per part. For 1 GB / 16 MB = 64 parts the response payload is ~6 KB — well within Worker limits.
- The fall-through to `stub.fetch(request)` keeps `/health`, `/jobs/...`, `/analyze/deep`, `/separate` working unchanged.

**Definition of Done:**

- [ ] All Vitest worker tests pass (`pnpm test:worker` from `backend/`).
- [ ] Manual `curl https://aurialis-core.yosefgamble.com/upload/initiate` with valid Turnstile token returns the expected payload.
- [ ] OPTIONS preflight to each new endpoint returns 200 with correct CORS headers.
- [ ] Rate limit returns 429 + `Retry-After` after `RATE_LIMIT_PER_HOUR + 1` calls from the same IP (Vitest test).
- [ ] Global rate limit returns 429 after `GLOBAL_RATE_LIMIT_PER_HOUR + 1` calls from distinct IPs (Vitest test).
- [ ] Turnstile token failure on either initiate OR complete returns 403.
- [ ] Invalid `key` (bad uuid format, unsupported ext, path-traversal, cross-bucket prefix) returns 400 in `/upload/complete` (Vitest test).
- [ ] Multipart Complete succeeds with ETags-as-returned by R2 PUT — byte-for-byte, no transformation (Vitest contract test against a mocked R2 binding mirroring the real ETag format).
- [ ] `wrangler deploy --dry-run` reports compressed bundle < 800 KB. Output captured in PR description as the new baseline.

**Verify:**

- `cd backend && pnpm test:worker`
- `cd backend && wrangler deploy --dry-run --outdir=/tmp/aurialis-core-dryrun && du -sh /tmp/aurialis-core-dryrun/*`
- `curl -X OPTIONS https://aurialis-core.yosefgamble.com/upload/initiate -H "Origin: https://aurialis.yosefgamble.com" -H "Access-Control-Request-Method: POST" -i`

### Task 3: FastAPI — accept JSON `{fetchUrl, ...}`; bytes-aware validation; one-shot streaming download

**Objective:** New JSON endpoints (`POST /analyze/deep` with JSON body, `POST /separate` with JSON body) accept `{fetchUrl, profile|model}`. They stream-download the object via `httpx.stream` to a local tempfile **once**, validate magic bytes from the first 64 KB and audio header from the first 1 MB before continuing the stream, abort early on validation failure, and start the job against the local path. Container never re-fetches from R2. The old multipart variants stay (FastAPI auto-routes by `Content-Type`) until Task 9.

**Dependencies:** Task 2 (Worker mints the fetchUrl)
**Mapped Scenarios:** TS-001, TS-003, TS-007, plus a new "malicious download" backend test

**Files:**

- Modify: `backend/main.py` — extract validation+persist+start logic into `_persist_and_start_deep_analysis(local_path, profile)` and `_persist_and_start_separation(local_path, model)`; add JSON-body route handlers; dispatch by `Content-Type`
- Create: `backend/r2_download.py` — `download_to_tempfile(fetch_url: str, max_bytes: int, suffix: str) -> Path` that streams via `httpx.stream`, applies pre-flight `Content-Length` check, validates magic bytes from first 64 KB and `soundfile.info`-compatible header from first 1 MB, aborts the stream on failure
- Modify: `backend/validation.py` — add public `validate_audio_bytes(data: bytes, max_bytes: int) -> bytes` (existing `validate_audio_upload` calls into it); set `MAX_UPLOAD_BYTES = 1 * 1024**3` (1 GB) with `MAX_UPLOAD_BYTES_OVERRIDE` env-var read at module load
- Test: `backend/tests/test_r2_download.py` — covers happy path, magic-byte rejection in first chunk, header rejection in first 1 MB, oversize Content-Length rejection, network failure, malicious download (5 GB stream that becomes invalid after 1 MB) terminates within 1 MB read
- Test: `backend/tests/test_main_json_endpoints.py` — async tests using `httpx.AsyncClient` with `respx`-mocked R2 GET

**Key Decisions / Notes:**

- Single dispatch handler per endpoint:
  ```python
  async def _analyze_deep(request: Request, ...):
      ct = request.headers.get("content-type", "").lower()
      if ct.startswith("application/json"):
          return await _analyze_deep_json(request)
      return await _analyze_deep_multipart(request)  # legacy, removed in Task 9
  ```
- Pydantic model for the JSON body: `class AnalyzeDeepBody(BaseModel): fetchUrl: HttpUrl; profile: str = "modern_pop_polish"`. Same shape for separate with `model` instead of `profile`.
- **Streaming validation order in `r2_download.py`:**
  1. Open `httpx.stream("GET", fetch_url, follow_redirects=True, timeout=httpx.Timeout(connect=30, read=300, write=30, pool=10))`.
  2. Read response headers; if `Content-Length > max_bytes`, abort with 413.
  3. Read first 64 KB into a buffer; run `validate_audio_bytes(buf, max_bytes)` for magic-byte + size sniff. On failure, close stream, raise.
  4. Continue reading; once 1 MB accumulated, write to tempfile and run `soundfile.info(path)` on the partial file. If header is unparseable, close stream + delete tempfile + raise.
  5. Stream remaining chunks to tempfile, accumulating size; if cumulative bytes exceed `max_bytes`, abort.
  6. Return `Path(tempfile.name)`.
- `MAX_UPLOAD_BYTES`: lift the constant from 200 MB to **1 GB**. Override via `MAX_UPLOAD_BYTES_OVERRIDE` env var (parsed at module load). Comment documents the cost-envelope reasoning.
- Validation refactor: split `validate_audio_upload` (UploadFile → bytes) into thin `UploadFile` wrapper around `validate_audio_bytes(data, max_bytes)`. Existing tests keep working.
- One-shot download: the local tempfile path is passed to `start_deep_analysis(input_path, profile)` / `start_separation(input_path, model)`. The job's daemon thread reads from the local path. R2 is not touched again for this job.
- Tempfile cleanup: existing `_unlink_quiet` (`backend/main.py:32`) handles cleanup on error; success path already cleans up at job completion.
- Old multipart `_analyze_deep` and `_separate` left in place; they increment a `multipart_legacy_calls` metric on entry (used to gate Task 9).
- **Performance:** streaming download avoids buffering the full file in memory. Tempfile is on `/tmp/smart-split` (existing path). For a 1 GB file the container needs ~1 GB free disk — Cloudflare Containers `standard` instance has plenty.

**Definition of Done:**

- [ ] All existing backend tests pass (`uv run pytest -q` in `backend/`).
- [ ] New `test_r2_download.py` and `test_main_json_endpoints.py` pass.
- [ ] `MAX_UPLOAD_BYTES == 1 * 1024**3`. A 4 GB Content-Length is rejected pre-stream with 413.
- [ ] An invalid magic-byte payload is rejected within 64 KB of stream consumption (test asserts).
- [ ] A 5 GB malicious stream that yields invalid magic bytes after 1 MB completes the abort within ≤ 1 MB read (test asserts cumulative bytes read).
- [ ] `httpx` connection failure returns 502 with `{detail: "Couldn't fetch upload"}`.
- [ ] Container `httpx.stream` is called exactly once per job (assert via mock call count).

**Verify:**

- `cd backend && uv run pytest -q tests/test_main_json_endpoints.py tests/test_r2_download.py`
- `cd backend && uv run pytest -q` (full suite)

### Task 4: Frontend — `r2-upload.ts` chunked multipart client

**Objective:** Pure helper that takes a `File`, calls `/upload/initiate`, PUTs each part to R2 with retries + concurrency, then calls `/upload/complete`. Returns the final `{key}`. No app coupling — usable by both deep-analysis and smart-split.

**Dependencies:** Task 2 (endpoints exist)
**Mapped Scenarios:** TS-001, TS-002, TS-003, TS-007

**Files:**

- Create: `src/lib/api/r2-upload.ts` — `uploadFileToR2(file, token, baseUrl, opts) → Promise<{key}>`
- Test: `src/lib/api/__tests__/r2-upload.test.ts` — mocks `fetch`, exercises chunking, retry-on-failure, parallel concurrency, abort

**Key Decisions / Notes:**

- API:
  ```typescript
  export interface UploadOpts {
    onProgress?: (loaded: number, total: number) => void;
    signal?: AbortSignal;
    chunkSize?: number; // default 16 MB
    concurrency?: number; // default 4
    maxAttemptsPerPart?: number; // default 3
  }
  export async function uploadFileToR2(
    file: File,
    turnstileToken: string,
    baseUrl: string,
    opts: UploadOpts = {}
  ): Promise<{ key: string }>;
  ```
- Reuse `DeepAnalysisError` shape from `src/lib/api/deep-analysis.ts:58` for error reporting — extract to `src/lib/api/errors.ts` so smart-split can use it too.
- Per-part PUT uses `fetch(url, { method: "PUT", body: file.slice(start, end), signal })`. The server sets `ETag` in the response; capture via `response.headers.get("etag")`.
- Concurrency via a small worker-pool pattern: maintain `concurrency` in-flight promises; when one resolves, start the next part.
- Retry logic: per-part exponential backoff (1 s, 2 s, 4 s); if all attempts fail, abort the whole upload (call `/upload/abort`) and throw.
- Progress: track bytes uploaded across parts; emit `onProgress(loaded, total)` after each part completes. Per-part progress is fine-grained enough for music-file UX.
- AbortController: cancelling the signal cancels in-flight PUTs and calls `/upload/abort`.
- **Performance:** `Blob.slice(start, end)` returns a lazy view — does NOT copy bytes into memory. Each part PUT streams the slice. Memory footprint: O(concurrency × chunkSize) ≈ 64 MB worst case.

**Definition of Done:**

- [ ] All `r2-upload.test.ts` tests pass.
- [ ] A 100 MB mocked file uploads via 7 parts, each ≤ 16 MB, parallel-4.
- [ ] Failing one part once succeeds on retry without re-uploading the others.
- [ ] Aborting mid-upload triggers `/upload/abort` and rejects with `DeepAnalysisError`.
- [ ] `onProgress` is monotonically non-decreasing, ends at `total`.

**Verify:**

- `pnpm test src/lib/api/__tests__/r2-upload.test.ts`

### Task 5: Frontend — wire `startDeepAnalysis` and `startSeparation` to R2

**Objective:** Replace the `FormData` paths in `deep-analysis.ts` and `separation.ts` with `r2-upload` + JSON POST. Keep the public API (`startDeepAnalysis(file, profile)` etc.) unchanged so callers don't break.

**Dependencies:** Task 4
**Mapped Scenarios:** TS-001, TS-003, TS-007

**Files:**

- Modify: `src/lib/api/deep-analysis.ts` — `startDeepAnalysis` becomes: `await uploadFileToR2(file, token, ...) → POST /analyze/deep with JSON {key, profile}`. Add a `turnstileToken` param.
- Modify: `src/lib/api/separation.ts` — same shape; also adopt the `DeepAnalysisError`-style structured errors that deep-analysis already uses (was missing before — see line 71). Rename to `BackendError` in a shared module if names clash.
- Create: `src/lib/api/errors.ts` — extracted `BackendError` + `BackendErrorDetails` (was `DeepAnalysisError` / `DeepErrorDetails`)
- Modify: `src/lib/stores/deep-store.ts:setError` (line ~) and call sites in `DeepMastering.tsx` to use the renamed types
- Modify: existing tests (`deep-analysis.test.ts`, `separation.test.ts`) to mock the new flow
- Test: `src/lib/api/__tests__/deep-analysis-r2.test.ts` — new test file covering the R2 path

**Key Decisions / Notes:**

- Public signature change (caller-facing) — both functions gain a `turnstileToken: string` param. Callers must obtain it from the Turnstile widget (Task 6).
- During transition (before Task 9): the JSON POST coexists with the multipart POST on the backend. Frontend always sends JSON.
- Renaming `DeepAnalysisError` → `BackendError`: keep `DeepAnalysisError` as an alias for one release to avoid touching every import. **Or** delete the alias if nothing breaks (TBD by lineage check during implementation).
- Progress mapping: `r2-upload.onProgress` feeds the existing deep-store `progress` field during the upload phase. Once `/analyze/deep` returns, polling takes over.

**Definition of Done:**

- [ ] All existing tests pass after refactor.
- [ ] New R2-path test covers happy path + Turnstile failure + R2 PUT failure.
- [ ] `DeepProgressCard` shows upload progress 0-100% during R2 phase, then switches to backend progress.

**Verify:**

- `pnpm test src/lib/api/__tests__/`
- `pnpm typecheck`

### Task 6: Frontend — Turnstile widget integration

**Objective:** Render an invisible Turnstile widget on upload entry points; pass the token to `r2-upload`. Handle widget render failure gracefully (render a managed-challenge fallback).

**Dependencies:** Task 1 (site key exists)
**Mapped Scenarios:** TS-004

**Files:**

- Create: `src/components/security/TurnstileGate.tsx` — wraps `react-turnstile` (or hand-rolled `<script>` injection) and exposes `useTurnstileToken()` hook
- Modify: `src/components/upload/UploadScreen.tsx` — wrap upload button in `TurnstileGate`; call `getToken()` before kicking off upload
- Modify: `src/components/mastering/DeepMastering.tsx` — same
- Modify: `package.json` — add `@marsidev/react-turnstile` (small, well-maintained Turnstile React wrapper; ~3 KB) **OR** roll a 30-line hook (decision in implementation)
- Modify: `wrangler.jsonc` (frontend) — add `NEXT_PUBLIC_TURNSTILE_SITE_KEY` to `vars`
- Modify: `.env.production` — add the site key for local prod-mode builds

**Key Decisions / Notes:**

- Invisible mode: token issued in the background after page load. If the user is suspicious (Tor, automation), Turnstile escalates to managed challenge automatically.
- Token TTL: 5 min. If the user takes longer to drop the file, re-fetch on submission.
- Failure UX: a small "Couldn't verify your browser — try refreshing" message. Don't block the upload UI from rendering — the user can still inspect their file before uploading.

**Definition of Done:**

- [ ] Turnstile widget renders invisibly on `/master` and smart-split.
- [ ] Token is captured and passed to `uploadFileToR2`.
- [ ] When the widget fails to render (no internet to challenges.cloudflare.com), the UI shows a clear error and does NOT call upload endpoints.
- [ ] No console errors related to Turnstile in normal flow.

**Verify:**

- `pnpm dev` and load `/master` — inspect network for Turnstile script load + token.

### Task 7: Backend Worker — presigned GET when forwarding `/analyze/deep` and `/separate`

**Objective:** When the Worker receives `POST /analyze/deep` or `POST /separate` with a JSON body containing `key`, it mints a presigned GET URL for the R2 object (10 min validity), substitutes the body to `{fetchUrl, profile|model}`, and forwards to the container. The frontend never sees the fetchUrl. Strict key validation prevents SSRF.

**Dependencies:** Task 2 (presign helper exists), Task 3 (container accepts fetchUrl)
**Mapped Scenarios:** TS-001, TS-003, TS-007

**Files:**

- Modify: `backend/src/worker.ts` — intercept `POST /analyze/deep` and `POST /separate`, parse JSON, validate `key` matches strict pattern, mint GET URL via `presignR2Get`, rewrite body, forward to `stub.fetch`
- Modify: `backend/src/r2-presign.ts` — add `presignR2Get(env, key, expirySec)` helper. Bucket name comes from `env.UPLOADS_BUCKET_NAME` constant — never accepts a parameter.
- Test: `backend/src/__tests__/forward.test.ts` — verifies body rewrite + key validation

**Key Decisions / Notes:**

- The Worker MUST NOT trust the `fetchUrl` from the client — only trust `key`. Mint the URL server-side. (Else attacker could submit any URL and have the container fetch it — SSRF.)
- **Strict key regex:** `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(wav|flac|mp3|aiff|aif|ogg)$` — case-insensitive on the extension match (use the `i` flag). Matches the `key` format generated by `/upload/initiate`.
- The container sees `{fetchUrl, profile}` — the `key` field never reaches it.
- For multipart legacy requests (Task 9 not yet done), the Worker passes through unchanged — the `Content-Type: multipart/form-data` check dispatches multipart straight to `stub.fetch`.
- Bucket-lock invariant: `presignR2Get(env, key, 10*60)` references `env.UPLOADS_BUCKET_NAME` from `wrangler.jsonc` `vars`. No call site can pass a different bucket. Cross-bucket attack rejected at the type level (TypeScript signature has no bucket parameter).

**Definition of Done:**

- [ ] Forwarding a JSON body with a valid `key` results in the container receiving `{fetchUrl, profile}` (test asserts).
- [ ] Invalid keys are rejected with 400 (test cases: bad UUID, unsupported ext, path-traversal `..`, cross-bucket prefix `bucket2/...`, uppercase ext like `WAV` works because of `i` flag — that's intentional).
- [ ] `presignR2Get`'s TypeScript signature does NOT take a `bucket` parameter — verified by reading the source.

**Verify:**

- `cd backend && pnpm test:worker src/__tests__/forward.test.ts`

### Task 8: Tests — backend unit, frontend unit, E2E updates

**Objective:** Round out coverage, update the existing E2E specs that touch `/analyze/deep` (mocking). Memory-ceiling assertion is the new bar for the resumable upload story.

**Dependencies:** Tasks 2-7
**Mapped Scenarios:** TS-001, TS-002, TS-003, TS-004, TS-007, TS-008

**Files:**

- Create: `e2e/r2-upload.spec.ts` — TS-001, TS-002, TS-003, TS-004, TS-007, TS-008
- Modify: `e2e/deep-analysis-progress.spec.ts` — update mocked routes from `/analyze/deep` (multipart) to `/upload/initiate` + `/upload/complete` + `/analyze/deep` (JSON). Existing scenarios still cover progress + cancel.
- Modify: `e2e/smart-split.spec.ts` — same pattern.
- Modify: `e2e/library.spec.ts` — same.
- Verify: `backend/tests/test_validation.py` — keep passing after `validate_audio_bytes` extraction.

**Key Decisions / Notes:**

- **TS-005 (rate limit) is NOT in the E2E suite** — it would flake because `cf-connecting-ip` can't be controlled from a Playwright runner whose IP is shared. It lives in `backend/src/__tests__/upload-control-plane.test.ts` (Task 2) where DO state and headers can be injected.
- **TS-006 (410 Gone) is NOT in the E2E suite** — it requires Task 9 to be deployed. It lives in `backend/tests/test_main_json_endpoints.py` (Task 9 DoD) covering the post-removal 410 behavior.
- E2E mocks respect the new flow: `/upload/initiate` returns mock part URLs that the test server accepts (or use `page.route` to mock R2 URLs entirely).
- For TS-002 (resumable), use `page.route` with a counter to fail the first attempt of part 3, succeed on retry.
- For TS-001/TS-008 with real >100 MB files, generate them in `e2e/fixtures/large-test.wav` (gitignored, generated in CI pre-step via a small Python script writing a real WAV header + zero PCM data) — too big to commit.
- **TS-008 memory ceiling:** uses Chrome DevTools `performance.measureUserAgentSpecificMemory()` (or fallback to `performance.memory.usedJSHeapSize` where available) at progress 25/50/75/100% — assert each sample < 200 MB. If the API isn't available in headless Playwright, fall back to manual validation with notes in the test.

**Definition of Done:**

- [ ] All new E2E tests pass locally with the live backend.
- [ ] Updated existing E2E tests pass.
- [ ] Backend unit tests pass (including the malicious-stream test from Task 3 and the rate-limit + key-validation tests from Task 2).
- [ ] CI gate updated to include `e2e/r2-upload.spec.ts`.
- [ ] TS-008 memory test passes with peak heap < 200 MB during a 1 GB upload.

**Verify:**

- `pnpm test:e2e e2e/r2-upload.spec.ts`
- `cd backend && uv run pytest -q && pnpm test:worker`

### Task 9: Remove old multipart endpoints

**Objective:** After Task 4-8 are deployed and verified in production AND three explicit gate conditions are met, remove the multipart `_analyze_deep`/`_separate` handlers and the `validate_audio_upload(UploadFile)` wrapper. Frontend no longer uses them.

**Dependencies:** Tasks 4-8 deployed and verified

**⛔ Three-condition gate — ALL must be true before this task runs:**

1. **≥ 7 days have elapsed** since the frontend deploy of Tasks 5+6 reached production.
2. **`multipart_legacy_calls` counter shows 0 hits in the trailing 48 hours**, queried via `wrangler analytics-engine query 'SELECT sum(_sample_interval) AS calls FROM aurialis_metrics WHERE blob1 = "multipart_legacy_calls" AND timestamp > NOW() - INTERVAL 2 DAY'` (or equivalent dashboard widget).
3. **CHANGELOG entry pre-announces the deprecation date** at least 7 days before this task is merged.

If any condition fails, defer Task 9 to the next cycle.

**Files:**

- Modify: `backend/main.py` — delete the multipart variants; the JSON variant becomes the only handler (renamed back to `_analyze_deep`)
- Modify: `backend/validation.py` — keep `validate_audio_bytes` only; delete `validate_audio_upload`
- Modify: `backend/tests/test_validation.py` — delete UploadFile-specific tests; add 410 Gone test
- Modify: `backend/main.py` — add a small dispatch shim that returns **`410 Gone`** with `{detail: "Use POST /upload/initiate then JSON /analyze/deep — see DEPLOY.md"}` for `multipart/form-data` requests to `/analyze/deep` and `/separate`. Keep this shim for one release, then drop in a follow-up.
- Add to `CHANGELOG.md` — note the deprecation + removal date.

**Key Decisions / Notes:**

- Strict deploy ordering: backend with both endpoints → frontend with R2 → wait ≥ 7 days + verify zero legacy traffic → backend without multipart (with 410 shim).
- The `410 Gone` shim covers external clients (Postman collections, ad-hoc curl scripts) that hit the old endpoint after removal.
- The `multipart_legacy_calls` counter was added to the multipart handlers in Task 3; it's the basis for the gate-2 query.

**Definition of Done:**

- [ ] All three gate conditions documented above are true and pasted into the PR description with screenshots/query results.
- [ ] `backend/main.py` no longer references `UploadFile`.
- [ ] All tests pass (including the new `test_main_json_endpoints.py::test_legacy_multipart_returns_410` test).
- [ ] Manual `curl -X POST .../analyze/deep -F "file=@small.wav"` returns `410` with the expected detail.
- [ ] CHANGELOG entry references the deprecation announcement and the removal commit.

**Verify:**

- `cd backend && uv run pytest -q tests/test_main_json_endpoints.py::test_legacy_multipart_returns_410`
- `curl -X POST https://aurialis-core.yosefgamble.com/analyze/deep -F "file=@small.wav" -F "profile=modern_pop_polish" -i | grep -E "HTTP/|detail"`

## Open Questions

- Should we collect Turnstile **action** values per-endpoint to discriminate `upload-initiate` vs (future) other gated endpoints? Defaulting to a single action `"upload"` for now; can split later.
- Should the rate-limit DO use Cloudflare's new native rate-limiting binding instead of a hand-rolled DO? It's still in beta and account-scoped — defer until GA.

### Deferred Ideas

- **Client-side WAV → FLAC encoding before upload** — would halve upload sizes (88 MB → ~44 MB). Useful even after R2 fix because uploads still take time on slow connections. Separate plan.
- **Resumable across browser refresh** — persist `{uploadId, key, partsCompleted}` in IndexedDB so closing the tab doesn't waste the upload. The library-storage helper added in the persist-deep-analysis plan already has the IDB plumbing.
- **Public R2 bucket with signed URLs only** — would simplify the Worker code at the cost of bucket-wide policy management. Defer.
- **Replace Cloudflare Containers with Fly/Railway** — the underlying DO Container architecture has multiple footguns (cold starts, CPU limits, no streaming through DO). Track separately.
