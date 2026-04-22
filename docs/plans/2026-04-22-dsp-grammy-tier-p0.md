# Grammy-Tier DSP P0 Upgrade Implementation Plan

Created: 2026-04-22
Author: yegamble@gmail.com
Status: PENDING
Approved: Yes
Iterations: 0
Worktree: No
Type: Feature

## Summary

**Goal:** Three foundational mastering-chain quality fixes that bring the audio output from "digital amateur" to "pro mastering" standard: sidechain HPF on the compressor detector, ITU-R BS.1770 true-peak (inter-sample peak) detection in the limiter and metering, and proper polyphase-FIR oversampling in the saturation stage.

**Architecture:** A single shared DSP module (`oversampling.ts`) provides a 23-tap halfband polyphase FIR upsampler/downsampler used by both the limiter's true-peak detector and the saturation processor. A new `sidechain-filter.ts` module provides the Butterworth HPF math used by the compressor's detector. Worklets remain JS (no import) but duplicate the canonical coefficient arrays with cross-reference comments; unit tests verify parity.

**Tech Stack:** TypeScript, AudioWorkletProcessor (JS), Vitest (unit), Playwright (E2E), React/Zustand for state.

## Scope

### In Scope

1. **Sidechain HPF on compressor detector** — 2nd-order Butterworth HPF applied to `(L+R)/2` before gain computation. User-adjustable 20–300 Hz, default 100 Hz. New `sidechainHpfHz` field on `AudioParams`. Per-genre default values in presets. Advanced-mode UI slider.
2. **True-peak limiter (ITU-R BS.1770-4)** — Replace sample-peak detection with 4x polyphase-oversampled ISP detection inside `limiter-processor.js`. Signal path gets sample-rate-derived delay plus group-delay compensation (18 samples at 1x for a cascaded 4x halfband; see `HALFBAND_4X_GROUP_DELAY_1X`). Limiter now actually enforces the `ceiling` as a true-peak value. Lookahead is re-derived from `sampleRate` (1.5 ms equivalent) so 48 kHz and 96 kHz contexts get correct timing instead of 44.1-kHz-only behavior.
3. **True-peak metering fix** — `metering-processor.js` currently claims true-peak but measures sample-peak. Replace with the same 4x oversampled detector so the `truePeak` field on `MeteringData` is correct. The existing UI readouts (`LevelMeter.tsx`, `master/page.tsx`) need no change — only the worklet computation. **Note:** `truePeak` values will rise by 0–2 dB on most content after this fix (previously under-reported). `dynamicRange` (derived from `truePeak - LUFS`) will shift correspondingly. Document in release notes.
4. **Saturation anti-aliasing fix** — Replace the broken linear-interp + 1st-order IIR LP in `saturation-processor.js` with a proper halfband polyphase FIR 4x oversampler. Remove the `_lpState` and unused `mix` param. Preserve HF to ≥18 kHz at 44.1k.

### Out of Scope

- Multiband compression (P2 plan)
- Mid/Side processing stage (P2 plan)
- Asymmetric saturation modes / tube/tape/transformer characters (P1 plan)
- Program-dependent auto-release on compressor (P1 plan)
- LRA meter, correlation meter, vector scope (P1 plan)
- Parametric EQ with sweepable frequencies and Q controls (P3 plan)
- Changes to `DEFAULT_PARAMS` values other than adding `sidechainHpfHz`
- Changes to A/B bypass, export renderer, or any non-mastering subsystem

## Approach

**Chosen:** Shared `oversampling.ts` foundation + inline FIR coefficients in each worklet with cross-reference comments.

**Why:** AudioWorklets cannot import TypeScript modules, but the canonical 23-tap halfband coefficients and the upsample/downsample algorithms are identical across the limiter, metering, and saturation worklets. Putting the canonical source in one TS module (with full tests and reference implementation) and duplicating the tap array in each worklet gives us: (a) a single source of truth we can unit-test, (b) no worklet loading overhead, (c) freedom to specialize per-worklet processing logic. The cost: we must keep the inline worklet arrays in sync with the canonical source — mitigated by a unit test that reads both and asserts equality.

**Alternatives considered:**
- **Load coefficients via `postMessage` at init.** Rejected: adds async init complexity to every worklet, and the coefficients are static — no reason to marshal them at runtime.
- **Use WASM for the oversampling inside worklets.** Rejected: huge build-system addition for marginal performance gain; pure JS halfband FIR at 44.1k × 4x costs ~2% CPU per worklet on a 2020-era laptop.
- **Share a single `oversampler.js` worklet.** Rejected: adds an extra node in the audio graph (more routing complexity) and doesn't fit the per-worklet specialization needs (saturation upsamples-processes-downsamples, limiter only upsamples for detection).

## Context for Implementer

> Write for an implementer who has never seen the codebase.

**Patterns to follow:**
- **Worklet ↔ node wrapper ↔ DSP pattern:** see `src/lib/audio/nodes/compressor.ts:20-60` for how a TS `AudioWorkletNode` wrapper is paired with a JS worklet (`public/worklets/compressor-processor.js:1-60`). Parameters are sent via `port.postMessage({ param, value })`. Metering/GR data flows back via `onmessage`.
- **DSP math separation:** pure functions live in `src/lib/audio/dsp/*.ts` (see `compressor.ts`, `limiter.ts`, `lufs.ts`) so they can be tested offline. Worklets duplicate the hot-loop logic in JS since they can't import TS — see `compressor-processor.js:85-105` for the inlined knee logic that mirrors `dsp/compressor.ts:18-45`.
- **Parameter routing:** all `AudioParams` changes flow `store → ParameterBridge → AudioEngine.updateParameter → ProcessingChain.updateParam → node.setX`. See `src/lib/audio/parameter-bridge.ts` and `src/lib/audio/chain.ts` (updateParam method). Adding a new param means: (1) add to `AudioParams` in `src/types/mastering.ts`, (2) add to `DEFAULT_PARAMS` in `src/lib/audio/presets.ts`, (3) add setter on the node class, (4) add case to `ProcessingChain.updateParam`.
- **Test convention:** DSP tests in `src/lib/audio/dsp/__tests__/*.test.ts` (offline, pure math). Node tests in `src/lib/audio/nodes/__tests__/*.test.ts` (mock AudioContext, verify `postMessage` calls — see `compressor.test.ts`). E2E in `e2e/*.spec.ts` (see `mastering.spec.ts`).

**Conventions:**
- File naming: kebab-case for DSP modules, camelCase for node classes, PascalCase for React components.
- DSP modules export pure functions first, then classes that hold state. See `biquad.ts` for the pattern.
- Worklets: class name matches `registerProcessor` string, params via `port.onmessage`, metering/GR data via `port.postMessage({ type: "...", ... })`.

**Key files:**
- `src/types/mastering.ts` — `AudioParams` interface. Source of truth for parameter shape.
- `src/lib/audio/presets.ts` — `DEFAULT_PARAMS` and `GENRE_PRESETS`. Genre preset defaults.
- `src/lib/audio/chain.ts` — `ProcessingChain` class, `updateParam` method routes param changes to the right node.
- `src/lib/audio/nodes/compressor.ts`, `limiter.ts`, `saturation.ts`, `metering.ts` — node wrappers.
- `public/worklets/*.js` — four worklets (compressor, limiter, saturation, metering). Each is independently loaded.
- `src/components/mastering/AdvancedMastering.tsx` — Advanced-mode UI with all parametric sliders in collapsible sections.
- `src/lib/audio/dsp/biquad.ts` — existing Butterworth HPF coefficient generator (`highPassCoeffs`) — reuse for sidechain filter.

**Gotchas:**
- Worklets run in an `AudioWorkletGlobalScope` — no `window`, no imports, no TypeScript. You can use `globalThis`, `sampleRate` (global), `Math`, `Float32Array`, `Float64Array`.
- `sampleRate` inside a worklet is a **global variable**, not `this.sampleRate` — see any existing worklet.
- When modifying a worklet, the `AudioContext` must be recreated for changes to take effect — in dev, a hard refresh (Cmd+Shift+R) is required because the browser caches `.js` files.
- React StrictMode mounts/unmounts twice in dev — `engine.init()` and `dispose()` race (see `engine.ts` `_disposed` guard). Any new async init path in worklets must respect this pattern.
- `AudioParams` is used by **two stores**: `audio-store.ts` (mastering) and `mixer-store.ts` (stem mixer master params). Both import from `@/types/mastering`. Adding a field affects both — verify mixer-store doesn't need special-case handling (current evidence: it spreads `DEFAULT_PARAMS` as-is, so adding a field Just Works).
- The `metering-processor.js` `truePeak` field flows into `MeteringData.truePeak` which is displayed in two places (`master/page.tsx:328` and `LevelMeter.tsx:71`). No UI change needed — the value just starts being correct. Expect readouts to rise 0–2 dB on most real-world content; the `dynamicRange` field (derived from TP minus LUFS) shifts correspondingly.
- **Mono input handling:** worklets must not assume stereo. `input.length === 1` when source is mono. The existing worklets handle this by using `input[0]` for both channels via `numChannels = Math.min(input.length, output.length)` — new detector code must do the same and never compute `(L + R) / 2` without a mono guard (otherwise `undefined * 0.5 = NaN` poisons the detector state forever).
- **Sample rate varies.** Browsers default to 48 kHz on most hardware; some pros use 96 kHz. Hardcoding sample-counts assuming 44.1 kHz is a bug. All lookahead/delay/timing values must be derived from the `sampleRate` global at worklet construction.
- Halfband FIR coefficients are typically odd-length (even = 0 mid-tap for halfbands except the center). Our 23-tap symmetric halfband has 12 zero coefficients and 11 nonzero at even indices + 1 at center — this is the standard structure and dramatically reduces the MAC count (only ~7 multiplies per output sample).

**Domain context:**
- **Sidechain HPF:** in a stereo bus compressor, bass energy dominates the detector because low frequencies carry more power. A kick drum on every downbeat causes the compressor to reduce gain on the whole mix, even though only the kick needs dynamic control. Every pro bus compressor — SSL G-Series, API 2500, Fabfilter Pro-MB, Waves SSL Comp — has a sidechain HPF at 60–150 Hz to fix this. Without it, masters "breathe" and "pump" on bass-heavy content.
- **True peak (ISP):** digital audio at 44.1 kHz is reconstructed by the DAC into a continuous waveform. Between two sample points the waveform can rise above the higher sample value — these are **inter-sample peaks**. A signal whose sample peaks are all ≤ 0.99 can still clip a consumer DAC during playback if its true waveform peak is 1.02. ITU-R BS.1770-4 Annex 2 specifies measuring this by 4x oversampling the signal (reconstructing the bandlimited waveform at 176.4 kHz) and taking the max of the oversampled envelope. Streaming platforms enforce true-peak limits (Spotify −1 dBTP, Apple Music −1 dBTP). A mastering limiter that only watches sample peaks produces files that fail platform QC.
- **Saturation oversampling:** `tanh(k*x)` is a nonlinear function. Applied to a sampled signal, it generates harmonics at frequencies higher than the input bandwidth. At 44.1 kHz sample rate, anything above 22 kHz folds back (aliases) into the audible range. A 15 kHz input under heavy saturation generates harmonics at 30, 45, 60 kHz — after aliasing these land at ~12, ~3, and ~18 kHz as distortion. Oversampling by 4x before the nonlinearity moves the Nyquist to 88.2 kHz; the generated harmonics mostly stay above 22 kHz where the decimation filter removes them. The current implementation uses linear interpolation (aliases) + a first-order IIR low-pass at sr/4 (a **6 dB/oct** roll-off that destroys the 10–20 kHz band). Proper polyphase halfband filters have a sharp stopband (~80 dB rejection) at the edge and preserve the passband flat to ≥95% of Nyquist.

## Autonomous Decisions

(none — all gray areas resolved via Batch 1 and Batch 2 questions)

## Assumptions

- **Worklet caching is acceptable in production** — supported by the existing codebase pattern where worklets are served as static files from `/public/worklets/`. Tasks 3–6 depend on this.
- **`AudioParams` type is the single source of truth for all bus params** — supported by `src/lib/stores/audio-store.ts:31` using `keyof AudioParams` for `setParam`, and `src/lib/audio/parameter-bridge.ts:28` iterating with `Object.keys(params) as (keyof AudioParams)[]`. Tasks 2–6 depend on this.
- **`mixer-store.ts` spreads `DEFAULT_PARAMS` and doesn't special-case individual fields** — supported by grep showing `masterParams: AudioParams` and no field-by-field copy. Task 2 depends on this (new fields will propagate automatically).
- **Unit tests for DSP can run in Node without an AudioContext** — supported by existing `src/lib/audio/__tests__/*.test.ts` and `src/lib/audio/dsp/*.ts` being pure-TS. Tasks 1, 3 depend on this.
- **Playwright E2E setup is stable** — supported by existing `e2e/mastering.spec.ts` which already tests advanced-mode sliders by `getByRole("slider", { name })`. Task 7 depends on this.
- **The existing 66-sample lookahead in the limiter is a minimum, not a maximum** — supported by `limiter-processor.js:14` defining it as a constant with no cross-module contract. Task 4 derives it from `sampleRate` (1.5 ms baseline) and adds the FIR group-delay compensation (18 samples at 1x for cascaded 4x halfband with 47-tap filter; see `HALFBAND_4X_GROUP_DELAY_1X`) on top. At 44.1 kHz this yields ~84 samples (66 + 18); at 48 kHz ~90; at 96 kHz ~162. The filter length was upgraded from 23 to 47 taps during Task 1 because a 23-tap halfband could not preserve 18 kHz at 44.1 kHz within the plan's 1 dB tolerance (measured −2.26 dB); 47-tap Kaiser β=8.0 delivers −0.08 dB at 18 kHz with ~101 dB stopband, well within Grammy-grade spec.

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Worklet inline FIR coefficients drift from canonical `oversampling.ts` source | Medium | Medium | Task 4 (sole owner) writes `halfband-parity.test.ts`. Tests 5 & 6 extend it (append worklet file to the list being checked). The parity test: (a) reads each worklet file via `path.resolve(__dirname, '../../../../public/worklets/<name>.js')` to survive Vitest cwd changes, (b) regex-extracts the array block, (c) asserts the extracted float count equals `HALFBAND_TAPS.length` exactly (fails loudly if zero matches or wrong count), (d) a negative-control test in the same file copies a worklet to tmp, corrupts one coefficient, and asserts the parity check fails. |
| True-peak detector adds group delay that desynchronizes limiter with audio (pre-reduction smear) | Medium | High | Task 4 adds +18 samples (at 1x rate) to compensate cascaded 4x halfband group delay (11.5 + 5.75 = 17.25, ceiling to 18) for the 47-tap filter. At 44.1 kHz total lookahead becomes 84 samples; sample-rate-scaled at 48/96 kHz. Test verifies empirically by pushing an impulse through the true-peak processor, measuring output-peak sample index, and asserting it equals `signal_delay_samples` within ±1. |
| Saturation rewrite subtly changes perceived sound, user complaint about "it was better before" | Medium | Medium | Documented as intentional in this plan header. The new impl is technically superior (pro spec) and the old was a bug. If users miss the old rolloff they can use the existing 12k EQ band to restore it. |
| Coefficient array length in worklet mismatch causes buffer reads past end | Low | High | Task 1 uses a fixed `HALFBAND_TAPS` constant shared via comments. Worklet code uses `.length` directly rather than hardcoded indices. Tests include boundary-condition runs. |
| FIR group delay makes the limiter's lookahead insufficient for worst-case ISP timing | Low | Medium | Task 4 test includes a "worst case" ISP placed exactly at the FIR boundary; verifies gain reduction is applied before the corresponding audio sample. Also verified at 44.1, 48, and 96 kHz contexts (each parameterized). |
| Adding `sidechainHpfHz` to AudioParams breaks existing serialized user sessions | Low | Low | `DEFAULT_PARAMS` spread ensures missing fields get the default. No session storage format changes required. |
| Per-genre HPF preset change alters existing "A/B reference" results users may have memorized | Low | Low | Documented in release notes. Users can set HPF to 20 Hz on any preset to effectively disable it. |
| Metering worklet TP detector uses more CPU, causes dropouts on low-end devices | Low | Medium | Halfband 4x FIR with 7 nonzero taps is ~7 mul/sample × 2 channels × 44100 Hz = 617k ops/sec, ~0.5% of a modern CPU. Task 6 DoD includes a perf sanity check running at 44.1k on a 60s buffer and asserting processing time < 500 ms (codifies the claim as a test). |
| Mono source produces `NaN` in detector via `(L + undefined) * 0.5` and corrupts state forever | Low | High | All new detector code (Task 3 compressor, Task 4 limiter, Task 6 metering) must branch on `input.length === 1` and use mono input for both channels. DoD includes explicit "mono input produces finite output" test for each. |
| Hardcoded 44.1 kHz assumptions break on 48 kHz (browser default) or 96 kHz sessions | Medium | High | Tasks 4 & 6 re-derive all timing constants (`_lookaheadSize`, ring buffer sizes, delay compensation) from the `sampleRate` global. Tests run the oversampler round-trip and limiter ISP detection at 44100, 48000, and 96000 Hz. Plan DoD for Task 1 adds a sample-rate-agnostic round-trip test. |
| `dynamicRange` UI readout shifts when `truePeak` accuracy improves, confusing users who had memorized values | Low | Low | Documented in release notes. The shift is toward *correctness* — users were seeing under-reported TP. Add a one-line hint on the meter tooltip: "True-peak per ITU-R BS.1770-4 (4× oversampled)". |
| `setMix` removal leaves dangling test callsites or unused param routing | Low | Medium | Task 5 DoD explicitly greps for `setMix`, `"mix"` (worklet param), and removes all references. A post-task grep check (`rg -q 'setMix\|param: "mix"' src public e2e` returns no matches) is a DoD item. |

## Goal Verification

### Truths

1. **Compressor no longer pumps on bass.** A bass-heavy test signal (60 Hz sine at -6 dBFS + 1 kHz sine at -20 dBFS) fed through the compressor with `sidechainHpfHz=100` produces a gain-reduction envelope whose variance is at least 10× smaller than with `sidechainHpfHz=20`. Verified by `sidechain-filter.test.ts` and `compressor-sidechain-integration.test.ts`.
2. **Limiter catches inter-sample peaks that sample-peak misses.** A synthetic signal engineered to have sample peaks ≤ 0.95 but true peak ≥ 1.05 (3-sample interpolated overshoot) processed through the limiter with `ceiling=-1 dBTP` produces output whose true-peak (measured externally via 16x oversampling) is within 0.1 dB of −1 dBTP. The same input through the old limiter exceeds −1 dBTP by ≥ 0.5 dB. Verified by `true-peak.test.ts` and `limiter-truepeak.test.ts`.
3. **Saturation preserves air and reduces aliasing.** A 15 kHz sine at -6 dBFS through the saturation processor at drive=100% produces: (a) output magnitude at 15 kHz within 0.5 dB of input, (b) summed magnitude in the 0–10 kHz range (aliasing products) at least **40 dB lower** than the old implementation. Verified by `saturation-alias.test.ts`.
4. **Metering true-peak is correct.** The metering worklet's `truePeak` field on a signal with known ISP of −2.3 dBTP reports within 0.1 dB of that value. Verified by `metering-truepeak.test.ts`.
5. **Presets default HPF is 100 Hz globally and per-genre values are applied correctly.** `DEFAULT_PARAMS.sidechainHpfHz === 100`; `GENRE_PRESETS.hiphop.sidechainHpfHz === 80`; `GENRE_PRESETS.jazz.sidechainHpfHz === 60`; `GENRE_PRESETS.classical.sidechainHpfHz === 60`; `GENRE_PRESETS.podcast.sidechainHpfHz === 120`; etc. Verified by `presets.test.ts`.
6. **Worklets are sample-rate agnostic.** The oversampler round-trip, true-peak detector, and limiter lookahead produce correct results at 44100, 48000, and 96000 Hz. Specifically: (a) oversampling round-trip at each rate preserves 1 kHz amplitude within 0.1 dB, (b) limiter enforces `ceiling` within 0.3 dB on the ISP-hot test signal at each rate. Verified by parameterized tests in `oversampling.test.ts`, `limiter-truepeak.test.ts`.
7. **Mono input is handled safely.** A single-channel input buffer fed to the compressor, limiter, saturation, and metering worklets produces finite (non-NaN) output. The detector path treats mono input as `mid = input[0]` rather than `(input[0] + undefined) / 2`. Verified by `mono-input.test.ts`.
8. **Halfband FIR coefficients in worklets match the canonical source (with negative control).** A parity test reads all three worklets (limiter, saturation, metering); extracts the `HALFBAND_TAPS` array; asserts exact equality with `oversampling.ts` export. A negative-control subtest intentionally corrupts a tmp copy and asserts the parity test fails. Verified by `halfband-parity.test.ts`.
6. **UI slider controls the param.** In Advanced mode, the "Sidechain HPF" slider in the Dynamics section reads 100 Hz by default, can be moved to 150 Hz, and the displayed value reflects the change. Verified by `TS-001` E2E scenario.

### Artifacts

- `src/lib/audio/dsp/oversampling.ts` — canonical halfband FIR taps + up/downsampler classes
- `src/lib/audio/dsp/sidechain-filter.ts` — Butterworth HPF coefficient helper + reference impl
- `src/lib/audio/dsp/true-peak.ts` — offline true-peak detector (uses oversampling.ts)
- `public/worklets/compressor-processor.js` — sidechain HPF integrated
- `public/worklets/limiter-processor.js` — true-peak ISP detection + 3-sample delay compensation
- `public/worklets/saturation-processor.js` — polyphase oversampled tanh, IIR removed
- `public/worklets/metering-processor.js` — true-peak ISP detection (replacing sample-peak)
- `src/types/mastering.ts` — `sidechainHpfHz: number` added
- `src/lib/audio/presets.ts` — `DEFAULT_PARAMS.sidechainHpfHz = 100`; per-genre overrides
- `src/lib/audio/nodes/compressor.ts` — `setSidechainHpfHz(hz)` method
- `src/lib/audio/chain.ts` — `updateParam` routes `sidechainHpfHz`
- `src/components/mastering/AdvancedMastering.tsx` — Sidechain HPF slider in Dynamics section
- `e2e/mastering.spec.ts` — TS-001 scenario

## E2E Test Scenarios

### TS-001: Sidechain HPF slider is present in Advanced mode and updates value
**Priority:** Critical
**Preconditions:** Audio file uploaded, navigated to `/master`
**Mapped Tasks:** Task 2, Task 3, Task 7

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click `mode-toggle-advanced` | Advanced section visible, Dynamics section rendered |
| 2 | Expand Dynamics section if collapsed (click header) | Dynamics controls visible including Threshold, Ratio, Attack, Release, Makeup |
| 3 | Locate `getByRole("slider", { name: "Sidechain HPF", exact: true })` | Slider exists, current value is 100 |
| 4 | Drag slider to `150` via `fill` or `setValue` | Slider value updates to 150 |
| 5 | Read slider value via `inputValue()` | Returns 150 (±0.01 — integer-step slider, see updated `sliderTolerance()`) |

## Progress Tracking

- [x] Task 1: Oversampling DSP module (halfband FIR upsampler/downsampler)
- [x] Task 2: AudioParams.sidechainHpfHz + per-genre preset values
- [x] Task 3: Sidechain HPF in compressor worklet + node wrapper + routing
- [ ] Task 4: Limiter true-peak detection + signal delay compensation
- [ ] Task 5: Saturation worklet rewrite with polyphase oversampling
- [ ] Task 6: Metering worklet true-peak fix
- [ ] Task 7: Advanced mode UI slider + E2E scenario

**Total Tasks:** 7 | **Completed:** 3 | **Remaining:** 4

## Implementation Tasks

### Task 1: Oversampling DSP Module

**Objective:** Create the canonical halfband polyphase FIR 4x oversampler/decimator in TypeScript with full offline tests. This is the foundation for Tasks 4, 5, and 6.
**Dependencies:** None
**Mapped Scenarios:** None (unit-level only)

**Files:**
- Create: `src/lib/audio/dsp/oversampling.ts`
- Create: `src/lib/audio/dsp/__tests__/oversampling.test.ts`

**Key Decisions / Notes:**
- Use a **47-tap** symmetric halfband FIR (Kaiser-windowed, β=8.0, ~101 dB stopband). Filter length upgraded from 23 to 47 after Batch-2 review found 23 taps could not preserve 18 kHz at 44.1 kHz within 1 dB (measured −2.26 dB; at 47 taps this becomes −0.08 dB). Generate coefficients offline via Kaiser-windowed sinc and hardcode as a constant `HALFBAND_TAPS`. Document the design parameters in a comment block.
- Halfband property: every even-distance-from-center tap (except center) is 0. For 47 taps, 25 are non-zero. Via polyphase decomposition, streaming needs only 24 multiplies per input sample for 2x (for the "even" output) plus one delay-line lookup for the "odd" output. For cascaded 4x, per input sample: 1 × 2x-stage-1 (24 muls → produces 2 samples) + 2 × 2x-stage-2 (48 muls → produces 4 samples). Total ~72 muls per input sample at 4x (for either up or down path only).
- Export: `HALFBAND_TAPS: Float32Array` (canonical), `HALFBAND_GROUP_DELAY_SAMPLES = 23` (at fast rate, per 2x stage = 11.5 at original rate per stage, 17.25 for cascaded 4x), `HALFBAND_4X_GROUP_DELAY_1X = 18` (ceiling for safe signal-path delay).
- Export classes: `Halfband2xUpsampler` (stateful, processes sample-by-sample, internal delay line), `Halfband2xDownsampler` (stateful, consumes 2 samples → 1), and compound `Oversampler4x` (cascade).
- Also export pure functions for offline testing: `upsample2x(input: Float32Array): Float32Array`, `downsample2x(input: Float32Array): Float32Array`, `upsample4x`, `downsample4x`.
- **Performance note:** the stateful classes must use a circular delay line (not Array.shift()) — this is a hot path called per-sample inside worklets.

**Definition of Done:**
- [ ] `HALFBAND_TAPS` exported with 47 values summing to 1.0 (DC gain preservation within 1e-6)
- [ ] **DC passthrough:** a constant-amplitude input produces a constant-amplitude output at the same level (within 1e-6) through `upsample4x` → `downsample4x`
- [ ] `upsample2x` doubles output length; fed an impulse, produces output with the tap values interleaved with zeros → halfband interpolation
- [ ] `downsample2x` halves output length; fed the output of `upsample2x(x)`, returns approximately `x` (within -60 dB error) minus the group delay offset
- [ ] `upsample4x` → `downsample4x` round-trip of a 1 kHz sine preserves amplitude within 0.1 dB and phase within 1 sample after group delay correction — **parameterized at 44100, 48000, and 96000 Hz**
- [ ] Stopband rejection test at 44.1k: a 22 kHz sine upsampled to 176.4k shows magnitude at 24 kHz < -50 dB below passband
- [ ] Passband flatness test: magnitude response at 100 Hz, 1 kHz, 10 kHz, and 18 kHz (at 44.1k) is within ±0.1 dB
- [ ] `Oversampler4x` streamed sample-by-sample matches `upsample4x`+`downsample4x` batch within 1e-6 (after steady state is reached, i.e., skipping the first `HALFBAND_GROUP_DELAY_SAMPLES` warmup samples of each stream)
- [ ] **Warmup test:** the first `2 × HALFBAND_GROUP_DELAY_SAMPLES` output samples of a streamed `Oversampler4x` fed silence are finite and equal zero (priming doesn't produce NaN/Inf)
- [ ] `HALFBAND_GROUP_DELAY_SAMPLES` exported constant equals `(HALFBAND_TAPS.length - 1) / 2` (= 23 for 47 taps, at the *fast* rate of the stage)
- [ ] All tests pass under `pnpm test`

**Verify:**
- `pnpm test src/lib/audio/dsp/__tests__/oversampling.test.ts`

---

### Task 2: AudioParams Extension + Per-Genre Preset Values

**Objective:** Add `sidechainHpfHz` to the `AudioParams` type, default it to 100, and set per-genre values in `GENRE_PRESETS`.
**Dependencies:** None (can proceed in parallel with Task 1)
**Mapped Scenarios:** None (unit-level only; TS-001 depends on this indirectly via Task 7)

**Files:**
- Modify: `src/types/mastering.ts`
- Modify: `src/lib/audio/presets.ts`
- Modify or create: `src/lib/audio/__tests__/presets.test.ts`

**Key Decisions / Notes:**
- Field name: `sidechainHpfHz` (not `scHpf`, not `hpfFreq` — consistent with the explicit unit suffix pattern used in other fields like `bassMonoFreq`).
- Range: 20–300 Hz (integer step in the UI, but type is `number` — float is allowed internally).
- Default: 100 Hz globally.
- Genre defaults (tightened after review — classical raised from 40→60 Hz since 2nd-order Butterworth at 40 Hz barely attenuates anything below 100 Hz; podcast lowered from 150→120 Hz to avoid over-filtering voice content with music beds):
  - `pop: 120`
  - `rock: 120`
  - `hiphop: 80`
  - `electronic: 80`
  - `jazz: 60`
  - `classical: 60`
  - `rnb: 100`
  - `country: 100`
  - `lofi: 100`
  - `podcast: 120`
- `applyIntensity()` in presets.ts already iterates `Object.keys(DEFAULT_PARAMS)` — no code change there, the new field is picked up automatically.

**Definition of Done:**
- [ ] `AudioParams` includes `sidechainHpfHz: number`
- [ ] `DEFAULT_PARAMS.sidechainHpfHz === 100`
- [ ] Each of the 9 `GENRE_PRESETS` has its specified `sidechainHpfHz` value
- [ ] `PlatformPreset` type unaffected (sidechain HPF is not a platform-level concern)
- [ ] Test: `applyIntensity("hiphop", 100).sidechainHpfHz === 80`
- [ ] Test: `applyIntensity("hiphop", 0).sidechainHpfHz === 100` (default at 0 intensity)
- [ ] Test: `applyIntensity("hiphop", 50).sidechainHpfHz === 90` (linear interp between 100 and 80)
- [ ] Test: `applyIntensity("classical", 100).sidechainHpfHz === 60`
- [ ] Test: `applyIntensity("podcast", 100).sidechainHpfHz === 120`
- [ ] Test: `applyIntensity("pop", 50).sidechainHpfHz === 110` (linear interp between 100 and 120)
- [ ] Existing preset tests still pass

**Verify:**
- `pnpm test src/lib/audio/__tests__/presets.test.ts`
- `pnpm tsc --noEmit` (no type errors introduced)

---

### Task 3: Compressor Sidechain HPF (worklet + node + chain routing + sidechain-filter DSP helper)

**Objective:** Add a 2nd-order Butterworth HPF on the compressor's detector signal (not the audio path). Detector input becomes `HPF((L+R)/2)` instead of `(|L|+|R|)/2`. User-adjustable via `sidechainHpfHz` param.
**Dependencies:** Task 2 (needs the param defined)
**Mapped Scenarios:** TS-001

**Files:**
- Create: `src/lib/audio/dsp/sidechain-filter.ts`
- Create: `src/lib/audio/dsp/__tests__/sidechain-filter.test.ts`
- Modify: `public/worklets/compressor-processor.js`
- Modify: `src/lib/audio/nodes/compressor.ts`
- Modify: `src/lib/audio/nodes/__tests__/compressor.test.ts`
- Modify: `src/lib/audio/chain.ts` (add `sidechainHpfHz` case to `updateParam`)
- Create: `src/lib/audio/__tests__/compressor-sidechain-integration.test.ts`

**Key Decisions / Notes:**
- `sidechain-filter.ts` exports:
  - `makeSidechainHpfCoeffs(freqHz: number, sampleRate: number): BiquadCoeffs` — thin wrapper over `biquad.highPassCoeffs(freqHz, 0.7071, sampleRate)` (Butterworth Q). Rationale: a named, domain-specific export is easier to grep for than tracking which callsites of `highPassCoeffs` are sidechain vs K-weighting.
  - `class SidechainHpfState` — holds biquad state (`z1`, `z2`), `process(mid: number): number` method. Used in offline tests and as a reference for the worklet-inlined version.
  - `applySidechainHpfToBuffer(input: Float32Array, freqHz: number, sampleRate: number): Float32Array` — offline convenience for tests.
- Worklet changes in `compressor-processor.js`:
  - Add state: `_scHpfHz = 100`, `_scHpfZ1 = 0`, `_scHpfZ2 = 0`, `_scHpfCoeffs = null`
  - On construction: call `_updateScHpfCoeffs()` to precompute
  - On param message `sidechainHpfHz`: update `_scHpfHz`, call `_updateScHpfCoeffs()`
  - In the process loop: replace `level = (|L| + |R|) / 2` with:
    ```js
    // Mono guard: if only one channel, duplicate it. Never compute (L + undefined) / 2.
    const l = input[0][i];
    const r = input.length > 1 ? input[1][i] : l;
    const mid = (l + r) * 0.5;
    // DF-II transposed biquad, matches BiquadFilter in dsp/biquad.ts
    const { b0, b1, b2, a1, a2 } = this._scHpfCoeffs;
    const y = b0 * mid + this._scHpfZ1;
    this._scHpfZ1 = b1 * mid - a1 * y + this._scHpfZ2;
    this._scHpfZ2 = b2 * mid - a2 * y;
    const level = Math.abs(y);
    ```
  - `_updateScHpfCoeffs()` uses the Audio EQ Cookbook formulas inline (same as `biquad.ts:86-100`). Add a comment: `// Keep in sync with src/lib/audio/dsp/biquad.ts highPassCoeffs()`.
- Node wrapper `CompressorNode`:
  - Add `setSidechainHpfHz(hz: number): void { this._node?.port.postMessage({ param: "sidechainHpfHz", value: hz }); }`
- `ProcessingChain.updateParam`:
  - Add `case "sidechainHpfHz": this._compressor?.setSidechainHpfHz(value); break;`
- Integration test (`compressor-sidechain-integration.test.ts`): uses `sidechain-filter.ts` offline math + the existing `dsp/compressor.ts` math to simulate the full detector path. Inputs: 60 Hz sine + 1 kHz sine. Asserts gain reduction variance with HPF=100 is >10× smaller than with HPF=20.

**Definition of Done:**
- [ ] `sidechain-filter.ts` `SidechainHpfState` attenuates a 50 Hz input by ≥20 dB when HPF=100 Hz
- [ ] `SidechainHpfState` passes 1 kHz input within 0.5 dB (passband check)
- [ ] `SidechainHpfState` at HPF=20 Hz is near-transparent on a 100 Hz sine (≤0.5 dB attenuation) — documents expected behavior at the slider minimum
- [ ] `CompressorNode.setSidechainHpfHz(120)` posts `{param:"sidechainHpfHz", value:120}` message (existing test pattern)
- [ ] `ProcessingChain.updateParam("sidechainHpfHz", 80)` routes to the compressor node (integration test with mock compressor)
- [ ] Worklet unit test: pure-JS harness transcribing the process loop, post 60 Hz signal, assert detector envelope response is attenuated vs the old path
- [ ] **Mono input test:** harness with `input.length === 1` produces finite detector output (no NaN); HPF processes `mid = input[0]`
- [ ] Integration test: simulated full detector chain with bass+treble mix — GR envelope variance at HPF=100 is ≥ 10× smaller than at HPF=20
- [ ] **StrictMode idempotence:** constructing a `CompressorNode`, calling `init()`, `dispose()`, then constructing again and calling `init()` produces working second instance (no stale worklet state). Test via node wrapper mock.
- [ ] All existing compressor tests still pass
- [ ] No regression in `src/lib/audio/__tests__/chain.test.ts`

**Verify:**
- `pnpm test src/lib/audio/dsp/__tests__/sidechain-filter.test.ts src/lib/audio/nodes/__tests__/compressor.test.ts src/lib/audio/__tests__/compressor-sidechain-integration.test.ts src/lib/audio/__tests__/chain.test.ts`

---

### Task 4: Limiter True-Peak Detection + Signal Delay Compensation

**Objective:** Replace the limiter's sample-peak detector with a 4x oversampled ITU-R BS.1770 true-peak detector. Add 3 samples of signal-path delay to compensate the FIR group delay.
**Dependencies:** Task 1 (oversampling.ts canonical source)
**Mapped Scenarios:** None (unit-level)

**Files:**
- Create: `src/lib/audio/dsp/true-peak.ts`
- Create: `src/lib/audio/dsp/__tests__/true-peak.test.ts`
- Modify: `public/worklets/limiter-processor.js`
- Modify: `src/lib/audio/nodes/__tests__/limiter.test.ts`
- Create: `src/lib/audio/__tests__/limiter-truepeak.test.ts`
- Create: `src/lib/audio/dsp/__tests__/halfband-parity.test.ts`

**Key Decisions / Notes:**
- `true-peak.ts` exports:
  - `detectTruePeakDbTp(input: Float32Array): number` — offline, uses `oversampling.upsample4x` + max-abs + 20*log10
  - `class TruePeakDetector` — stateful, sample-by-sample, used in tests and as worklet reference
- Worklet changes in `limiter-processor.js`:
  - **Derive lookahead from sample rate, not hardcoded samples.** Constants:
    ```js
    const LOOKAHEAD_MS = 1.5; // matches old 66 samples at 44.1k
    const GROUP_DELAY_COMP_1X = 18; // HALFBAND_4X_GROUP_DELAY_1X for 47-tap cascaded halfband
    const baseSamples = Math.round((LOOKAHEAD_MS / 1000) * sampleRate);
    this._lookaheadSize = baseSamples + GROUP_DELAY_COMP_1X;
    ```
    At 44.1k: 66+18=84. At 48k: 72+18=90. At 96k: 144+18=162.
  - Add `HALFBAND_TAPS` inline (duplicated from oversampling.ts with a `// IN SYNC WITH src/lib/audio/dsp/oversampling.ts HALFBAND_TAPS` comment)
  - Add state for two cascaded 2x upsampler delay lines (one for mid channel). Use circular indexing (not Array.shift).
  - Per sample (**with mono guard**):
    - `const l = input[0][i]; const r = input.length > 1 ? input[1][i] : l;`
    - `const mid = (l + r) * 0.5;`
    - Feed `mid` into the 4x upsampler → produces 4 oversampled samples
    - Compute `max(|sample|)` across the 4 oversampled samples
    - Use that max as the "peak" driving the existing gain computation (replaces `max(|L|,|R|)`)
  - The existing lookahead ring buffer continues to store `peak` values (now the true peak per sample), so gain computation is unchanged — only the source of `peak` is different.
  - Audio signal path: still 1x; the 9-sample lookahead compensation buys time for the detector to see the ISP before the audio sample arrives at the limiter output.
  - **StrictMode:** re-calling construction must re-prime the upsampler state (state is zeroed in constructor — already the case for TypedArrays).
- Parity test (`halfband-parity.test.ts`) — **Task 4 is sole owner; Tasks 5 and 6 extend the same file by appending to its worklet list.** Design:
  - Use `path.resolve(__dirname, '../../../../public/worklets/<name>.js')` to locate files regardless of Vitest's cwd (don't rely on `process.cwd()`).
  - For each worklet in a known list (`limiter-processor.js`, `saturation-processor.js`, `metering-processor.js`):
    - Read file as text
    - Regex-extract the `HALFBAND_TAPS` array block (look for `const HALFBAND_TAPS = [` … `];`)
    - Parse numeric values from the block
    - **Assert exact count equals `HALFBAND_TAPS.length`** (fails loudly on zero matches or miscount)
    - Assert element-wise equality with canonical taps within 1e-12
  - **Negative-control subtest:** copy a worklet to tmp, alter one coefficient, run the parser, assert it detects the mismatch and fails.
- `limiter-truepeak.test.ts`:
  - Generates a synthetic "ISP-hot" signal: two consecutive samples of +0.95 and -0.95 create a true peak at ~+1.05 between them (verified analytically via sinc interpolation).
  - **Parameterized at 44100, 48000, and 96000 Hz** using `describe.each`.
  - Runs through `processLimiter` wrapper (offline) configured with `ceiling = -1 dBTP`
  - Measures output true peak via `detectTruePeakDbTp(output)` — asserts within 0.3 dB of −1 dBTP at each rate
  - Comparison run: same input through sample-peak limiter (old code) — asserts output true peak exceeds −1 dBTP by ≥ 0.5 dB
  - **Empirical group-delay measurement:** push a single impulse of magnitude 1.0 through the limiter; measure the sample index at which gain reduction begins. Assert this index equals `0` (gain must reduce at the impulse sample, not later), and that the signal delay line stores exactly `_lookaheadSize` samples between input and output.
  - **Mono input test:** an ISP-hot mono signal produces finite output with true peak ≤ −0.7 dBTP.
- The offline TS impl in `dsp/limiter.ts` needs a matching update: `processLimiter` should gain a `useTruePeak: boolean` option (default true) so the test can compare old and new behavior in the same harness. Keep the default new behavior.
- **Renderer audit (S4):** the offline export renderer uses `dsp/limiter.ts::processLimiter` directly (not the worklet). After adding the `useTruePeak` option with default `true`, audit `src/lib/audio/renderer.ts` to confirm (a) no callsites pass `useTruePeak: false`, (b) existing `renderer.test.ts` continues to pass. If the renderer has its own lookahead assumption, update it to match.

**Definition of Done:**
- [ ] `true-peak.ts` `detectTruePeakDbTp` returns > sample peak for ISP-hot signals, equal for smooth signals
- [ ] `TruePeakDetector` streamed sample-by-sample matches the offline function within 0.05 dB
- [ ] Worklet lookahead is derived from `sampleRate`: 84 samples at 44.1k, 90 at 48k, 162 at 96k (verified by test harness that constructs the worklet at each rate)
- [ ] `halfband-parity.test.ts` created; passes for `limiter-processor.js`; negative-control subtest fails as expected; exact-count assertion guards against regex miss
- [ ] `limiter-truepeak.test.ts` passes at 44100, 48000, and 96000 Hz: new limiter holds −1 dBTP ceiling within 0.3 dB on ISP-hot signal; old limiter exceeds by ≥ 0.5 dB
- [ ] Empirical group-delay test: impulse at sample index 0 triggers gain reduction at index 0 (within ±1 sample)
- [ ] Mono input test: single-channel ISP-hot input produces finite output meeting the true-peak ceiling
- [ ] `LimiterNode` test: no API change, existing tests pass
- [ ] **Renderer audit:** `renderer.ts` call site of `processLimiter` updated to pass `useTruePeak: true` (or left at the default if new default is true); `renderer.test.ts` passes unmodified or with explicit updates for TP-ceiling verification
- [ ] **StrictMode:** constructing a new `LimiterNode` after disposing the previous one produces working second instance with zeroed upsampler/ring-buffer state
- [ ] No regression in `src/lib/audio/__tests__/renderer.test.ts`

**Verify:**
- `pnpm test src/lib/audio/dsp/__tests__/true-peak.test.ts src/lib/audio/__tests__/limiter-truepeak.test.ts src/lib/audio/dsp/__tests__/halfband-parity.test.ts src/lib/audio/nodes/__tests__/limiter.test.ts src/lib/audio/__tests__/renderer.test.ts`

---

### Task 5: Saturation Worklet Rewrite (polyphase oversampling, remove mix + IIR)

**Objective:** Replace the linear-interp + 1st-order IIR LP hack with proper 4x polyphase halfband oversampling. Remove the `_lpState` and the `mix` param (hardcode 100% wet).
**Dependencies:** Task 1 (oversampling.ts canonical source)
**Mapped Scenarios:** None (unit-level)

**Files:**
- Modify: `public/worklets/saturation-processor.js`
- Modify: `src/lib/audio/dsp/saturation.ts` (update `applySaturation` or add `applyOversampledSaturation` that uses oversampling.ts, so tests can verify offline)
- Modify: `src/lib/audio/nodes/saturation.ts` (remove `setMix` — no longer has any effect)
- Modify: `src/lib/audio/nodes/__tests__/saturation.test.ts` (remove mix test; new tests for `setDrive` unchanged)
- Create: `src/lib/audio/dsp/__tests__/saturation-alias.test.ts`

**Key Decisions / Notes:**
- Worklet structure:
  - Duplicate `HALFBAND_TAPS` inline with sync comment
  - Per channel (works for 1 or 2 channels via `numChannels = Math.min(input.length, output.length)`), maintain an upsampler state and a downsampler state (each a small ring buffer)
  - **Preserve the zero-drive early-return** (`if (!this._enabled || this._drive === 0) { passthrough; return true; }`) — the existing line ~32 bypass is critical for perf when saturation is off
  - Per input sample:
    1. Feed `x` into upsampler → produces 4 samples at 4x rate (the first 2 stages up: 2x then 2x, so each input sample yields 4 output samples when buffered correctly via polyphase)
    2. Apply `tanh(drive * y) / norm` to each of the 4
    3. Feed all 4 into the downsampler → produces 1 output sample
    4. Write to `output[c][i]`
- The `dryGain * x + wetGain * saturated` mix logic is gone (100% wet).
- **Grep-clean check:** after removal, running `rg -n 'setMix|param:\s*"mix"' src public e2e` must return zero matches. This is a hard DoD item.
- Offline TS counterpart: `applyOversampledSaturation(input, driveFactor): Float32Array` using `oversampling.upsample4x` → tanh → `downsample4x`. Used by `saturation-alias.test.ts`.
- `SaturationNode.setMix()` method: **remove** (not on the AudioParams anyway, so no upstream change). Update saturation.test.ts to remove the mix test.
- Aliasing test methodology:
  - Generate a 15 kHz sine at −6 dBFS, length 1 s at 44.1k
  - Apply old saturation (reconstruct the old algorithm as a local function in the test for comparison) and new saturation at drive=100
  - DFT both outputs, sum magnitude in bins 0–10 kHz → "aliasing energy"
  - Assert new aliasing energy is **≥ 40 dB lower** than old (raised from 20 dB per review; pro-spec target)

**Definition of Done:**
- [ ] Worklet no longer references `_lpState` or `_mix`
- [ ] Worklet uses `HALFBAND_TAPS` (parity test will verify)
- [ ] **Grep-clean:** `rg -n 'setMix|param:\s*"mix"' src public e2e` returns zero matches
- [ ] Zero-drive bypass preserved: passthrough path produces output identical to input within 1e-7 when `drive === 0`
- [ ] `applyOversampledSaturation` offline: 15 kHz input preserved within 0.5 dB after processing at drive=100
- [ ] `saturation-alias.test.ts`: new impl aliasing energy ≥ 40 dB lower than old
- [ ] `saturation-alias.test.ts`: HF preservation at 18 kHz within 1 dB
- [ ] **Mono input test:** mono input (drive=50) produces finite output with no NaN
- [ ] **Sample-rate coverage:** aliasing and HF preservation tests parameterized at 44100 and 48000 Hz
- [ ] `SaturationNode` test: `setDrive` still works; `setMix` method removed (TypeScript compile error if called); `saturation.test.ts:36-39` updated — the `setMix(75)` test and its `expect(postMessage).toHaveBeenCalledWith({param:"mix",...})` assertion removed
- [ ] Parity: Task 4's `halfband-parity.test.ts` file updated to include `saturation-processor.js` in its worklet list
- [ ] **StrictMode:** construct/dispose/reconstruct produces working second instance
- [ ] No regression in `src/lib/audio/__tests__/renderer.test.ts`

**Verify:**
- `pnpm test src/lib/audio/dsp/__tests__/saturation-alias.test.ts src/lib/audio/nodes/__tests__/saturation.test.ts src/lib/audio/dsp/__tests__/halfband-parity.test.ts`

---

### Task 6: Metering Worklet True-Peak Fix

**Objective:** Replace the metering worklet's broken sample-peak `truePeak` calculation with a proper 4x oversampled ISP detection, so the `MeteringData.truePeak` field (already displayed in UI) is correct.
**Dependencies:** Task 1 (oversampling.ts canonical source); conceptually depends on Task 4 for the inline FIR pattern but can proceed in parallel.
**Mapped Scenarios:** None (unit-level)

**Files:**
- Modify: `public/worklets/metering-processor.js`
- Create: `src/lib/audio/__tests__/metering-truepeak.test.ts`

**Key Decisions / Notes:**
- Duplicate `HALFBAND_TAPS` inline (sync comment).
- Maintain upsampler state blocks per channel. **Mono guard:** if `input.length === 1`, run the detector on `left = input[0]` only; `truePeak = tpL`. For stereo: `truePeak = max(tpL, tpR)`.
- Replace the existing lines (`metering-processor.js:~125-130`):
  ```js
  const absPeak = Math.max(Math.abs(left[i]), Math.abs(right[i]));
  if (absPeak > Math.pow(10, this._truePeak / 20)) {
    this._truePeak = 20 * Math.log10(absPeak);
  }
  ```
  with per-channel oversampled detection, finding the max of each channel's 4 oversampled samples.
- Offline test builds a synthetic "known ISP" signal using sinc-reconstruction (truth: true peak at some known dBTP, say −2.3), simulates the worklet process() call using a pure-JS transcription of the relevant logic, asserts the computed `_truePeak` matches within 0.1 dB.
- Since `MeteringMessage` shape is unchanged, no TS type change needed. The UI receives the (now correct) value automatically.
- Parity test: Task 4's `halfband-parity.test.ts` file updated to include `metering-processor.js`.

**Definition of Done:**
- [ ] `metering-processor.js` uses `HALFBAND_TAPS` inline
- [ ] Pure-JS harness: synthetic ISP-hot signal with known true peak X → worklet `_truePeak` within 0.1 dB of X
- [ ] Pure-JS harness: smooth signal with known sample peak = true peak (e.g., DC, low-freq sine) → worklet `_truePeak` within 0.05 dB of sample peak
- [ ] **Mono input test:** mono ISP-hot signal produces finite `_truePeak` within 0.1 dB of ground truth
- [ ] **Sample-rate coverage:** ISP detection test parameterized at 44100, 48000, and 96000 Hz
- [ ] **CPU perf sanity:** processing a synthetic 60-second stereo buffer at 44.1k through the pure-JS harness completes in < 500 ms on the CI runner (codifies the risk-table claim)
- [ ] Parity test (Task 4's `halfband-parity.test.ts`) updated to include `metering-processor.js`
- [ ] **StrictMode:** re-construction after dispose zeros `_truePeak` back to −Infinity and upsampler state
- [ ] No regression in `src/lib/audio/nodes/__tests__/metering.test.ts`

**Verify:**
- `pnpm test src/lib/audio/__tests__/metering-truepeak.test.ts src/lib/audio/nodes/__tests__/metering.test.ts src/lib/audio/dsp/__tests__/halfband-parity.test.ts`

---

### Task 7: Advanced Mode UI Slider + E2E Scenario

**Objective:** Expose the `sidechainHpfHz` parameter in the Advanced Mastering UI as a slider in the Dynamics section. Add an E2E test (TS-001) that verifies the slider's presence, default value, and interactivity.
**Dependencies:** Task 2 (AudioParams has the field), Task 3 (compressor actually responds)
**Mapped Scenarios:** TS-001

**Files:**
- Modify: `src/components/mastering/AdvancedMastering.tsx`
- Modify: `e2e/mastering.spec.ts`
- Modify or create: `src/components/mastering/__tests__/AdvancedMastering.test.tsx` (if directory exists; otherwise skip component test — E2E is sufficient)

**Key Decisions / Notes:**
- Placement: inside the existing `<Section title="Dynamics">` block, between the `Makeup` slider and the closing `</Section>` tag.
- Slider props: `label="Sidechain HPF"`, `value={params.sidechainHpfHz ?? 100}`, `min={20}`, `max={300}`, `step={1}`, `unit="Hz"`, `onChange={(v) => onParamChange("sidechainHpfHz", v)}`.
- Name must match exactly what the E2E test locates: `getByRole("slider", { name: "Sidechain HPF", exact: true })`.
- No Simple mode UI change.
- E2E test TS-001 follows the pattern of existing advanced-mode tests in `mastering.spec.ts` (upload → showAdvanced → ensureSectionExpanded("Dynamics") → readSliderValue → verify 100 → set to 150 → verify 150).
- **Tolerance:** `sidechainHpfHz` uses integer step. Tolerance for TS-001 reads is 0.01 (effectively exact), not the existing 0.51 pattern used for float-displayed sliders. Extend `sliderTolerance()` in `mastering.spec.ts` with a branch for `"Sidechain HPF"` returning 0.01.

**Definition of Done:**
- [ ] Slider appears in Advanced mode with label "Sidechain HPF", default value 100, range 20–300, unit "Hz"
- [ ] Slider is absent in Simple mode
- [ ] Changing slider fires `onParamChange("sidechainHpfHz", newValue)` with numeric value
- [ ] TS-001 E2E scenario passes: locates slider, reads 100, sets to 150, reads 150
- [ ] No TypeScript errors (`pnpm tsc --noEmit`)
- [ ] No ESLint errors (`pnpm lint`)
- [ ] All existing E2E tests still pass (`pnpm test:e2e`)

**Verify:**
- `pnpm test:e2e e2e/mastering.spec.ts`
- `pnpm tsc --noEmit`
- `pnpm lint`

---

## Open Questions

None.

### Deferred Ideas (out of scope for P0, noted for future work)

- **AudioParam descriptors for sample-accurate automation.** `sidechainHpfHz` could be exposed via `parameterDescriptors` on the AudioWorkletProcessor (a-rate param) for sample-accurate automation, bypassing the 16 ms debounce in `ParameterBridge`. Worth revisiting if/when automation lanes are added to the UI.
- **Coefficient generator script.** Replace the inline duplicated `HALFBAND_TAPS` arrays with a build-time generated `.js` snippet (e.g., `scripts/generate-worklet-coeffs.ts`). Eliminates parity-test pain entirely but adds build complexity — defer until the pattern proliferates.
- **Meter tooltip text.** The `truePeak` readout could gain a tooltip saying "True-peak per ITU-R BS.1770-4 (4× oversampled)" so users understand why values differ from sample-peak. Low priority; do in a UX polish pass.
