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
- [x] **Extract `MasterScreen` component** (mode prop) from the inline mode-switch
  in `src/app/master/page.tsx`. The simple/advanced/deep switch was duplicated
  (desktop inspector + mobile drawer); both now render `<MasterScreen>` with an
  `animated` flag (AnimatePresence slide) and a `testIdSuffix` ("" / "-mobile")
  so all E2E testids are preserved. RTL test covers mode routing + variants.
- [x] **Build `StemsView`** wrapping the inline /mix layout. — b434d80 (RTL test).
- [x] **Build `ExportView`** wrapping/restyling `ExportPanel`. — 559b3a4 (RTL test).
- [x] **Add `AppShell`/`Sidebar` to /master & /mix** so all routes share the shell.
  — 83b3539 (master) + fef64c2 (mix); 3651daa removed the WindowChrome top bar.
- [x] **Make the Pro Mode toggle reachable on /master & /mix** — the Sidebar owns
  the Pro Mode toggle (`Sidebar.tsx:88`); both /master and /mix pass
  `proMode`/`onProModeChange` into it. [#21]

## ✅ 2026-07-07 design-100 (branch `feat/design-100`, Stage 3 merge + integration)

Six area tracks (master, sidebar, library, album, export+mix, R2 tests) merged
and integrated. One line per area landed:

- [x] **Shell**: unified `AppShell` on `/`, `/master`, `/mix`, `/album`; shared
  `libraryEntriesToSidebarTracks` builder feeds real tracks (analyzed check +
  seeded art tile) into the sidebar on every route.
- [x] **Master screen**: transport/waveform/spectrum cards, +5s skip, Direction-C
  Phase Scope goniometer, full-width deep-timeline card, focused Export state.
- [x] **Sidebar**: ⌘K search, OPFS/backend footer status, seeded art tiles.
- [x] **Library + Import**: real-data table, album hero card, inline dropzone,
  in-shell import; sidebar "Import" deep-links to `/?screen=upload` from any route.
- [x] **Smart Master Album**: LUFS bar chart, hero stats, suggestions, client-side
  master-all ZIP — now **re-gained to the album target** post-render (peak-guarded
  by the persisted ceiling; renderer untouched).
- [x] **Export + Mix**: WAV/MP3 formats, segmented sample-rate + dither, size
  estimate, progress; `/mix` Export routes through shared options.
- [x] **R2 test debt**: see the infra item below — gate mounted, 422 fix, both
  transports covered; multipart-removal + live-Worker verify remain HELD.
- [x] **Art-tile consolidation**: master toolbar + library table now source colours
  from the shared `src/lib/art-tile.ts` `artGradient` (one seed → one colour).

## ✅ 2026-07-08 design-100 Stage 5 (local verification against real backend)

Fresh-eyes browser walkthroughs (docker backend + Next server) + full test gate.
All three walkthroughs verified WORKING in a real browser:
- **Deep Mastering**: upload → Deep mode → Metal Wall profile → Analyze (real
  sections→stems→script pipeline, no crash on completion) → full-width deep
  timeline + legend → move editor (top-right) edit flips `edited` → Script A/B
  toggle → toolbar Export → WAV + MP3 downloads (valid RIFF / MPEG headers).
- **Smart Master Album**: 3 seeded tracks (distinct measured LUFS) → hero, stats,
  LUFS bar chart, 3-tier suggestions, LUFS-only segmented → Master entire album →
  per-track progress + ZIP (one WAV/track). **Independently confirmed** each
  mastered track integrates to ~−14 LUFS (−14.06 / −14.11 / −14.25) via
  `backend/.venv` pyloudnorm — album re-gain (5b33eb4) lands.
- **Mobile 375×812**: drawer nav opens/closes on all four routes; /master keeps
  compact meters + waveform + Phase Scope (Pro Mode); no horizontal overflow.

Test-infra bugs found + fixed (the specs had latent failures that only surfaced
once the raised health probe let them actually run against the real backend):
- [x] **deep-mastering specs aborted at the 30s default test timeout** (real
  pipeline is 40-90s) and hammered the CPU backend in parallel. Serial mode +
  300s per-test timeout; fixed TS-004's occluded move click (dispatchEvent) and
  controlled-slider edit (native value setter); rewired TS-005 to the C8 export
  overlay. 5/5 pass. — d8937d9
- [x] **smart-split beforeAll health probe had no timeout** → 30s hook hang under
  load; **Backend Warning** test asserted a down-state off a racy probe of the
  live backend. Bounded + retried the probe; made Backend Warning hermetic
  (route `**/health` to abort). — d705585 / aae00a2
- [x] **mixer TS-001 `waitForLoadState("networkidle")`** never settled because the
  redesigned sidebar polls backend health; wait for the upload input instead. — cc038ed

Final gate (prod E2E bundle built with `NEXT_PUBLIC_E2E_HOOKS=1`, matching CI):
tsc 0 · lint 0 · **vitest 1607 pass** (2 CPU-timing micro-benchmarks flake only
under concurrent docker+server load; pass in isolation) · **Playwright 100 pass /
4 skip / 0 fail** (4 skips = smart-split separation TS-001×3 + TS-005×1, the
pre-existing collection-time `test.skip(!backendAvailable)` footgun; they skip in
CI too) · **backend pytest 115 pass**.

## ▢ Remaining — needs a decision or live infra (NOT autonomous)

- [infra] **Finish + ship the R2 cutover.** Test debt now cleared on
  `feat/design-100`: the gate is mounted (DeepMastering + StemsView render
  `{turnstileGate}`); `test_main_json_endpoints.py` landed via httpx
  `MockTransport` (no `respx`) and the JSON branches now return 422 on a bad
  body (was a 500); `e2e/r2-upload.spec.ts` covers both transports and the
  webServer sets a Turnstile test key so the direct-R2 path actually runs.

  **Live verification (2026-07-08) against the deployed Workers found THREE
  blockers; TWO are now code-fixed on `feat/design-100`:**
  1. *Single-use token reused on `/upload/complete`* — the Worker ran Turnstile
     siteverify on BOTH initiate and complete while the client sent the same
     single-use token to both, so complete always 403'd (duplicate token) and
     no upload could finalize. **CODE-FIXED (51758f6):** Turnstile is verified
     on `/upload/initiate` only; complete is authorized by possession of the
     uploadId+key capability initiate minted.
  2. *Client bundle carried no Turnstile site key* — `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
     was only a Worker runtime var, but Next inlines `NEXT_PUBLIC_*` at BUILD
     time, so `getTurnstileSiteKey()` returned null in the browser and every
     upload silently fell back to legacy multipart. **CODE-FIXED (9b7a222):**
     the public key is now in committed `.env.production`; a local `pnpm build`
     confirms it inlines into a client chunk.
  3. *Missing R2 secrets → uncaught 500 with NO CORS headers at the SigV4
     presign step* (a valid Turnstile token reached presign and threw; browsers
     saw an opaque ERR_FAILED). **Code hardened (d4905ea):** presign paths now
     return an explicit `503 {"detail":"R2 storage not configured"}` WITH CORS,
     and a top-level catch wraps all handlers so any throw is a CORS-safe JSON
     500 — BUT this only makes the failure legible; the upload stays BLOCKED
     until the secrets are actually set (infra, below).

  **Still HELD — remaining INFRA steps (needs live infra + go-ahead), in order:**
  1. Set the R2 secrets on `aurialis-core`
     (`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_ACCOUNT_ID` via
     `wrangler secret put`) — without these initiate still (now cleanly) 503s.
  2. Redeploy BOTH workers: `aurialis-core` (ships the worker code fixes #1/#3)
     and `aurialis` (a fresh `pnpm build` bakes the inlined site key into the
     client bundle #2).
  3. Re-verify a real end-to-end upload against the deployed Worker (valid
     Turnstile token → initiate → PUT parts → complete → analyze).
  4. **THEN** remove the legacy multipart fallback — it replaces a
     currently-working path, so only after live re-verification passes.
  [direct-R2 Tasks 5/6/8/9; #27/#28/#34]
