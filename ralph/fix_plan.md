# Aurialis — Incomplete Work Backlog (Ralph fix_plan)

Generated 2026-06-19 from a full audit of all 26 plan docs + 5 codebase scans
(81-agent workflow, every gap adversarially verified). Ordered by priority.
Each task is one atomic commit. Tick `[x]` only when its "Done when" holds and
the green gate (`tsc` + `lint` + `test`) passes.

Baseline at start: tsc clean, lint exit 0 (after task 1), 1408 unit tests green.

## Correctness / export quality

- [x] **Lint: ignore generated dirs so `pnpm lint` exits 0.**
  Add `.open-next`, `out`, `node_modules`, `backend` to `eslint.config.mjs`
  ignores; drop stale `react-hooks/refs` disables in `useMixEngine.ts`.
  Done when: `pnpm run lint` exits 0. — 7e0ff0a

- [ ] **True-peak limiter in the offline WAV renderer.**
  `renderer.ts` limits with sample-peak `processLimiter` at both callsites;
  `processTruePeakLimiter` exists but is only called from tests. Wire true-peak
  (inter-sample) limiting into both the legacy and deep-script render paths.
  Done when: a renderer test proves the exported buffer holds the −1 dBTP
  ceiling (via `detectTruePeakDbTp`) on an ISP-hot input. [p0 Task 4 S4]

- [ ] **AI-repair in the offline render (export == preview).**
  Realtime chain runs `Saturation → AiRepair → StereoWidth`; the offline
  renderer omits AI-repair, so exported WAV silently differs. Resolve the
  `master.aiRepair.amount` envelope per block, keep persistent filter state,
  insert the stage between Saturation and StereoWidth. Fix the stale "T11
  no-op" comments in `ai-repair-processor.js`, `nodes/ai-repair.ts`,
  `dsp/ai-repair.ts`, `chain.ts`.
  Done when: parity test shows offline RMS within ±0.5 LU of the realtime
  chain for an aiRepair-bearing script, and `amount=0` is bit-exact bypass.

- [ ] **Tighten relaxed DSP test tolerances to plan spec.**
  `limiter-truepeak.test.ts` 0.5→0.3 dB (impl measures −0.886/−0.989).
  `saturation-alias.test.ts`: assert plan spec (15 kHz source, ≥40 dB reduction
  in 0–10 kHz) instead of ≥30 dB@7 kHz; either meet 18 kHz-within-1 dB or
  document the accepted deviation. [p0 Truth #2/#3]

- [ ] **Add the 4 DSP test files the plans marked done.**
  `metering-truepeak.test.ts` (ISP <0.1 dB, mono, 44.1/48/96 k, perf);
  `compressor-auto-release-integration.test.ts` (worklet-level, pink noise vs
  frozen P0); extend `saturation-alias.test.ts` to all 4 modes (≥25 dB);
  parametric-EQ golden snapshot — or amend the plan if pre-P3 bit-equivalence
  is provably not achievable. [p0 T6, p1 T1/T3, eq T7/TS-006]

## App / UX correctness

- [ ] **Album: measured LUFS instead of `targetLufs` stand-in.**
  `album/page.tsx` plots each track's configured target as if it were measured,
  so every track looks on-target (fabricated consistency). Add `measuredLufs`
  to `LibraryEntry`, populate from `analyzeAudio().integratedLufs` in the master
  flow, read the real value, decouple the album target. Unmeasured → "—".

- [ ] **Surface standalone Auto-Mix failures in the UI.**
  `mix/page.tsx` `handleAutoMix` awaits `autoMix()` with no try/catch → silent
  unhandled rejection. Wrap + `setLoadError` with "Failed analyzing stem N: <name>"
  from `autoMixRun.error`. [verbose-analysis-progress T6]

- [ ] **Remove the vestigial `StemTrack.file` placeholder.**
  Typed required `File` but filled with empty `new File([])` in 3 places and
  never read (audioBuffer is the source of truth). Make optional / remove from
  `src/types/mixer.ts` and drop the placeholder assignments.

## Redesign Direction A — complete the unified shell

- [ ] **Extract `MasterScreen` component + wire `BigReadout`.**
  Move the inline mode-switch (`master/page.tsx`) into
  `components/mastering/MasterScreen.tsx` (mode prop) + RTL test; replace the
  hand-inlined readout block with `BigReadout` (currently dead code). [Phase 2]

- [ ] **`StemsView` + `ExportView` + unified Sidebar on /master & /mix.**
  Build the two missing shells; add `AppShell`/`Sidebar` to /master and /mix so
  all routes share the unified shell (only / and /album have it today).
  RTL + Playwright. [Phase 3]

- [ ] **`useAlbumStore` stub + wire album page.** [Phase 4 t3]

## R2 direct upload — complete fully (incl. Turnstile)

- [ ] **`src/lib/api/r2-upload.ts` chunked client + unit test.**
  `uploadFileToR2(file, turnstileToken, baseUrl, opts)`: initiate → parallel
  16 MB part PUTs (concurrency 4, 3-retry backoff, ETag capture) → complete;
  abort on failure; returns `{key}`. [Task 4]

- [ ] **`errors.ts` + rewire deep-analysis/separation to JSON `{key}`.**
  Extract shared `BackendError`; switch `startDeepAnalysis`/`startSeparation`
  from FormData to `uploadFileToR2` + JSON POST; add `turnstileToken` params;
  drop the bespoke `SeparationError`. + `deep-analysis-r2.test.ts`. [Task 5]

- [blocked] **`TurnstileGate` + wire entry points.** Needs a Cloudflare
  Turnstile **site key** (`NEXT_PUBLIC_TURNSTILE_SITE_KEY`) + Worker **secret**.
  Build the component to gracefully no-op when the key is absent so dev still
  works; activation pending the keys. [Task 6]

- [ ] **Backend pytest suites + remove legacy multipart.**
  `test_r2_download.py` (magic-byte/header rejection within 64 KB/1 MB, oversize
  413, malicious-stream abort <1 MB, network 502) and `test_main_json_endpoints.py`
  (respx-mocked R2 GET, single-fetch). Then Task 9: remove the legacy multipart
  handlers (or return 410) + `test_legacy_multipart_returns_410`. [Tasks 3/8/9]

- [ ] **Frontend Vitest + Playwright E2E for the R2 path.**
  `e2e/r2-upload.spec.ts` (TS-001/002/003/004/007/008 incl. memory-ceiling,
  resumable) mocking initiate/complete; update existing specs to the JSON flow.
  [Task 8]

## Polish & docs

- [ ] **Profile-switch dirty guard: Radix dialog instead of `window.confirm`.**
  `DeepMastering.tsx` `handleApplyProfile` + test (Cancel keeps script, Confirm
  setProfile+runAnalyze). [ai-deep-mastering T17]

- [ ] **Docs housekeeping + plan-status reconciliation.**
  p2 plan: add "Superseded by Phase 4a" note at the byte-equivalence assertions
  (do NOT revert presets). Close `genre-buttons` plan as "no defect found".
  Flesh out the `airpods-head-tracking` plan into an actionable spec (sensor
  source, audio-rotation strategy, phases, acceptance) without building it.
  Bump the status of every plan whose gaps were closed this effort.
