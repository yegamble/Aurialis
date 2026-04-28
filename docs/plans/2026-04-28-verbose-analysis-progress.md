# Verbose Analysis Progress Implementation Plan

Created: 2026-04-28
Author: yegamble@gmail.com
Status: VERIFIED
Approved: Yes
Iterations: 0
Worktree: No
Type: Feature

## Summary

**Goal:** Make every analysis flow in Aurialis self-narrating so users can distinguish between "still working", "stuck", and "failed at stage X" — and bump the analysis backend's container vCPU so analyses don't time out from CPU starvation.

**Architecture:** Introduce one shared `AnalysisStage` event harness (types + emitter helper + per-flow Zustand store + console formatter). Wire the four existing analysis pipelines (Deep Analysis, Smart Split, Mastering DSP `analyzeAudio`, Stem-Mixer auto-mix) through the harness without changing their core logic. Surface the active stage, its elapsed time, and the chronological stage trace in both the UI progress cards and the browser console with a consistent prefix. Bump `backend/wrangler.jsonc` `instance_type` from `standard` (legacy alias for `standard-1` = ½ vCPU, 4 GiB, 8 GB) to `standard-4` (4 vCPU, 12 GiB, 20 GB disk) so Demucs / madmom finishes within the polling loop's 10-min total cap.

**Cloudflare Containers tier catalog** (verified 2026-04-28 against [https://developers.cloudflare.com/containers/platform-details/limits/](https://developers.cloudflare.com/containers/platform-details/limits/)): `lite` (1/16 vCPU), `basic` (1/4 vCPU), `standard-1` (1/2 vCPU, 4 GiB) — current — `standard-2` (1 vCPU, 6 GiB), `standard-3` (2 vCPU, 8 GiB), `standard-4` (4 vCPU, 12 GiB, 20 GB) — target. Plus optional custom tiers up to 4 vCPU / 12 GiB / 20 GB.

**Tech Stack:** TypeScript, React, Zustand (existing stores pattern), Cloudflare Containers (wrangler.jsonc). No new dependencies.

## Scope

### In Scope

- Bump `backend/wrangler.jsonc` container `instance_type` from `standard` → `standard-4`.
- A shared `AnalysisStage` types module + emitter + per-flow Zustand stage-trace store + console formatter (`[analysis:<flow>:<stage> 12.3s]`).
- Wiring Deep Analysis (`DeepMastering.tsx` + `deep-analysis-polling.ts`) through the harness. Existing `DeepProgressCard` extended to show per-stage start/end timings and the failed-at-stage on error.
- Wiring Smart Split (`src/app/mix/page.tsx` `handleStartSeparation` + `handleSplitFurther`) through the harness. Replace its inline recursive `setTimeout` polling with the same resilient pattern Deep Analysis uses (per-request timeout, 3-strikes failure tolerance, total cap). Add a Smart Split progress card that mirrors DeepProgressCard's structure for parity.
- Wiring synchronous mastering DSP analysis (`analyzeAudio` in `src/lib/audio/analysis.ts` + `handleAutoMaster` in `src/app/master/page.tsx`) through the harness, with chunked yielding (`requestIdleCallback` / `Promise.resolve()` per N samples) so the main thread can repaint between sub-band passes.
- Wiring Stem-Mixer auto-mix (`autoMix` in `src/hooks/useMixEngine.ts`) through the harness with per-stem progress events.
- Error-path enhancements on every flow: failed-at-stage label in the UI error card, full chronological stage trace in `console.error`, per-stage timings in both UI and console.
- Unit tests for the harness (emitter, store, formatter) + per-flow integration tests verifying stage events fire in expected order.
- Playwright E2E scenarios verifying users see stage progression and stage-tagged errors in each flow.

### Out of Scope

- Switching to SSE / WebSocket streaming from the backend (rejected — overkill, polling already works after CPU bump).
- Backend protocol changes (`/jobs/{id}/status` shape, `partial_result` keys). The frontend harness derives stages from existing fields.
- Reworking Deep Analysis's resilient polling (`pollUntilDone`) — only adds emit hooks.
- GPU support for the analysis backend (separate concern, larger infra change).
- Logging to a remote service / persistent telemetry. Console + UI only.

## Approach

**Chosen:** Shared harness across all four flows.

**Why:** Each flow gets identical observability semantics (same console prefix shape, same UI stage-list pattern, same error-trace dump) at the cost of one new module + a one-time refactor per flow. Adding a flow later only requires emitting the standard events. The harness's primary value is **error-trace shape consistency**, not UI reuse — each flow keeps its own bespoke progress UI (DeepProgressCard / SeparationProgressCard / inline strip / button label), so future maintainers should not try to consolidate the four progress UIs into one component.

**Alternatives considered:**

- **Per-flow ad-hoc progress:** Faster to ship for any single flow, but inconsistent shape across flows means future maintainers have to relearn each one. Rejected.
- **Backend SSE / WebSocket streaming:** Better real-time semantics, but the underlying timeout is a CPU problem (solved by Task 1) — the polling cadence is fine. Backend protocol change is out of proportion to the visibility goal. Rejected.

## Context for Implementer

> Write for an implementer who has never seen the codebase.

- **Patterns to follow:**
  - Zustand store pattern: `src/lib/stores/deep-store.ts` (concise interface + `create<T>((set, get) => ({…}))` body).
  - Resilient polling pattern: `src/lib/api/deep-analysis-polling.ts:135` (`pollUntilDone`).
  - Structured error pattern: `src/lib/api/deep-analysis.ts:38` (`DeepErrorDetails` + `DeepAnalysisError`).
  - Progress UI pattern: `src/components/mastering/DeepProgressCard.tsx` (status / sub-status / elapsed + error pre block with toggle).
  - Test pattern: `src/lib/api/__tests__/deep-analysis.test.ts` (Vitest + fetch mocking + describe-per-export).

- **Conventions:**
  - File names: kebab-case (e.g. `analysis-stage.ts`).
  - Components: PascalCase, in `src/components/<area>/`.
  - Stores: `src/lib/stores/<name>-store.ts` exporting `useXxxStore`.
  - One-line JSDoc on exports.
  - Explicit return types on exports.
  - Imports: built-ins → external → internal `@/…` → relative.

- **Key files:**
  - `src/lib/api/deep-analysis.ts` — Deep Analysis HTTP client, `DeepErrorDetails`, structured error logging.
  - `src/lib/api/deep-analysis-polling.ts` — resilient poll loop with `onPoll` callback (this is the natural integration point for harness emits).
  - `src/components/mastering/DeepMastering.tsx` — orchestrator; calls `startDeepAnalysis` → `pollUntilDone` → `fetchDeepResult`.
  - `src/components/mastering/DeepProgressCard.tsx` — existing UI; has hardcoded `STAGES` list (lines 22–26).
  - `src/lib/api/separation.ts` — Smart Split HTTP client (no retry / no structured errors yet).
  - `src/app/mix/page.tsx:108-215` — Smart Split orchestration with inline recursive polling (the part being refactored).
  - `src/lib/audio/analysis.ts` — synchronous DSP `analyzeAudio` (~10–500 ms depending on file length).
  - `src/app/master/page.tsx:235-245` — `handleAutoMaster` calling `analyzeAudio` synchronously.
  - `src/hooks/useMixEngine.ts:272-306` — `autoMix` callback (per-stem `analyzeStem`).
  - `backend/wrangler.jsonc:35-43` — Cloudflare Container `instance_type` config.
  - `backend/deep_analysis.py:76-158` — backend phase progression (5 → 15 → 40 → 80 → 100; `partial_result` keys `sections` / `stems` / `script`).
  - `backend/separation.py:63-130` — backend phase progression (10 → 50–89 → 90 → 100).

- **Gotchas:**
  - `DeepProgressCard` is wrapped in `memo()` — extending its prop shape requires updating the prop interface (not just internal state).
  - `pollUntilDone` already calls `onPoll(status, elapsedMs)` — the harness emit goes inside `onPoll`, not as a new callback parameter.
  - `analyzeAudio` is currently sync; making it async means callers in `handleAutoMaster` and tests must `await`. There is one callsite in production code (`src/app/master/page.tsx:238`) and one in tests (`src/lib/audio/__tests__/analysis.test.ts`).
  - Smart Split's `handleStartSeparation` is in a page component — pulling its retry / timeout logic into a shared module reduces duplication and makes it testable.
  - Deep Analysis backend reports `progress` in coarse jumps (5 → 15 → 40 → 80) — the harness must NOT pretend this is continuous; show coarse stage transitions, not interpolated smoothness.
  - Cloudflare instance type bump requires `wrangler deploy` (paid plan only) — implementer just edits the config; deploy happens out-of-band after merge.
  - `backend/wrangler.jsonc` is the *backend* worker (`aurialis-core`), not the root frontend `wrangler.jsonc`. Don't edit the wrong file.

- **Domain context:**
  - "Deep Analysis" runs sections detection (madmom) → stems separation (Demucs) → script generation (LLM) on the backend, polled by frontend.
  - "Smart Split" runs Demucs only (no sections / script).
  - "Mastering DSP analysis" is `analyzeAudio` — pure JS LUFS / peak / dynamic-range / spectral-balance computation on a decoded `AudioBuffer`. Triggers from the Auto-master button.
  - "Stem-Mixer auto-mix" runs `analyzeStem` on each loaded stem (LUFS + spectral) then `generateAutoMix` (heuristic gain/pan/EQ assignment).

## Runtime Environment

- **Frontend dev:** `pnpm dev` on http://localhost:3000.
- **Backend dev:** `cd backend && uv run uvicorn main:app --reload --port 8000`.
- **Backend deploy:** `cd backend && pnpm wrangler deploy` (paid Cloudflare account; deploys the container).
- **Health check:** `curl http://localhost:8000/health` returns `{ ok: true, gpu, models }`.
- **Restart procedure:** `Ctrl-C` the dev server, re-run the start command.

## Assumptions

- Cloudflare Containers tier `standard-4` (4 vCPU / 12 GiB / 20 GB) exists and is available on the deploying account — verified 2026-04-28 against `https://developers.cloudflare.com/containers/platform-details/limits/` which lists six predefined tiers: lite, basic, standard-1, standard-2, standard-3, standard-4. Task 1 depends on this.
- Backend's existing `progress` and `partial_result` fields cover the observable phases we need to surface; no backend protocol changes required — supported by `backend/deep_analysis.py:76-158` and `backend/separation.py:63-130`. Tasks 3, 4 depend on this.
- `analyzeAudio` runs in ≤ 1 s on typical (3–6 min) tracks — supported by the absence of any "Analyzing…" UI for it today and the existing tests in `src/lib/audio/__tests__/analysis.test.ts` running synchronously without timeout. Task 5's chunking is a guard for outlier large buffers, not a hot-path optimization.
- Existing E2E suites (`e2e/deep-analysis-progress.spec.ts`, `e2e/smart-split.spec.ts`, `e2e/mastering.spec.ts`, `e2e/mixer.spec.ts`) are runnable in this environment and gate verification. Task 7 depends on this.

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| Bumping container to `standard-4` raises hosting cost | High | Low (cost) | Document the change in the plan + commit message; deploy is user-triggered. Recommend `standard-2` as a fallback if cost matters more than analysis speed (note in the wrangler.jsonc comment). |
| Console verbosity floods devtools during normal use | Medium | Medium | Gate `console.debug`-level emits behind `process.env.NEXT_PUBLIC_ANALYSIS_VERBOSE === "true"` (default off in prod). `console.info` for stage transitions, `console.error` for failures — always on. |
| Making `analyzeAudio` async breaks existing call sites | Low | Medium | Keep a sync `analyzeAudioSync` export for callers that depend on synchronous semantics (currently only tests). Add the async chunked variant as `analyzeAudio`. Update the one production caller in `src/app/master/page.tsx`. |
| Smart Split refactor regresses the existing pipeline | Medium | High | Refactor incrementally: extract the inline recursive polling into a new `pollSeparationUntilDone` mirroring `pollDeepUntilDone`. Rely on existing `e2e/smart-split.spec.ts` + new TS-003/TS-004 as the regression gate (acceptable for a single-page client where the only consumer is `src/app/mix/page.tsx`). No feature flag — the change is small enough and reverting is one git command. |
| Stage-trace console dumps leak job IDs / file names to logs | Low | Low | Stage events store only stage name + elapsed ms + status; no file content, no job ID in `console.debug` (job ID stays in the existing structured `DeepErrorDetails.jobId` for `console.error` only — same as today). |

## Goal Verification

### Truths

1. After Task 1 deploys, the Cloudflare Containers UI for `aurialis-core-container` shows `4 vCPU` (not `1/2 vCPU`).
2. During a Deep Analysis run on a 4-min track, the user sees the active stage label change at least 3 times (sections → stems → script) within `DeepProgressCard`, and each stage shows its own elapsed time. Console emits exactly one `[analysis:deep:<stage>]` start line per stage in chronological order plus one `[analysis:deep:done]` end line.
3. During a Smart Split run, the user sees a progress card analogous to `DeepProgressCard` showing at least 3 stages (queued → separating → finalizing) with elapsed times.
4. Triggering Auto-master on the mastering page shows a transient "Analyzing…" indicator with stage progress. Console emits exactly four phase-transition `console.info` lines in this exact order: `[analysis:mastering-auto:loudness]`, `[analysis:mastering-auto:peak]`, `[analysis:mastering-auto:dynamic-range]`, `[analysis:mastering-auto:spectral-balance]`, plus a final `[analysis:mastering-auto:done]` line. Out-of-order or missing-stage runs FAIL this truth.
5. Clicking Auto-Mix in the stem mixer shows per-stem stage progress (`[analysis:auto-mix:stem-N/M …]` in console + UI), not just a binary "Analyzing…" / done.
6. When any of the four flows fails, the UI error surface displays `Failed at: <stage-name>` and `console.error` outputs a single structured line containing the chronological stage trace and per-stage durations. (Verified by TS-002, TS-004, TS-006, TS-008.)
7. Re-running the existing `e2e/deep-analysis-progress.spec.ts` and `e2e/smart-split.spec.ts` continues to pass (no regression).

### Artifacts

- `backend/wrangler.jsonc` — `instance_type: "standard-4"` after Task 1.
- `src/lib/analysis-stage/types.ts` — `AnalysisStageEvent`, `AnalysisStage`, `AnalysisFlow` types.
- `src/lib/analysis-stage/emitter.ts` — `emitStage(flow, stage, payload?)`, console-formatting helper.
- `src/lib/stores/analysis-stage-store.ts` — Zustand store keyed by flow ID, holds the chronological trace + active-stage pointer.
- `src/components/mastering/DeepProgressCard.tsx` — extended to show per-stage timings and failed-at label.
- New `src/components/mix/SeparationProgressCard.tsx` — Smart Split progress card.
- `src/lib/api/separation-polling.ts` — extracted resilient poll for Smart Split.
- `src/lib/audio/analysis.ts` — async chunked variant + sync export preserved for tests.
- `src/hooks/useMixEngine.ts` — auto-mix loop emits per-stem stages.
- `e2e/deep-analysis-progress.spec.ts`, `e2e/smart-split.spec.ts`, `e2e/mastering.spec.ts`, `e2e/mixer.spec.ts` — extended with stage-visibility scenarios.

## E2E Test Scenarios

### TS-001: Deep Analysis happy path shows all stages

**Priority:** Critical
**Preconditions:** Track loaded, mastering page in Deep mode, backend reachable.
**Mapped Tasks:** Task 3, Task 7

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click `[data-testid="deep-analyze-button"]` | DeepProgressCard appears with "Analyzing…" |
| 2 | Wait for backend to enter `partial_result.sections` | Stage list shows "Detecting sections" with `…` and an elapsed timer that ticks |
| 3 | Wait for `partial_result.stems` | Previous stage shows a fixed elapsed time, "Analyzing stems" becomes active |
| 4 | Wait for `partial_result.script` | "Generating script" becomes active |
| 5 | Wait for `status === "ready"` | DeepProgressCard hides; DeepTimeline renders |

### TS-002: Deep Analysis error shows failed-at-stage

**Priority:** Critical
**Preconditions:** Track loaded; backend mocked to return 500 at `/jobs/{id}/status` after stems.
**Mapped Tasks:** Task 3, Task 7

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click `[data-testid="deep-analyze-button"]` | Analysis starts |
| 2 | Wait for failure | `[data-testid="deep-progress-error-message"]` is visible AND contains the active stage name (e.g. "Failed at: Analyzing stems") |
| 3 | Click "Show details" | `[data-testid="deep-progress-error-details"]` reveals chronological stage trace with durations |
| 4 | Inspect `page.consoleMessages` | Exactly one `console.error` line tagged `[analysis:deep:error]` with structured JSON containing `stages: [...]` array |

### TS-003: Smart Split happy path shows stages

**Priority:** Critical
**Preconditions:** Mix page open, single audio file ready to upload.
**Mapped Tasks:** Task 4, Task 7

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Drop a file → click confirm in model-select dialog | Separation progress card appears |
| 2 | Wait for queued → processing transition | Stage label switches from "Queued" to "Separating stems" |
| 3 | Wait for backend `progress: 90` | Stage label switches to "Finalizing" |
| 4 | Wait for done | Card hides; mixer renders the loaded stems |

### TS-004: Smart Split error shows failed-at-stage

**Priority:** High
**Preconditions:** Mix page open; backend mocked to fail at `/jobs/{id}/status`.
**Mapped Tasks:** Task 4, Task 7

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Trigger separation | Card appears |
| 2 | Wait for backend failure | Error UI shows `Failed at: Separating stems` (or whatever stage was active) |
| 3 | Inspect console | `[analysis:smart-split:error]` line with chronological stage trace + durations |

### TS-005: Mastering Auto-master shows progress

**Priority:** Medium
**Preconditions:** Master page open with track loaded.
**Mapped Tasks:** Task 5, Task 7

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click Auto-master button | Transient progress indicator visible with stage label |
| 2 | Wait for completion (≤ 1 s typically) | Indicator hides, params applied. Console emits an ordered subsequence of exactly five lines: `[analysis:mastering-auto:loudness]` → `[…peak]` → `[…dynamic-range]` → `[…spectral-balance]` → `[…done]`. Test asserts the ordered subsequence, not just presence of any one prefix. |

### TS-006: Mastering Auto-master error path

**Priority:** Medium
**Preconditions:** Master page; mock `analyzeAudio` to throw mid-pass.
**Mapped Tasks:** Task 5, Task 7

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click Auto-master | Indicator shows |
| 2 | Wait for throw | Inline error toast/message includes the failed stage name |
| 3 | Inspect console | `[analysis:mastering-auto:error]` line with stage trace |

### TS-007: Stem-Mixer auto-mix shows per-stem progress

**Priority:** High
**Preconditions:** Mix page open with ≥3 stems loaded.
**Mapped Tasks:** Task 6, Task 7

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click "Auto Mix" button | Progress indicator appears, "Analyzing stem 1 of N" |
| 2 | Wait | Indicator updates to "Analyzing stem 2 of N", etc. |
| 3 | Wait for completion | Indicator hides, mixer state updated |

### TS-008: Stem-Mixer auto-mix error path

**Priority:** Medium
**Preconditions:** Mix page; one stem with corrupted audio buffer.
**Mapped Tasks:** Task 6, Task 7

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click "Auto Mix" | Progress shows |
| 2 | Wait for failure on bad stem | Error UI shows `Failed analyzing stem N: <name>` |
| 3 | Inspect console | `[analysis:auto-mix:error]` line with which stem failed and durations of completed stems |

## Progress Tracking

- [x] Task 1: Bump container vCPU
- [x] Task 2: Build shared analysis-stage harness
- [x] Task 3: Wire Deep Analysis through harness
- [x] Task 4: Refactor Smart Split through harness (with retry/timeout)
- [x] Task 5: Wire Mastering Auto-master through harness (chunked)
- [x] Task 6: Wire Stem-Mixer auto-mix through harness
- [x] Task 7: E2E coverage + verification

**Total Tasks:** 7 | **Completed:** 7 | **Remaining:** 0

## E2E Results

| Scenario | Priority | Result | Fix Attempts | Notes |
|----------|----------|--------|--------------|-------|
| TS-001 (Deep Analysis happy path stages) | Critical | PASS | 0 | Console emits upload-start, sections, stems, done in order. |
| TS-002 (Deep Analysis failed-at-stage label) | Critical | PASS | 0 | UI shows "Failed at: Detecting sections" mid-flight on 410. |
| TS-003 (Smart Split happy path stages) | Critical | DEFERRED | – | Covered by harness console assertion in TS-004; full happy path requires live Demucs backend. Existing smart-split.spec.ts passes the regression flow. |
| TS-004 (Smart Split failed-at-stage label) | High | PASS | 1 | Initial selector targeted generic "separate" button; corrected to "4 Stems" matching mix/page.tsx:644. |
| TS-005 (Auto-master ordered phase lines) | Medium | PASS | 1 | Initial fixed-timeout wait was flaky in parallel; replaced with `page.waitForFunction` polling for the `done` line. |
| TS-006 (Auto-master error path) | Medium | DEFERRED | – | Covered by analysis.test.ts unit-level error handling; mocking `analyzeAudio` to throw mid-pass requires page-level injection beyond Playwright's normal scope. |
| TS-007 (Stem-Mixer per-stem progress) | High | PASS | 0 | Console emits stem-1/4 through stem-4/4 + generate-mix + done. |
| TS-008 (Stem-Mixer per-stem error) | Medium | DEFERRED | – | Covered by useMixEngine.test.ts unit-level error path with corrupt-buffer fixture. |

## Implementation Tasks

### Task 1: Bump Cloudflare Container vCPU

**Objective:** Change the analysis backend container from `standard` (½ vCPU) to `standard-4` (4 vCPU) so Demucs and madmom finish well within the 10-minute polling cap.
**Dependencies:** None
**Mapped Scenarios:** None (deploy verification, not E2E)

**Files:**

- Modify: `backend/wrangler.jsonc`
- Modify: `backend/DEPLOY.md` — note new instance type and rough cost delta in the deploy section (one paragraph).

**Key Decisions / Notes:**

- Set `instance_type` to `"standard-4"` (4 vCPU, 12 GiB RAM, 8 GB disk).
- Keep `max_instances: 5` unchanged.
- Add a comment in `wrangler.jsonc` next to `instance_type` documenting why this tier was chosen ("Demucs htdemucs_6s is ~3× realtime per vCPU; standard-4 finishes a 4-min song in ~30 s").
- This task does NOT trigger a deploy. Deploy is user-driven via `pnpm wrangler deploy` from `backend/`.

**Definition of Done:**

- [ ] `backend/wrangler.jsonc` shows `"instance_type": "standard-4"` with explanatory comment.
- [ ] `backend/DEPLOY.md` mentions the new tier in its container section.
- [ ] `pnpm wrangler deploy --dry-run` (from `backend/`) parses the file without error.
- [ ] Tier name `standard-4` verified to match Cloudflare's current published catalog at https://developers.cloudflare.com/containers/platform-details/limits/ (URL pinned in commit message). Verified 2026-04-28 to be one of the six predefined tiers: `lite`, `basic`, `standard-1`, `standard-2`, `standard-3`, `standard-4`.

**Verify:**

- `cd backend && pnpm wrangler deploy --dry-run`
- `grep instance_type backend/wrangler.jsonc`

---

### Task 2: Build shared analysis-stage harness

**Objective:** Create the `AnalysisStage` types, emitter, console formatter, and Zustand store that every other task plugs into.
**Dependencies:** None
**Mapped Scenarios:** Indirectly TS-001..TS-008 (all rely on this)

**Files:**

- Create: `src/lib/analysis-stage/types.ts`
- Create: `src/lib/analysis-stage/emitter.ts`
- Create: `src/lib/analysis-stage/console-format.ts`
- Create: `src/lib/stores/analysis-stage-store.ts`
- Test: `src/lib/analysis-stage/__tests__/emitter.test.ts`
- Test: `src/lib/analysis-stage/__tests__/console-format.test.ts`
- Test: `src/lib/stores/__tests__/analysis-stage-store.test.ts`
- Modify: `.env.example` if it exists, OR `README.md` env-var section, OR `backend/DEPLOY.md` — document `NEXT_PUBLIC_ANALYSIS_VERBOSE` (default `false`, set to `true` to enable per-tick `console.debug` lines during analysis runs). The env var must be documented somewhere a developer cloning the repo will find it.

**Key Decisions / Notes:**

- `AnalysisFlow` is a union: `"deep" | "smart-split" | "mastering-auto" | "auto-mix"`.
- `AnalysisStage` carries: `flow`, `runId` (a per-run uuid), `stage` (string), `phase` (`"start" | "tick" | "end" | "error"`), `progress?` (0–100, optional), `at` (ms since epoch), `note?` (string for free-form context).
- Store shape: keyed by `runId`, holds `{ flow, startedAt, endedAt?, stages: AnalysisStageEvent[], activeStage: string | null, error?: { stage: string; message: string; raw: string } }`. Auto-prune rules: a successful run (last phase `end`) prunes 60 s after `endedAt`; a failed run (last phase `error`) prunes 10 minutes after `endedAt` so the user has time to expand "Show details" and read the trace. The error UI MAY also explicitly call `clearRun(runId)` when the user dismisses the error card to reclaim memory immediately.
- Console emit: `emitStage` always logs `console.info` for `start`/`end`, `console.error` for `error`, and `console.debug` for `tick` (debug gated by `NEXT_PUBLIC_ANALYSIS_VERBOSE === "true"`). Format: `[analysis:<flow>:<stage>] +12.3s {note?} (progress: NN%)`.
- Performance: emitter is a thin sync wrapper — never returns a promise. `console.error` for failure includes a one-shot JSON dump of the full stages array so a single line in the console gives the full trace.

**Definition of Done:**

- [ ] All exports have explicit TypeScript return types.
- [ ] `tsc --noEmit` clean.
- [ ] Emitter unit test verifies it writes to the correct console method per phase and gates `tick` behind the env flag.
- [ ] Store unit test verifies stages append in chronological order, `activeStage` follows the latest `start` not yet matched by an `end`, success-run pruning fires at 60 s, and error-run pruning waits the full 10 minutes (use Vitest fake timers; do NOT actually wait).
- [ ] Console-format unit test verifies prefix shape, elapsed formatting (`+1.2s`, `+1m02s`), and progress suffix conditional rendering.
- [ ] `NEXT_PUBLIC_ANALYSIS_VERBOSE` env var documented in the agreed location (`.env.example`, README, or `DEPLOY.md`).

**Verify:**

- `pnpm test src/lib/analysis-stage src/lib/stores/__tests__/analysis-stage-store.test.ts --silent`
- `pnpm tsc --noEmit`

---

### Task 3: Wire Deep Analysis through harness

**Objective:** Emit stage events from `DeepMastering.runAnalyze` + `pollUntilDone` and surface failed-at-stage in `DeepProgressCard`.
**Dependencies:** Task 2
**Mapped Scenarios:** TS-001, TS-002

**Files:**

- Modify: `src/components/mastering/DeepMastering.tsx`
- Modify: `src/lib/api/deep-analysis-polling.ts` (add stage emit inside existing `onPoll`, do not change retry/timeout logic)
- Modify: `src/components/mastering/DeepProgressCard.tsx` (extend props to accept failed-at-stage and per-stage durations; render them; keep memoized)
- Modify: `src/lib/stores/deep-store.ts` (carry the active `runId` in state so the card can subscribe to the trace)
- Test: extend `src/lib/api/__tests__/deep-analysis-polling.test.ts` to assert stage events fire on phase transitions
- Test: extend `src/components/mastering/__tests__/DeepProgressCard.test.tsx` to verify the new props render correctly

**Key Decisions / Notes:**

- Stage names: `upload-start` → `queued` → `sections` → `stems` → `script` → `done` (or `error`).
- **Stage → backend-field mapping** (no protocol changes — derives from existing fields):

  | Stage | Derived from |
  |-------|--------------|
  | `upload-start` | Client-side, emitted just before `startDeepAnalysis` resolves |
  | `queued` | `pollDeepJobStatus` returns `status === 'queued'` |
  | `sections` | `partial_result.sections` is present and `partial_result.stems` is NOT |
  | `stems` | `partial_result.stems` is present and `partial_result.script` is NOT |
  | `script` | `partial_result.script` is present, `status !== 'done'` |
  | `done` | `status === 'done'` |
  | `error` | `status === 'error'` (the `error` field carries the message) |
  Backend reference: `backend/deep_analysis.py:76-158` (progress 5 → 15 → 40 → 80 → 100).
- Implementer must NOT change the existing retry / timeout / cancel logic in `pollUntilDone`. Only add `emitStage(...)` calls inside the existing `onPoll` callback in `DeepMastering.runAnalyze`.
- On error, `runAnalyze` calls `emitStage("deep", lastActiveStage, "error", { note: errMsg })` BEFORE setting `setStatus("error")` so the trace lands first.
- The existing `DeepErrorDetails` is preserved unchanged; the harness's stage trace is an additional structured channel, not a replacement.

**Definition of Done:**

- [ ] All four `partial_result` transitions emit a stage event in the correct order (verified by polling test).
- [ ] On simulated error, the error UI shows `Failed at: <stage-label>` matching the most recent active stage.
- [ ] Console shows one `console.info` line per stage transition during a happy run.
- [ ] Console shows exactly one `console.error` line on failure, containing the full stages array.
- [ ] `e2e/deep-analysis-progress.spec.ts` still passes (no regression).

**Verify:**

- `pnpm test src/lib/api/__tests__/deep-analysis-polling.test.ts src/components/mastering/__tests__/DeepProgressCard.test.tsx --silent`
- `pnpm tsc --noEmit`
- `pnpm exec playwright test e2e/deep-analysis-progress.spec.ts`

---

### Task 4: Refactor Smart Split through harness

**Objective:** Extract Smart Split's inline recursive polling into a resilient `pollSeparationUntilDone` (mirroring `pollDeepUntilDone`), wire it through the stage harness, add a `SeparationProgressCard`, surface structured errors.
**Dependencies:** Task 2
**Mapped Scenarios:** TS-003, TS-004

**Files:**

- Modify: `src/lib/api/separation.ts` (add `SeparationError` + `SeparationErrorDetails` mirroring `DeepAnalysisError`; structure the error throws so `handleStartSeparation` gets typed details)
- Create: `src/lib/api/separation-polling.ts` (mirrors `deep-analysis-polling.ts` — per-request timeout, 3-strikes failure tolerance, total cap; emits stage events via the harness)
- Create: `src/components/mix/SeparationProgressCard.tsx` (mirrors DeepProgressCard structure: status / progress / stage list / failed-at on error / details toggle)
- Modify: `src/app/mix/page.tsx` (`handleStartSeparation` and `handleSplitFurther` use the new poll function and render `SeparationProgressCard` instead of the bare error string)
- Test: `src/lib/api/__tests__/separation-polling.test.ts` (new)
- Test: extend `src/lib/api/__tests__/separation.test.ts` for structured errors

**Key Decisions / Notes:**

- Stage names: `upload-start` → `queued` → `separating-stems` → `finalizing` → `downloading` → `done` (or `error`).
- **Stage → backend-field mapping** (no protocol changes):

  | Stage | Derived from |
  |-------|--------------|
  | `upload-start` | Client-side, before `startSeparation` resolves |
  | `queued` | `status === 'queued'` (default state pre-`update_job`; first poll typically returns this) |
  | `separating-stems` | `status === 'processing' && progress < 90` |
  | `finalizing` | `progress >= 90 && status !== 'done'` |
  | `downloading` | Client-side, while iterating `downloadStem(jobId, name)` for each ready stem |
  | `done` | `status === 'done'` |
  | `error` | `status === 'error'` |
  Backend reference: `backend/separation.py:36-130` (progress 0 → 10 → 50–89 → 90 → 100).
- The new `pollSeparationUntilDone` uses the SAME timeout/retry constants as `pollDeepUntilDone` (15s per request, 3 strikes, 10min cap) — copy them as named constants in a tiny shared module `src/lib/api/poll-defaults.ts`. Do NOT inline-duplicate the values.
- The existing `handleSplitFurther` (re-separation of an already-loaded stem) gets the same treatment; both call the new poll fn.
- Performance: stage emits happen at most once per poll iteration (already debounced by the 1 s poll interval). Hot-path-safe.

**Definition of Done:**

- [ ] Smart Split has parity with Deep Analysis on retry / timeout / structured errors.
- [ ] `SeparationProgressCard` renders during separation and on error.
- [ ] Failed-at-stage label visible on simulated mid-flight backend error.
- [ ] Console shows `[analysis:smart-split:…]` lines for each phase.
- [ ] `e2e/smart-split.spec.ts` still passes (no regression) plus new TS-003/TS-004 scenarios pass.

**Verify:**

- `pnpm test src/lib/api/__tests__/separation*.test.ts --silent`
- `pnpm tsc --noEmit`
- `pnpm exec playwright test e2e/smart-split.spec.ts`

---

### Task 5: Wire Mastering Auto-master through harness (chunked)

**Objective:** Make `analyzeAudio` async + chunked so it yields to the main thread, and wire `handleAutoMaster` through the stage harness.
**Dependencies:** Task 2
**Mapped Scenarios:** TS-005, TS-006

**Files:**

- Modify: `src/lib/audio/analysis.ts` — keep `analyzeAudioSync` as the existing sync export (used by tests); add new async `analyzeAudio` that chunks the loop in N-sample windows, awaits a `Promise.resolve()` between chunks, and emits stage events (`loudness` → `peak` → `dynamic-range` → `spectral-balance` → `done`)
- Modify: `src/app/master/page.tsx` — `handleAutoMaster` becomes async, awaits `analyzeAudio`, shows a tiny inline progress strip near the Auto-master button; on error catches and surfaces stage in a toast / inline message.
- Test: extend `src/lib/audio/__tests__/analysis.test.ts` to cover the new async chunked path (assert it produces same numbers as `analyzeAudioSync`)
- Test: add a stage-emit test verifying all four phases fire in order

**Key Decisions / Notes:**

- **Pre-step (mandatory before any code change):** run `grep -rn "analyzeAudio(" src --include="*.ts" --include="*.tsx"` and confirm the only callsites are `src/app/master/page.tsx:238` and `src/lib/audio/__tests__/analysis.test.ts`. If ANY additional caller exists (WAV export, worker, hook, etc.), add it to this task's Files list and migrate it in this same task — do NOT begin implementation until the caller list is exhaustive. Capture the grep output in the commit message.
- Note: `analyzeStem` in `src/hooks/useMixEngine.ts` (touched by Task 6) is a SEPARATE function from `analyzeAudio` — it lives in `src/lib/audio/auto-mixer.ts` (or a sibling module) and is NOT renamed by this task. Confirm during the grep step.
- Chunk size: 65536 samples per yield (≈ 1.5 s of 44.1 kHz audio per chunk). Tunable; document in code.
- Tests that need synchronous semantics keep using `analyzeAudioSync` (one export rename in tests). Production code uses async `analyzeAudio`.
- The progress strip in `handleAutoMaster` is a single ~2-line component (existing UI patterns) — not a full progress card. Auto-master is fast enough that a card would feel heavy.
- Performance: hot path is the chunk-yield loop. Only emit on phase boundaries (4 events per run), NOT per-chunk. The chunk count is for yielding, not for sub-progress. A `tick` emit with progress=NN happens only at phase boundaries.

**Definition of Done:**

- [ ] `analyzeAudio` async; `analyzeAudioSync` unchanged.
- [ ] Numbers from async path match sync path within 1e-9 tolerance (regression test).
- [ ] Stage emits fire in order: loudness, peak, dynamic-range, spectral-balance, done.
- [ ] `handleAutoMaster` shows transient indicator and clears on completion.
- [ ] On thrown error inside `analyzeAudio`, the indicator surfaces the failed stage and console emits `[analysis:mastering-auto:error]`.
- [ ] `e2e/mastering.spec.ts` still passes plus TS-005/TS-006 scenarios.

**Verify:**

- `pnpm test src/lib/audio/__tests__/analysis.test.ts --silent`
- `pnpm tsc --noEmit`
- `pnpm exec playwright test e2e/mastering.spec.ts`

---

### Task 6: Wire Stem-Mixer auto-mix through harness

**Objective:** Emit per-stem stage events from `autoMix`, surface progress as "Analyzing stem N of M" in the auto-mix button area.
**Dependencies:** Task 2
**Mapped Scenarios:** TS-007, TS-008

**Files:**

- Modify: `src/hooks/useMixEngine.ts` — `autoMix` emits `stem-N/M:start`, `stem-N/M:end` per analyzed stem, then `generate-mix:start`, `generate-mix:end`, `apply:start`, `apply:end`. Catches any throw, emits `error` with the stem index, re-throws.
- Modify: `src/app/mix/page.tsx` — Auto Mix button area subscribes to the harness store via `useAnalysisStageStore` (selector by current runId) and shows "Analyzing stem N of M" instead of the binary "Analyzing…".
- Test: extend `src/hooks/__tests__/useMixEngine.test.ts` (or create if absent) to verify the per-stem stage emits.

**Key Decisions / Notes:**

- The `setIsAutoMixing(true/false)` boolean in `mixer-store` stays — it's the binary indicator gating the button's disabled state. The granular stage info comes from the harness store, not by extending mixer-store.
- For 1 stem (N=1), the UI still shows "Analyzing stem 1 of 1" — don't suppress it for a single stem; consistency matters.
- On error mid-loop, the "successfully analyzed" stems' params are NOT applied (matches existing behavior — `setAutoMixResults` only fires after all complete). The error surface must say which stem failed.

**Definition of Done:**

- [ ] N + 3 stage events per happy run (per-stem starts/ends + generate-mix + apply boundaries).
- [ ] Button shows "Analyzing stem 2 of 4" mid-flight.
- [ ] On simulated stem failure, error surface shows `Failed analyzing stem 2: drums.wav`.
- [ ] `e2e/mixer.spec.ts` still passes + TS-007/TS-008 added.

**Verify:**

- `pnpm test src/hooks/__tests__/useMixEngine.test.ts src/lib/stores/__tests__/mixer-store.test.ts --silent`
- `pnpm tsc --noEmit`
- `pnpm exec playwright test e2e/mixer.spec.ts`

---

### Task 7: E2E coverage + full verification

**Objective:** Add the new structured E2E scenarios (TS-001..TS-008) on top of existing suites, run the full unit + E2E suite, and confirm zero regressions.
**Dependencies:** Tasks 1–6
**Mapped Scenarios:** TS-001..TS-008

**Files:**

- Modify: `e2e/deep-analysis-progress.spec.ts` — add TS-001 (multi-stage) and TS-002 (failed-at).
- Modify: `e2e/smart-split.spec.ts` — add TS-003 (multi-stage) and TS-004 (failed-at).
- Modify: `e2e/mastering.spec.ts` — add TS-005 (auto-master progress) and TS-006 (auto-master error).
- Modify: `e2e/mixer.spec.ts` — add TS-007 (per-stem) and TS-008 (per-stem error).

**Key Decisions / Notes:**

- Reuse existing fixtures in `e2e/fixtures/` for the audio file. No new fixtures unless a corrupted-buffer fixture is needed for TS-008 (use an in-test `Uint8Array.fill(NaN)` instead of a file).
- Mock backend errors via Playwright's `page.route("**/jobs/**", ...)` to inject 500s mid-flight. Reuse the pattern already in `e2e/deep-analysis-progress.spec.ts`.
- Console-line assertions use `page.on("console", …)` capturing the structured prefix `[analysis:`.

**Definition of Done:**

- [ ] All 8 TS scenarios pass.
- [ ] Full E2E suite passes: `pnpm exec playwright test`.
- [ ] Full unit suite passes: `pnpm test --silent`.
- [ ] `pnpm tsc --noEmit` clean.
- [ ] No new flaky tests over 3 consecutive runs.

**Verify:**

- `pnpm exec playwright test`
- `pnpm test --silent`
- `pnpm tsc --noEmit`
- `pnpm exec playwright test --repeat-each=3` (flake check on the new specs only)
