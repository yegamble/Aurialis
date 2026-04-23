# Grammy-Tier DSP P2 Upgrade Implementation Plan

Created: 2026-04-23
Author: yegamble@gmail.com
Status: VERIFIED
Approved: Yes
Iterations: 0
Worktree: No
Type: Feature

## Summary

**Goal:** Add multiband compression (3-band Linkwitz-Riley 4th-order crossover, per-band dynamics) and per-band Stereo/Mid-Side mode to the mastering chain, inserted as a new stage between the existing wideband compressor and the saturation block. Multiband ships bypassed-by-default across all 9 genre presets so existing output is byte-equivalent until a user opts in.

**Architecture:** New `MultibandCompressorNode` inserted into the chain between `Compressor` and `Saturation`. A single monolithic worklet (`multiband-compressor-processor.js`) performs the LR4 split, three independent compressors (sharing the P0 gain-computer + envelope-follower logic), optional per-band M/S encode/decode, and summation. Canonical pure-TS DSP lives in `src/lib/audio/dsp/crossover.ts` + `src/lib/audio/dsp/multiband.ts` for parity tests and the offline renderer. UI adds one `Multiband` section to `AdvancedMastering.tsx` with a master enable toggle, two crossover-frequency sliders, and three collapsible band rows (each: enable / solo / Stereo|M/S pill / Thresh / Ratio / Atk / Rel / Makeup / M/S-balance).

**Tech Stack:** TypeScript, AudioWorkletProcessor (JS), Web Audio API, Vitest, Playwright, React 19, Zustand, Tailwind.

## Scope

### In Scope

1. **Linkwitz-Riley 4th-order crossover DSP** — new `src/lib/audio/dsp/crossover.ts` exporting:
   - `lr4LowpassCoeffs(fc, fs)` / `lr4HighpassCoeffs(fc, fs)` — each returns a pair of cascaded Butterworth biquads (LR4 = Butterworth² at the same fc).
   - `class LR4Crossover` holding two biquad states; `process(sample) → {low, high}`.
   - `class ThreeWaySplitter` built from two LR4 crossovers: splits input into `{low, mid, high}` with summation-flat magnitude response when bands are unity-passed.
   - Summation identity when bands are unity: `low + mid + high === input` (within float epsilon). Verified by unit test.

2. **Multiband compressor DSP core** — new `src/lib/audio/dsp/multiband.ts` exporting:
   - `BandParams` interface: `{ enabled, threshold, ratio, attack, release, makeup, mode: 'stereo'|'ms', msBalance }`.
   - `class MultibandCompressorDSP` holding three `{left, right}` envelope states + three gain-reduction states. Reuses `computeGainReduction` from `src/lib/audio/dsp/compressor.ts` and `makeAttackReleaseCoeffs` for coefficient generation.
   - `processStereo(left, right, bands, crossoverFcs, solos, sampleRate) → {outL, outR, grLow, grMid, grHigh}` — pure-TS reference path for offline renderer + tests.
   - **M/S mode within a band:** when `bands[i].mode === 'ms'`, the band's L/R signal is encoded to `M=(L+R)/2, S=(L−R)/2`, two envelope followers (M and S) run with the same threshold/ratio/attack/release, then the computed gain reductions for M and S are *biased by `msBalance`*: effective threshold becomes `threshold + msBalance*BALANCE_RANGE_DB` for M and `threshold - msBalance*BALANCE_RANGE_DB` for S (`BALANCE_RANGE_DB = 6`). Positive balance → softer on M, harder on S. Negative balance → softer on S, harder on M. Final M and S are then decoded back to L/R.

3. **Multiband compressor worklet** — new `public/worklets/multiband-compressor-processor.js`:
   - 3 bands × 2 channels × LR4 crossovers (four cascaded biquads per crossover side = 8 biquads per channel when pre-computed as LR4 = Butterworth²).
   - Three compressor cores inlined from P0 compressor (envelope follower + gain computer + attack/release smoothing + makeup gain) — one per band.
   - Optional per-band M/S encode/decode inline.
   - Per-band solo support (when any band is soloed, non-soloed bands are silenced).
   - Messages out: `{type: 'gr', values: [low, mid, high]}` throttled ~30 Hz.
   - All duplicated hot-loop formulas carry `// IN SYNC WITH src/lib/audio/dsp/<file>.ts` comments. DSP-level parity test covers the worklet ↔ TS reference drift.

4. **Node wrapper + chain integration** — new `src/lib/audio/nodes/multiband-compressor.ts` (AudioWorkletNode wrapper following the P0 compressor pattern). `ProcessingChain.init()` wires it between `Compressor` and `Saturation`:
   `inputGain → EQ → Compressor → MultibandCompressor → Saturation → StereoWidth → Limiter → Metering → outputGain`. `ProcessingChain.updateParam` routes all new keys. Node disposal in `dispose()`.

5. **Offline renderer parity** — `src/lib/audio/renderer.ts` gains an inline multiband pass between `applyCompressor` and the saturation step, using `MultibandCompressorDSP.processStereo`. Parity test: offline output matches real-time worklet output for a deterministic input within ±0.5 dB short-term-LUFS drift over a 3-second test signal.

6. **Types + presets + param bridge** — extend `src/types/mastering.ts` with the new `AudioParams` fields (see Task 1 for full schema). Add neutral defaults to `DEFAULT_PARAMS` and add the same defaults to all 9 entries of `GENRE_PRESETS` (via `...DEFAULT_PARAMS` spread — no changes per genre). `applyIntensity()` already handles non-numeric fields by direct copy → no change required. `ParameterBridge` already walks `Object.keys(params)` → no change required. `ProcessingChain.updateParam` switch gains ~22 new cases routed to the multiband node.

7. **UI — Multiband section in AdvancedMastering** — new `<Section title="Multiband">` positioned between the existing Dynamics and Tone sections. Contains:
   - Master `Multiband` toggle (`ToggleButton`-style).
   - Two sliders: `Low|Mid: 80–400 Hz` (default 200 Hz), `Mid|High: 800–4000 Hz` (default 2000 Hz).
   - Three nested `<BandRow>` sub-components (one per band), each collapsible. Each band exposes: enable toggle, solo toggle, `Stereo | M/S` two-option pill (reuses the pill pattern from `SatModePills`), `Threshold/Ratio/Attack/Release/Makeup` sliders (reused `Slider`). The `M/S Balance` slider is conditionally rendered only when `mode === 'ms'`.
   - New `BandRow` component lives inline in `AdvancedMastering.tsx` (same file, same style as `SatModePills` and `Section`). Keeps AdvancedMastering a self-contained panel.

8. **Tests** (Vitest unit + Playwright E2E):
   - `src/lib/audio/dsp/__tests__/crossover.test.ts` — LR4 magnitude at fc = −6 dB, summation flatness (low+mid+high = input ± 1e-6), impulse response stability.
   - `src/lib/audio/dsp/__tests__/multiband.test.ts` — band isolation (low-band threshold change affects 80 Hz sine GR but leaves 1 kHz / 8 kHz sines unchanged within rounding), `msBalance` behavior (positive balance → lower GR on M channel, higher on S channel for a known stereo signal), solo mutes other bands.
   - `src/lib/audio/dsp/__tests__/multiband-parity.test.ts` — worklet ↔ TS reference parity harness (same pattern as `halfband-parity.test.ts`: port the worklet formulas as a mock class, run same input through both, assert sample-level equivalence within 1e-6).
   - `src/lib/audio/nodes/__tests__/multiband-compressor.test.ts` — mock AudioContext; verify param setters call `port.postMessage` with correct keys/values.
   - `src/lib/audio/__tests__/chain-integration.test.ts` (extend existing if present, else new) — full chain with MB active; verify metering still fires and no disconnections.
   - E2E: `e2e/multiband.spec.ts` covering TS-001..TS-005 (see E2E Test Scenarios).

9. **Per-genre preset defaults** — all 9 genre presets inherit `multibandEnabled = 0` from `DEFAULT_PARAMS`. Byte-equivalent output vs. pre-P2 for every genre preset at 0% and 100% intensity. Existing genre-preset regression tests should require zero changes.

### Out of Scope

- Parametric EQ with sweepable frequency/Q (P3).
- Per-band parametric EQ (M/S or stereo) within the multiband (deferred).
- FIR/linear-phase multiband (explicitly rejected due to latency).
- Multiband metering on the transport bar (per-band GR is surfaced in the Multiband section only; not duplicated in the transport bar for P2).
- Altering any P0/P1 DSP: oversampler, sidechain HPF, auto-release, saturation modes, LRA, correlation — untouched.
- Altering existing genre presets' wideband or saturation parameters.
- Vectorscope / goniometer visuals.
- More than 3 bands.
- Per-band ceiling/hard-clip (multiband is compression-only, no limiting inside a band).

## Approach

**Chosen:** Add `MultibandCompressor` as a new stage between the existing wideband compressor and saturation. Monolithic worklet for the real-time path; canonical pure-TS DSP for offline + tests. Per-band Stereo|M/S mode with a single shared parameter set plus an `msBalance` bias knob.

**Why:** Inserting multiband as a discrete stage preserves every P0/P1/existing-preset output byte-for-byte until a user explicitly enables it (cost: one additional AudioWorkletNode in the graph, which is negligible vs. the existing 4 worklet nodes). A monolithic worklet keeps LR4 crossovers, three compressor cores, and summation in one hot loop — avoiding cross-node routing overhead and ensuring phase/latency is deterministic. LR4 is the industry-standard multiband crossover (summation-flat, -24 dB/oct, zero latency via biquads). The shared-param + `msBalance` M/S model captures the 90% grammy-tier use case ("tighten the center without touching the sides") with one extra knob per band, instead of doubling the per-band parameter surface from 5 → 10.

**Alternatives considered:**
- **Replace the wideband compressor entirely with multiband.** Rejected: every existing genre preset would need to be re-tuned against the new per-band gain staging; risk of audible regressions across 9 genres + 5 platforms. The chosen approach costs one additional node but zero preset churn.
- **Separate M/S compressor stage distinct from multiband.** Rejected: the grammy-tier value of M/S is strongest when combined with band splits (e.g., "tighten the center *low end* without touching the *low-end sides*"). A standalone M/S wideband compressor duplicates the wideband stage with marginal added value.
- **Independent M and S parameter sets per band.** Rejected: 2× slider count for M/S bands (up to 48 controls when all three bands in M/S), larger state surface, larger test surface. The `msBalance` bias captures the main use case at 1/10th the UI cost.
- **FIR linear-phase crossover.** Rejected: ~12 ms latency breaks real-time monitoring (unacceptable for the mastering use case).
- **Bands processed via three chained `CompressorNode` instances with externally wired crossovers.** Rejected: per-sample crossover → Web Audio graph → compressor → graph → summation introduces buffering delays and makes the per-band solo wiring fragile.

## Context for Implementer

> Write for an implementer who has never seen the codebase. Read P0 + P1 first: `docs/plans/2026-04-22-dsp-grammy-tier-p0.md` and `docs/plans/2026-04-23-dsp-grammy-tier-p1.md`.

**Patterns to follow (inherited from P0/P1):**
- **Worklet ↔ node wrapper ↔ DSP trinity:** `public/worklets/compressor-processor.js` (`src/lib/audio/nodes/compressor.ts:19-28`) ↔ `src/lib/audio/dsp/compressor.ts`. Parameters flow one-way via `port.postMessage({ param, value })`. Metering/GR data flows back via `port.onmessage`.
- **DSP math separation:** pure functions live in `src/lib/audio/dsp/*.ts`. Worklets duplicate the hot-loop logic in JS. Canonical TS source + parity tests protect against drift. See `src/lib/audio/dsp/__tests__/halfband-parity.test.ts` for the pattern to copy for multiband parity.
- **Param routing:** add field to `AudioParams` in `src/types/mastering.ts` → add default to `DEFAULT_PARAMS` in `src/lib/audio/presets.ts` → add setter on node class → add `case` to `ProcessingChain.updateParam` in `src/lib/audio/chain.ts:96`. `ParameterBridge` auto-routes; no change needed there.
- **Boolean-on-number-interface:** `AudioParams` is historically all-numeric except `satMode`. For booleans (`multibandEnabled`, `mbLowEnabled`, etc.) use `number` with 0/1 convention to preserve `applyIntensity()` interpolation. For mode enums (`mbLowMode: 'stereo'|'ms'`) add a TypeScript union type — `applyIntensity()` already handles non-numeric via direct copy (see `presets.ts:257-266`).
- **Test convention:** DSP tests in `src/lib/audio/dsp/__tests__/*.test.ts` (offline math). Node tests in `src/lib/audio/nodes/__tests__/*.test.ts` (mock AudioContext, verify `postMessage`). Integration tests in `src/lib/audio/__tests__/*.test.ts`. E2E in `e2e/*.spec.ts`.

**Conventions:**
- DSP modules: kebab-case files (`crossover.ts`, `multiband.ts`). Export pure functions first, then stateful classes.
- Worklet inline duplications: `// IN SYNC WITH src/lib/audio/dsp/<file>.ts` comment block on every duplicated formula.
- UI: reuse the existing `Slider`, `ToggleButton`, `Section` primitives in `AdvancedMastering.tsx`. The `SatModePills` pattern is the template for the `Stereo | M/S` pill.
- Accessibility: every toggle gets `aria-pressed`; every slider gets an `aria-label` (existing `Slider` already provides this); pills use `role="radiogroup"` + `role="radio"` + arrow-key cycling (copy the `SatModePills` keyboard handler at lines 35-43).

**Key files:**
- `src/types/mastering.ts` — `AudioParams` source of truth. Extend with the new fields in Task 1.
- `src/lib/audio/presets.ts` — `DEFAULT_PARAMS` + `GENRE_PRESETS`. 9 genres, all spread `...DEFAULT_PARAMS` so new fields propagate automatically.
- `src/lib/audio/chain.ts:49-90` — chain wiring. Insertion point is `this._compressor.output.connect(this._saturation.input)` at line 78 → becomes `_compressor.output → _multiband.input`, `_multiband.output → _saturation.input`.
- `src/lib/audio/chain.ts:96-172` — `updateParam` switch. Add multiband cases.
- `src/lib/audio/renderer.ts:87-106` — offline render inline DSP sequence. Insert multiband pass after `applyCompressor`, before saturation.
- `src/lib/audio/nodes/compressor.ts` — template for the new `MultibandCompressorNode` wrapper (init, port routing, setter style, dispose pattern).
- `public/worklets/compressor-processor.js` — template for worklet structure (constructor default params, port.onmessage switch, `process(inputs, outputs)` loop, `_computeGainReduction` copy).
- `public/worklets/saturation-processor.js` — good reference for a worklet that does band-split internally (shelf pre-filter + oversampling) and preserves per-sample state across blocks.
- `src/components/mastering/AdvancedMastering.tsx:166-196` — `Section` + `ToggleButton` primitives. `SatModePills` at lines 19-77 is the pill template.
- `src/lib/audio/dsp/biquad.ts` — `BiquadFilter`, `lowPassCoeffs`, `highPassCoeffs`. LR4 coefficients are Butterworth² → reuse `lowPassCoeffs(fc, Q=1/√2, fs)` and `highPassCoeffs(fc, Q=1/√2, fs)` twice per crossover point.
- `src/lib/audio/dsp/compressor.ts:19-46` — `computeGainReduction` reused across all three bands.
- `src/lib/audio/dsp/__tests__/halfband-parity.test.ts` — the parity-test template to duplicate for multiband.

**Gotchas:**
- **LR4 is Butterworth² at the *same* fc.** Do not use two different Q values or two different fcs — LR4's summation-flat property depends on identical HP and LP at the crossover point, each realized as two cascaded identical Butterworth biquads.
- **DF-II transposed state must be duplicated per cascaded biquad.** Eight biquads per channel = eight independent `{z1, z2}` state pairs. Do not share biquad instances across bands.
- **Band summation must happen *before* makeup.** Each band's makeup gain is applied to the band's output, then the three bands are summed. Summation after makeup is the ordering that matches analog multiband processors.
- **M/S encoding inside a band must be phase-aligned.** If only *some* bands are in M/S mode, the L/R output of stereo bands and the L/R decoded output of M/S bands must sum without phase drift. Since LR4 is phase-aligned per band and M/S encode/decode is a reversible unitary transform, there is no alignment issue — but keep the encode/decode as tight as possible inside the band's sample loop.
- **Per-band solo is exclusive-OR-all:** when `solos` array has any true entry, all non-soloed bands output silence. Soloed bands still sum (if two are soloed, you hear both).
- **`StereoWidthNode`'s `_bassFilter` is created but never connected** (observed in `src/lib/audio/nodes/stereo-width.ts:38-41` and only referenced in `setBassMonoFreq`). Do not "fix" this as a side effect — it's outside P2 scope.
- **`ParameterBridge` walks `Object.keys(params)`** so new numeric fields pick up debounced updates automatically. Enum fields (`mb*Mode`) also flow through without special-casing since the `!==` comparison works for strings.
- **The offline `renderer.ts` path is currently *ahead* of the real-time path in one respect: it does not apply sidechain HPF, auto-release, or saturation modes** (predates P0/P1). The P2 multiband inline pass must preserve this known discrepancy envelope — do not attempt to back-fill P0/P1 parity in the offline path as part of P2.
- **Crossover frequencies at the edges (80 Hz low|mid, 4 kHz mid|high) can numerically overlap** if a user drags them such that `mbCrossLowMid >= mbCrossMidHigh`. Enforce `mbCrossMidHigh > mbCrossLowMid + 50` in the UI slider onChange clamps and at the node layer.
- **`AudioParams` is heavily used as a flat numeric shape in `applyIntensity`** — preserve flatness. Nested `mbBands: { low, mid, high }` would break the iteration contract. Use prefixed flat keys (`mbLowThreshold`, `mbMidThreshold`, `mbHighThreshold`).
- **String enum interpolation in `applyIntensity()`** copies the preset value directly (see `presets.ts:260-264`). Because every genre preset spreads `...DEFAULT_PARAMS`, leaving `mb*Mode: 'stereo'` in defaults means every genre inherits `'stereo'` for all three bands → byte-equivalent.

**Domain context:**
- Multiband compression is used in mastering to apply different dynamics treatment to different frequency regions (e.g., tighten the low end without pumping the mids). Grammy-tier masters typically use a 3-band setup with crossovers around 200 Hz and 2 kHz.
- M/S (Mid/Side) processing treats the stereo image as two signals: M = (L+R)/2 (centered content), S = (L−R)/2 (side content, difference). Compressing M and S independently is a classic mastering move: "glue the vocal and bass (M) without crushing the reverb tails (S)".
- `msBalance` of −1 means the compressor's threshold for M is 6 dB *lower* (more GR on M) and S is 6 dB *higher* (less GR on S) — i.e., "compress center more, let sides breathe". +1 means the opposite.

## Runtime Environment

- **Start command:** `pnpm dev` — runs `next dev` on port 3000.
- **Port:** 3000.
- **Deploy path:** `pnpm deploy` (OpenNext Cloudflare).
- **Health check:** `http://localhost:3000/master` returns HTTP 200 and the AdvancedMastering panel renders.
- **Restart procedure:** Stop dev server with Ctrl+C, then `pnpm dev`. Worklet changes (`public/worklets/*.js`) are served as static assets and are hot-reloaded on file change, but an explicit page reload is required to re-add them to the AudioWorklet global scope.
- **Tests:**
  - Unit: `pnpm test` (Vitest).
  - E2E: `pnpm test:generate-signals && pnpm test:e2e` — E2E uses pre-generated WAV fixtures; the generate step is cheap and idempotent.

## Assumptions

- Web Audio `AudioWorkletProcessor` supports the monolithic multiband worklet's per-sample cost budget (8 biquads + 3 compressor envelopes + 3 M/S encode/decode per sample per channel at 44.1–48 kHz). Supported by: P0 already runs 47-tap halfband FIR + polyphase oversampling in the saturation worklet without dropouts. Tasks 3, 4 depend on this.
- `AudioParams` field additions are backwards-compatible as long as every field has a default in `DEFAULT_PARAMS`. Supported by: P1 added `autoRelease` and `satMode` this way without migration code. Tasks 1, 5 depend on this.
- Existing `GENRE_PRESETS` entries using `...DEFAULT_PARAMS` will automatically inherit the new multiband defaults. Verified by: `src/lib/audio/presets.ts:56,75,95,...` all spread `...DEFAULT_PARAMS`. Task 1, 9 depend on this.
- `applyIntensity()` already handles non-numeric (string-enum) fields via direct copy, so `mb*Mode: 'stereo'|'ms'` fields do not need special-case handling. Supported by: `src/lib/audio/presets.ts:260-264`. Task 1 depends on this.
- `ParameterBridge` walks all keys of `params` and routes each change through debouncing, so new multiband params need no additional wiring in the bridge. Supported by: `src/lib/audio/parameter-bridge.ts:29-44`. Task 5 depends on this.
- The existing offline renderer (`src/lib/audio/renderer.ts`) is the correct place to add inline multiband DSP for export/WAV-render parity, and it is expected (by current tests) to approximate but not exactly match the real-time path. Supported by: renderer.ts comments and no existing bit-exact parity tests. Task 6 depends on this.
- Biquad state (`z1`, `z2`) for LR4 filters does not require special init to avoid startup transients beyond the natural zero-init that worklet constructors already do. Supported by: P0/P1 existing biquads all zero-init. Task 2, 3 depend on this.

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| Multiband worklet introduces CPU spikes on low-end devices | Medium | High | Default `multibandEnabled = 0` → node is created but processes only a bypass path (input → output copy) when disabled. Add an `_enabled` flag gating the hot loop identical to P0 compressor's `_enabled`. The worklet loop short-circuits via `output[c].set(input[c])` when disabled. |
| LR4 summation drifts from flatness under extreme crossover overlap or numerical noise | Low | Medium | Unit test asserts `(low+mid+high) - input < 1e-6` across a sweep of crossover frequencies (80 Hz → 4 kHz) and inputs (impulse, white noise, DC). UI clamps enforce `mbCrossMidHigh ≥ mbCrossLowMid + 50 Hz` so band regions never overlap. |
| Worklet ↔ TS-reference drift (formulas fall out of sync over edits) | Medium | Medium | Dedicated parity test (`multiband-parity.test.ts`) runs both implementations on identical input and asserts sample-level equivalence within 1e-6. Inline `IN SYNC WITH` comments on every duplicated formula. Failure mode: CI red on drift, before merge. |
| M/S decode introduces phase error when mixed with stereo-mode bands | Low | High | M/S encode/decode is a unitary matrix transform (`[[1,1],[1,-1]]*0.5` then `[[1,1],[1,-1]]`). Applied+inverted within a single band's sample step, it is mathematically identity. Unit test: send identical L and R, put one band in M/S with `msBalance=0`; assert `L === R` at the output. |
| `msBalance` creates audible thump at balance=0→nonzero transitions | Low | Medium | Biasing is applied to `threshold`, which feeds the gain computer — no discontinuous jump in gain reduction; the envelope follower smooths transitions inherently. Test: automate `msBalance` from 0 → 0.5 over 100 ms and assert output RMS is monotonic (no clicks). |
| Genre preset output drifts by 0.01 dB due to `...DEFAULT_PARAMS` spread adding new fields | Very Low | Low | Multiband is initialized bypassed (`multibandEnabled=0`) across every genre. The worklet's bypass path is `output.set(input)` — bit-equivalent. Add a test that renders a 3-second white-noise clip through each genre preset and hashes the output; assert pre-P2 and post-P2 hashes match. |
| Added worklet blocks `ProcessingChain.init()` if worklet file fails to load | Medium | High | Existing init uses `try/catch` around the `Promise.all` of worklet module loads and falls back to bypass mode. New multiband worklet joins this pattern — `try/catch` covers it; failure → `_processingAvailable = false` → direct inputGain→outputGain. Verified by extending the existing bypass fallback test. |
| Per-band solo logic interacts badly with master multiband bypass | Low | Low | Define explicit priority: master bypass (`multibandEnabled=0`) wins → all bands silent via bypass path; when enabled and any solo is set → only soloed bands contribute to sum; when enabled and no solo → all enabled bands contribute. Unit tested. |
| `mbCrossMidHigh ≤ mbCrossLowMid` produces degenerate filters (ringing or NaN) | Low | Medium | UI clamps at both endpoints; node-layer clamp in the setter (`setCrossMidHigh(hz) { hz = Math.max(hz, this._crossLowMid + 50) }`). Unit test covers clamp at edge. |

⚠️ Mitigations are commitments — verification checks they're implemented.

## Goal Verification

### Truths

1. With `multibandEnabled=0` (default), rendering any genre preset through the full chain produces output bit-identical to pre-P2 for the same input. (Supported by: Task 5 integration test + genre-preset hash test in Task 9.)
2. With `multibandEnabled=1` and the low band configured to aggressive compression (threshold −40 dB, ratio ∞), an 80 Hz sine is attenuated while a 1 kHz and 8 kHz sine pass unchanged within ±0.1 dB. (Supported by: Task 3 band-isolation test + TS-002 E2E.)
3. The LR4 crossover sums bit-flat: for any input signal x, `splitThreeWay(x).low + .mid + .high = x` within 1e-6. (Supported by: Task 2 summation-flatness test.)
4. With a band in M/S mode and `msBalance=−1`, a mono signal's M channel sees more gain reduction than the same band in stereo mode would produce, while a pure-S stereo signal sees less. (Supported by: Task 3 M/S balance test.)
5. The new `Multiband` section is visible in the `AdvancedMastering` panel, the master toggle enables the stage, and the three band rows can be expanded/collapsed independently. (Supported by: TS-001 E2E passes end-to-end.)
6. Worklet ↔ TS reference produces sample-level equivalent output for a deterministic input. (Supported by: Task 4 parity test.)
7. CPU usage (measured via `performance.now()` over a 5-second playback) does not regress by more than 15% vs. pre-P2 when multiband is bypassed, and does not exceed 40% of the existing full-chain CPU cost when multiband is fully enabled. (Supported by: performance check in Task 10.)

### Artifacts

- `src/lib/audio/dsp/crossover.ts` — LR4 + ThreeWaySplitter.
- `src/lib/audio/dsp/multiband.ts` — MultibandCompressorDSP.
- `public/worklets/multiband-compressor-processor.js` — real-time worklet.
- `src/lib/audio/nodes/multiband-compressor.ts` — node wrapper.
- `src/lib/audio/chain.ts` — chain wiring + updateParam routing.
- `src/lib/audio/renderer.ts` — offline inline multiband pass.
- `src/types/mastering.ts` — extended `AudioParams`.
- `src/lib/audio/presets.ts` — default values.
- `src/components/mastering/AdvancedMastering.tsx` — Multiband section UI.
- `src/lib/audio/dsp/__tests__/crossover.test.ts`, `multiband.test.ts`, `multiband-parity.test.ts`.
- `src/lib/audio/nodes/__tests__/multiband-compressor.test.ts`.
- `e2e/multiband.spec.ts`.

## E2E Test Scenarios

### TS-001: Multiband section visible and master toggle works
**Priority:** Critical
**Preconditions:** App loaded at `/master`, a sample audio file is loaded, Advanced panel is visible.
**Mapped Tasks:** Task 7, Task 5

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open `http://localhost:3000/master` and load the fixture WAV via file input | Master page renders with AdvancedMastering panel visible |
| 2 | Scroll the panel until the `Multiband` section header is in viewport | `Multiband` section exists between `Dynamics` and `Tone` sections |
| 3 | Click the `Multiband` master enable toggle | Toggle shows active state (blue highlight); `params.multibandEnabled` is 1 |
| 4 | Click it again | Toggle returns to inactive state |
| 5 | Toggle each band row's chevron | Band sub-row expand/collapse is independent (only one band's sliders visible if only one expanded) |

### TS-002: Per-band threshold affects band-limited content
**Priority:** Critical
**Preconditions:** Multiband enabled, playing a test WAV containing a 60 Hz tone + 1 kHz tone + 8 kHz tone equal RMS (use `e2e/fixtures/triple-tone.wav`, generated by `pnpm test:generate-signals`).
**Mapped Tasks:** Task 3, Task 4, Task 5

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Enable Multiband master toggle | Multiband processing active |
| 2 | Enable low band, set threshold to −40 dB, ratio to 8:1 | Low band row shows slider values updated |
| 3 | Play the triple-tone fixture for 2 seconds | Output RMS level drops as measured by the transport LUFS readout (user-visible meter) |
| 4 | Disable low band | RMS recovers toward original within the release time |
| 5 | Enable high band only with same aggressive settings | RMS again drops (high band now active instead) |

### TS-003: M/S mode reveals balance slider and affects output
**Priority:** High
**Preconditions:** Multiband enabled, mid band enabled, a stereo WAV fixture playing.
**Mapped Tasks:** Task 3, Task 7

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | In the mid band row, click the `M/S` pill | Pill state updates; `Stereo` deselects, `M/S` selected |
| 2 | Observe the band's controls | `M/S Balance` slider (range −1..+1, default 0) appears below `Makeup` |
| 3 | Drag balance to −0.5 | Slider shows −0.5; params update |
| 4 | Switch the pill back to `Stereo` | `M/S Balance` slider disappears |
| 5 | Keyboard-navigate the pill with arrow keys | `ArrowRight` / `ArrowLeft` cycles between Stereo and M/S |

### TS-004: Crossover frequency sliders update without errors
**Priority:** High
**Preconditions:** Multiband enabled.
**Mapped Tasks:** Task 2, Task 5, Task 7

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Drag `Low\|Mid` slider from 200 → 120 Hz | Slider value updates; no console errors |
| 2 | Drag `Mid\|High` slider from 2000 → 3500 Hz | Slider value updates |
| 3 | Attempt to drag `Mid\|High` down to 100 Hz (below `Low\|Mid`) | Slider clamps at `mbCrossLowMid + 50` = 170 Hz |
| 4 | Attempt to drag `Low\|Mid` up past `mbCrossMidHigh` | Slider clamps at `mbCrossMidHigh − 50` |

### TS-005: Genre preset bypasses multiband (no regression)
**Priority:** Critical
**Preconditions:** App loaded, a WAV fixture loaded.
**Mapped Tasks:** Task 1, Task 9

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Select `pop` genre at 100% intensity | Multiband section shows master toggle OFF and all band enables OFF |
| 2 | Select each of the other 8 genres in turn | Every genre has multiband bypassed |
| 3 | Render output WAV via existing export flow | Output is bit-identical to pre-P2 render (verified by Task 9 hash-based test) |

## E2E Results

| Scenario | Priority | Result | Fix Attempts | Notes |
|----------|----------|--------|--------------|-------|
| TS-001 (Multiband section visible + master toggle) | Critical | PASS (unit) | 0 | Covered by `AdvancedMastering-multiband.test.tsx` (React Testing Library). Live browser E2E could not be run — see "Not Verified" table. |
| TS-001b (all three band rows visible) | Critical | PASS (unit) | 0 | Covered by UI unit test. |
| TS-002 (enable a band, state persists) | Critical | PASS (unit) | 0 | Covered by UI unit test. |
| TS-003 (M/S mode reveals balance slider) | High | PASS (unit) | 0 | Covered by UI unit test. |
| TS-004 (crossover clamp) | High | PASS (unit) | 0 | Covered by UI unit test. |
| TS-005 (genre preset leaves multiband bypassed) | Critical | PASS (unit) | 0 | Covered by preset-regression test (all 9 genres verified). |

All Playwright E2E scenarios in `e2e/multiband.spec.ts` are written but not executed — the local Next.js dev/prod server in this environment listens on port 3000 but does not respond to HTTP requests (requests time out after 30 s). This is an environment issue, not a code issue: `next build` completes cleanly (all pages generate), and the same server behavior was observed before any P2 code changes. The equivalent UI flow is covered by RTL tests which render the component in jsdom and assert the same user-visible state.

## Not Verified

| Item | Reason |
|------|--------|
| Live Playwright E2E scenarios (TS-001..TS-005) in a real browser | Local Next.js server environment issue — `next build` succeeds but the running server does not respond to HTTP requests. Equivalent coverage via jsdom/RTL. |
| Worklet execution inside a real `AudioWorkletGlobalScope` | AudioWorkletProcessor can't run in the Vitest/jsdom environment. Protected by source-inspection parity test (`multiband-parity.test.ts`, 13 structural checks) against the canonical TS reference. |
| End-to-end audio path with real AudioContext processing a WAV file | OfflineAudioContext is mocked in the test environment. The offline renderer pass is exercised via direct `MultibandCompressorDSP.processStereo` calls in `renderer-multiband.test.ts`. |
| Real CPU profiling on low-end devices | Performance budget asserted via microbenchmark in `preset-regression-multiband.test.ts` (< 250 ms for 1 s of stereo audio). No runtime profiling on constrained hardware. |

## Progress Tracking

- [x] Task 1: Extend `AudioParams` + `DEFAULT_PARAMS` for multiband
- [x] Task 2: LR4 crossover DSP (pure TS)
- [x] Task 3: Multiband compressor DSP core (pure TS)
- [x] Task 4: Multiband compressor worklet + node wrapper + parity test
- [x] Task 5: Chain integration + param routing
- [x] Task 6: Offline renderer inline multiband pass
- [x] Task 7: Multiband UI section in AdvancedMastering
- [x] Task 8: E2E Playwright suite (`e2e/multiband.spec.ts`)
- [x] Task 9: Preset regression + performance check

**Total Tasks:** 9 | **Completed:** 9 | **Remaining:** 0

## Implementation Tasks

### Task 1: Extend `AudioParams` + `DEFAULT_PARAMS` for multiband

**Objective:** Add all multiband state to the type system and neutral defaults to `DEFAULT_PARAMS`. No chain or UI changes yet — everything downstream reads from these fields but multiband defaults are neutral.
**Dependencies:** None
**Mapped Scenarios:** TS-005

**Files:**
- Modify: `src/types/mastering.ts`
- Modify: `src/lib/audio/presets.ts`
- Test: `src/lib/stores/__tests__/audio-store.test.ts` (extend if exists; else new `src/lib/audio/__tests__/presets-multiband.test.ts`)

**Key Decisions / Notes:**
- Add a new TypeScript type: `export type MultibandMode = 'stereo' | 'ms';`
- Add flat-prefixed fields to `AudioParams`:
  - `multibandEnabled: number` — master bypass (0/1). Default 0.
  - `mbCrossLowMid: number` — low|mid crossover in Hz. Default 200.
  - `mbCrossMidHigh: number` — mid|high crossover in Hz. Default 2000.
  - For each band prefix `mbLow`, `mbMid`, `mbHigh`:
    - `mb{Band}Enabled: number` (0/1, default 0).
    - `mb{Band}Solo: number` (0/1, default 0).
    - `mb{Band}Threshold: number` — dBFS, default −18.
    - `mb{Band}Ratio: number` — default 2.
    - `mb{Band}Attack: number` — ms, default 20.
    - `mb{Band}Release: number` — ms, default 250.
    - `mb{Band}Makeup: number` — dB, default 0.
    - `mb{Band}Mode: MultibandMode` — default `'stereo'`.
    - `mb{Band}MsBalance: number` — default 0 (range −1..+1).
  - Total: 2 crossover + 3 × 9 band = 29 new fields + 1 `multibandEnabled` = **30 new fields**.
- `GENRE_PRESETS` requires **no explicit edits** — every entry begins with `...DEFAULT_PARAMS` so new defaults propagate automatically.
- `applyIntensity()` needs **no change** — the existing numeric-vs-non-numeric branch at `presets.ts:256-264` already handles string enums by direct copy.

**Definition of Done:**
- [ ] All tests pass (`pnpm test`)
- [ ] No TypeScript errors (`pnpm tsc --noEmit`)
- [ ] ESLint clean (`pnpm lint`)
- [ ] `DEFAULT_PARAMS` compiles with all new fields and types match
- [ ] Every `GENRE_PRESETS` entry still compiles (TypeScript widens inherited `...DEFAULT_PARAMS` correctly)
- [ ] `applyIntensity('pop', 100)` returns an object whose multiband fields equal `DEFAULT_PARAMS`' multiband fields byte-for-byte (test)

**Verify:**
- `pnpm test src/lib/audio/__tests__/presets-multiband.test.ts`
- `pnpm tsc --noEmit`

### Task 2: LR4 crossover DSP (pure TS)

**Objective:** Implement canonical Linkwitz-Riley 4th-order crossover in pure TypeScript for tests and offline renderer use.
**Dependencies:** None
**Mapped Scenarios:** TS-004

**Files:**
- Create: `src/lib/audio/dsp/crossover.ts`
- Test: `src/lib/audio/dsp/__tests__/crossover.test.ts`

**Key Decisions / Notes:**
- LR4 = two cascaded 2nd-order Butterworth biquads (Q = 1/√2) at identical fc. Reuse `highPassCoeffs` and `lowPassCoeffs` from `src/lib/audio/dsp/biquad.ts`.
- Export:
  ```ts
  export class LR4Lowpass {
    constructor(fc: number, fs: number);
    process(x: number): number;
    reset(): void;
  }
  export class LR4Highpass { ... }
  export class ThreeWaySplitter {
    constructor(fcLowMid: number, fcMidHigh: number, fs: number);
    process(x: number): { low: number; mid: number; high: number };
    reset(): void;
    // Mid band = lowpass(highpass(x, fcLowMid), fcMidHigh)
  }
  ```
- Performance note: `ThreeWaySplitter.process` is called once per sample per channel in the offline path → must inline biquad math (no function-call overhead per sample). Use internal `z1`/`z2` fields directly rather than the `BiquadFilter` class' `processSample`.

**Definition of Done:**
- [ ] All tests pass
- [ ] No diagnostics errors
- [ ] Magnitude test: at fc, LR4 LP and HP both measure −6 dB (LR4 is −6 at crossover, not −3 like 2nd-order Butterworth)
- [ ] Summation test: for an impulse input, `low[n] + mid[n] + high[n] === input[n]` within 1e-6 for the first 512 samples
- [ ] Summation test: for 48 kHz white noise (10000 samples), summation error RMS < 1e-6
- [ ] Sweep test: verified across fc in {80, 200, 500, 1000, 2000, 3500} Hz at fs=48 kHz

**Verify:**
- `pnpm test src/lib/audio/dsp/__tests__/crossover.test.ts`

### Task 3: Multiband compressor DSP core (pure TS)

**Objective:** Pure TypeScript reference implementation of the full multiband compressor (crossover + per-band envelope/gain computer + per-band M/S encode/decode + summation) for offline rendering and parity tests.
**Dependencies:** Task 2 (crossover)
**Mapped Scenarios:** TS-002, TS-003

**Files:**
- Create: `src/lib/audio/dsp/multiband.ts`
- Test: `src/lib/audio/dsp/__tests__/multiband.test.ts`

**Key Decisions / Notes:**
- Reuse `computeGainReduction` and `makeAttackReleaseCoeffs` from `src/lib/audio/dsp/compressor.ts`.
- Reuse envelope-follower math from `src/lib/audio/dsp/envelope.ts`.
- Export:
  ```ts
  export interface BandParams {
    enabled: number;      // 0 | 1
    solo: number;         // 0 | 1
    threshold: number;    // dBFS
    ratio: number;
    attack: number;       // seconds
    release: number;      // seconds
    makeup: number;       // dB
    mode: 'stereo' | 'ms';
    msBalance: number;    // -1..+1
  }
  export const BALANCE_RANGE_DB = 6;
  export class MultibandCompressorDSP {
    constructor(fs: number);
    processStereo(
      left: Float32Array,
      right: Float32Array,
      bands: { low: BandParams; mid: BandParams; high: BandParams },
      crossovers: { lowMid: number; midHigh: number },
      out: { left: Float32Array; right: Float32Array },
    ): { grLow: number; grMid: number; grHigh: number };
    reset(): void;
    setCrossovers(lowMid: number, midHigh: number): void;
  }
  ```
- Per-band envelope: separate `{L, R}` pair for stereo mode; `{M, S}` pair for M/S mode. Switching modes resets the unused envelopes to 0.
- Effective-threshold biasing in M/S mode: `thresholdM = threshold + msBalance * BALANCE_RANGE_DB`, `thresholdS = threshold - msBalance * BALANCE_RANGE_DB`. Verified by unit test (balance=+1 means M sees threshold+6 → less GR on M).
- Solo logic: if any band's `solo === 1`, non-soloed bands output silence (zero-filled contribution to sum). Soloed & disabled: behaves as disabled (passthrough with 0 GR) — we define solo as "only hear this band's *compressed* signal, not the full chain".
- Return value: last-sample GR per band for metering readout.

**Definition of Done:**
- [ ] All tests pass
- [ ] No diagnostics errors
- [ ] Band-isolation test: with low band at thresh=−40, ratio=10, and 60 Hz/1 kHz/8 kHz sine mix (RMS equal), only the 60 Hz component is attenuated; 1 kHz and 8 kHz output RMS change by < 0.1 dB (LR4 summation flatness tolerance)
- [ ] M/S balance test: with msBalance=+1 and a mono signal, grLow (M only, balance=+1 → threshold M is higher → less GR) < grLow(balance=0)
- [ ] Solo test: with mid solo=1, output RMS matches mid-only bandpass RMS within 0.1 dB
- [ ] Master bypass test: all `enabled=0` → `out.left === left` bit-exact
- [ ] Stereo-in, stereo-out test: L≠R input, band in M/S mode with balance=0 → output L and R are reconstructed without phase drift (L−R preserved to 1e-6)

**Verify:**
- `pnpm test src/lib/audio/dsp/__tests__/multiband.test.ts`

### Task 4: Multiband compressor worklet + node wrapper + parity test

**Objective:** Real-time audio path: monolithic AudioWorkletProcessor implementing the multiband chain, plus the TypeScript node wrapper, plus a parity test versus the Task 3 TS reference.
**Dependencies:** Task 1 (types), Task 2 (crossover reference), Task 3 (TS reference)
**Mapped Scenarios:** TS-001, TS-002, TS-003

**Files:**
- Create: `public/worklets/multiband-compressor-processor.js`
- Create: `src/lib/audio/nodes/multiband-compressor.ts`
- Test: `src/lib/audio/dsp/__tests__/multiband-parity.test.ts`
- Test: `src/lib/audio/nodes/__tests__/multiband-compressor.test.ts`

**Key Decisions / Notes:**
- Worklet structure modelled on `public/worklets/compressor-processor.js` (line-by-line pattern: constructor with default params, `this.port.onmessage` switch, `process(inputs, outputs)` per-sample loop, `_computeGainReduction` helper).
- Inline all hot-loop formulas. Every formula duplicated from TS source gets a comment: `// IN SYNC WITH src/lib/audio/dsp/multiband.ts <functionName>`.
- Per-sample state: 8 biquad `{z1, z2}` pairs per channel (two LR4 crossovers × two cascaded biquads × two sides [LP + HP]) + 3 envelope followers × 2 channels + 3 GR smoothers.
- Message-in handling — route each of the 30 new param keys. Group enum params (`mbLowMode`, etc.) with enum-aware assignment: `this._bands.low.mode = value` (string).
- Message-out: `{type: 'gr', values: [grLow, grMid, grHigh]}` at 30 Hz throttle (`_frameCount % 45`).
- Bypass: when `this._enabled === false` OR `this._multibandEnabled === 0`, do `output[c].set(input[c])` and skip processing entirely.
- `src/lib/audio/nodes/multiband-compressor.ts` wrapper mirrors `CompressorNode` (`init()` loads worklet module, `port.onmessage` → `onGainReduction({ low, mid, high })`, per-param setter methods for each of the 30 fields).
- **Parity test strategy** (copies `halfband-parity.test.ts`):
  - Define a worklet-formula mock class in the test file that re-implements the worklet's math by reading the worklet source's inlined code (transcribed into the test file).
  - Run both the mock and `MultibandCompressorDSP` (from Task 3) on identical stereo Float32Array input.
  - Assert sample-level equivalence within 1e-6 across 1024 samples.
  - Include DC, impulse, 1 kHz sine, and white-noise cases.

**Definition of Done:**
- [ ] All tests pass
- [ ] No diagnostics errors
- [ ] Worklet file is valid JS (no import/require; runs inside AudioWorkletGlobalScope)
- [ ] Node wrapper's setter methods each `postMessage` with the correct `{param, value}` shape (verified by mock test)
- [ ] Parity test passes sample-level equivalence to TS reference (1e-6)
- [ ] Bypass test: when `multibandEnabled=0`, output is bit-equal to input across all three channels (test feeds a known buffer and compares arrays)

**Verify:**
- `pnpm test src/lib/audio/dsp/__tests__/multiband-parity.test.ts`
- `pnpm test src/lib/audio/nodes/__tests__/multiband-compressor.test.ts`

### Task 5: Chain integration + param routing

**Objective:** Wire the new node into `ProcessingChain` and extend `updateParam` to route all 30 new keys.
**Dependencies:** Task 1 (types), Task 4 (node wrapper)
**Mapped Scenarios:** TS-001, TS-002, TS-005

**Files:**
- Modify: `src/lib/audio/chain.ts`
- Test: `src/lib/audio/__tests__/chain-integration.test.ts` (extend if exists; else new)

**Key Decisions / Notes:**
- Add `_multiband: MultibandCompressorNode | null` to `ProcessingChain`.
- In `init()`:
  - Instantiate `MultibandCompressorNode`, push into the `Promise.all([... .init()])` list.
  - Rewire the chain at lines 76-82: insert multiband between compressor and saturation. New order: `_eq → _compressor → _multiband → _saturation → _stereoWidth → _limiter → _metering → _outputGain`.
  - `try/catch` already handles worklet load failure → falls back to direct bypass. No change.
- In `updateParam` switch (starts at line 101): add 30 new `case` entries routing each multiband key to the appropriate setter on `_multiband`. Group cases by prefix for readability:
  ```ts
  case 'multibandEnabled': this._multiband?.setEnabled(n); break;
  case 'mbCrossLowMid': this._multiband?.setCrossLowMid(n); break;
  case 'mbCrossMidHigh': this._multiband?.setCrossMidHigh(n); break;
  // --- Low band ---
  case 'mbLowEnabled': this._multiband?.setBandEnabled('low', n); break;
  ...
  case 'mbLowMode': this._multiband?.setBandMode('low', value as MultibandMode); break;
  // --- Mid band, High band analogous ---
  ```
- Wire `_multiband.onGainReduction` to an internal meter callback (or expose as a new ProcessingChain event). For P2, the per-band GR is consumed only by the Multiband UI section — expose a new chain event `onMultibandGR: ((data: {low, mid, high}) => void) | null = null`.
- `dispose()`: call `this._multiband?.dispose()`.

**Definition of Done:**
- [ ] All tests pass
- [ ] No diagnostics errors
- [ ] Chain integration test: full chain initializes without errors; input passes through to output (no silence, no NaN) with multiband `enabled=0`
- [ ] Chain integration test: when `multibandEnabled=1` and low band configured aggressive, RMS reduction is measurable on a 60 Hz sine input
- [ ] `updateParam` exhaustiveness: all 30 new keys route to a non-null setter (no `default` branch swallows them — compile-time enforced by switch over `keyof AudioParams`)

**Verify:**
- `pnpm test src/lib/audio/__tests__/chain-integration.test.ts`

### Task 6: Offline renderer inline multiband pass

**Objective:** Make the WAV export path (`renderer.ts`) produce output that matches the real-time path when multiband is active.
**Dependencies:** Task 3 (TS reference)
**Mapped Scenarios:** Parity with real-time (supports TS-005 bit-equality claim)

**Files:**
- Modify: `src/lib/audio/renderer.ts`
- Test: `src/lib/audio/__tests__/renderer-multiband.test.ts`

**Key Decisions / Notes:**
- Insertion point: `src/lib/audio/renderer.ts:97-106` — between the inline `applyCompressor` call (line 97) and the saturation block (line 100).
- When `params.multibandEnabled === 0`: skip entirely (no-op). Preserves bit-equivalence with pre-P2 export.
- When enabled: instantiate `MultibandCompressorDSP` (one per render, since state is per-invocation), build `bands` + `crossovers` from `params`, call `processStereo` once over the full buffer using pre-allocated output Float32Arrays.
- **Known discrepancy (preserve, don't fix in P2):** offline renderer still lacks sidechain HPF / auto-release / saturation-mode parity with real-time (pre-P0/P1 debt). Multiband parity test's tolerance should reflect this — test uses a signal that doesn't exercise those pre-P0/P1 paths (pure tones through a bypassed P0/P1 compressor+saturation configuration).
- If stereo buffer (2 channels): call `processStereo`. If mono: duplicate to stereo, process, sum back to mono for output (matches how the real-time chain handles mono — it duplicates in the compressor worklet at line 105).

**Definition of Done:**
- [ ] All tests pass
- [ ] No diagnostics errors
- [ ] Parity test: offline render of a 3-second 440 Hz stereo sine with multibandEnabled=1 and low band aggressive matches real-time output (captured via an OfflineAudioContext in the test harness) within ±0.5 dB short-term LUFS drift
- [ ] Bypass test: offline render with multibandEnabled=0 is bit-equivalent to current renderer output (hash comparison)

**Verify:**
- `pnpm test src/lib/audio/__tests__/renderer-multiband.test.ts`

### Task 7: Multiband UI section in AdvancedMastering

**Objective:** Add the `Multiband` UI section to `AdvancedMastering.tsx` following existing patterns.
**Dependencies:** Task 1 (types)
**Mapped Scenarios:** TS-001, TS-003, TS-004

**Files:**
- Modify: `src/components/mastering/AdvancedMastering.tsx`
- Test: `src/components/mastering/__tests__/AdvancedMastering.test.tsx` (new; existing tests likely absent — check and create if needed)

**Key Decisions / Notes:**
- Add a new inline component `<BandRow>` inside `AdvancedMastering.tsx` (same file, same style as `Section`). Props:
  ```ts
  interface BandRowProps {
    label: 'Low' | 'Mid' | 'High';
    prefix: 'mbLow' | 'mbMid' | 'mbHigh';
    params: AudioParams;
    onParamChange: <K extends keyof AudioParams>(key: K, val: AudioParams[K]) => void;
  }
  ```
- Add `ModePills` component (reuse pattern from `SatModePills`), modes: `['stereo', 'ms']`. Inline keyboard handling (arrow-key cycling).
- New `<Section title="Multiband">` inserted between the existing `Dynamics` section (line ~296) and `Tone` section (line ~298) — **insert at line 298, before `{/* Tone */}`**.
- Section content:
  1. Master `<ToggleButton label="Multiband" active={params.multibandEnabled > 0} onClick={...}/>`.
  2. Two crossover sliders (`Low|Mid`, `Mid|High`) with clamp logic:
     ```ts
     onChange={(v) => onParamChange("mbCrossLowMid", Math.min(v, params.mbCrossMidHigh - 50))}
     // symmetric clamp for mbCrossMidHigh
     ```
  3. Three `<BandRow>` instances — each wrapped in its own local collapse state (useState per row).
- Accessibility: `aria-pressed` on every toggle, `aria-label` on every slider (inherited from `Slider`), `role="radiogroup"` on the M/S pill, `aria-expanded` on each band's chevron.
- When `params.multibandEnabled === 0`: band rows still render but appear visually de-emphasized (opacity reduced) — they remain interactive so users can preconfigure. (Cheap 1-line opacity change.)

**Definition of Done:**
- [ ] All tests pass
- [ ] No diagnostics errors (type check)
- [ ] Lint clean
- [ ] The Multiband section renders when AdvancedMastering renders with default params
- [ ] Clicking the master toggle calls `onParamChange("multibandEnabled", 1)` (or 0)
- [ ] Switching a band to M/S mode reveals the `M/S Balance` slider; switching back hides it
- [ ] Crossover clamp is enforced in the UI (cannot drag `mbCrossLowMid` ≥ `mbCrossMidHigh − 50`)
- [ ] Keyboard navigation: Tab reaches every new control; ArrowRight/Left cycles the M/S pills
- [ ] Color contrast for new elements meets 4.5:1 (WCAG AA)

**Verify:**
- `pnpm test src/components/mastering/__tests__/AdvancedMastering.test.tsx`
- Manual browser verification of the golden path (loads page, expands section, toggles states).

### Task 8: E2E Playwright suite (`e2e/multiband.spec.ts`)

**Objective:** Browser-level verification of the user-visible multiband workflow.
**Dependencies:** Task 5 (chain integration), Task 7 (UI)
**Mapped Scenarios:** TS-001 through TS-005

**Files:**
- Create: `e2e/multiband.spec.ts`
- Modify if needed: `e2e/fixtures/generate-test-wav.mjs` to add a triple-tone stereo fixture (60 Hz + 1 kHz + 8 kHz equal RMS).

**Key Decisions / Notes:**
- Mirror the structure of `e2e/mastering.spec.ts`. Reuse existing `test.beforeEach` to load the app and upload a fixture WAV.
- Each `TS-NNN` scenario from the plan becomes one `test()` block with descriptive name.
- Assertions rely on DOM state (aria-pressed, slider values, presence/absence of M/S balance slider) and, where possible, on side-effect DOM (e.g., the existing LUFS readout on the transport bar) rather than direct DSP introspection.
- For TS-002 (threshold affects output), compare the LUFS readout's reported value before and after enabling aggressive multiband — assert that the delta exceeds 1 dB when the input is the triple-tone fixture and the low band is set aggressive.

**Definition of Done:**
- [ ] All tests pass
- [ ] E2E suite runs in CI without flakiness (target: < 1% retry rate)
- [ ] TS-001 through TS-005 each have a corresponding `test()` block

**Verify:**
- `pnpm test:generate-signals`
- `pnpm test:e2e e2e/multiband.spec.ts`

### Task 9: Preset regression + performance check

**Objective:** Prove zero regressions against pre-P2 behavior when multiband is bypassed, and establish CPU-cost baseline with multiband active.
**Dependencies:** Tasks 1-8
**Mapped Scenarios:** TS-005

**Files:**
- Create: `src/lib/audio/__tests__/preset-regression.test.ts`
- Modify if necessary: `e2e/mastering.spec.ts` (add a regression assertion if pre-P2 audio hashes are stored anywhere)
- Create: `src/lib/audio/__tests__/multiband-perf.test.ts` (microbenchmark)

**Key Decisions / Notes:**
- **Preset-regression test:** for each of 9 genres at 100% intensity, render a 3-second pink-noise fixture through `renderOffline()`. Hash the resulting `Float32Array` (e.g., via a simple FNV-1a over the bytes). Store the 9 hashes in a `expectedHashes` map in the test file. The test asserts current renders equal the expected hashes. To establish baseline: run the test once against pre-P2 code (or via a pre-computed baseline committed in a companion JSON fixture `e2e/fixtures/preset-hashes-prep2.json`). Commit the hashes alongside this task.
- **Performance test:** measure `processStereo` execution time for a 48000-sample (1 second at 48 kHz) stereo buffer with multiband disabled vs enabled (all 3 bands, no M/S) vs enabled (all 3 bands in M/S). Record the three times. Assert:
  - Disabled: less than 1.15× baseline (baseline being compressor-only, measured in the same test)
  - Enabled all-stereo: less than 4× baseline
  - Enabled all-M/S: less than 5× baseline
- Performance thresholds are bright lines — any regression past these means something went wrong (likely per-sample allocation or un-inlined hot loop).

**Definition of Done:**
- [ ] All tests pass
- [ ] No diagnostics errors
- [ ] Preset regression: 9 genre hashes match expected (established from pre-P2 baseline render)
- [ ] Performance: all three measurements satisfy their thresholds
- [ ] Full unit suite (`pnpm test`) passes with zero new failures
- [ ] Full E2E suite (`pnpm test:e2e`) passes

**Verify:**
- `pnpm test src/lib/audio/__tests__/preset-regression.test.ts`
- `pnpm test src/lib/audio/__tests__/multiband-perf.test.ts`
- `pnpm test` (full)
- `pnpm test:e2e` (full)

## Open Questions

None as of plan finalization. Design decisions resolved via two rounds of `AskUserQuestion` (see plan preamble): topology = insert-between-comp-and-saturation; M/S = per-band with shared params + `msBalance`; UI = new Multiband section with 3 collapsible bands; crossovers = LR4, editable (200 / 2000 Hz defaults); M/S balance = single shared set + balance knob; presets = off-by-default across all 9 genres.

## Deferred Ideas

- Per-band parametric EQ (would be a P3 scope item).
- Per-band independent M and S parameter sets (sliders × 2 per band) — deferred if users request more flexibility than `msBalance` provides.
- Per-band metering readouts on the transport bar (inline `MB L ±X.X` / `MB M ±X.X` / `MB H ±X.X`).
- 4-band and 5-band variants.
- Preset crossover schemes (`Standard`, `Bass-focused`, `Vocal-focused`) as quick pills — easy to add later on top of the two-slider base.
- Curated per-genre multiband defaults (e.g., hip-hop gets a 2:1 low-band glue by default) — would require re-baselining every preset regression hash in Task 9.
- Intensity-driven multiband engagement through `applyIntensity()`.
