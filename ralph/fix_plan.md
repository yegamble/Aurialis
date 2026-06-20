# Aurialis — Incomplete Work Backlog (Ralph fix_plan)

Generated 2026-06-19 from a full audit of all 26 plan docs + 5 codebase scans
(81-agent workflow, every gap adversarially verified). Ordered by priority.
Each task is one atomic commit. Tick `[x]` only when its "Done when" holds and
the green gate (`tsc` + `lint` + `test`) passes.

Baseline at start: tsc clean, lint exit 0 (after task 1), 1408 unit tests green.
**Progress: 12 of 18 tasks done. Remaining: #5 (rest of DSP tests), #9, #10
(redesign shell), #12–16 (R2 cluster).** All work on branch
`fix/incomplete-work-audit`; gate green at every commit (now 1428 unit tests).

## Correctness / export quality

- [x] **Lint: ignore generated dirs so `pnpm lint` exits 0.** — 7e0ff0a
- [x] **True-peak limiter in the offline WAV renderer.** Both render paths now
  use the validated `processTruePeakLimiter`; ISP-hot export held within 0.5 dB
  of −1 dBTP (was +1.15 dBTP). — 40d0bb8
- [x] **AI-repair in the offline render (export == preview).** `applyAiRepair`
  wired between Saturation and StereoWidth in both paths via a new
  `aiRepairAmount` AudioParam surfaced by the script-renderer; amount 0 = bypass.
  Stale "T11 no-op" comments fixed. — 81801b0
- [~] **Tighten relaxed DSP test tolerances to plan spec.** Limiter true-peak
  tightened 0.5→0.3 dB (passes). The plan's 15 kHz / ≥40 dB 0–10 kHz saturation
  alias target is NOT achievable (measured ~15 dB) — kept the real 7 kHz/≥30 dB
  check + documented the deviation. — b51e78f
- [~] **Add the remaining DSP test files the plans marked done.**
  DONE (commit e9128b3): `metering-truepeak.test.ts` (accuracy within 0.2 dB —
  the plan's 0.1 dB isn't achievable with 4× oversampling, documented; mono,
  44.1/48/96 k, perf) and the parametric-EQ golden decision (no fixture — P3
  replaced the EQ kernel, so pre-P3 bit-equivalence is intentionally not enforced;
  plan amended). STILL TODO (both need transcribing worklet internals into the
  test, like `parametric-eq-parity.test.ts` does):
  `compressor-auto-release-integration.test.ts` (worklet-level, pink noise vs a
  frozen P0 reference) and extending `saturation-alias.test.ts` to all 4 modes
  (clean/tube/tape/transformer ≥25 dB — the oversampled per-mode path lives only
  in `saturation-processor.js`, not in pure DSP). [p1 T1/T3]

## App / UX correctness

- [x] **Album: measured LUFS instead of `targetLufs` stand-in.** Added
  `measuredLufs` to LibraryEntry, captured from `analyzeAudio().integratedLufs`
  in the master flow; `useAlbumStore` derives rows from real measured loudness. — b3e55b7
- [x] **Surface standalone Auto-Mix failures in the UI.** — 848e494
- [x] **Remove the vestigial `StemTrack.file` placeholder.** — 45f5972

## Redesign Direction A — complete the unified shell  (REMAINING)

- [ ] **Extract `MasterScreen` component + wire `BigReadout`.**
  Move the inline mode-switch (`src/app/master/page.tsx` ~356-424) into
  `components/mastering/MasterScreen.tsx` (mode prop) + RTL test; replace the
  hand-inlined readout block (~430-491) with `BigReadout` (currently dead code —
  only its test references it). [Phase 2]
- [ ] **`StemsView` + `ExportView` + unified Sidebar on /master & /mix.**
  Build the two shells; add `AppShell`/`Sidebar` to /master and /mix so all
  routes share the unified shell (only / and /album have it today). RTL +
  Playwright. Preserve E2E `data-testid`s. [Phase 3]

## R2 direct upload — complete fully (incl. Turnstile)  (REMAINING)

Full spec in `docs/plans/2026-04-28-direct-r2-upload.md`. Backend JSON endpoints
+ Worker already exist; the frontend still uses multipart FormData (the backend
legacy multipart path is still live, so nothing is broken today — this is
unfinished, not breaking).

- [ ] **`src/lib/api/r2-upload.ts` chunked client + unit test.**
  `uploadFileToR2(file, turnstileToken, baseUrl, opts)`: `/upload/initiate` →
  parallel 16 MB part PUTs (concurrency 4, 3-retry backoff, ETag capture) →
  `/upload/complete`; abort on failure; returns `{key}`. [Task 4]
- [ ] **`errors.ts` + rewire deep-analysis/separation to JSON `{key}`.**
  Extract shared `BackendError`; switch `startDeepAnalysis`/`startSeparation`
  from FormData to `uploadFileToR2` + JSON POST `{key,profile}`/`{key,model}`;
  add `turnstileToken` params; drop the bespoke `SeparationError`. [Task 5]
- [blocked] **`TurnstileGate` + wire entry points.** Needs a Cloudflare Turnstile
  **site key** (`NEXT_PUBLIC_TURNSTILE_SITE_KEY`) + Worker **secret**. Build the
  component to gracefully no-op when the key is absent so dev still works. [Task 6]
- [ ] **Backend pytest suites + remove legacy multipart.**
  `test_r2_download.py` (magic-byte/header rejection within 64 KB/1 MB, oversize
  413, malicious-stream abort <1 MB, network 502) + `test_main_json_endpoints.py`
  (respx-mocked R2 GET, single-fetch). Task 9: remove legacy multipart (or 410)
  + `test_legacy_multipart_returns_410`. [Tasks 3/8/9]
- [ ] **Frontend Vitest + Playwright E2E for the R2 path.** `e2e/r2-upload.spec.ts`
  (TS-001/002/003/004/007/008) mocking initiate/complete; update existing specs
  to the JSON flow. [Task 8]

## Polish & docs

- [x] **Profile-switch dirty guard: Radix dialog instead of `window.confirm`.** — c81492e
- [~] **Docs housekeeping + plan-status reconciliation.** In progress: fix_plan
  synced; genre plan closed; p2 byte-equivalence + p0 saturation deviation notes;
  airpods plan fleshed out; plan statuses bumped.
