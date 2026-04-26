# AI Deep Mastering Mode Implementation Plan

Created: 2026-04-25
Author: yegamble@gmail.com
Status: VERIFIED
Approved: Yes
Iterations: 1
Worktree: No
Type: Feature

## Summary

**Goal:** Ship a third mastering mode in `/master` ("Deep") that runs an AI-powered
deep analysis on the uploaded track — detecting musical sections, optionally
analyzing separated stems for AI-music artifacts (narrow guitars from Suno-style
sources), and applying time-varying mastering moves (volume/EQ/compression/
saturation/stereo-width) at sample-accurate timecodes — driven by 5 engineer-style
"deep profiles" the user can switch between, with a collaborative timeline editor
that lets the user accept, reject, or edit each AI-proposed move.

**Architecture:** Hybrid — cloud Python service (extends existing Demucs backend)
runs structure detection + per-stem AI-artifact analysis + script generation,
returns a `MasteringScript` JSON containing typed `Section`s and `Move`s with
per-sample envelopes. Frontend extends every existing AudioWorklet processor
with an envelope-scheduler protocol (sample-accurate interpolation) and routes
the script through both real-time playback (`engine.ts`) and offline export
(`renderer.ts`). New "AI Repair" DSP module adds a frequency-targeted M/S
widener + harmonic exciter that the script can schedule to repair narrow
AI-generated guitars.

**Tech Stack:** Existing — Next.js 15 + React 19, Zustand, Vitest, Playwright,
Cloudflare Workers (`@opennextjs/cloudflare`), FastAPI + Demucs. Adds — `madmom`
+ `librosa` (Python structure analysis), no new frontend dependencies (Web Audio
API + AudioWorklet only).

## Scope

### In Scope

- Backend: new `/analyze/deep` job type in FastAPI service (parallels existing
  separation job), runs structure detection (madmom + librosa) + per-section
  loudness/spectral analysis + optional Demucs separation + per-stem AI-artifact
  detection + script generation against the chosen engineer profile.
- 5 engineer-style deep profiles with neutral names: "Modern Pop Polish",
  "Hip-Hop Low-End", "Indie Warmth", "Metal Wall", "Pop Punk Air". Profile
  system is data-driven (JSON config in backend).
- Frontend: new "Deep" tab in `/master`, profile picker, deep-analysis progress
  UI, mastering-script timeline (read-only visualization + per-move editor),
  A/B compare against no-script playback.
- AudioWorklet protocol extension: every existing worklet (compressor,
  multiband-compressor, limiter, saturation, parametric-eq, stereo-width)
  accepts an envelope message and applies sample-accurate per-sample
  interpolation between scheduled points.
- Real-time engine integration: schedule envelopes on play, cancel on pause,
  re-emit envelopes on seek.
- Offline renderer integration: apply time-varying params during sample-by-sample
  DSP in `renderer.ts` so exports match real-time playback bit-for-bit.
- AI Repair DSP module: M/S widener + frequency-targeted harmonic exciter
  schedulable as a script `Move`.
- Mastering-script JSON schema (versioned, `version: 1`).
- Tests: unit tests for schema, envelope scheduler, profile→script generator,
  AI-artifact detector, AI Repair DSP. Playwright E2E covering the full Deep
  workflow.

### Out of Scope

- Licensed real-engineer profiles (architecture supports it; v1 ships neutral
  names only).
- Multi-track editing or DAW-style timeline (timeline UI is restricted to
  AI-proposed moves on the master bus + repair moves on detected stems).
- Voice-over guidance / engineer commentary audio (text-only "reason" strings
  shown on each move).
- Mobile-first redesign of the Deep mode UI (lg-and-up only in v1; mobile
  shows a banner directing user to desktop).
- Saving / loading user-edited scripts (each analysis run is ephemeral; the
  current script lives in the Zustand store and is regenerated per upload).

## Approach

**Chosen:** Big-bang single plan, cloud analysis + local DSP application,
sample-accurate envelopes, all four move types, 5 neutral-named profiles.

**Why:** User explicitly elected the big-bang approach in Batch 2 to ship the
full vision in one plan rather than phased plans. This document mitigates the
risk by structuring tasks into 5 milestones (A=Foundation, B=Automation Engine,
C=AI Repair, D=UI, E=Integration) where each task is independently testable
and the milestone boundaries are natural rollback points if scope pressure hits.

**Alternatives considered:**

- **v1 = Foundation slice (offline-only, one profile, section-level)** —
  rejected by user. Would have been ~10 tasks shipping in 1 week.
- **v1 = Foundation + AI-artifact repair** — rejected by user. ~15 tasks.
- **Local-only browser analysis** — rejected (already discussed in Batch 1):
  browser-side structure detection is significantly less accurate than madmom
  and would constrain v1 quality below the user's bar.

## Context for Implementer

> Write for someone who has never seen this codebase.

- **Existing mastering pipeline:**
  - `src/app/master/page.tsx` is the Master page. It currently has two modes
    (Simple, Advanced) toggled by `useUIStore.mode`. The Deep mode adds a
    third.
  - `src/lib/audio/chain.ts` (the `ProcessingChain` class) wires the worklet
    nodes in order: `inputGain → EQ → Compressor → MultibandCompressor →
    Saturation → StereoWidth → Limiter → Metering → outputGain`.
  - `src/lib/audio/engine.ts` is the real-time orchestrator (loads audio,
    creates `ProcessingChain`, plays back). It exposes `setBypass`, `play`,
    `pause`, `seek`, etc.
  - `src/lib/audio/renderer.ts` (`renderOffline`) is the pure-DSP offline path
    used for WAV export. It applies the same params via pure functions in
    `src/lib/audio/dsp/*.ts`.
  - `src/lib/stores/audio-store.ts` holds `AudioParams` (the static param
    snapshot) and the metering state. It already has `setParam` /
    `setParams`. The Deep mode adds a separate slice for the active
    `MasteringScript` so the existing static-param flow is untouched when
    Deep mode is off.

- **AudioWorklet message protocol (existing):** Every worklet processor in
  `public/worklets/*.js` accepts messages of shape `{ param: string, value:
  number }` via `port.postMessage`. The Deep mode adds a new shape
  `{ param: string, envelope: Array<[number, number]> }` where each pair is
  `[contextTimeSeconds, value]`. The processor consumes the envelope per
  sample using linear interpolation between adjacent points. Existing static
  `value` messages still work — they short-circuit the envelope scheduler.

- **Backend service:** `backend/main.py` is FastAPI. It currently has
  `/separate` (start), `/jobs/{id}/status` (poll), `/jobs/{id}/stems/{name}`
  (download). Deep analysis adds a new endpoint `/analyze/deep` (start) and
  reuses the same `/jobs/{id}/status` polling. Job storage in `backend/jobs.py`
  already supports arbitrary `job_type` strings.

- **Stem analysis (existing):** `src/lib/audio/stem-analyzer.ts` already
  computes spectral centroid, rolloff, transient density, RMS, crest factor,
  band energy, ZCR per stem. The AI-artifact detector reuses this — adds a
  stereo-width measurement (per-band L/R correlation) and a "spectral collapse
  score" specific to guitars.

- **Patterns to follow:**
  - Worklet node pattern: see `src/lib/audio/nodes/compressor.ts` paired with
    `public/worklets/compressor-processor.js`. The `*Node` class wraps an
    `AudioWorkletNode` and exposes typed setter methods.
  - Pure DSP function pattern: see `src/lib/audio/dsp/compressor.ts` —
    real-time worklet logic mirrored as pure functions for offline render.
  - Store pattern: Zustand with `subscribeWithSelector`. See `audio-store.ts`.
  - Backend job pattern: `start_X(...) → returns Job`, polled via
    `/jobs/{id}/status`. See `backend/separation.py` as the template.

- **Conventions:**
  - File names: kebab-case in `src/lib/`. Components: PascalCase in
    `src/components/`.
  - No `any`. Strict types. Use `unknown` + narrowing or generics.
  - Tests live in `__tests__/` next to the source file.
  - Backend: type hints required (FastAPI). pytest tests in `backend/tests/`
    (create the directory).

- **Gotchas:**
  - **Worklet code is duplicated** — the worklet processor (`public/worklets/
    *-processor.js`) is *not* the same file as `src/lib/audio/nodes/*.ts`.
    The processor runs in a separate global scope and cannot import from
    src/. Any envelope-scheduler logic must be duplicated in each processor
    OR factored to a shared helper that the build copies into both worklets.
    Recommend: write the envelope scheduler as a single `.js` file that each
    processor `importScripts()`-loads at module init. This requires hosting
    the helper at a stable URL under `public/worklets/`.
  - **Offline render uses pure JS DSP** — to apply envelopes during offline,
    the pure-function DSP signatures need to accept either a static param or
    a `(sampleIndex) → number` getter. Plan to add an overload, not break the
    existing signature.
  - **Cloudflare Workers cannot run Python** — the backend runs as a separate
    container (already true). Workers only host the Next.js frontend. The
    Deep API URL is a wrangler env var (existing pattern from Smart Split).
  - **AudioContext sample rate is not always 44.1k** — many systems run at
    48k. Envelope timestamps are in seconds (context time), not samples, so
    sample-rate independence is automatic.
  - **Goniometer analysers** in `chain.ts` are tapped post-metering. The
    Deep mode does not affect them.

- **Domain context:** "Mastering" = post-mix processing applied to the stereo
  master bus to optimize loudness, tonal balance, dynamic consistency, and
  stereo image for the target medium. "Deep mastering" = a mode in which an
  AI proposes time-varying moves that match a chosen engineer's style, rather
  than the static-genre approach used today. "AI music artifacts" = mono-
  collapsed stereo guitars and spectrally-narrow lead instruments common in
  Suno / Udio outputs.

## Runtime Environment

- **Frontend dev:** `pnpm dev` (Next.js on `localhost:3000`).
- **Backend dev:** `docker compose up backend` (FastAPI on `localhost:8000`).
- **Frontend prod:** Cloudflare Workers via `pnpm deploy` (`opennextjs-cloudflare`).
- **Backend prod:** Same docker container deployed externally; URL configured
  via wrangler env var `NEXT_PUBLIC_DEEP_ANALYSIS_API_URL` (and the existing
  `NEXT_PUBLIC_SEPARATION_API_URL` if not already shared).
- **Health check:** `GET /health` on backend (already exists). Deep analysis
  surfaces `models_loaded` flag so frontend can hide Deep mode if backend
  cannot serve it.
- **Restart procedure:** `docker compose restart backend` (Demucs models hot
  on disk; structure-analysis models lazy-load on first request).

## Assumptions

- The existing FastAPI backend at `backend/main.py` can be extended in-place
  with the new endpoint. **Supported by:** `backend/main.py` already shows
  the FastAPI pattern; `backend/jobs.py` already supports arbitrary job types.
  **Tasks affected:** T2, T3, T4.
- AudioWorklet processors can `importScripts()` a shared helper hosted under
  `public/worklets/`. **Supported by:** Standard AudioWorklet spec —
  `importScripts` is allowed inside `AudioWorkletGlobalScope`. **Tasks
  affected:** T6, T7.
- madmom and librosa can run inside the existing CPU/GPU docker image.
  **Supported by:** Both are pure-Python (madmom uses numpy + cython, no
  CUDA dependency). **Tasks affected:** T2, T20.
- 5 hand-tuned engineer-style profiles are sufficient for v1 marketing
  ("AI-powered, Grammy-engineer-curated"). **Supported by:** Batch 2 user
  selection. **Tasks affected:** T5, T13.
- Per-sample envelopes for the worklet automation are tractable on consumer
  hardware. **Supported by:** Each worklet's `process()` runs at audio rate
  already; an O(1) interpolation per sample is cheap relative to existing
  filter math. **Risk:** Audible CPU pressure on long tracks — see Risks.
  **Tasks affected:** T6, T7, T8, T9.

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Big-bang plan fragments mid-implementation, leaving partial DSP/UI shipped | High | High | Tasks are sequenced into 5 milestones (A→E); each milestone boundary is a clean rollback point. If a milestone overruns, ship through the latest completed boundary and split the rest into a follow-up plan. |
| Per-sample envelopes increase AudioWorklet CPU enough to drop frames on long tracks | Medium | High | **Spike S2 measures p99 blockProcessing time on M1, 2019 Intel, and iPhone Safari BEFORE T6 begins.** If any platform exceeds 50% of the 2.7 ms block budget at 6× scaling, drop the per-sample fallback and use a one-pole smoothing filter on the param itself. Cap envelope point density (max 100 points/worklet/sec) in the script schema; engine validates and rejects scripts exceeding the cap. T8 enforces p99 < 2.0 ms. |
| Backend structure-detection (madmom) returns garbage on AI-generated music with weak downbeats | Medium | High | Profile generation falls back to fixed-grid sectioning (4-bar / 8-bar boundaries via beat tracking, no segmentation) when madmom confidence < 0.5. AI-artifact detector still fires regardless. |
| AI Repair DSP makes guitars sound *worse* on real recordings (false-positive widening) | Medium | High | Two-layer gating: (1) per-stem narrowness score crosses threshold AND stem classified as "guitar" with confidence > 0.7 (T3); (2) script generator (T5) emits zero AI Repair moves on a wide-guitar reference fixture for ALL 5 profiles — verified by T5 DoD. User can also mute individual repair moves in the timeline editor. |
| Sample-accurate offline render becomes prohibitively slow (sample-by-sample DSP loop) | Medium | Medium | Renderer batches into 128-sample blocks (matching worklet block size) and reads envelope value once per block. Acceptable accuracy trade-off; 128 samples = 2.7 ms at 48k. |
| Worklet `importScripts()` not supported in Cloudflare Workers preview | Medium | High | **Spike S1 verifies `importScripts` works under `pnpm preview` BEFORE T6 begins.** If it fails, fallback is a build-time inline-concatenation step (postbuild script concatenates `envelope-scheduler.js` into each processor). Fallback is documented in S1's notes; no project work is committed to either path until S1 resolves. |
| User edits a Move in the timeline, A/B comparison no longer matches export | Medium | Medium | The Move editor mutates the script in the Zustand store; both real-time engine and offline renderer read from the same store, so A/B compare and export always match. Verification: T17 includes a parity test. |
| Latency between "Analyze" click and first Move appearing exceeds 2 minutes (user abandons) | Medium | Medium | T2 + T4 + T17 implement progressive results: backend writes `partial_result.{sections, stems, script}` to the job record as each phase completes; `/jobs/{id}/status` exposes them; client emits sub-progress events; UI shows three sub-stages ("Detecting sections" → "Analyzing stems" → "Generating script"). Section bands appear at ~10 s. |
| Engineer-profile / script JSON drift between backend (Python) and frontend (TypeScript) | Medium | Medium | Codegen explicitly rejected (user choice). Replaced with a CI shape-check: T1 ships a vitest test that loads `mastering_script.schema.json` and validates a hand-crafted fixture against both the runtime validator (ajv) and the TypeScript type via a `satisfies` check. Backend ships a pytest test that validates the same fixture via `jsonschema`. If either side drifts from the schema, CI fails on both repos. |
| Profile-switch silently discards user move-edits | Medium | Low | T17 adds a confirmation dialog: if any moves have been edited (`move.edited === true`), switching profiles asks "Apply [Profile] — your manual edits will be lost. Continue?". One-line guard, prevents data loss. |
| New `/analyze/deep` endpoint conflicts with existing CORS / job-scheduling | Low | Low | Reuse the exact CORS middleware + `jobs.py` scheduler. T2 explicitly passes existing CORS test. |

## Goal Verification

### Truths

1. From a fresh upload on `/master`, the user can switch to "Deep" mode,
   click "Analyze", and within 3 minutes see a populated timeline with
   sections, moves, and a non-empty `MasteringScript` in the store.
2. Real-time playback of a track with an active script produces audibly
   different output at the section boundaries (verified by capturing the
   metering stream pre/post a chosen section boundary and asserting at
   least one parameter changed by >0.5 dB or >5% of its range).
3. Offline export of the same track with the same active script produces
   a WAV whose RMS-per-second curve matches the real-time playback
   loudness curve to within ±0.5 LU (verified by re-running BS.1770
   metering on the rendered WAV).
4. Switching engineer profiles regenerates the script and produces a
   measurably different parameter trajectory (at least 3 of the 4 move
   types differ in either count or magnitude between any two profiles).
5. On a Suno-generated track with narrow guitars, the AI-artifact detector
   flags the guitar stem as narrow (M/S correlation > 0.85 in the 200–4000 Hz
   band) and the script schedules at least one AI Repair Move covering
   that stem's active sections.
6. Editing a Move's value in the timeline UI immediately changes the
   playback (the new value is heard within one block period, ≤2.7 ms at 48k).
7. A/B comparison toggles between the active script and a clean
   bypass-equivalent state without restarting playback (no audible click
   or position jump).
8. TS-001 through TS-005 all pass via Playwright.

### Artifacts

- `src/types/deep-mastering.ts` — `MasteringScript`, `Section`, `Move`,
  `EngineerProfile` types
- `backend/deep_analysis.py` — structure detection + per-stem analysis +
  script generation
- `backend/profiles/*.json` — 5 engineer profiles
- `src/lib/audio/deep/script-engine.ts` — script playback orchestration
- `src/lib/audio/deep/envelope-scheduler.ts` (and worklet companion at
  `public/worklets/envelope-scheduler.js`) — sample-accurate envelope eval
- `src/lib/audio/deep/ai-repair.ts` + `public/worklets/ai-repair-processor.js`
- `src/components/mastering/DeepMastering.tsx` (tab body)
- `src/components/mastering/DeepTimeline.tsx` (timeline + move editor)
- `src/components/mastering/EngineerProfilePicker.tsx`
- `e2e/deep-mastering.spec.ts` — full Playwright workflow

## E2E Test Scenarios

### TS-001: First-time Deep Analysis (happy path)
**Priority:** Critical
**Preconditions:** User has uploaded a 30-second WAV; backend is up and
healthy; on `/master`.
**Mapped Tasks:** T11, T12, T13, T17, T19

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click the "Deep" tab in the mastering mode switcher | Deep mode panel renders; profile picker visible with 5 named profiles; "Analyze" button enabled |
| 2 | Click "Modern Pop Polish" profile | Profile card shows selected (border highlight); "Analyze" button still enabled |
| 3 | Click "Analyze" | Progress indicator shows three sub-stages: "Detecting sections...", "Analyzing stems...", "Generating script..." |
| 4 | Wait for completion (≤3 min) | Timeline populates: at least 3 section bands rendered with type labels (e.g., "Verse 1", "Chorus 1"); at least 4 Move markers visible across the timeline; "Play" button now reflects deep-script-active state |
| 5 | Click Play | Audio plays from start; progress cursor advances on the timeline. Verification: a debug hook (`window.__deepDebug.envelopeAt(param, contextTime)`) installed by the script engine returns *different* values for at least one DSP param at `contextTime = sectionBoundary - 0.5` vs `sectionBoundary + 0.5` (delta > 0.5 dB or > 5% of param range). No "change-event log" abstraction is built — the debug hook reads directly from the envelope scheduler. |
| 6 | Wait for full track playback | Track plays end-to-end without dropouts; metering shows the expected per-section loudness pattern |

### TS-002: Profile Switch Regenerates Script
**Priority:** High
**Preconditions:** TS-001 has completed (a script exists for the loaded
track).
**Mapped Tasks:** T5, T13, T17

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Note the count of Moves displayed on the current timeline | Count recorded (e.g., 7) |
| 2 | Click "Metal Wall" profile | Profile picker re-highlights; "Apply" button appears (re-analysis is NOT required — sections are reused, only moves regenerate) |
| 3 | Click "Apply" | Within 1 s, the timeline rerenders with a different Move count or different positions; section bands unchanged |
| 4 | Click Play | Playback uses the new script audibly (loudness curve differs) |

### TS-003: AI-Artifact Detection on Suno Track
**Priority:** High
**Preconditions:** A test fixture is loaded — primary: `e2e/fixtures/
suno-narrow-guitar.wav` (synthetic narrow-guitar fixture, generated by
the test fixture generator and committed). Acceptance variant (manual,
not committed): `e2e/fixtures/.local/real-suno-track.wav` — a real
30-second Suno-generated clip checked into a `.local/` gitignored path
by the developer running the acceptance pass. Backend is up.
**Mapped Tasks:** T3, T10, T11, T14 (AI Repair lane), T19

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Upload the Suno fixture | Master page loads with the fixture |
| 2 | Switch to Deep mode, choose "Metal Wall" profile, click "Analyze" | Analysis runs; on completion the timeline shows at least one Move on the dedicated "AI Repair" lane (5th lane, distinct color + badge per T14) |
| 3 | Hover the AI Repair Move | Tooltip shows reason text containing the word "narrow" or "stereo" |
| 4 | Toggle A/B (off) and play through a section containing the repair move | Compare metering: with repair on, M/S correlation in the 200–4000 Hz band is at least 0.05 lower than with repair off |
| 5 | (Acceptance only — manual) Repeat steps 1–4 with `real-suno-track.wav` | Same outcomes; this validates the synthetic fixture isn't circular |

### TS-004: Edit a Move and Hear the Change
**Priority:** Medium
**Preconditions:** TS-001 has completed.
**Mapped Tasks:** T15, T17

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Start playback | Audio plays |
| 2 | While playing, click a Move marker on the timeline | Move editor opens inline (popover) with the current value, timecode, and reason |
| 3 | Drag the value slider down by 3 dB | Slider value updates; within ≤30 ms (one block period at 48k + render latency budget) playback reflects the change (verified via metering: target param changed by ≈3 dB at the next block boundary inside the move's window) |
| 4 | Click "Reset" | Move snaps back to AI-proposed value; playback follows |

### TS-005: Export Matches Real-time Playback
**Priority:** Critical
**Preconditions:** TS-001 has completed; track is loaded with an active
script.
**Mapped Tasks:** T9, T17

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click "Export WAV" | Export dialog opens; "Use deep script" checkbox is checked by default |
| 2 | Click "Export" | Export progress indicator runs; download begins |
| 3 | Open the downloaded WAV in a new browser tab and play through metering | The exported track's per-second RMS curve matches the real-time playback's per-second RMS curve to within ±0.5 dB at every section boundary (verified by an automated diff in the test) |

## Progress Tracking

- [x] **Spike S1: Workers `importScripts` compatibility — RESOLVED 2026-04-25 via inline-concat fallback (decision recorded in T6 Key Decisions)**
- [x] **Spike S2: per-sample envelope CPU — RESOLVED 2026-04-25 via per-block + one-pole smoother (decision recorded in T6 Key Decisions)**
- [x] Task 1: Define `MasteringScript` / `Section` / `Move` / `EngineerProfile` types + JSON Schema (Milestone A)
- [x] Task 2: Backend — section detection endpoint with madmom + librosa (Milestone A)
- [x] Task 3: Backend — per-stem AI-artifact detection (extends existing Demucs flow) (Milestone A)
- [x] Task 4: Frontend API client `src/lib/api/deep-analysis.ts` + Zustand `deepStore` (Milestone A)
- [x] Task 5: Backend — 5 engineer profiles + script generator (Milestone A)
- [x] Task 6: AudioWorklet envelope-scheduler shared helper + apply to compressor worklet (Milestone B)
- [x] Task 7a: Apply envelope scheduler to 4 worklet-based nodes (multiband, limiter, saturation, parametric-eq) (Milestone B)
- [x] Task 7b: Stereo-width native AudioParam ramp + protocol-parity test (Milestone B)
- [x] Task 8: Real-time engine — schedule envelopes on play, cancel on pause, re-emit on seek (Milestone B)
- [x] Task 9a: Offline renderer envelope plumbing for compressor/multiband/saturation/limiter (Milestone B)
- [x] Task 9b: Parametric-EQ pure-DSP envelope path + Truth 3 LUFS parity (Milestone B)
- [x] Task 10: AI Repair DSP — frequency-targeted M/S widener (Milestone C)
- [x] Task 11: AI Repair DSP — targeted harmonic exciter for guitar restoration (Milestone C)
- [x] Task 12: Deep mode tab in `/master/page.tsx` + integration with mode switcher (Milestone D)
- [x] Task 13: `EngineerProfilePicker` component (Milestone D)
- [x] Task 14: `DeepTimeline` — read-only timeline visualization with section bands and move markers (Milestone D)
- [x] Task 15: Move editor (per-move edit / mute / reset) inside DeepTimeline (Milestone D)
- [x] Task 16: A/B compare toggle + bypass parity for deep-script playback (Milestone D)
- [x] Task 17: Wire profile→backend→script→engine end-to-end (integration task) (Milestone E)
- [x] Task 18: Comprehensive unit test suite (schema, scheduler, profile generator, AI-artifact detector, AI Repair DSP) (Milestone E)
- [x] Task 19: Playwright E2E spec covering TS-001..TS-005 (Milestone E)
- [x] Task 20: Deploy — `docker-compose.yml` updates + `wrangler.jsonc` env var + backend `requirements.txt` (Milestone E)

**Total Tasks:** 24 (22 implementation including T7a/b + T9a/b + 2 spikes) | **Completed:** 24 | **Remaining:** 0

## Implementation Tasks

### Spike S1: Cloudflare Workers `importScripts` Compatibility

**⛔ Gates Milestone B.** Must complete before T6 begins.

**Objective:** Verify that an AudioWorklet processor served from a Cloudflare
Workers (`@opennextjs/cloudflare`) build can `importScripts()` a sibling
JS asset under `public/worklets/`. If it cannot, fall back to a build-time
inline-concatenation strategy.
**Dependencies:** None
**Mapped Scenarios:** None directly; gates worklet plumbing for Milestone B

**Files (throwaway / spike branch — not merged unless adopted):**

- Create: `public/worklets/spike-helper.js` (10-line stub)
- Create: `public/worklets/spike-processor.js` (loads via `importScripts`,
  uses helper)
- Modify: a temporary route or page that registers the spike worklet

**Steps:**

1. Run `pnpm preview` (OpenNext build).
2. Open the spike route, register `spike-processor.js`, post a message,
   verify the helper executed.
3. Repeat in browser DevTools, capture network for the `importScripts`
   request — confirm 200 + `application/javascript` MIME.
4. Resolve outcome:
   - **Pass:** Document in T6 Key Decisions: `importScripts` confirmed
     working under OpenNext. Proceed.
   - **Fail:** Implement `scripts/inline-worklet-helpers.mjs` postbuild
     step (read each processor, replace `importScripts(...)` with literal
     inlined contents). Add to `package.json` build script. Re-verify
     under `pnpm preview`. Document in T6 Key Decisions: helper inlined
     at build time.

**Definition of Done:**

- [ ] Spike route loads the worklet under `pnpm preview`
- [ ] Either `importScripts` works OR the inline-concatenation fallback is
      implemented and verified
- [ ] Outcome + chosen path documented in T6 Key Decisions BEFORE T6 begins
- [ ] Spike branch is reverted (only the documented decision and, if needed,
      the postbuild script are kept)

**Verify:**

- Manual: `pnpm preview` + browser DevTools confirm `importScripts` (or
  inlined equivalent) succeeds with no console errors

---

### Spike S2: Per-sample Envelope CPU Budget Validation

**⛔ Gates Milestone B.** Must complete before T6 begins.

**Objective:** Measure realistic per-block CPU cost of a per-sample-evaluating
envelope scheduler on three target platforms. Determine whether the
per-sample fallback is viable or whether to drop it in favor of a one-pole
parameter smoother.
**Dependencies:** None
**Mapped Scenarios:** None directly; gates the sample-accuracy decision
that drives Milestone B

**Files (throwaway / spike branch — not merged unless adopted):**

- Create: `public/worklets/spike-envelope-perf.js` (single worklet running
  envelope evaluation in a tight loop)
- Create: `e2e/spike-perf.html` (manual test page with start/stop button
  and a `console.table` of measured times)

**Steps:**

1. Run the perf harness on (a) M1 base, (b) 2019 Intel MacBook, (c) iPhone
   Safari (low-power mode if available).
2. Active envelopes: 6 worklets × 5 params each, mid-ramp (forces per-sample
   evaluation under the >0.001 dB/sample threshold).
3. Capture p50, p95, p99 blockProcessing time per platform.
4. Resolve outcome:
   - **All p99 < 50% of 2.7 ms (1.35 ms):** Per-sample fallback viable.
     Proceed with the design as planned.
   - **Any p99 ≥ 1.35 ms:** Drop per-sample fallback. Design becomes
     per-block evaluation with a one-pole smoother on each param (cheaper,
     mitigates zipper noise). Update T6 Key Decisions.

**Definition of Done:**

- [ ] Numbers captured for all three platforms (M1, Intel, iPhone Safari)
- [ ] Decision documented in T6 Key Decisions BEFORE T6 begins (per-sample
      vs per-block + smoother)
- [ ] T8 perf gate (p99 < 2.0 ms) is achievable per the spike's outcome —
      if not, T8 gate is renegotiated AT spike time (not deferred to
      implementation)
- [ ] Spike branch is reverted

**Verify:**

- Manual: `e2e/spike-perf.html` shows p99 numbers per platform; results
  pasted into the T6 Key Decisions section before T6 starts

---

### Task 1: Type Definitions + JSON Schema

**Objective:** Define the TypeScript types and matching JSON Schema for
`MasteringScript`. This is the contract every other task depends on.
**Dependencies:** None
**Mapped Scenarios:** TS-001 (the script the timeline renders)

**Files:**

- Create: `src/types/deep-mastering.ts`
- Create: `backend/schemas/mastering_script.schema.json`
- Test: `src/types/__tests__/deep-mastering.test.ts`

**Key Decisions / Notes:**

- Single source of truth: the JSON Schema. The TypeScript type is hand-mirrored
  (no codegen — schema is small and stable).
- **Drift mitigation (replaces codegen):** The shape-check test in this task
  validates a hand-crafted fixture against BOTH the runtime ajv validator
  AND the TypeScript type via a `satisfies` check. Backend ships a parallel
  pytest test (added in T2) that validates the same fixture via
  `jsonschema`. If either side drifts, CI fails on either repo.
- `Section.type`: `"intro" | "verse" | "chorus" | "bridge" | "drop" | "breakdown" | "outro" | "unknown"`.
- `Move.param`: dotted-path string (e.g., `"master.compressor.threshold"`,
  `"master.eq.band1.gain"`, `"master.aiRepair.amount"`). Validated against
  a closed enum.
- `Move.envelope`: `Array<[number, number]>` where each entry is
  `[contextTimeSeconds, paramValue]`. Schema enforces ≥2 points,
  monotonically increasing time, max 100 points/sec.
- `Move.muted: boolean` and `Move.edited: boolean` (default false) — used
  by T15 (mute) and the profile-switch confirmation guard (T17).
- `Move.original: number` — the AI-proposed value, kept so T15's "Reset"
  can restore even after multiple edits.
- Schema version field is `1` (literal). Future versions can branch.
- **Add `ajv` dev dependency** for the runtime validator — no production
  dependency added.

**Definition of Done:**

- [ ] All tests pass
- [ ] No diagnostics errors
- [ ] JSON Schema validates a hand-crafted minimal example via `ajv`
- [ ] Round-trip: TS object → JSON.stringify → JSON.parse → schema-validate succeeds
- [ ] Shape-check test: the hand-crafted fixture both passes ajv validation
      AND `satisfies MasteringScript` at type-check time
- [ ] Same fixture is committed at `backend/tests/fixtures/mastering_script_minimal.json`
      so T2's pytest test can read it (single source of truth across repos)

**Verify:**

- `pnpm test src/types/__tests__/deep-mastering.test.ts`

---

### Task 2: Backend — Section Detection Endpoint

**Objective:** Add `/analyze/deep` endpoint to FastAPI backend. Job runs
beat tracking + structure segmentation + per-section LUFS via librosa.
Returns `Section[]` only (moves come in T5, stems in T3).
**Dependencies:** Task 1
**Mapped Scenarios:** TS-001 (sections appear in timeline)

**Files:**

- Modify: `backend/main.py` (add endpoint)
- Create: `backend/deep_analysis.py` (analysis logic)
- Modify: `backend/requirements.txt` (add `madmom>=0.16`, `librosa>=0.10`)
- Test: `backend/tests/test_deep_analysis.py`

**Key Decisions / Notes:**

- madmom downbeat tracker first; librosa segmentation as fallback.
- If madmom confidence < 0.5: fall back to fixed 8-bar grid sections from
  beat tracking only.
- Per-section LUFS via `pyloudnorm` (already a transitive dep of librosa? if
  not, add it explicitly).
- Performance target: ≤30 s for a 4-min track on the existing CPU container.
- Reuse `backend/jobs.py` job registry — pass `job_type="deep_analysis"`.
- **Progressive results:** the job record exposes a `partial_result` dict
  with `sections`, `stems`, `script` keys. Each phase writes its key as
  soon as it completes. `GET /jobs/{id}/status` returns this dict alongside
  `progress`. The full `script` is filled by T5; T2 fills `sections` only.
- **Schema parity test (replaces codegen):** Add `backend/tests/test_schema_parity.py`
  that loads `tests/fixtures/mastering_script_minimal.json` (committed in
  T1) and validates it against `schemas/mastering_script.schema.json` via
  the `jsonschema` library. CI fails if the schema or fixture drift.

**Definition of Done:**

- [ ] All tests pass
- [ ] No diagnostics errors
- [ ] `POST /analyze/deep` accepts a multipart audio upload, returns `{job_id}`
- [ ] `GET /jobs/{id}/status` reflects progress 0→100 AND includes
      `partial_result.sections` once detection completes
- [ ] `GET /jobs/{id}/result` returns valid `Section[]` matching the JSON Schema
- [ ] Schema parity test passes (proves the shared fixture validates server-side too)

**Verify:**

- `cd backend && pytest tests/test_deep_analysis.py -q`

---

### Task 3: Backend — Per-stem AI-Artifact Detection

**Objective:** Extend the deep analysis job to optionally run Demucs
separation, then per-stem narrowness/spectral-collapse analysis. Detect
"AI music" artifacts (mono-collapsed guitars) and tag stems for repair.
**Dependencies:** Task 2
**Mapped Scenarios:** TS-003

**Files:**

- Modify: `backend/deep_analysis.py` (add stem-analysis branch)
- Create: `backend/stem_artifacts.py` (M/S correlation, spectral collapse score)
- Test: `backend/tests/test_stem_artifacts.py`

**Key Decisions / Notes:**

- M/S correlation per band: split into 5 bands (bass / low-mid / mid /
  high-mid / high), compute L/R correlation per band over 200 ms windows,
  flag bands with mean correlation > 0.85 (very narrow).
- Spectral collapse score: variance of spectral centroid over time. Suno
  guitars tend to have unnaturally stable centroid → low variance → high
  collapse score.
- Heavy lift: Demucs is already in the image. Reuse `htdemucs` model.
- Result returned as `StemAnalysisReport[]` extending the script JSON.

**Definition of Done:**

- [ ] All tests pass
- [ ] No diagnostics errors
- [ ] Test fixture (synthetic narrow-guitar file) produces a narrowness score
      > 0.85 in the 200–4000 Hz band
- [ ] Test fixture (real wide-guitar reference) produces a score < 0.5

**Verify:**

- `cd backend && pytest tests/test_stem_artifacts.py -q`

---

### Task 4: Frontend API Client + Zustand Deep Store

**Objective:** Create the API client for `/analyze/deep` (start + poll +
fetch script), and a new Zustand store slice (`deepStore`) holding the
active `MasteringScript`, current profile selection, and analysis status.
**Dependencies:** Task 1
**Mapped Scenarios:** TS-001

**Files:**

- Create: `src/lib/api/deep-analysis.ts`
- Create: `src/lib/stores/deep-store.ts`
- Test: `src/lib/stores/__tests__/deep-store.test.ts`
- Test: `src/lib/api/__tests__/deep-analysis.test.ts`

**Key Decisions / Notes:**

- Mirror `src/lib/api/separation.ts` for the start/poll pattern.
- `deepStore` does NOT replace `audio-store` — it supplements with
  `script: MasteringScript | null`, `profile: ProfileId`, `status: "idle"
  | "analyzing" | "ready" | "error"`, `subStatus: "sections" | "stems" |
  "script" | null`, and `applyMoveEdit(moveId, patch)`.
- Performance: `applyMoveEdit` uses immer-style shallow merge (no deps —
  hand-written via spread).
- **Sub-progress events:** the polling loop reads `partial_result` from
  `/jobs/{id}/status` and updates `subStatus` + writes partial data into
  the store as each phase completes. UI subscribes to render three
  sub-stages.
- `applyMoveEdit` flips `move.edited = true` so T17's profile-switch
  confirmation can detect the dirty state.

**Definition of Done:**

- [ ] All tests pass
- [ ] No diagnostics errors
- [ ] `startDeepAnalysis(file, profile)` resolves to a job ID
- [ ] `subscribeToScript()` Zustand selector returns `null` initially
      then the parsed script after polling completes (mocked fetch in test)
- [ ] When `partial_result.sections` arrives ahead of the full script, the
      store exposes `script.sections` and `script.moves === []` (mocked
      partial-progress test)
- [ ] `applyMoveEdit` sets `move.edited = true`

**Verify:**

- `pnpm test src/lib/api/__tests__/deep-analysis.test.ts src/lib/stores/__tests__/deep-store.test.ts`

---

### Task 5: Backend — 5 Engineer Profiles + Script Generator

**Objective:** Define 5 engineer-style JSON profiles. Implement the script
generator: given `Section[]`, `StemAnalysisReport[]?`, and a profile, emit
a `MasteringScript` with all the moves filled in.
**Dependencies:** Tasks 1, 2, 3
**Mapped Scenarios:** TS-001, TS-002, TS-003

**Files:**

- Create: `backend/profiles/modern_pop_polish.json`
- Create: `backend/profiles/hip_hop_low_end.json`
- Create: `backend/profiles/indie_warmth.json`
- Create: `backend/profiles/metal_wall.json`
- Create: `backend/profiles/pop_punk_air.json`
- Create: `backend/script_generator.py`
- Test: `backend/tests/test_script_generator.py`

**Key Decisions / Notes:**

- Each profile encodes per-section-type targets:
  - target LUFS by section type (e.g., chorus louder than verse by 1.5 dB)
  - tonal balance offsets per section type (3 EQ moves: low/mid/high)
  - compression character per section type (threshold/makeup deltas)
  - stereo width target per section type (chorus wider than verse)
  - AI-repair recipe (only triggered if stem analysis flags artifacts)
- Generator: for each section, look up profile.sectionType[s.type], emit
  Move per parameter type, build envelope with linear ramps from previous
  section's target → this section's target across a 200 ms crossfade
  centered on the section boundary.
- Cap envelope point density at 20 points/sec (well under the 100/sec hard
  cap; gives headroom for future curve enrichment).

**Definition of Done:**

- [ ] All tests pass
- [ ] No diagnostics errors
- [ ] Each of the 5 profiles produces a valid `MasteringScript` for a
      fixture input, validated against the JSON Schema
- [ ] Two different profiles run on the same input produce scripts with
      ≥3-of-4 move types differing in count or magnitude (per Truth 4)
- [ ] **False-positive guard:** A wide-guitar reference fixture (no
      artifacts — created in this task at `backend/tests/fixtures/wide_guitar_reference.wav`)
      produces ZERO `master.aiRepair.*` moves in the script for ALL 5
      profiles. Catches AI-Repair false positives end-to-end.

**Verify:**

- `cd backend && pytest tests/test_script_generator.py -q`

---

### Task 6: Envelope Scheduler — Shared Helper + Compressor Worklet

**Objective:** Create the sample-accurate envelope-scheduler logic as a
reusable JS module hosted at `public/worklets/envelope-scheduler.js`. Wire
it into the existing compressor worklet (`public/worklets/compressor-
processor.js`) as the proof-of-concept.
**Dependencies:** Task 1
**Mapped Scenarios:** TS-001 step 5, TS-004 step 3

**Files:**

- Create: `public/worklets/envelope-scheduler.js`
- Modify: `public/worklets/compressor-processor.js` (importScripts + envelope handling)
- Modify: `src/lib/audio/nodes/compressor.ts` (new `setEnvelope(param, points[])` method)
- Test: `src/lib/audio/nodes/__tests__/compressor.test.ts` (new test cases)

**Key Decisions / Notes:**

**S1 outcome (resolved 2026-04-25):** Adopt the **inline-concatenation
fallback** — do NOT rely on AudioWorklet `importScripts()` under
`@opennextjs/cloudflare`. The shared `envelope-scheduler.js` source lives
at `src/worklets/envelope-scheduler.js` (NOT `public/`). A postbuild
script `scripts/inline-worklet-helpers.mjs` runs after `next build`
(wired in `package.json`'s `build` and `deploy` scripts) and concatenates
the helper's source into each `public/worklets/*-processor.js` at the
top, replacing the `// @inline-helper: envelope-scheduler` marker
comment. This removes the importScripts dependency entirely and works
identically under `pnpm dev`, `pnpm preview`, and Cloudflare Workers
production.

**S2 outcome (resolved 2026-04-25):** Adopt **per-block evaluation with
a one-pole smoother** — do NOT use a per-sample fallback. Each worklet's
`process()` reads ONE envelope value per 128-sample block, then a
single-stage one-pole IIR smoother (`y[n] = a*x[n] + (1-a)*y[n-1]`,
a ≈ 0.05 at 48k for a ~5 ms time constant) is applied to the param
itself before each sample is processed. This caps per-block CPU at O(1)
envelope evaluation + O(blockSize) smoother math (cheap relative to the
filter math each worklet already does). Zipper noise is mitigated by
the smoother, not by per-sample envelope evaluation.

- The shared helper is a class `EnvelopeScheduler` with `setEnvelope(param,
  points)`, `getValueAt(param, contextTime)` — note the simpler API: NO
  per-sample interpolation, just per-block lookup.
- Linear interpolation between adjacent points; clamp to first/last value
  outside range.
- Each worklet maintains a one-pole smoother per param. Block flow:
  `envelopeValue = scheduler.getValueAt(param, blockStartTime)`;
  `for each sample: smoothed = a*envelopeValue + (1-a)*smoothed; useSmoothed`.
- The compressor worklet receives `{ param: "threshold", envelope: [[t, v]...] }`
  and stores it in the scheduler. Static `{ param: "threshold", value: -18 }`
  messages clear the envelope and use the static value (smoother bypassed
  to preserve existing `value:` semantics).
- Performance budget: <2% of an audio thread block on M1 (achievable
  trivially with per-block evaluation; no per-sample fallback to fail
  the budget).

**Definition of Done:**

- [ ] All tests pass
- [ ] No diagnostics errors
- [ ] Sending an envelope of `[[0, -24], [1, -18]]` and ticking the
      processor for 1 s of samples produces a smooth threshold ramp
      (verified by spying on the underlying threshold variable)
- [ ] Static `value:` messages still work (regression)

**Verify:**

- `pnpm test src/lib/audio/nodes/__tests__/compressor.test.ts`

---

### Task 7a: Apply Envelope Scheduler to Worklet-based Nodes (4 processors)

**Objective:** Repeat the Task-6 pattern for the 4 worklet-based nodes:
`multiband-compressor`, `limiter`, `saturation`, `parametric-eq`. These
all share the `importScripts(envelope-scheduler.js)` pattern and uniform
worklet message protocol.
**Dependencies:** Task 6
**Mapped Scenarios:** TS-001 step 5, TS-002 step 4

**Files:**

- Modify: `public/worklets/multiband-compressor-processor.js`
- Modify: `public/worklets/limiter-processor.js`
- Modify: `public/worklets/saturation-processor.js`
- Modify: `public/worklets/parametric-eq-processor.js`
- Modify: `src/lib/audio/nodes/multiband-compressor.ts`
- Modify: `src/lib/audio/nodes/limiter.ts`
- Modify: `src/lib/audio/nodes/saturation.ts`
- Modify: `src/lib/audio/nodes/eq.ts`
- Test: extended cases in each `__tests__/<node>.test.ts`

**Key Decisions / Notes:**

- Each worklet processor `importScripts('/worklets/envelope-scheduler.js')`
  at module load (or uses the inlined fallback per S1 outcome).
- Multiband: scheduler per band per param (3 bands × ~5 params = 15
  potential envelopes; cheap because most are flat).
- Parametric-EQ worklet: schedules biquad coefficients per band via the
  envelope. Note this overlaps with T9b which extends the *pure-DSP*
  parametric-eq path for offline render — both must read the same envelope
  format. T7a verifies real-time worklet path; T9b verifies offline
  pure-DSP path.

**Definition of Done:**

- [ ] All tests pass
- [ ] No diagnostics errors
- [ ] Each of the 4 nodes' `setEnvelope(param, points)` produces audibly
      correct ramps
- [ ] All existing `value:` messages still work (regression for each node)

**Verify:**

- `pnpm test src/lib/audio/nodes/__tests__/`

---

### Task 7b: Stereo-Width Native AudioParam Ramp + Timing Reconciliation

**Objective:** Stereo-width is implemented as a graph of native GainNodes,
not an AudioWorklet — its scheduling primitive is `AudioParam.linearRampToValueAtTime()`.
Implement a parallel `setEnvelope` API that translates the same envelope
points into a chain of `linearRampToValueAtTime` calls. **Critically: prove
timing parity with the worklet-block envelope path within ±1 block at 48k
via a shared test fixture.** This closes the dual-protocol bug surface
flagged in review.
**Dependencies:** Task 7a
**Mapped Scenarios:** TS-002 step 4

**Files:**

- Modify: `src/lib/audio/nodes/stereo-width.ts`
- Create: `src/lib/audio/deep/__tests__/protocol-parity.test.ts`
  (shared fixture: same envelope, run through worklet-style and
  AudioParam-style schedulers, compare values at sample boundaries)
- Test: extended cases in `src/lib/audio/nodes/__tests__/stereo-width.test.ts`

**Key Decisions / Notes:**

- `stereo-width.ts` keeps the same `setEnvelope(param, points)` signature
  as the worklet nodes for uniformity. Internally translates to
  `param.cancelScheduledValues(0)` + `param.setValueAtTime(points[0][1],
  points[0][0])` + a chain of `param.linearRampToValueAtTime(...)`.
- Parity test simulates an AudioWorklet block schedule (128 samples @
  48 kHz = 2.667 ms blocks) and asserts both schedulers produce values
  within ±1 sample (±20.8 µs) of each other at every block boundary.

**Definition of Done:**

- [ ] All tests pass
- [ ] No diagnostics errors
- [ ] StereoWidth `setEnvelope` produces audibly correct ramps
- [ ] Existing `value:` paths still work (regression)
- [ ] Protocol-parity test confirms ±1-block timing alignment between
      worklet and AudioParam envelope paths

**Verify:**

- `pnpm test src/lib/audio/nodes/__tests__/stereo-width.test.ts src/lib/audio/deep/__tests__/protocol-parity.test.ts`

---

### Task 8: Real-time Engine — Envelope Scheduling on Play / Pause / Seek

**Objective:** Extend `engine.ts` so that on `play()`, the active
`MasteringScript`'s moves are translated into envelope messages and
posted to each worklet. On `pause()`, envelopes are cleared. On `seek()`,
envelopes are recomputed from the new playback position.
**Dependencies:** Tasks 4, 6, 7
**Mapped Scenarios:** TS-001 step 5, TS-004 step 3

**Files:**

- Modify: `src/lib/audio/engine.ts`
- Create: `src/lib/audio/deep/script-engine.ts` (translation layer)
- Test: `src/lib/audio/__tests__/engine.test.ts` (new cases)
- Test: `src/lib/audio/deep/__tests__/script-engine.test.ts`

**Key Decisions / Notes:**

- `script-engine.ts` exports `applyScript(chain, script, contextTimeAtPlayStart)`
  which maps each Move's `param` (dotted-path string) to the right node and
  posts an envelope offset by `contextTimeAtPlayStart`.
- On seek: clip envelopes to start at the new position. On pause: set every
  envelope to `[]` (clears scheduler) and revert to last static values.
- Engine subscribes to `deepStore` for live edits — when a move is patched,
  re-emit only the affected envelope.
- Performance target (per S2 outcome): p99 blockProcessing ≤ 2.0 ms (75% of
  the 2.7 ms block budget at 48k) on M1 base. p95 ≤ 1.5 ms. Zero glitch
  events from `AudioContext.outputLatency` monitoring during a 5-min
  playback. **If S2 found per-sample evaluation infeasible**, the
  implementation here uses per-block evaluation with a one-pole smoother
  per param — same DoD targets apply.

**Definition of Done:**

- [ ] All tests pass
- [ ] No diagnostics errors
- [ ] Playing with an active script causes ≥1 worklet to receive an envelope
      message (verified by spying on `port.postMessage`)
- [ ] Pausing clears all envelopes
- [ ] Seeking re-emits envelopes
- [ ] **Perf gate:** 5-min track playback shows p99 blockProcessing ≤ 2.0 ms,
      p95 ≤ 1.5 ms; zero glitch events. Failing this is a hard fail —
      revisit S2's recommended fallback, do not slip the gate.

**Verify:**

- `pnpm test src/lib/audio/__tests__/engine.test.ts src/lib/audio/deep/__tests__/`

---

### Task 9a: Offline Renderer — Envelope Plumbing for 4 DSP Modules

**Objective:** Extend `renderer.ts` and the pure-DSP functions so offline
WAV export applies the active script's envelopes during sample-by-sample
processing — for the 4 modules that already have pure-DSP implementations:
compressor, multiband, saturation, limiter. EQ is handled in T9b.
**Dependencies:** Tasks 1, 8 (uses script-engine helpers)
**Mapped Scenarios:** TS-005

**Files:**

- Modify: `src/lib/audio/renderer.ts`
- Modify: `src/lib/audio/dsp/compressor.ts` (accept optional per-block param getter)
- Modify: `src/lib/audio/dsp/multiband.ts`
- Modify: `src/lib/audio/dsp/saturation.ts`
- Modify: `src/lib/audio/dsp/limiter.ts`
- Modify: `src/lib/audio/export.ts` (route the active script through to renderer)
- Test: `src/lib/audio/__tests__/renderer.test.ts` (new cases)

**Key Decisions / Notes:**

- Read envelope value once per 128-sample block, not per sample (accuracy
  trade-off: ±2.7 ms at 48k).
- Each DSP function gains an overload: `process(samples, params, opts?)`
  where `opts.paramAt(blockIndex)` returns the params for that block.
- This task does NOT touch parametric-eq — see T9b. The renderer's
  current EQ code path (BiquadFilter via OfflineAudioContext) is unchanged
  here; T9b replaces it with pure-DSP biquad evaluation.

**Definition of Done:**

- [ ] All tests pass
- [ ] No diagnostics errors
- [ ] Renderer with an active script produces a WAV whose per-block
      compressor/multiband/saturation/limiter param values match the
      script's envelope to within block-quantization

**Verify:**

- `pnpm test src/lib/audio/__tests__/renderer.test.ts`

---

### Task 9b: Parametric-EQ Pure-DSP Path + Truth 3 LUFS Parity

**Objective:** Resolve the EQ render-path contradiction. The existing
renderer routes EQ through `OfflineAudioContext` BiquadFilters; that path
cannot evaluate per-block envelopes the way the other DSP modules do
(would require dual ramp/envelope logic that won't time-align with T9a).
Move EQ to the pure-DSP path: extend `src/lib/audio/dsp/parametric-eq.ts`
so it evaluates biquad coefficients per-block from the envelope, and
remove the OfflineAudioContext EQ stage from `renderer.ts`. Then run the
end-to-end LUFS-parity test that closes Truth 3.
**Dependencies:** Task 9a
**Mapped Scenarios:** TS-005

**Files:**

- Modify: `src/lib/audio/dsp/parametric-eq.ts` (per-block coefficient
  evaluation; mirror the worklet's interpolation rules)
- Modify: `src/lib/audio/renderer.ts` (remove BiquadFilter stage; route
  through pure-DSP biquad)
- Test: `src/lib/audio/dsp/__tests__/parametric-eq.test.ts` (new cases
  covering envelope evaluation)
- Test: `src/lib/audio/__tests__/renderer.test.ts` (LUFS parity test)

**Key Decisions / Notes:**

- Pure-DSP biquad: re-derive coefficients each block from the current
  band parameters (gain, Q, freq, type). At 48k that's ~370 coefficient
  derivations per second per band. Cheap.
- Coefficient ramp continuity: when band gain ramps mid-block, recompute
  coefficients at block start (not per sample) — matches the worklet's
  block-quantized ramp behavior, ensuring real-time and offline paths
  produce bit-identical-block output.
- Removing the OfflineAudioContext EQ stage means `renderer.ts` no longer
  depends on `OfflineAudioContext` if its only role was EQ. Verify any
  other consumer (resampling?) — keep `OfflineAudioContext` only if still
  needed for resampling; otherwise remove.

**Definition of Done:**

- [ ] All tests pass
- [ ] No diagnostics errors
- [ ] Pure-DSP biquad envelope evaluation produces output matching the
      worklet's output within ±0.001 dB at every block boundary (parity
      test against a known envelope)
- [ ] **Truth 3 closure:** Renderer + parametric-eq produces a WAV whose
      1-second-window RMS curve matches the real-time playback's metering
      curve within ±0.5 LU at every section boundary. This is THE LUFS
      parity test that gates TS-005 and Truth 3.

**Verify:**

- `pnpm test src/lib/audio/dsp/__tests__/parametric-eq.test.ts src/lib/audio/__tests__/renderer.test.ts`

---

### Task 10: AI Repair DSP — M/S Widener (final filenames)

**Objective:** Implement a frequency-targeted Mid/Side widener as a new
worklet + node + DSP pure function, exposing a single `amount` parameter
(0–100%) that the script can schedule. Files use the FINAL names from the
start (T11 fills in the exciter logic in the same files — no rename).
**Dependencies:** Task 6 (envelope scheduler)
**Mapped Scenarios:** TS-003 step 4

**Files:**

- Create: `public/worklets/ai-repair-processor.js` (widener-only logic now;
  exciter scaffolded as a no-op stub)
- Create: `src/lib/audio/nodes/ai-repair.ts`
- Create: `src/lib/audio/dsp/ai-repair.ts` (pure function for offline)
- Test: `src/lib/audio/nodes/__tests__/ai-repair.test.ts`
- Test: `src/lib/audio/dsp/__tests__/ai-repair.test.ts`

**Key Decisions / Notes:**

- Algorithm: M/S decompose, lift Side band by `amount` × frequency-dependent
  curve (peaked around 1.5–4 kHz where guitar artifacts live). Re-encode L/R.
- New node sits BEFORE the StereoWidth node in the chain (chain.ts updated
  in T17). Bypass at amount=0.
- Pure function for offline render mirrors the same algorithm.
- Exciter section in the worklet is a no-op stub today; T11 fills it. This
  avoids the file-rename noise flagged in review.

**Definition of Done:**

- [ ] All tests pass
- [ ] No diagnostics errors
- [ ] Test: feeding a mono signal through with amount=50% produces output
      with M/S correlation < 1.0 in the 1.5–4 kHz band
- [ ] At amount=0, output is bit-identical to input

**Verify:**

- `pnpm test src/lib/audio/nodes/__tests__/ai-repair.test.ts src/lib/audio/dsp/__tests__/ai-repair.test.ts`

---

### Task 11: AI Repair DSP — Targeted Harmonic Exciter (fill-in)

**Objective:** Fill in the exciter stub in the existing `ai-repair-processor.js`,
`ai-repair.ts` (node), and `ai-repair.ts` (dsp). Adds a frequency-targeted
harmonic exciter (saturation in a narrow 1–4 kHz band) for restoring guitar
presence. Exposed as part of the same `amount` parameter on the AI Repair node.
**Dependencies:** Task 10
**Mapped Scenarios:** TS-003

**Files:**

- Modify: `public/worklets/ai-repair-processor.js` (replace exciter no-op
  stub with real implementation)
- Modify: `src/lib/audio/nodes/ai-repair.ts`
- Modify: `src/lib/audio/dsp/ai-repair.ts`
- Test: extend `src/lib/audio/dsp/__tests__/ai-repair.test.ts`

**Key Decisions / Notes:**

- Bandpass 1–4 kHz → soft-clip → mix back with dry by `amount × 0.3` (max
  30% wet).
- Single `amount` param drives both widener and exciter with internal
  weighting (kept as one parameter for UX simplicity).

**Definition of Done:**

- [ ] All tests pass
- [ ] No diagnostics errors
- [ ] Test: total harmonic distortion in 1–4 kHz band increases monotonically
      with `amount`
- [ ] At amount=0, output is bit-identical to input (regression — exciter
      stub-removal must not break the bypass guarantee)

**Verify:**

- `pnpm test src/lib/audio/dsp/__tests__/ai-repair.test.ts`

---

### Task 12: Deep Mode Tab in `/master/page.tsx`

**Objective:** Add the Deep mode panel to the master page's mode switcher.
**Dependencies:** Task 4 (deepStore)
**Mapped Scenarios:** TS-001 step 1

**Files:**

- Modify: `src/app/master/page.tsx`
- Modify: `src/lib/stores/ui-store.ts` (extend `mode` enum to include "deep")
- Create: `src/components/mastering/DeepMastering.tsx` (panel skeleton)
- Test: `src/components/mastering/__tests__/DeepMastering.test.tsx`

**Key Decisions / Notes:**

- The existing mode switcher (Simple / Advanced) becomes a 3-way switcher.
- DeepMastering panel hosts: profile picker (T13), Analyze button,
  progress UI, timeline (T14), A/B toggle (T16).
- Mobile: render a banner directing user to desktop (per scope: lg-only).

**Definition of Done:**

- [ ] All tests pass
- [ ] No diagnostics errors
- [ ] Switching to "deep" mode shows DeepMastering panel
- [ ] Existing Simple / Advanced modes still work (regression)

**Verify:**

- `pnpm test src/components/mastering/__tests__/DeepMastering.test.tsx`

---

### Task 13: Engineer Profile Picker

**Objective:** UI component listing the 5 profiles with selection + apply.
**Dependencies:** Task 4, Task 12
**Mapped Scenarios:** TS-001 step 2, TS-002

**Files:**

- Create: `src/components/mastering/EngineerProfilePicker.tsx`
- Test: `src/components/mastering/__tests__/EngineerProfilePicker.test.tsx`

**Key Decisions / Notes:**

- Each profile rendered as a card with title + 1-line description + accent
  color.
- Clicking selects (visual highlight); clicking "Apply" triggers script
  regeneration (T17 wires the action).

**Definition of Done:**

- [ ] All tests pass
- [ ] No diagnostics errors
- [ ] All 5 profiles render
- [ ] Click → selected state visible
- [ ] "Apply" button disabled if no profile selected; enabled otherwise

**Verify:**

- `pnpm test src/components/mastering/__tests__/EngineerProfilePicker.test.tsx`

---

### Task 14: Deep Timeline — Read-only Visualization

**Objective:** Render the timeline visualization: waveform (reuse existing
`WaveformDisplay`), section bands overlay, move markers as dots/triangles
on the appropriate parameter lanes.
**Dependencies:** Task 4 (deepStore), Task 12
**Mapped Scenarios:** TS-001 step 4

**Files:**

- Create: `src/components/mastering/DeepTimeline.tsx`
- Test: `src/components/mastering/__tests__/DeepTimeline.test.tsx`

**Key Decisions / Notes:**

- Layout: waveform on top (height 80px), then **5 horizontal lanes**
  (Volume, EQ, Comp/Sat, Width, **AI Repair**) at 32px each. Move markers
  on the appropriate lane.
- The AI Repair lane uses a distinct accent color and an "AI" badge icon
  on each marker so TS-003 step 2 can assert visually-distinguishable
  AI-Repair moves.
- Performance: render to single `<canvas>` (one per timeline element);
  avoid React per-marker rerenders.
- Interactive: hover a marker → tooltip shows reason. Click → opens editor
  (T15).

**Definition of Done:**

- [ ] All tests pass
- [ ] No diagnostics errors
- [ ] Loading a fixture script renders sections + markers across 5 lanes
- [ ] AI Repair markers render on the dedicated 5th lane with the AI badge
      (verified by snapshot or DOM-class assertion)
- [ ] Hover shows reason tooltip

**Verify:**

- `pnpm test src/components/mastering/__tests__/DeepTimeline.test.tsx`

---

### Task 15: Move Editor (per-move edit / mute / reset)

**Objective:** Inline popover editor for individual moves: edit value,
mute the move (skip it during playback), reset to AI-proposed value.
**Dependencies:** Task 14
**Mapped Scenarios:** TS-004

**Files:**

- Modify: `src/components/mastering/DeepTimeline.tsx` (host the popover)
- Create: `src/components/mastering/MoveEditor.tsx`
- Test: `src/components/mastering/__tests__/MoveEditor.test.tsx`

**Key Decisions / Notes:**

- Edit calls `deepStore.applyMoveEdit(moveId, { value: newValue })` which
  updates the script in the store; the engine subscribes (T8) and re-emits
  the affected envelope.
- "Mute" toggles a per-move `muted: boolean` flag. The engine treats muted
  moves as no-ops (envelope reverts to neutral baseline for that param).
- "Reset" reverts to the original AI-proposed value, kept in `move.original`.

**Definition of Done:**

- [ ] All tests pass
- [ ] No diagnostics errors
- [ ] Editing a value updates the store within the same tick
- [ ] Mute toggle persists across UI re-renders
- [ ] Reset restores the original value

**Verify:**

- `pnpm test src/components/mastering/__tests__/MoveEditor.test.tsx`

---

### Task 16: A/B Compare Toggle for Deep-script Playback

**Objective:** Add an A/B toggle in the Deep mode panel that switches
between "script active" (A) and "script muted" (B = baseline DSP only).
**Dependencies:** Tasks 8, 12
**Mapped Scenarios:** TS-003 step 4

**Files:**

- Modify: `src/components/mastering/DeepMastering.tsx` (add toggle)
- Modify: `src/lib/stores/deep-store.ts` (add `scriptActive: boolean`)
- Modify: `src/lib/audio/deep/script-engine.ts` (respect `scriptActive`)
- Test: extend `src/lib/audio/deep/__tests__/script-engine.test.ts`

**Key Decisions / Notes:**

- Toggling does NOT restart playback. The engine catches the toggle and
  swaps envelopes for static neutral values within ≤1 block.
- Visual: matches the existing global A/B toggle styling on the master page.

**Definition of Done:**

- [ ] All tests pass
- [ ] No diagnostics errors
- [ ] Toggle does not restart playback (verified via `currentTime` continuity)
- [ ] B state mutes all envelopes (verified via `port.postMessage` spy)

**Verify:**

- `pnpm test src/lib/audio/deep/__tests__/script-engine.test.ts`

---

### Task 17: Wire Profile → Backend → Script → Engine End-to-end

**Objective:** Integrate every component shipped so far. Click "Analyze"
in DeepMastering → API call → poll → store update → timeline renders →
Play uses the script via the engine. Edit a move → engine re-emits the
affected envelope. Switch profiles → confirmation dialog if any moves were
edited (prevents silent loss of user work).
**Dependencies:** Tasks 5, 8, 9b, 12, 13, 14, **15**, 16
**Mapped Scenarios:** TS-001, TS-002, TS-004, TS-005

**Files:**

- Modify: `src/components/mastering/DeepMastering.tsx` (wire Analyze button +
  three-stage progress UI from `deepStore.subStatus`)
- Modify: `src/components/mastering/EngineerProfilePicker.tsx` (wire Apply +
  confirmation dialog if any `move.edited === true`)
- Modify: `src/lib/audio/engine.ts` (subscribe to `deepStore.script`,
  re-emit affected envelope on move edit)
- Modify: `src/lib/audio/export.ts` (use script during render if active)
- Test: `src/components/mastering/__tests__/integration-deep.test.tsx`
- Test: `src/lib/audio/__tests__/integration-parity.test.ts` (offline-only
  LUFS parity, vitest-runnable — see DoD)

**Key Decisions / Notes:**

- This is the integration task — small code, big verification surface.
- **Test harness honesty:** vitest+happy-dom cannot run real AudioWorklets,
  cannot run a real AudioContext, cannot reach the Python backend. The
  integration test in this task asserts what the harness CAN verify:
  store wiring, fetch mocking, timeline rendering. Real audio playback
  is verified in T19 (Playwright).
- **LUFS parity (Truth 3) is verified offline-only in this task:** feed a
  known buffer through the renderer with a fixture script, recompute the
  LUFS curve from the rendered WAV, compare against a recomputed-from-the-
  same-script-applied-as-static-blocks reference. This is achievable in
  vitest because both paths are pure JS DSP.
- **Profile-switch dirty guard:** EngineerProfilePicker checks
  `deepStore.script?.moves.some(m => m.edited)` and shows a Radix dialog
  ("Switching to [Profile] will discard your edits to N moves. Continue?")
  before calling the regenerate action.
- Visualizer state (`useVisualization`) requires no changes — TS-001 step 5
  uses the `window.__deepDebug` envelope-scheduler hook (added by the
  script engine for debugging), not the metering callback.

**Definition of Done:**

- [ ] All tests pass
- [ ] No diagnostics errors
- [ ] Integration test (vitest+happy-dom) reproduces TS-001 steps 1–4
      with mocked fetch + mocked AudioContext + mocked Worklet ports —
      verifies clicking Analyze triggers API call, store updates with
      script (including partial-progress emission), timeline renders the
      expected sections + 5 lanes
- [ ] Move-edit re-emit test: simulate `applyMoveEdit`, assert the engine
      posts a new envelope message for the affected param within the same
      tick
- [ ] Profile-switch dirty guard: when `move.edited` is true, the dialog
      renders; clicking Cancel keeps the script; clicking Confirm calls
      regenerate
- [ ] **LUFS parity test (Truth 3, offline):** rendered WAV's 1-second
      LUFS curve matches the reference within ±0.5 LU at every section
      boundary

**Verify:**

- `pnpm test src/components/mastering/__tests__/integration-deep.test.tsx src/lib/audio/__tests__/integration-parity.test.ts`

---

### Task 18: Comprehensive Unit Test Suite

**Objective:** Backfill missing unit-test coverage across all new code so
total project coverage stays ≥80%.
**Dependencies:** All prior tasks (T1–T17)
**Mapped Scenarios:** None directly; underpins all

**Files:**

- Add tests as needed to: `src/types/__tests__/`, `src/lib/api/__tests__/`,
  `src/lib/audio/deep/__tests__/`, `src/lib/audio/dsp/__tests__/`,
  `src/lib/audio/nodes/__tests__/`, `src/components/mastering/__tests__/`,
  `backend/tests/`

**Key Decisions / Notes:**

- Audit each new TypeScript file in `src/`'s coverage; target ≥80%
  per file.
- **Worklet processors in `public/worklets/*.js` are excluded from
  unit-coverage requirements.** They run in `AudioWorkletGlobalScope`
  which Vitest's coverage instrumenter does not cover. Their behavior
  is verified by:
  - The envelope-scheduler unit tests (T6) — covers the shared helper
  - The `*Node` wrapper tests in `src/lib/audio/nodes/__tests__/` — covers
    the message-port API surface
  - The integration parity tests (T7b protocol parity, T9b LUFS parity)
  - The Playwright E2E suite (T19)
- Property-based tests for: envelope interpolation (any monotonic input →
  monotonic output), schema round-trip. Add `fast-check` if not already
  in devDependencies.

**Definition of Done:**

- [ ] All tests pass
- [ ] `pnpm test:coverage` shows ≥80% on every new TypeScript file in `src/`
- [ ] Worklet exclusion is documented in `vitest.config.ts` (or coverage
      config) so the bar is enforceable, not aspirational
- [ ] No diagnostics errors

**Verify:**

- `pnpm test:coverage`

---

### Task 19: Playwright E2E Spec

**Objective:** Implement TS-001..TS-005 as Playwright tests.
**Dependencies:** All prior tasks
**Mapped Scenarios:** TS-001, TS-002, TS-003, TS-004, TS-005

**Files:**

- Create: `e2e/deep-mastering.spec.ts`
- Create: `e2e/fixtures/suno-narrow-guitar.wav` (synthetic AI-music fixture
  generated by `e2e/fixtures/generate-test-wav.mjs` extended)
- Modify: `e2e/fixtures/generate-test-wav.mjs` (add narrow-guitar generator)

**Key Decisions / Notes:**

- Fixture generation: pipe a sine→exciter chain to produce a "narrow
  guitar" signature with high M/S correlation in 1–4 kHz.
- Tests run against a backend instance — start via docker-compose in CI
  (or skip-on-missing-backend with a fixture script if backend unreachable).
- Use existing Playwright config (`playwright.config.ts`).

**Definition of Done:**

- [ ] All five scenarios (TS-001..TS-005) pass headlessly
- [ ] No diagnostics errors
- [ ] Skip-with-warning when backend unreachable (do not fail CI)

**Verify:**

- `pnpm test:e2e -- deep-mastering`

---

### Task 20: Deploy Configuration

**Objective:** Update infra so Deep mode reaches production.
**Dependencies:** All prior tasks
**Mapped Scenarios:** None directly; gates production rollout

**Files:**

- Modify: `docker-compose.yml` (no new services; ensure `madmom`/`librosa`
  Python deps install correctly during build)
- Modify: `backend/Dockerfile` (apt deps if needed for librosa: `ffmpeg`,
  `libsndfile1`)
- Modify: `wrangler.jsonc` (add `NEXT_PUBLIC_DEEP_ANALYSIS_API_URL` env var
  if not already shared with separation API)
- Modify: `backend/requirements.txt` (already touched in T2; verify final
  list)
- Modify: `README.md` (add Deep mode usage section)

**Key Decisions / Notes:**

- Re-use existing separation backend URL if Deep analysis runs on the same
  service. The frontend client (T4) reads either a shared or dedicated URL
  from env.
- Run a `pnpm preview` smoke test locally that exercises Deep mode against
  a local backend (manual, recorded in PR description).

**Definition of Done:**

- [ ] All tests pass
- [ ] No diagnostics errors
- [ ] `docker compose build backend` succeeds
- [ ] `pnpm build` succeeds
- [ ] **Real preview smoke test:** `pnpm preview` starts; with a configured
      local backend reachable, clicking Analyze in Deep mode produces a
      non-empty script + populated timeline; browser DevTools console
      shows zero errors related to `importScripts` or worklet load.
      Recorded with a screenshot in the PR description.

**Verify:**

- `docker compose build backend && pnpm build && pnpm preview`

## Open Questions / Spike Validations Required Before Implementation Starts

These four items are open at plan-approval time. Each is closed by a small
spike or a documented decision before the dependent task starts. None
block plan approval; they block specific tasks.

1. **Cloudflare Workers `importScripts` compatibility** — closed by Spike S1
   before T6 starts. Outcome (importScripts works OR inline-concat fallback
   adopted) is documented in T6 Key Decisions.
2. **Per-sample envelope CPU budget on M1 / Intel / iPhone Safari** — closed
   by Spike S2 before T6 starts. Outcome (per-sample fallback OR per-block
   + one-pole smoother) is documented in T6 Key Decisions.
3. **Real-Suno fixture availability for TS-003 acceptance** — closed by
   licensing review before T19 starts. If Suno's TOS forbids redistribution,
   acceptance variant is run manually with a developer-supplied
   `.local/real-suno-track.wav`. Documented in T19.
4. **`OfflineAudioContext` retention in renderer.ts after T9b** — T9b
   removes OfflineAudioContext for EQ. If OfflineAudioContext was also
   handling resampling, the resampling path must be replaced (likely with
   a pure-DSP linear resampler) or kept. Closed during T9b implementation
   by a 1-hour audit.

### Deferred Ideas

- Saving / loading user-edited scripts (per-account persistence)
- Voice-over engineer commentary
- Mobile redesign of Deep mode
- Real licensed engineer profiles (architecture is ready; awaits business)
- Multi-track / DAW-style timeline beyond AI-proposed moves
