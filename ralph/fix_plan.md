# Aurialis — Incomplete Work Backlog (Ralph fix_plan)

Originally generated 2026-06-19 (81-agent audit of 26 plan docs + 5 codebase
scans). **Re-audited 2026-06-29** (fresh 100-agent workflow re-scan; 34 gaps
adversarially verified) after a partial R2 rewire (`e9390df`) landed the tree
red. Ordered by priority. Each task = one atomic commit; tick `[x]` only when
its "Done when" holds and the green gate (`tsc` + `lint` + `test`, plus backend
`pytest` for server changes) passes.

**Status (2026-06-29): tree GREEN — `tsc` 0, `lint` 0, 1453 unit tests, 92
backend tests.** All work on branch `fix/incomplete-work-audit`.
Turnstile site key is in wrangler.jsonc (`0x4AAAAAADFNPdaK9423tgxr`); the Worker
secret `TURNSTILE_SECRET` is set via `wrangler secret put`.

---

## ✅ Done in the 2026-06-29 re-audit pass

- [x] **Green the gate: complete the `tokenRef` wiring.** `e9390df` left `tokenRef`
  out of 3 useCallback deps (React-Compiler error) + the DeepMastering tests
  asserted a stale 3-arg call. — 7a562fb
- [x] **Persist audio to OPFS on analyze (export-of-feature was broken).**
  `persistScriptToLibrary` called `addEntry(file,{script})` with no `audioBlob`,
  so every real library entry was audio-less and re-opening it errored. — 0efdc4e
- [x] **Delete dead `LibraryList` component** (superseded by LibraryView). — d603048
- [x] **Remove dead `mixer-store.originalMixBuffer` field.** — 4b590b6
- [x] **Remove redundant dead `library-store.setActiveFingerprint` setter.** — 6e2c13e
- [x] **Auto-Mix failure message includes the stem index (TS-008).** — bb8ff77
- [x] **Auto-Mix progress shows "stem N of M" not "stem N/M" (TS-007).** — 09852d8
- [x] **Highlight the active track in the home Sidebar** (was hardcoded null). — 368311b
- [x] **Export applies the active deep mastering script (export == preview).** — d7d9ee5
- [x] **Export applies multiband to MONO buffers** (worklet does; renderer skipped). — ae825a5
- [x] **Enforce multiband crossover ordering at the node layer** (was UI-only). — e5d87f7
- [x] **Backend: lifespan handler instead of deprecated `@app.on_event`.** — cc7f3b1
- [x] **Badge audio-less library entries "Re-upload audio to play".** — 42ef9c0
- [x] **AI-Repair: separate with htdemucs_6s so guitar-gated moves can fire.**
  Per maintainer decision (accepts slower separation for correct guitar repair). — e842bbd
- [x] **Capture per-track duration (`durationSec`)** from the decoded buffer so
  library/album rows show time, not byte size. — 3809436
- [x] **Backend `test_r2_download.py`** — magic-byte/size/header validation paths
  via httpx.MockTransport (happy/400/400/413/502/502/no-orphan). — d2b45c5
- [x] **Remove dead `StemTrack.file` test remnants** (5 makeStem helpers). — de106bc
- [x] **Correct the LR4 "bit-flat summation" plan claim** to magnitude-flat
  all-pass (code + test were already correct; the plan overclaimed). — 9248995

## ✅ Done earlier (2026-06-19 pass) — see git history
Lint generated-dir ignore (7e0ff0a); true-peak limiter offline (40d0bb8);
AI-repair offline (81801b0); DSP tolerances (b51e78f); DSP test files
(e9128b3/81f3b9c/35d60d9); album measured LUFS (b3e55b7); surface Auto-Mix
failure (848e494); StemTrack.file removed (45f5972, but see remnant below);
r2-upload.ts client (c02f72c); Radix profile-switch guard (c81492e).

---

## ▢ Remaining — autonomous (finishable + verifiable with tests alone)

Ordered high→low value. Each is one atomic commit; green gate at every commit.

- [x] **Wire `BigReadout` into the master readout block.** — c17daa9 (5-col
  metering grid; b2bd668 re-homed MB-GR into the meters rail; 0b78474 E2E covers it).
- [x] **`checkPhaseCoherence` is implemented but never invoked.** Wired into the
  StemsView Smart-Repair flow after the per-stem repair loop via
  `summarizeRepairCoherence` (score + warn threshold); surfaced as a
  `data-testid="phase-coherence"` badge. Helper unit-tested in `smart-repair.test.ts`.
- [x] **Stereo sub-split DSP (`stereo-split.ts`) is never wired into the mixer.**
  Wired a client-side "Split L/R" control into StemsView: a per-stem effect runs
  `analyzePanContent` off-render to gate the button on `hasPannedContent`;
  `handleSplitStereo` M/S-decodes the stem and replaces it with two hard-panned
  L/R sub-stems. Track-building extracted to the pure `buildStereoSubTracks`
  helper (`src/lib/mix/split-stereo-tracks.ts`) + unit test.
- [x] **Pro Mode shows no denser spectrum** (only the Goniometer half landed).
  Added a `pro` prop to `SpectrumDisplay` (driven from `proMode` on /master):
  pro renders the denser 10-label frequency grid + vertical gridlines vs. the
  sparse 6-label standard set. Density decision extracted to the pure
  `spectrumDensity` helper + unit test; also null-guarded the 2D context.
- [x] **Numerical multiband worklet↔TS parity test.** — afa8da4 (vm-loaded
  numerical equivalence vs. `MultibandCompressorDSP.processStereo` < 1e-6).
- [x] **`window.__deepDebug.envelopeAt(param, t)` verification hook** — fd7bd75
  (added to the stateful engine, `engine.ts:426`).
### Redesign Direction A — unified shell (cohesive batch; all touch master/mix layout)
- [ ] **Extract `MasterScreen` component** (mode prop) from the inline mode-switch
  in `src/app/master/page.tsx`. RTL test. [Phase 2]
- [x] **Build `StemsView`** wrapping the inline /mix layout. — b434d80 (RTL test).
- [x] **Build `ExportView`** wrapping/restyling `ExportPanel`. — 559b3a4 (RTL test).
- [x] **Add `AppShell`/`Sidebar` to /master & /mix** so all routes share the shell.
  — 83b3539 (master) + fef64c2 (mix); 3651daa removed the WindowChrome top bar.
- [x] **Make the Pro Mode toggle reachable on /master & /mix** — the Sidebar owns
  the Pro Mode toggle (`Sidebar.tsx:88`); both /master and /mix pass
  `proMode`/`onProModeChange` into it. [#21]

## ▢ Remaining — needs a decision or live infra (NOT autonomous)

- [infra] **Finish + ship the R2 cutover.** The rewire is ~70% done (both API
  clients use `uploadFileToR2` with multipart fallback; `TurnstileGate`/
  `useTurnstileToken` built). Remaining: **mount the gate** (it's destructured but
  never rendered, so tokens never flow in prod); `test_main_json_endpoints.py`
  (needs `respx` — not installed in the venv, or rewrite with `MockTransport`);
  `e2e/r2-upload.spec.ts` + migrate existing specs; remove legacy multipart; then
  **verify a real upload against the deployed Worker** (Turnstile secret set).
  → replaces a currently-working path; do behind a deploy + your go-ahead.
  [direct-R2 Tasks 5/6/8/9; #27/#28/#34]
