# Deep Analysis Progress & Error Feedback Implementation Plan

Created: 2026-04-27
Author: yegamble@gmail.com
Status: VERIFIED
Approved: Yes
Iterations: 1
Worktree: No
Type: Feature

## Summary

**Goal:** When a user clicks Analyze on aurialis.yosefgamble.com, the UI must clearly show: progress per phase, elapsed time, an actionable error if anything fails (with technical details for debugging), and a way to Cancel an in-progress job. Plus: end-to-end observability (structured JSON logs + OpenTelemetry spans) so production failures can be traced from browser → Worker → FastAPI → Demucs.

**Architecture:** Frontend rebuild of `DeepMastering` to render distinct UI per status, with a resilient polling loop (timeout, bounded retries, abort). Backend gets a cooperative cancel flag, a `DELETE /jobs/{id}` endpoint, and OpenTelemetry instrumentation around the FastAPI app + per-phase manual spans. Frontend captures the trace context from response headers and surfaces it in error details so a single trace ID links the browser failure to backend logs.

**Tech Stack:** Next.js 15 + Zustand (frontend), FastAPI 0.115 + Python 3.11 (backend), OpenTelemetry SDK (Python `opentelemetry-api`, `opentelemetry-sdk`, `opentelemetry-instrumentation-fastapi`, `opentelemetry-exporter-otlp-proto-http`).

## Scope

### In Scope

- Visible inline progress UI in the Deep Mastering panel: phase, %, elapsed time
- Actionable error UI with Retry button + expandable technical details (URL, status, message, jobId, traceId)
- Cancel button that aborts the in-progress job both client- and server-side
- Resilient polling loop: 15s per-request fetch timeout, 3-consecutive-failure tolerance, 10-min total cap
- Backend cancellation: `cancelled` flag on `Job`, `DELETE /jobs/{id}`, cooperative checks between phases in `_run_deep_analysis`
- Structured JSON logging in FastAPI (job_id, phase, duration_ms, error)
- OpenTelemetry tracing in FastAPI: auto-instrumentation + manual spans for `_load_mono_for_analysis`, `detect_sections`, `enrich_with_loudness_and_centroid`, `run_stem_artifact_analysis`, `_separate_stems`
- Default OTel exporter: console (visible in `wrangler tail` of the container). OTLP exporter activated when `OTEL_EXPORTER_OTLP_ENDPOINT` env var is set.
- Trace context propagation: FastAPI emits `traceparent` response header via an explicit OTel response hook; CORS exposes the header to JS; frontend captures it and includes the trace ID in error details
- Vitest unit tests for polling resilience + cancel; pytest tests for cancel + DELETE endpoint; Playwright E2E scenarios (TS-001..TS-005)

### Out of Scope

- Replacing polling with Server-Sent Events / WebSockets (considered, rejected — bigger refactor through Cloudflare Containers proxy, marginal benefit)
- Frontend OpenTelemetry SDK (`@opentelemetry/sdk-trace-web`) — adds bundle weight; structured `console.error` with traceId is sufficient for current debugging needs
- Cloudflare Worker tracing — the worker is a 4-line passthrough; instrumenting it adds complexity for marginal value. `traceparent` header is forwarded by the Worker's `stub.fetch(request)` automatically.
- Persisting failed jobs to localStorage (deferred — user can re-trigger)
- Cancellation mid-Demucs-batch (cooperative checks happen between phases, not inside Demucs's `apply_model`. Worst case: user clicks Cancel near the end of separation and waits ~10–30 s for the next phase boundary. Acceptable trade-off.)

## Approach

**Chosen:** Full-stack — frontend UX rebuild + backend cooperative cancel + FastAPI OpenTelemetry instrumentation.

**Why:** The user's actual pain point is "I can't tell what's happening when it fails." Solving that fully requires: (1) UI states that render every status path, (2) error metadata that names the failure point, (3) a trace ID that links the browser-side failure to a backend span. Adding cancel server-side is cheap once we already have job state in Python and is the only way to actually stop wasting compute when a user gives up.

**Alternatives considered:**
- *Frontend-only cancel* — rejected: user explicitly opted into the bigger scope, and resource leakage during cancel is real (Demucs runs ~30 s of CPU per cancelled job).
- *SSE / streaming instead of polling* — rejected: bigger refactor through CF Containers proxy, risks regressions, unclear win for a job that emits 3–4 phase boundaries.
- *Skip OTel, just add log lines* — rejected: user explicitly asked for OTel so external loggers can be plugged in later. OTel auto-instrumentation gives FastAPI request/response spans for free; adding 5 manual spans on top costs ~30 lines.

## Context for Implementer

### Patterns to follow

- **Zustand store mutation:** existing pattern in `src/lib/stores/deep-store.ts:44-114` — define typed setters, never mutate state directly.
- **API client:** existing pattern in `src/lib/api/deep-analysis.ts:34-104` — every fetch wrapped in `if (!response.ok) throw`, response shape declared via local interface, cast `await response.json()` to typed shape (strict mode requirement).
- **Component splitting:** new `<DeepProgressCard>` extracted to its own file under `src/components/mastering/`. Existing siblings: `EngineerProfilePicker.tsx`, `DeepTimeline.tsx`. Follow the same `"use client"` + named-export pattern.
- **Backend job mutation:** existing pattern in `backend/jobs.py:90-100` — always go through `update_job(job_id, **kwargs)` so the JSON file lock is held; never write to `Job` instances directly from the worker thread.
- **Backend test mocks:** see `backend/tests/test_stem_artifacts.py` and `tests/conftest.py` — heavy ML calls (`apply_model`, `librosa.feature.spectral_centroid`) are mocked. Cancel tests should similarly mock the heavy work and only verify the cancel flag is honored at phase boundaries.

### Conventions

- **Tailwind** utility classes only (matches existing `DeepMastering.tsx`). No CSS modules. Color tokens are inline `rgba(...)` strings — keep that for consistency.
- **TypeScript strict mode** is on. New `errorDetails` field must be typed; cast all `await response.json()` results to a local `interface`.
- **Python**: `from __future__ import annotations`, type hints on public functions, dataclass mutations only via `update_job`.
- **Tests**: vitest for frontend (mock `fetch` at module level via `vi.stubGlobal`), pytest for backend (markers `@pytest.mark.unit` / `@pytest.mark.integration`).

### Key files

- `src/components/mastering/DeepMastering.tsx` — current consumer; will be refactored to render `<DeepProgressCard>` and use a refactored polling helper
- `src/lib/api/deep-analysis.ts` — adds `cancelDeepAnalysis`, `DeepErrorDetails` type, captures `traceparent` from response headers
- `src/lib/stores/deep-store.ts` — adds `errorDetails: DeepErrorDetails | null`, `startedAt: number | null`, setters
- `backend/jobs.py` — adds `cancelled: bool` field, helper `is_cancelled(job_id)`
- `backend/main.py` — adds `DELETE /jobs/{id}`, OTel setup
- `backend/deep_analysis.py` — adds cancel checks between phases, manual OTel spans
- `backend/requirements.txt` — adds 4 OTel packages
- `backend/Dockerfile` — no changes needed (OTel is pip-installable)

### Gotchas

- **`update_job` reloads from disk on every call** (`jobs.py:91`). Frequent polling of `is_cancelled` from the worker thread costs disk I/O. Mitigate: check cancel only at phase boundaries (≤ 5 checks per job), not in tight loops.
- **CF Worker timeouts:** the frontend Worker request limit is 30 s. The frontend polls `/jobs/{id}/status` independently of the long-running container — we are NOT making one long request, so this isn't a concern. Worth re-verifying that `pollDeepJobStatus` is short-lived.
- **`process.env.NEXT_PUBLIC_DEEP_ANALYSIS_API_URL` is build-time-inlined.** Tests must mock `fetch` and not rely on env-var resolution. Already the existing pattern in `__tests__/deep-analysis.test.ts`.
- **OTel + threads (parent-child, NOT links):** `_run_deep_analysis` runs in a `daemon=True` thread. OTel context does NOT propagate to threads automatically, and `Link`s render as sidebar references in Jaeger/Tempo — they are NOT a parent-child relationship and won't show the worker spans nested under the request span. Use `opentelemetry.context.attach(trace.set_span_in_context(captured_span))` inside the thread BEFORE starting the worker span. Pattern: in `start_deep_analysis`, capture the live span (`trace.get_current_span()`); inside the thread's first line, call `context.attach(set_span_in_context(captured_span))` to make the worker span a true child. At thread exit (success or failure), call `tracer_provider.force_flush(timeout_millis=5000)` so spans are exported before the daemon thread is reaped — otherwise short test runs drop spans and DoD assertions go flaky.
- **`update_job` lock + DELETE race:** the worker calls `is_cancelled` (read), DELETE handler can flip the flag in the gap before the next phase begins. Net effect in the worst case: cancel is honored one phase later than ideal (≤2-phase latency, ≤60 s). No code change needed; mitigated by the 35-s client-side hard-bound (Task 2) so the UI never waits forever even if the backend race happens.
- **Strict mode + `process.env`** — `process.env.NEXT_PUBLIC_*` is `string | undefined`. Always default with `??`.

### Domain context

- **Deep analysis phases:** `_run_deep_analysis` (`backend/deep_analysis.py:50-79`) runs three phases sequentially: section detection (~5–15 s), per-stem AI-artifact analysis via Demucs (~20–60 s on CPU), script generation (T5, currently a no-op marking done). `partial_result` accumulates `{sections, stems, script}` keys progressively. `subStatus` is derived in `pollDeepJobStatus` (`src/lib/api/deep-analysis.ts:83-89`) by checking which keys exist.
- **Job lifecycle:** `queued` → `processing` → (`done` | `error`). Adding `cancelled` should reuse `error` status with `error="Cancelled by user"` to avoid changing the public job-status enum and breaking existing tests/consumers. The `cancelled` boolean on the Job is internal — DELETE flips it; the worker thread observes it and exits via `error`.
- **Job TTL:** 30 minutes (`jobs.py:15`). Cancel doesn't have to free disk immediately — `cleanup_expired` will reap.

## Runtime Environment

- **Backend start command (local):** `cd backend && uv run uvicorn main:app --host 0.0.0.0 --port 8000`
- **Backend deploy:** `cd backend && pnpm run deploy` (Cloudflare Container)
- **Frontend deploy:** `pnpm run deploy` from repo root
- **Health check:** `curl https://aurialis-core.yosefgamble.com/health` → `200` with `{ok, gpu, models}`
- **Restart procedure:** redeploy the container — there's no in-place restart for CF Containers
- **OTel observation (local):** with the console exporter, spans print to container stdout. Tail with `cd backend && pnpm exec wrangler tail`. With OTLP, set `OTEL_EXPORTER_OTLP_ENDPOINT=https://...` as a wrangler secret.

## Assumptions

- The Cloudflare Container's `stub.fetch(request)` proxy forwards the `traceparent` *response* header from FastAPI to the browser when the response is constructed — verified by Cloudflare Workers fetch semantics (response headers are passed through). Tasks 3 & 5 depend on this.
- CORS preflight cost (one extra `OPTIONS` per cancel) is acceptable; DELETE is rare. Task 4 depends on this.
- The frontend polling cadence (1 s) is fast enough that a 10-min cap is reached in ≤ 600 polls. No infinite-loop risk if the cap is honored. Task 2 depends on this.
- The user's CF account already has the Container deployed (per prior conversation `aurialis-core.yosefgamble.com` is live). No env or DNS changes needed. Tasks 4 & 5 depend on this.
- OpenTelemetry packages install cleanly into the existing `python:3.11-slim` Docker image — they're pure Python, no native compilation. Task 5 depends on this.
- The `madmom`/`librosa` heavy paths inside `_run_deep_analysis` will tolerate being wrapped in OTel spans (no monkey-patching of internal calls). Task 5 depends on this.
- The current production failure on `aurialis.yosefgamble.com` is a deployment / wiring issue (URL, CORS, or Worker not yet redeployed), not a logic bug. This plan makes that failure visible — it does not necessarily fix the underlying wiring. The user must still redeploy after this lands.

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| OTel context doesn't propagate to the daemon thread → spans render as orphans, not nested under the request span in Jaeger/Tempo | High | Medium | Use `context.attach(trace.set_span_in_context(captured_span))` inside the thread (true parent-child). Add `tracer_provider.force_flush()` at thread exit so short test runs don't drop spans. Verified by `test_observability.py` asserting `worker_span.parent.span_id == request_span.context.span_id`. |
| `traceparent` response header invisible to frontend JS (cross-origin from `aurialis.yosefgamble.com` to `aurialis-core.yosefgamble.com`) | High | High | Two-part fix: (1) FastAPI CORSMiddleware adds `expose_headers=["traceparent"]`; (2) FastAPIInstrumentor configured with a `server_response_hook` that calls `inject(headers)` on the W3C `TraceContextTextMapPropagator` to emit `traceparent` (NOT default behavior). Playwright TS-002 step 4 asserts `traceId` is a 32-hex string, not `(none captured)`. |
| iOS Safari ≤17.3 (released Jan 2024 — still on un-updated devices) lacks `AbortSignal.any` → analyze button errors with `TypeError`, contradicting Truth #1 | Medium | High | Use a fallback that does NOT depend on `AbortSignal.any`: a single `AbortController` whose signal is propagated manually — for the per-request 15s timeout, attach a `setTimeout` that calls `controller.abort('timeout')`, with `clearTimeout` on success. No browser-level `AbortSignal.timeout` or `AbortSignal.any` required. Document fallback in Task 2. |
| Cancel-while-Demucs takes up to ~30s for the phase boundary; users may think the app is hung | High | Medium | (1) Cancelling state shows explanatory text: "Cancelling — this can take up to 30 seconds while the current phase finishes"; (2) Client-side 35s hard-bound: if `cancelled=true` round-trip doesn't surface within 35 s, transition UI to error state with "Cancel timed out — the backend job will finish on its own and clean up automatically", abort polling client-side. The backend job continues to TTL cleanup. |
| `update_job` lock contention if cancel polling runs in a tight inner loop | Medium | Low | Cancel checks only at phase boundaries (≤ 5 per job). Document in Task 4. |
| Frontend abort during fetch leaves a "ghost" job on the backend | High | Low | Job TTL = 30 min handles cleanup; DELETE explicitly clears it sooner. Test coverage in TS-003. |
| OTel deps add image build time | Low | Low | Pure Python wheels — adds ~5 MB and ~10 s to first build, cached afterward. |
| User clicks Retry while a stale poll is still in flight, double-execution races | Medium | Medium | All async work guarded by an `AbortController` per analyze run; Retry creates a fresh controller and aborts the prior one before starting. |
| Trace ID leaked in error UI is information leakage | Low | Low | Trace IDs are opaque hex strings, not credentials. Acceptable to surface in technical details. |
| OTLP exporter blocks startup if endpoint is unreachable | Medium | Medium | Use `BatchSpanProcessor` with non-blocking export; if endpoint is set but unreachable, spans drop silently. Default is the console exporter — no external dependency. |

## Goal Verification

### Truths

1. **No silent failures:** When the backend is unreachable / 5xx / CORS-rejected / times out, the UI displays an error message with a Retry button — never a blank UI. *(Verified by TS-002, TS-004.)*
2. **Progress is observable:** While analyzing, the UI shows the current phase name, progress %, and elapsed seconds. *(Verified by TS-001.)*
3. **Cancel works with bounded recovery:** Clicking Cancel during processing surfaces a clear "Cancelling…" state with explanatory text, fires DELETE /jobs/{id}, and within 35 seconds the UI either returns to idle (backend honored cancel) or surfaces an explicit "Cancel timed out" error (backend missed the phase boundary; client gives up gracefully and lets TTL reap the orphan). *(Verified by TS-003 steps 3 and 4.)*
4. **Trace IDs are surfaced:** When an error occurs against a live backend, the technical-details panel shows a 32-hex-character trace ID parsed from the `traceparent` response header (NOT a "(none captured)" placeholder). The mocked-backend variant of TS-002 covers the UI rendering; the live-backend variant (TS-002 step 4) verifies the cross-origin CORS expose + ASGI response hook actually deliver the header to JS. *(Verified by TS-002 step 4.)*
5. **OTel emits spans:** A successful deep-analysis run produces an OTel trace with at least 5 spans (FastAPI request span + 4 per-phase manual spans: `deep_analysis.load`, `deep_analysis.sections`, `deep_analysis.enrich`, `deep_analysis.stems`). *(Verified by `wrangler tail` showing console-exporter JSON during a smoke test, captured in T5 DoD.)*
6. **Polling is resilient:** A single transient poll failure (e.g. simulated 502 from one `/status` call out of N) does NOT abort the job; 3 consecutive failures DO surface an error. *(Verified by Vitest unit test in T2.)*
7. **Retry is functional:** After an error, clicking Retry restarts the analyze flow with the same profile and clears the prior error state. *(Verified by TS-002.)*

### Artifacts

- `src/components/mastering/DeepProgressCard.tsx` (new — UI for progress + error states)
- `src/components/mastering/DeepMastering.tsx` (refactored — uses progress card, refactored polling)
- `src/lib/api/deep-analysis.ts` (extended — `cancelDeepAnalysis`, `DeepErrorDetails`, traceparent capture)
- `src/lib/stores/deep-store.ts` (extended — `errorDetails`, `startedAt`)
- `backend/jobs.py` (extended — `cancelled` field, `is_cancelled` helper)
- `backend/main.py` (extended — `DELETE /jobs/{id}`, OTel setup, structured JSON logging)
- `backend/deep_analysis.py` (extended — cancel checks, manual OTel spans)
- `backend/requirements.txt` (extended — OTel deps)

## E2E Test Scenarios

### TS-001: Happy path — progress visible at every phase
**Priority:** Critical
**Preconditions:** Track loaded; backend reachable and responding
**Mapped Tasks:** Task 1, Task 2

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click "Analyze" | UI replaces button with progress card; status reads "Analyzing… 0%"; elapsed timer starts at 0:00 |
| 2 | Wait for poll → status returns `processing` with `partial_result.sections` | Card shows "Detecting sections…" highlighted; progress % updates to ~40% |
| 3 | Wait for next poll showing `partial_result.sections + stems` | Card shows "Analyzing stems…" highlighted; progress jumps to ~80% |
| 4 | Wait for next poll showing `status: done` | Card disappears; timeline renders; status text shows "Status: ready" |

### TS-002: Backend down — error with Retry + technical details
**Priority:** Critical
**Preconditions:** Track loaded; backend simulated unreachable (mock fetch to throw `TypeError: Failed to fetch`)
**Mapped Tasks:** Task 1, Task 2, Task 3

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click "Analyze" | Progress card appears |
| 2 | Wait for fetch failure | Card transitions to error state with red border; message: "Couldn't reach the analysis service" |
| 3 | Click "Show details" toggle | Expandable section reveals: URL (`https://aurialis-core.yosefgamble.com/analyze/deep`), Status: "network error", Message: full error string, Trace ID: "(none captured)" |
| 4 | (Live backend variant) Trigger a real `/analyze/deep` request; force backend to return 500 | The error state's "Trace ID" field is a 32-hex-character string (NOT "(none captured)"), proving the `traceparent` header round-trip works through the CF Container proxy and CORS expose-headers |
| 5 | Click "Retry" | Card resets to fresh "Analyzing… 0%" state; new fetch attempt fires |

### TS-003: Cancel mid-job
**Priority:** Critical
**Preconditions:** Track loaded; job started; status is `processing`
**Mapped Tasks:** Task 1, Task 2, Task 4

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click "Analyze" → wait for `processing` status with sections returned | Progress card shows "Detecting sections…" |
| 2 | Click "Cancel" | Card immediately shows "Cancelling — this can take up to 30 seconds while the current phase finishes."; Cancel button disabled; `DELETE /jobs/{id}` fires |
| 3 | Wait for next poll within ≤30s → server responds `status: error, error: "Cancelled by user"` | Card disappears; status returns to "idle"; Analyze button re-enabled |
| 4 | (Hard-bound variant) Mock backend to never honor cancel; advance fake timers 35s | Card transitions to error state with message: "Cancel timed out — the backend job will finish on its own and clean up automatically"; technical details show `status: cancel-timeout` |
| 5 | Verify in backend logs (live deploy): `wrangler tail` shows JSON log entry with `phase: cancel-observed`, matching `job_id` | Cancel was honored server-side |

### TS-004: Total timeout — 10-min cap
**Priority:** High
**Preconditions:** Backend simulated stuck (poll always returns `processing` with no progress)
**Mapped Tasks:** Task 2
**Verification:** **Unit test (Vitest fake timers)**, not Playwright. Driving 600 polling iterations through Playwright's mock-clock + cross-process fetch chain proved non-deterministic — each `clock.runFor` advances the mocked setTimeout but the next iteration's real fetch IPC doesn't drain reliably between calls. The total-cap logic is pure time math in `pollUntilDone` and is fully exercised by `src/lib/api/__tests__/deep-analysis-polling.test.ts` ("aborts after total cap with status 'timeout'"). The error UI rendering for the resulting `DeepErrorDetails` shape is exercised by TS-002.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Start analyze with mocked time advance (vitest `vi.useFakeTimers`) | Loop iterates with backend always returning processing |
| 2 | Advance fake timers past 10 minutes | `pollUntilDone` rejects with `DeepAnalysisError` whose `details.status === "timeout"` |
| 3 | Verify error message contains "Analysis timed out" and `details.raw` references the cap | Assertion passes |

### TS-005: Transient poll failures — 1–2 blips don't abort
**Priority:** High
**Preconditions:** Track loaded; backend route handler returns alternating responses driven by a `pollCount` counter (incremented on each fetch). Test asserts on consecutive-failure behavior, not poll ordinal.
**Mapped Tasks:** Task 2

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Start analyze. Route handler returns success (200, processing). | Card shows "Analyzing…" |
| 2 | Configure route handler to return 502 once, then 200; advance polling | After the single 502, card stays in analyzing state (no error); after the next 200, card continues |
| 3 | Configure route handler to return 502 for 3 consecutive polls; advance polling | Card transitions to error state; error message contains "Failed to reach analysis service" + the 502 status; technical details show `status: "502"` |
| 4 | Configure route handler to return 404 once; advance polling | Card transitions to error state IMMEDIATELY (no 3-strikes wait); technical details show `status: "404"` |

## Progress Tracking

- [x] Task 1: DeepProgressCard component (idle / analyzing / cancelling / error / ready states)
- [x] Task 2: Resilient polling — timeout, retry, abort, total-time cap
- [x] Task 3: Error metadata capture + structured logging + trace propagation (frontend)
- [x] Task 4: Backend cancel plumbing — `Job.cancelled`, `DELETE /jobs/{id}`, cooperative phase checks
- [x] Task 5: OpenTelemetry tracing + structured JSON logging (FastAPI)
- [x] Task 6: Tests — Vitest, pytest, Playwright E2E (TS-001..TS-005)

      **Total Tasks:** 6 | **Completed:** 6 | **Remaining:** 0

## Implementation Tasks

### Task 1: DeepProgressCard component

**Objective:** Extract a presentational card component that renders the right UI for every job state (analyzing / cancelling / error / ready). No business logic — pure props in, JSX out.
**Dependencies:** None
**Mapped Scenarios:** TS-001, TS-002, TS-003

**Files:**
- Create: `src/components/mastering/DeepProgressCard.tsx`
- Create: `src/components/mastering/__tests__/DeepProgressCard.test.tsx`

**Key Decisions / Notes:**
- Props: `{ status, subStatus, progress, elapsedSec, errorDetails, onRetry, onCancel }`. `errorDetails` is `null` when no error.
- States rendered:
  - `analyzing` → progress bar (Tailwind utility, clamp width to `progress%`), stage list (existing pattern from `DeepMastering.tsx:179-202` polished), elapsed timer (`mm:ss`), Cancel button
  - `cancelling` → same layout as analyzing, but with explanatory text: "Cancelling — this can take up to 30 seconds while the current phase finishes." Cancel button disabled. (35-second hard-bound enforced in Task 2's polling loop, not here.)
  - `error` → red border, message line, "Show details" toggle that expands to a `<pre>` with URL/status/message/jobId/traceId, Retry button
  - `ready` / `idle` → render nothing (parent's responsibility)
- A11y: `role="status"` + `aria-live="polite"` on the analyzing container so screen readers announce phase changes; Retry/Cancel are real `<button>` elements with `aria-label` if icon-only.
- Performance: this component re-renders on every poll tick. Memoize with `React.memo` and ensure `errorDetails`/`onRetry`/`onCancel` are stable refs from the parent (parent uses `useCallback`).

**Definition of Done:**
- [ ] All Vitest tests pass: `pnpm exec vitest run src/components/mastering/__tests__/DeepProgressCard.test.tsx`
- [ ] No type errors: `pnpm exec tsc --noEmit`
- [ ] Component renders distinct DOM for each of: analyzing/cancelling/error states (verified by snapshot tests)
- [ ] Error state's "Show details" toggle reveals the technical details `<pre>` (verified by interaction test)
- [ ] Retry/Cancel callbacks fire when their buttons are clicked

**Verify:**
- `pnpm exec vitest run src/components/mastering/__tests__/DeepProgressCard.test.tsx`
- `pnpm exec tsc --noEmit`

---

### Task 2: Resilient polling loop

**Objective:** Replace the busy-loop in `runAnalyze` with a refactored polling helper that supports per-request timeout (`AbortController`, 15 s), bounded transient retries (3 consecutive failures = abort), total-time cap (10 min), and external abort (cancel button).
**Dependencies:** Task 1
**Mapped Scenarios:** TS-001, TS-002, TS-004, TS-005

**Files:**
- Create: `src/lib/api/deep-analysis-polling.ts`
- Modify: `src/components/mastering/DeepMastering.tsx`
- Create: `src/lib/api/__tests__/deep-analysis-polling.test.ts`

**Key Decisions / Notes:**
- Extract `pollUntilDone({ jobId, signal, onProgress, onSubStatus })` to its own module so it can be unit-tested in isolation. `onProgress(progress, subStatus, elapsedMs)` fires after every successful poll.
- AbortController plumbing: every fetch (`startDeepAnalysis`, `pollDeepJobStatus`, `fetchDeepResult`, `cancelDeepAnalysis`) accepts an optional `signal` parameter. The polling helper owns one controller per run; Cancel button calls `controller.abort('cancelled by user')`; component unmount also aborts.
- **Per-request fetch timeout — DO NOT USE `AbortSignal.any` or `AbortSignal.timeout`.** iOS Safari ≤17.3 (still in the wild) lacks both. Use a manual fallback: each fetch accepts the user's signal directly; wrap the call site with a `setTimeout` that calls `controller.abort('timeout')` after 15 s, and `clearTimeout` on success/failure. This works on every browser that supports `AbortController` itself (Safari 11.1+).
- Failure tracking: maintain `consecutiveFailures` in the loop. Reset on success. After 3 consecutive failures, throw the last error.
- **4xx is NOT transient — abort immediately.** Any response with `status >= 400 && status < 500` (job not found, schema mismatch, etc.) aborts the loop on the first occurrence with `errorDetails.status = String(httpStatus)`. Network errors and 5xx responses are transient (count toward the 3-strikes counter). Test explicitly: poll returns 404 → abort with status: "404", no retries.
- **Cancel hard-bound:** when the polling helper observes `status === "cancelling"` (set by the parent when Cancel is clicked), it starts a 35-second timer. If the next successful poll within that window returns `status: error` with `error: "Cancelled by user"`, the helper resolves cleanly. If the timer expires first, the helper aborts client-side with `errorDetails.status = "cancel-timeout"` and message "Cancel timed out — the backend job will finish on its own and clean up automatically." This guarantees Truth #3's bounded recovery time.
- Total cap: capture `startMs = Date.now()` at the start of the run; on each poll iteration check `if (Date.now() - startMs > 600_000) throw new TimeoutError(...)`.
- Use `setTimeout`-driven sleep (`new Promise(r => setTimeout(r, 1000))`) but make the sleep itself awaitable on the abort signal so cancel doesn't have to wait for the next 1 s tick. Pattern: `await waitOrAbort(1000, signal)`.

**Performance considerations:** This loop runs once per analyze; the poll cadence (1 Hz) is the bottleneck, not CPU. No memoization needed in the loop. The `onProgress` callback fires up to 600 times per job — make it cheap (just `setSubStatus` / `setProgress` Zustand calls).

**Definition of Done:**
- [ ] Unit tests pass with fake timers covering: success path, single transient failure (recovers), 3 consecutive 5xx failures (aborts with last error), **single 4xx response (aborts immediately, no retries)**, total-time cap (aborts at 10 min), external abort (cancel signal), **35s cancel hard-bound (cancelling → 35s elapses → error: cancel-timeout)**
- [ ] No type errors
- [ ] `DeepMastering.tsx` no longer contains the busy `while(true)` loop — delegates to `pollUntilDone`
- [ ] Cancel button in DeepProgressCard, when wired to the controller, terminates polling within ~50 ms (no stale 1 s wait)
- [ ] No `setTimeout` leaks (verified via fake-timers `getTimerCount()` after abort returns 0)
- [ ] Manual smoke test on Safari 16/17 (older iOS) — analyze button does NOT throw `TypeError`

**Verify:**
- `pnpm exec vitest run src/lib/api/__tests__/deep-analysis-polling.test.ts`
- `pnpm exec tsc --noEmit`

---

### Task 3: Frontend error metadata + trace propagation + structured logging

**Objective:** Capture failure metadata (URL, status, message, jobId, traceparent) at the point of failure; surface it in the deep-store; emit a structured `console.error` for every failure path so devtools shows queryable JSON.
**Dependencies:** None (parallel with Task 1, 2)
**Mapped Scenarios:** TS-002

**Files:**
- Modify: `src/lib/api/deep-analysis.ts`
- Modify: `src/lib/stores/deep-store.ts`
- Modify: `src/lib/api/__tests__/deep-analysis.test.ts`

**Key Decisions / Notes:**
- New type in `deep-analysis.ts`:
  ```ts
  export interface DeepErrorDetails {
    /** Human-readable summary for the UI's headline. */
    message: string;
    /** Request URL that failed. Undefined for client-side errors. */
    url?: string;
    /** HTTP status, or "network error" / "timeout" / "cancelled" / "client". */
    status: string;
    /** Job ID if known at the time of failure. */
    jobId?: string;
    /** W3C trace ID parsed from `traceparent` response header, if present. */
    traceId?: string;
    /** Raw error message / stack for the technical-details `<pre>`. */
    raw: string;
    /** ISO timestamp of failure. */
    at: string;
  }
  ```
- Each fetch in the API client wraps the error path with a builder that produces a `DeepErrorDetails` and `console.error(JSON.stringify(details))` before throwing.
- Parse `traceparent`: if the response has the header, parse format `00-<trace-id>-<span-id>-<flags>`; capture trace-id (32 hex chars). Use a tiny inline parser — no new dep.
- New cancel API: `cancelDeepAnalysis(jobId, signal?)` — `DELETE /jobs/{id}`. Returns `{ ok: true } | { ok: false, status: 404 }`. 404 means the job already finished — treat as no-op.
- Deep store: add `errorDetails: DeepErrorDetails | null`, `startedAt: number | null`, setters. `setError(message)` is now `setError(details: DeepErrorDetails | null)`. Update existing tests accordingly.

**Definition of Done:**
- [ ] All existing deep-analysis tests still pass; new tests added for error metadata capture and traceparent parsing
- [ ] `setError(null)` clears both the message and details
- [ ] On a forced fetch failure in tests, the captured `console.error` payload is valid JSON containing `{message, url, status, raw, at}`
- [ ] `cancelDeepAnalysis` returns `{ ok: false, status: 404 }` (not throwing) when the backend returns 404
- [ ] No type errors

**Verify:**
- `pnpm exec vitest run src/lib/api/__tests__/deep-analysis.test.ts`
- `pnpm exec tsc --noEmit`

---

### Task 4: Backend cancel plumbing

**Objective:** Add a cooperative cancellation path so `DELETE /jobs/{id}` halts the in-progress worker thread between phases.
**Dependencies:** None (parallel with frontend tasks 1–3)
**Mapped Scenarios:** TS-003

**Files:**
- Modify: `backend/jobs.py`
- Modify: `backend/main.py`
- Modify: `backend/deep_analysis.py`
- Create: `backend/tests/test_cancel.py`

**Out of scope for this task:** `backend/separation.py`. The user's request is scoped to Deep Analysis. Reusing the cancel pattern in Smart Split is sensible follow-up work but introduces undisclosed scope (no E2E coverage, no Smart Split Cancel UI, risk of regressing Smart Split tests). Tracked in Deferred Ideas.

**Key Decisions / Notes:**
- `Job` dataclass adds `cancelled: bool = False`. JSON load defaults to False for legacy job records (`jdata.setdefault("cancelled", False)` in `_load_jobs`).
- New helper `is_cancelled(job_id: str) -> bool` in `jobs.py` — wraps `get_job` and returns the flag without holding state.
- New endpoint in `main.py`:
  ```python
  @app.delete("/jobs/{job_id}")
  async def cancel_job(job_id: str):
      job = get_job(job_id)
      if not job:
          raise HTTPException(status_code=404, detail="Job not found")
      if job.status in ("done", "error"):
          # Already terminal — DELETE is a no-op (idempotent)
          return {"job_id": job_id, "status": job.status, "cancelled": False}
      update_job(job_id, cancelled=True)
      return {"job_id": job_id, "status": job.status, "cancelled": True}
      ```
- In `_run_deep_analysis` (`backend/deep_analysis.py:50`), insert cancel checks at 3 phase boundaries (before section detection, before stem analysis, before script generation). Pattern:
  ```python
  if is_cancelled(job_id):
      update_job(job_id, status="error", error="Cancelled by user")
      return
  ```
- 404 on DELETE-already-finished is intentional (matches REST idempotency expectations + surfaces "we got the cancel but the work was already done" cleanly).
- **CORS expose for traceparent:** when modifying `main.py` for the DELETE endpoint, also extend CORSMiddleware with `expose_headers=["traceparent"]` so the browser-side fetch can read the trace ID from response headers. (See must_fix #1 in spec review.)

**Definition of Done:**
- [ ] `pytest backend/tests/test_cancel.py -q` passes (covers: cancel before any phase → status=error, error="Cancelled by user"; cancel after job done → 200 with cancelled=False; cancel of nonexistent job → 404)
- [ ] `cancelled` field round-trips through `_load_jobs` / `_save_jobs`
- [ ] `is_cancelled` returns False for nonexistent jobs (no exception)
- [ ] CORSMiddleware response includes `Access-Control-Expose-Headers: traceparent` for the prod origin (verified by an integration test calling `/health` with `Origin: https://aurialis.yosefgamble.com` and asserting the response header)
- [ ] `pytest backend/tests/ -q` (full suite) passes — no regressions

**Verify:**
- `cd backend && uv run pytest tests/test_cancel.py -q`
- `cd backend && uv run pytest tests/ -q`

---

### Task 5: OpenTelemetry tracing + structured JSON logging (FastAPI)

**Objective:** Add OpenTelemetry instrumentation with auto-instrumented FastAPI plus 4 manual spans around the deep-analysis phases, plus structured JSON logs with job_id / phase / duration_ms / error.
**Dependencies:** None (parallel with Task 4)
**Mapped Scenarios:** Truth #5 (OTel emits spans)

**Files:**
- Modify: `backend/requirements.txt`
- Modify: `backend/main.py`
- Modify: `backend/deep_analysis.py`
- Create: `backend/observability.py`
- Create: `backend/tests/test_observability.py`

**Key Decisions / Notes:**
- New deps in `requirements.txt`:
  ```
  opentelemetry-api>=1.27.0
  opentelemetry-sdk>=1.27.0
  opentelemetry-instrumentation-fastapi>=0.48b0
  opentelemetry-exporter-otlp-proto-http>=1.27.0
  ```
- New module `backend/observability.py` exports `setup_telemetry(app)` and `tracer`, `logger`. Called once from `main.py` at startup.
- Exporter selection: if `OTEL_EXPORTER_OTLP_ENDPOINT` env var is set, use the OTLP/HTTP exporter; otherwise use `ConsoleSpanExporter` (writes JSON to stdout — visible in `wrangler tail`). Use `BatchSpanProcessor` so exports don't block requests.
- `FastAPIInstrumentor.instrument_app(app, server_response_hook=_inject_traceparent)` enables auto-spans around every HTTP request AND injects the `traceparent` header into every response. The hook is small (~6 lines): `def _inject_traceparent(span, message): if message["type"] == "http.response.start": TraceContextTextMapPropagator().inject(message["headers"], setter=AsgiHeaderSetter())` — uses ASGI message headers (list of byte tuples).
- Manual spans in `_run_deep_analysis` around: `_load_mono_for_analysis`, `detect_sections`, `enrich_with_loudness_and_centroid`, `run_stem_artifact_analysis`. Each span gets attributes: `job_id`, `profile`, `audio.sample_rate`, `audio.duration_sec` (only on the load span), `phase` (sections|stems|script).
- **Thread context propagation — true parent-child via `context.attach`, NOT Link.** `_run_deep_analysis` runs in a daemon thread. OTel context does NOT auto-propagate. Span Links are NOT a parent-child relationship (Jaeger renders them as sidebar references). To get the worker spans nested under the FastAPI request span in the trace tree, capture the live request span at the call site (`captured_span = trace.get_current_span()`); pass it to the thread; inside the thread, the FIRST line is `token = context.attach(trace.set_span_in_context(captured_span))`. After the worker completes (success OR error), `context.detach(token)` and `tracer_provider.force_flush(timeout_millis=5000)` to ensure spans are exported before the daemon thread is reaped.
- Structured logging via stdlib `logging` + a JSON formatter (no new dep — write a 15-line `JsonFormatter`). Logger name `aurialis.deep_analysis`. Log on: job created, each phase enter/exit (with `duration_ms`), errors (with full traceback). Format: `{"timestamp", "level", "msg", "job_id", "phase", "duration_ms", "error", "trace_id"}`. The `trace_id` is fetched from the active span at log time, linking logs to traces.
- The `/health` endpoint stays untraced (low signal, high frequency) — apply `excluded_urls` config to FastAPIInstrumentor: `excluded_urls="health"`.

**Performance considerations:** OTel adds ~0.5–1 ms per request for span creation; negligible compared to the 30-s+ Demucs work. `BatchSpanProcessor` flushes asynchronously — no impact on response latency. Manual spans inside the worker thread cost ~50 µs each at phase boundaries.

**Definition of Done:**
- [ ] `pytest backend/tests/test_observability.py -q` passes, covering:
  - `setup_telemetry` returns a tracer
  - Manual span attributes (`job_id`, `phase`, `audio.sample_rate`) are set
  - JSON logger emits valid JSON with the documented fields
  - **Thread context propagation: assert that the worker span's `parent` matches the request span's context — i.e., `worker_span.parent.span_id == request_span.context.span_id` and `worker_span.context.trace_id == request_span.context.trace_id`.** A Link-only test would silently pass even if the parent-child relationship is broken — this assertion catches that.
  - `force_flush` is called at thread exit (mock the provider, assert called)
  - `_inject_traceparent` hook adds a `traceparent` header to ASGI response messages
- [ ] Integration test: spawn FastAPI in-process via `TestClient`, hit `POST /analyze/deep` with mocked Demucs, assert the response includes `traceparent` header in W3C format (`00-<32-hex>-<16-hex>-<flags>`)
- [ ] When `OTEL_EXPORTER_OTLP_ENDPOINT` is unset, spans appear in stdout JSON during a local request
- [ ] Structured log line on phase enter/exit contains `job_id`, `phase`, `duration_ms`, `trace_id`
- [ ] `/health` requests do NOT produce spans (verified by `excluded_urls` config + test)

**Verify:**
- `cd backend && uv run pytest tests/test_observability.py -q`
- `cd backend && docker build -t aurialis-core-test .` (manual — no CI gate)

---

### Task 6: Tests — Vitest + pytest + Playwright E2E

**Objective:** Lock in the 7 truths via automated tests that match the E2E scenarios.
**Dependencies:** Tasks 1–5
**Mapped Scenarios:** TS-001..TS-005

**Files:**
- Modify: `src/components/mastering/__tests__/DeepProgressCard.test.tsx` (extended)
- Modify: `src/lib/api/__tests__/deep-analysis-polling.test.ts` (extended)
- Modify: `src/lib/api/__tests__/deep-analysis.test.ts` (extended)
- Modify: `backend/tests/test_cancel.py` (extended)
- Create: `e2e/deep-analysis-progress.spec.ts`
- Create: `backend/tests/test_observability.py` (covered in T5)

**Key Decisions / Notes:**
- Playwright E2E mocks the FastAPI backend at the network layer (`page.route('**/analyze/deep', ...)`, etc.) — does NOT require a live container. This keeps the E2E suite hermetic and CI-runnable.
- Five Playwright scenarios map 1:1 to TS-001..TS-005. Each uses `vi.useFakeTimers`-equivalent for total-cap simulation: Playwright's `clock.fastForward` API.
- For TS-005 (transient failures), the route handler returns alternating success / 502 responses driven by a counter. The test asserts the UI does NOT show error after fewer than 3 consecutive failures.
- Each E2E scenario takes a screenshot on failure (Playwright default) — diagnostic when CI fails.

**Definition of Done:**
- [ ] `pnpm exec vitest run` — all unit tests pass
- [ ] `cd backend && uv run pytest -q` — all backend tests pass with ≥ 80 % coverage on new modules (`observability.py`, cancel paths in `deep_analysis.py` / `separation.py`)
- [ ] `pnpm exec playwright test e2e/deep-analysis-progress.spec.ts` — all 5 scenarios green
- [ ] Full pre-CI gate: `pnpm exec tsc --noEmit && pnpm run lint && pnpm exec vitest run`

**Verify:**
- `pnpm exec vitest run`
- `cd backend && uv run pytest -q`
- `pnpm exec playwright test e2e/deep-analysis-progress.spec.ts`
- `pnpm exec tsc --noEmit && pnpm run lint`

## Open Questions

None remaining — design choices captured in Step 7 Q&A.

## Deferred Ideas

- **Frontend OTel SDK** — pulls in ~30 KB; defer until we have an OTLP collector configured to actually receive frontend spans. Today's pragma: structured `console.error` + traceId-from-headers is enough.
- **Cancellation mid-Demucs-batch** — would require a custom Demucs wrapper that polls for cancel inside `apply_model`; deep-cuts into a third-party library. Phase-boundary cancel is sufficient for the user pain point.
- **Smart Split cancel** — applying the same cancel pattern to `backend/separation.py` is a sensible follow-up; intentionally out of scope here because it would require a Smart Split UI Cancel button + new TS scenarios + Smart Split regression coverage. File a follow-up plan once Deep Analysis cancel is shipped and validated.
- **Persistence of failed jobs** — could store the last `DeepErrorDetails` in localStorage so a refresh keeps the error visible. Defer — user can re-trigger.
- **Replace polling with SSE / WebSockets** — a real future optimization; out of scope for "make failures visible" goal.
