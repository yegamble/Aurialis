# Grammy-Tier DSP P1 Upgrade Implementation Plan

Created: 2026-04-23
Author: yegamble@gmail.com
Status: COMPLETE
Approved: Yes
Iterations: 0
Worktree: No
Type: Feature

## Summary

**Goal:** Three P1 mastering enhancements that add pro-level character and visibility on top of the P0 foundation: (1) program-dependent auto-release on the compressor (dual-stage parallel envelope — SSL G-Series style) to stop pumping on dense material, (2) four saturation character modes (Clean / Tube / Tape / Transformer) with asymmetric and band-limited variants all running through the P0 4× polyphase oversampler, (3) LRA (EBU R128 Loudness Range) and stereo correlation meters surfaced inline on the transport bar.

**Architecture:** Reuse the P0 worklet + DSP split pattern. Extend the existing compressor/saturation/metering worklets with inline implementations; keep canonical pure-TS reference implementations under `src/lib/audio/dsp/` for offline testing. UI touches are limited: an `autoRelease` toggle in Dynamics, a 4-way segmented `satMode` selector in Saturation, and two inline numeric readouts (`LRA` and `Corr`) on the transport bar next to the existing LUFS / dBTP displays.

**Tech Stack:** TypeScript, AudioWorkletProcessor (JS), Vitest, Playwright, React/Zustand.

## Scope

### In Scope

1. **Auto-release compressor** — `autoRelease: boolean` on `AudioParams`. When on, engages dual-stage parallel envelope: a fast envelope (user's `release` value) runs alongside a slow envelope (internally derived, ~5× slower). During release, the effective envelope picks the slower of the two (`max(fast_env, slow_env)`) → **gain reduction is HELD longer** on dense content → less pumping. Trade-off: next-transient compression ramps back in slightly later than in manual mode. This is a "glue for dense mixes" tool, not a "recover-fast-from-transients" tool.
2. **Saturation modes** — `satMode: 'clean'|'tube'|'tape'|'transformer'` on `AudioParams`. Four shapers, each running through the existing 4× halfband polyphase oversampler:
   - **Clean** — current `tanh(drive·x)/tanh(drive)` (unchanged)
   - **Tube** — `tanh(drive·x + 0.1)/tanh(drive) − dcTrim` (asymmetric; positive bias generates 2nd-order harmonics; DC trim removes the resulting offset so the signal stays centered)
   - **Tape** — high-shelf pre-filter (-3 dB at 12 kHz, Q=0.707) **applied at the base rate BEFORE the 4× oversampler** → then 4× oversampled soft-knee waveshaper. Canonical waveshaper formula: `y = x / pow(1 + pow(|drive·x|, 1.5), 1/1.5)`. The `cbrt(1 + cubic)` shorthand is a different curve (p=3, hard-clip-like) and is NOT used — keep `p=1.5` in both worklet and TS.
   - **Transformer** — piecewise soft-clip at 4× rate + midrange emphasis peak (+2 dB at 1.5 kHz, Q=1.2) **applied at the base rate BEFORE the oversampler** (same reasoning).

   **Why pre-filters are applied at base rate, not inside the 4× oversampled block:** a biquad designed with coefficients for `sampleRate` gives the wrong frequency response when run at `4 × sampleRate` (the shelf would land at 3 kHz, not 12 kHz). The correct architecture is: base-rate colored pre-filter → 4× upsample → waveshape → 4× downsample. This matches real analog (tape head rolls off HF *before* the tape magnetization nonlinearity; transformer has frequency-dependent excitation *before* soft-clip).
3. **LRA meter** — per EBU R128 / ITU-R BS.1770-4: gated short-term LUFS values' 10th–95th percentile spread. Exposed on `MeteringData.lra` (LU).
4. **Correlation meter** — running stereo correlation `E[LR]/√(E[L²]·E[R²])` over a 100 ms window. Exposed on `MeteringData.correlation` (range −1..+1).
5. **UI**: auto-release toggle in Dynamics (next to existing De-Harsh / Glue Comp toggles), 4-way segmented `satMode` selector at the top of the Saturation section, `LRA: X.X LU` + `Corr: ±X.XX` numeric readouts on the transport bar (inline with existing LUFS/dBTP), correlation colored red (<0) / amber (0–0.3) / green (≥0.3).
6. **Per-genre `satMode` preset defaults**: rock/hiphop → tube, lofi → tape, electronic → transformer, pop/rnb/jazz/classical/podcast → clean.
7. **Tests**: unit tests for auto-release behavior, each saturation mode's spectral signature, LRA on known signals, correlation on mono/stereo/inverted signals. E2E: TS-001 auto-release toggle, TS-002 satMode selector, TS-003 LRA + Corr readouts visible during playback.

### Out of Scope

- Multiband compression / M/S processing (P2)
- Parametric EQ with sweepable freq/Q (P3)
- A/B bypass for individual modes (use existing global A/B)
- Vector scope / goniometer visual (future)
- LRA target matching / automatic makeup gain
- Modifying the 47-tap halfband FIR or any P0 oversampler code

## Approach

**Chosen:** Incremental extension of existing worklets + DSP modules. No new files beyond one per new DSP concept (`auto-release.ts`, `sat-modes.ts`, extended `lufs.ts`, new `correlation.ts`). No UI component restructuring — add toggles/pills/readouts to existing `AdvancedMastering.tsx` and `master/page.tsx`.

**Why:** The P0 pattern (worklet ↔ node wrapper ↔ canonical TS DSP ↔ unit test) is well-proven and already produces parity-verified worklets. Reusing it keeps surface area minimal. The cost: three worklets (compressor, saturation, metering) each gain modest inline additions rather than being extracted into separate specialized worklets.

**Alternatives considered:**
- **New `autorelease-processor.js` as a separate worklet in the chain.** Rejected: couples the compressor to a downstream box and adds node-graph complexity. The auto-release logic needs access to the compressor's existing envelope follower — keeping it inline is natural.
- **New `SaturationCharacter` class hierarchy with dispatch.** Rejected: over-engineered for four static modes. A simple switch + pre-filter state is sufficient and keeps the worklet's hot loop flat.
- **LRA/correlation as a new sidechain-only metering node.** Rejected: the existing `metering-processor.js` already has the K-weighted signal path; extending it is a few dozen lines. A new node means a new `addModule` call + routing.

## Context for Implementer

> Write for an implementer who has never seen the codebase. Everything P1 builds on the P0 Grammy-tier foundation — read `docs/plans/2026-04-22-dsp-grammy-tier-p0.md` first.

**Patterns to follow (inherited from P0):**
- **Worklet ↔ node wrapper ↔ DSP pattern:** see `src/lib/audio/nodes/compressor.ts:19-28` and `public/worklets/compressor-processor.js` for the paired structure. Parameters flow via `port.postMessage({ param, value })`. Metering/gain-reduction data flows back via `port.onmessage`.
- **DSP math separation:** pure functions live in `src/lib/audio/dsp/*.ts` (see `oversampling.ts`, `sidechain-filter.ts`, `true-peak.ts`). Worklets duplicate the hot-loop logic in JS; canonical TS source + parity tests protect against drift (see `src/lib/audio/dsp/__tests__/halfband-parity.test.ts`).
- **Param routing:** add field to `AudioParams` in `src/types/mastering.ts` → add default to `DEFAULT_PARAMS` in `src/lib/audio/presets.ts` → add setter on node class → add case to `ProcessingChain.updateParam` in `src/lib/audio/chain.ts:92`. The `ParameterBridge` subscribes to store changes and auto-routes.
- **Test convention:** DSP tests in `src/lib/audio/dsp/__tests__/*.test.ts` (offline math). Node tests in `src/lib/audio/nodes/__tests__/*.test.ts` (mock AudioContext, verify `postMessage` calls). Integration tests in `src/lib/audio/__tests__/*.test.ts`. E2E in `e2e/*.spec.ts`.
- **Boolean-on-number-interface:** `AudioParams` is historically all `number`. For booleans (`autoRelease`), use `number` with 0/1 convention to keep the interpolation logic in `applyIntensity` working without special-casing. For enums (`satMode`), extend `AudioParams` to allow string values — this is a new type signature.

**Conventions:**
- DSP modules: kebab-case files (`auto-release.ts`). Export pure functions first, then stateful classes.
- Worklet inline duplications: comment block `// IN SYNC WITH src/lib/audio/dsp/<file>.ts` for every duplicated formula.
- UI: existing Slider/ToggleButton/Section components in `AdvancedMastering.tsx` (internal); reuse them rather than creating new primitives.

**Key files:**
- `src/types/mastering.ts` — `AudioParams` interface. Source of truth.
- `src/lib/audio/presets.ts` — `DEFAULT_PARAMS` and `GENRE_PRESETS`. 9 genres currently.
- `src/lib/audio/chain.ts` — `ProcessingChain.updateParam` routes to nodes.
- `src/lib/audio/nodes/{compressor,saturation,metering}.ts` — node wrappers.
- `public/worklets/{compressor,saturation,metering}-processor.js` — the three P1 touches.
- `src/lib/audio/dsp/oversampling.ts` — **do not modify.** Shared 47-tap halfband foundation.
- `src/components/mastering/AdvancedMastering.tsx` — Dynamics + Saturation sections, existing `ToggleButton` pattern lines 99-131.
- `src/app/master/page.tsx` — transport bar with LUFS/dBTP readouts around lines 325-340.
- `src/components/visualization/LevelMeter.tsx` — level-meter component; may get LRA/Corr props.
- `src/types/audio.ts` — `MeteringData` interface. Source of truth for metering shape.

**Gotchas:**
- **`satMode` is the first string field on `AudioParams`.** `applyIntensity()` currently iterates all keys treating them as numbers (`src/lib/audio/presets.ts:236-241`). It must be updated to skip string fields. Add a guard or a type-narrowed key list.
- **Signature-widening target:** `ParameterBridge` already passes `params[key]` generically — it doesn't care about the value type. The actual numeric-only type signatures live on `AudioEngine.updateParameter` and `ProcessingChain.updateParam` (`src/lib/audio/chain.ts:92`). These need to accept `AudioParams[keyof AudioParams]` (= `number | SaturationMode`). Widen THOSE, not parameter-bridge.
- **`DEFAULT_PARAMS.autoRelease` must be `0` (off by default) for backward compat.** Existing saved sessions should not unexpectedly engage auto-release.
- **LRA requires accumulating short-term values over at least 3 seconds.** Before that window fills, report `0` (not `-Infinity`, which would break UI number formatting). Document this.
- **Correlation of silence is undefined (0/0).** Guard with a minimum RMS threshold; return `0` when both channels are effectively silent.
- **Saturation mode changes must not glitch.** When switching modes mid-stream, the inline waveshaper state (tape HF shelf biquad, transformer midrange emphasis biquad) must preserve state across the switch — don't zero it.

**Domain context:**

- **Auto-release (dual-stage parallel envelope):** The compressor's envelope follower holds a "peak history" of the input level. Release is how fast this envelope falls when the signal drops. Fast release → gain recovers quickly after a transient, good for punch. Slow release → gain stays reduced through sustained content, good for glue. Real program material has BOTH characters: transient vocals + sustained instrumentation. A fixed release either pumps on dense content (too fast) or loses punch on transients (too slow). Classic SSL G-Series "Auto" solves this by running two envelope followers in parallel: a fast one and a slow one. When the signal just peaked and the fast envelope is still high, the fast release controls recovery (punch preserved). When the fast envelope has decayed past the slow envelope, the slow release takes over (glue, no pumping). Mathematically: `effective_env = max(fast_env, slow_env)` during release phase.
- **Saturation character (why it matters):** Pure `tanh` is a symmetric nonlinearity — it generates only odd harmonics (3rd, 5th, 7th...). That's the "digital distortion" sound: cold, unnatural. Analog gear distorts asymmetrically, adding 2nd-order harmonics that the ear perceives as warm and pleasing. **Tube** amplifiers have DC-biased grids that clip one polarity more than the other → strong 2nd harmonic. We simulate with `tanh(drive·x + bias)` where `bias > 0` causes asymmetric clipping. **Tape** machines are band-limited (the tape+head response rolls off HF gradually) and exhibit soft-knee saturation with slight hysteresis. We approximate with a gentle HF shelf (−3 dB at 12 kHz) + a soft-knee shaper like `x / (1 + |x|^p)^(1/p)`. **Transformer** saturation has a characteristic midrange resonance and soft-clip above threshold. We simulate with a resonant mid peak (+2 dB at 1.5 kHz) + piecewise linear/cubic clipper. All three ride through the P0 4× oversampler, so harmonic generation stays below Nyquist.
- **LRA (Loudness Range):** A single number describing the dynamic range of the mastered signal per EBU R128. Formal definition: the range between the 10th and 95th percentiles of the distribution of gated short-term (3 s) loudness measurements, using a −20 LU relative gate. Streaming platforms publish reference LRAs (Spotify ~6–8 LU for pop, ~10–15 LU for film mixes). Grammy-grade masters target appropriate LRA for the genre; engineers monitor LRA during mastering to verify dynamics are preserved.
- **Stereo correlation:** Formally `E[L·R] / √(E[L²]·E[R²])`. Range: +1 (identical channels, mono-compatible), 0 (uncorrelated, e.g. wide stereo field), −1 (inverted channels, sums to silence on mono playback — a bug). Engineers monitor correlation to ensure mono fold-down doesn't cancel content. Negative correlation is a red flag.

## Autonomous Decisions

None — all gray areas resolved via Batch 1 and Batch 2 `AskUserQuestion`.

## Assumptions

- **P0 DSP foundation is stable and green.** Supported by 612-test suite passing on P0 completion (plan `2026-04-22-dsp-grammy-tier-p0.md` VERIFIED state). Tasks 3 (saturation modes) and 4 (LRA/Corr) depend on this.
- **`AudioParams` can grow a string-valued field without breaking the store.** `mixer-store.ts` spreads `DEFAULT_PARAMS` as-is and `parameter-bridge.ts` iterates keys via `Object.keys` — neither requires numeric-only values. But `applyIntensity` in `presets.ts:231-244` assumes all values are numbers and would crash on a string. Must be fixed. Task 2 depends on this.
- **The existing `LevelMeter.tsx` component can accept new props without visual regression.** Supported by reading current usage at `src/app/master/page.tsx:414`. Task 6 depends on this.
- **Saturation mode state (HF shelf biquad, mid emphasis biquad) can be mode-switched without audible clicks** as long as biquad state is preserved. This is standard practice; verified by keeping Biquad `z1`/`z2` values across mode changes. Task 3 depends on this.
- **The P0 halfband parity test auto-covers new worklet-inlined coefficient additions.** Tasks 3 & 4 must NOT add new HALFBAND_TAPS copies to the worklets (oversampling is already there). They may add other inline biquad coefficients, which get their own narrower parity checks if needed.

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Auto-release HOLDS GR too long and under-compresses the next transient | Medium | Medium | Add explicit "transient preservation" DoD: peak GR with autoRelease=1 is ≤ 2 dB deeper than with autoRelease=0 on an isolated-transient signal. If this fails, cap the slow time constant at 2 seconds (already in plan) and/or blend fast/slow rather than using `max()`. |
| Auto-release algorithm name oversold — "auto-release" implies auto-RECOVERY but the actual behavior is auto-HOLD | Low | Low | UI label reads "Auto Release" (SSL historical term) but the tooltip / docstring describes actual behavior as "adaptive hold for dense mixes". Don't claim the transient-recovery-speedup benefit in user-facing text. |
| Saturation mode switch produces click/pop from state discontinuity | Low | Medium | Preserve biquad state (z1/z2) across mode switches; only the waveshaper formula changes. Unit test: switch mode while processing a continuous sine → no discontinuity > 0.1 × sample amplitude. |
| Tube asymmetric bias creates DC offset that builds up | Medium | High | Apply explicit DC trim: after `tanh(drive·x + bias)/tanh(drive)`, subtract the DC component `tanh(bias)/tanh(drive)`. Test: DC input (`x=0`) → output is exactly 0 within 1e-7. |
| LRA returns `NaN` or `-Infinity` in first 3 seconds (insufficient short-term data) | High | Low | Use explicit `lraReady: boolean` sentinel in the metering payload. Return `{ lra: 0, lraReady: false }` until 30 short-term values accumulated. UI shows `---` only when `!lraReady`; otherwise displays the (possibly 0) value as a valid measurement. |
| Correlation divides by zero on silence | Medium | High | Guard: if `E[L²] < 1e-10` or `E[R²] < 1e-10` → return `0`. Test with all-zero input → `0`, not `NaN`. |
| `applyIntensity` crashes on new string `satMode` field | Medium | High | Refactor `applyIntensity` to partition keys into numeric and non-numeric; copy non-numeric keys from preset as-is (no interpolation). Test: `applyIntensity('rock', 50)` returns a preset with `satMode === 'tube'` (unchanged at any intensity). |
| New `AudioParams` fields break `mixer-store.ts` consumers | Low | Medium | Grep all `AudioParams` usages; `mixer-store.ts` currently spreads `DEFAULT_PARAMS` which propagates new fields automatically. Verify via TypeScript compile. |
| UI segmented button group has bad keyboard nav | Low | Low | Use native `<button>` elements with shared `role="group"` container. Standard browser tab order. Add `aria-pressed` state. |
| LRA/Corr readouts add visual clutter to transport bar | Medium | Low | Keep them small and secondary (smaller font than primary LUFS/dBTP). If clutter becomes a problem, move to a "Pro Meters" expandable panel (deferred). |

## Goal Verification

### Truths

1. **Auto-release reduces GR envelope variance on dense content WITHOUT destroying transient punch.** Two-part test: (a) on dense content (kick pulses + drone), GR variance is ≥ 30% smaller with `autoRelease=1` vs `=0` — less pumping. (b) On an isolated transient, peak GR with `autoRelease=1` is ≤ 2 dB deeper than with `=0` — transient punch is preserved. Verified by `auto-release.test.ts` + `compressor-auto-release-integration.test.ts`.
11. **Auto-release with `autoRelease=0` is BIT-EXACT equivalent to P0 compressor.** 10-second pink-noise input → max per-sample diff ≤ 1e-9 between P0 reference and P1 `autoRelease=0` output. Verified by the backward-compat parity test in `auto-release.test.ts`.
2. **Tube mode produces measurable 2nd-order harmonics that exceed Clean mode's.** A 1 kHz sine at drive=50% through Tube produces magnitude at 2 kHz at least 20 dB higher than the same signal through Clean. Verified by `sat-modes.test.ts`.
3. **Tape mode attenuates 15 kHz content relative to Clean by ≥2 dB at drive=50%.** Verified by `sat-modes.test.ts`.
4. **Transformer mode boosts 1.5 kHz content by ≥1.5 dB relative to Clean at drive=50%.** Verified by `sat-modes.test.ts`.
5. **All four saturation modes remain alias-free** — 15 kHz input at drive=100% has summed 0–10 kHz energy ≥ 30 dB below the Clean-mode naive (non-oversampled) reference. Verified by extending `saturation-alias.test.ts`.
6. **Mode switching is click-free.** Processing a continuous 1 kHz sine and switching modes between blocks produces no output sample discontinuity > 0.1 × steady-state amplitude. Verified by `sat-modes-switching.test.ts`.
7. **LRA reports sensible values for canonical signals.** Compressed rock test signal → LRA 4–8 LU; dynamic classical test signal → LRA 12–20 LU; steady 1 kHz sine → LRA ≤ 1 LU. Verified by `lra.test.ts`.
8. **Correlation reports +1 for mono, ~0 for uncorrelated noise, −1 for anti-phase.** Tolerance ±0.05. Verified by `correlation.test.ts`.
9. **UI shows the new controls and readouts.** Sidebar: auto-release toggle in Dynamics; 4-pill satMode selector in Saturation. Transport bar: `LRA: X.X LU` and `Corr: ±X.XX` visible with correlation color-coded. Verified by E2E scenarios TS-001, TS-002, TS-003.
10. **All P0 tests still pass** — zero regression across the 612-test baseline. Verified by full suite run in each task's DoD.

### Artifacts

- `src/lib/audio/dsp/auto-release.ts` — dual-envelope math (pure TS)
- `src/lib/audio/dsp/sat-modes.ts` — tube/tape/transformer waveshapers (pure TS)
- `src/lib/audio/dsp/correlation.ts` — running stereo correlation (pure TS)
- `src/lib/audio/dsp/lufs.ts` — extended with `computeLRA()` helper
- `public/worklets/compressor-processor.js` — inline auto-release envelope
- `public/worklets/saturation-processor.js` — inline 4-mode dispatch + HF shelf + mid emphasis biquads
- `public/worklets/metering-processor.js` — inline LRA computation + correlation accumulator
- `src/types/mastering.ts` — `autoRelease` and `satMode` fields + `SaturationMode` type
- `src/types/audio.ts` — `MeteringData.lra` and `MeteringData.correlation`
- `src/lib/audio/presets.ts` — `DEFAULT_PARAMS` updates + per-genre `satMode` defaults + `applyIntensity` refactor
- `src/lib/audio/nodes/{compressor,saturation,metering}.ts` — setters for new params
- `src/lib/audio/chain.ts` — new routing cases
- `src/components/mastering/AdvancedMastering.tsx` — auto-release toggle + satMode pills
- `src/app/master/page.tsx` — LRA + Correlation readouts on transport bar
- `e2e/mastering.spec.ts` — TS-001, TS-002, TS-003

## E2E Test Scenarios

### TS-001: Auto-release toggle appears in Dynamics and toggles state
**Priority:** Critical
**Preconditions:** Audio uploaded, on `/master`, Advanced mode active
**Mapped Tasks:** Task 1, Task 5

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Expand Dynamics section (if collapsed) | Dynamics controls visible |
| 2 | Locate `getByRole("button", { name: "Auto Release", exact: true })` | Toggle exists, `aria-pressed="false"` |
| 3 | Click toggle | `aria-pressed="true"` |
| 4 | Click again | `aria-pressed="false"` |

### TS-002: Saturation mode selector cycles through 4 modes
**Priority:** Critical
**Preconditions:** Audio uploaded, Advanced mode active
**Mapped Tasks:** Task 2, Task 3, Task 5

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Expand Saturation section | Drive slider + satMode pills visible |
| 2 | Verify 4 pill buttons: Clean, Tube, Tape, Transformer | All four present with correct labels |
| 3 | Default pill (Clean or genre-set) has `aria-pressed="true"` | Correct default based on current genre |
| 4 | Click each pill in sequence | Only one is `aria-pressed="true"` at any time |

### TS-003: LRA and Correlation readouts visible on transport bar during playback
**Priority:** High
**Preconditions:** Audio uploaded, on `/master`
**Mapped Tasks:** Task 4, Task 6

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Observe transport bar while stopped | `LRA: --- LU` and `Corr: ---` placeholders visible |
| 2 | Click Play | Playback starts |
| 3 | Wait 4 seconds | `LRA` shows a numeric value (float, 1 decimal, followed by ` LU`) |
| 4 | `Corr` shows a signed numeric value between −1.00 and +1.00 | Format: `+0.XX` or `-0.XX` |

## Progress Tracking

- [x] Task 1: Auto-release compressor (DSP + worklet + node + chain + types + tests)
- [x] Task 2: SaturationMode types + per-genre presets + applyIntensity refactor + routing scaffold
- [x] Task 3: Tube / Tape / Transformer waveshapers (DSP + worklet integration + alias-safe oversampling reuse)
- [x] Task 4: LRA + Correlation in metering worklet + MeteringData types
- [x] Task 5: UI — auto-release toggle + satMode pills in AdvancedMastering.tsx
- [x] Task 6: UI — LRA + Corr readouts on transport bar + E2E scenarios

**Total Tasks:** 6 | **Completed:** 6 | **Remaining:** 0

## Implementation Tasks

### Task 1: Auto-Release Compressor (Dual-Stage Parallel Envelope)

**Objective:** Add `autoRelease: number` (0 or 1) param to AudioParams. Implement dual-stage parallel envelope in compressor DSP and worklet. When on, the effective envelope during release picks the slower of fast + slow envelopes, reducing pumping on dense content.
**Dependencies:** None
**Mapped Scenarios:** TS-001

**Files:**
- Create: `src/lib/audio/dsp/auto-release.ts` — pure TS dual-envelope helper
- Create: `src/lib/audio/dsp/__tests__/auto-release.test.ts`
- Modify: `src/types/mastering.ts` (add `autoRelease: number`)
- Modify: `src/lib/audio/presets.ts` (`DEFAULT_PARAMS.autoRelease = 0`)
- Modify: `public/worklets/compressor-processor.js` (inline dual-envelope)
- Modify: `src/lib/audio/nodes/compressor.ts` (add `setAutoRelease`)
- Modify: `src/lib/audio/nodes/__tests__/compressor.test.ts`
- Modify: `src/lib/audio/chain.ts` (route `autoRelease`)
- Create: `src/lib/audio/__tests__/compressor-auto-release-integration.test.ts`

**Key Decisions / Notes:**
- **Algorithm (SSL G-Series-inspired, dual-stage parallel envelope):** maintain two envelope followers in parallel on the same detector signal.
  ```
  env_fast ← attack/release with user's release time (T_fast = release_ms / 1000)
  env_slow ← attack/release with T_slow = 5 × T_fast (capped at 2 seconds)
  During ATTACK (input > env_prev):
    both envelopes attack at the user's attack time
    effective_env = input  (or attack-smoothed input, same as P0)
  During RELEASE (input <= env_prev):
    env_fast decays with T_fast
    env_slow decays with T_slow
    effective_env = max(env_fast, env_slow)   ← SLOW DOMINATES (higher value)
  ```
  **What this does:** once the signal drops below its recent peak, `env_slow` stays near the peak longer than `env_fast`. Because `max()` picks the higher value, the effective envelope follows the slow decay → gain reduction is held. On dense content (many transients close together), this prevents the "pumping" where GR keeps hopping up and down. On sparse content with clear transients, GR stays reduced slightly longer than the user's manual release — this is the intentional trade-off.
- **Conditional work:** `env_slow` updates only when `autoRelease > 0` — saves per-sample work in the default path. Worklet has one `if` per sample + one extra multiply-accumulate when enabled.
- **Backward compat:** When `autoRelease === 0`, `env_slow` is bypassed entirely. Test must prove SAMPLE-EXACT parity (≤ 1e-9 diff per sample) on a non-trivial signal — not just silence — vs. a reference single-envelope implementation copying P0's code. Use 10 seconds of pink-noise-like varied content.
- **Worklet state:** new `this._envSlow = 0`. Zero-initialized in constructor, survives block boundaries.
- `auto-release.ts` exports: `class DualEnvelopeFollower` with `{ processSample(x, attackMs, releaseMs, autoRelease, sampleRate): envelope }` + a pure function variant for offline tests.
- **Test 1 — pumping reduction:** synthetic signal = 1 second of 60 Hz pulses every 200 ms (kick-drum-like) overlaid with 1 kHz drone. Feed through compressor at threshold=-20 dB, ratio=4, attack=10ms, release=100ms. Measure `var(gr_envelope)` with `autoRelease=0` and `autoRelease=1`. Assert the `=1` variance is ≥ 30% lower. *(This is what the variance test proves — pumping reduction, i.e. GR is more stable.)*
- **Test 2 — transient preservation:** a single isolated transient (10 ms of 0.9 amplitude 440 Hz tone surrounded by silence). Feed through compressor at same settings. Measure peak gain-reduction magnitude at the transient sample. Assert `autoRelease=1` reduces the peak by NO MORE THAN 2 dB additional vs. `autoRelease=0`. *(This prevents the "glue at the cost of punch" regression — under-compression of transients.)*
- **Test 3 — bit-exact backward compat:** generate 10 s of pseudo-random pink-noise-scaled content. Feed through P1 compressor with `autoRelease=0`. Capture output. Compare sample-by-sample with the reference implementation (P0 compressor math, copied into the test file as a frozen reference). Assert max diff ≤ 1e-9.

**Definition of Done:**
- [ ] `DualEnvelopeFollower`: two-stage envelope produces the expected `max()` behavior during release (unit test)
- [ ] **Backward compat (bit-exact):** 10-second pink-noise input → `autoRelease=0` output matches frozen P0 reference within 1e-9 per sample (not just silence)
- [ ] **Pumping reduction:** GR variance ≥ 30% lower on dense test signal with `autoRelease=1` vs `=0`
- [ ] **Transient preservation:** isolated-transient test, peak GR with `autoRelease=1` is ≤ 2 dB deeper than with `=0` (guards against over-compression of punchy content)
- [ ] **Silent-input behavior:** zero input → effective envelope is 0 (no floating state); `max(0, 0) = 0`; no NaN
- [ ] `CompressorNode.setAutoRelease(1)` posts `{param:"autoRelease", value:1}` message (existing test pattern)
- [ ] `ProcessingChain.updateParam("autoRelease", 1)` routes correctly
- [ ] No regression in `chain.test.ts`, `compressor.test.ts`, `compressor-sidechain-integration.test.ts`
- [ ] TypeScript compile clean
- [ ] Full suite passes

**Verify:**
- `pnpm test src/lib/audio/dsp/__tests__/auto-release.test.ts src/lib/audio/nodes/__tests__/compressor.test.ts src/lib/audio/__tests__/compressor-auto-release-integration.test.ts`

---

### Task 2: SaturationMode Types + Per-Genre Presets + `applyIntensity` Refactor

**Objective:** Add `satMode: SaturationMode` to `AudioParams`, update `DEFAULT_PARAMS`, set per-genre defaults, refactor `applyIntensity` to handle non-numeric fields correctly. Add `setSatMode` on `SaturationNode` + chain routing. This task sets up the scaffolding for Task 3 but doesn't implement the actual waveshapers yet.
**Dependencies:** None (parallelizable with Task 1)
**Mapped Scenarios:** TS-002

**Files:**
- Modify: `src/types/mastering.ts` (export `SaturationMode` type; add `satMode` field)
- Modify: `src/lib/audio/presets.ts` (`DEFAULT_PARAMS.satMode = 'clean'`; per-genre values; refactor `applyIntensity` to partition numeric/non-numeric keys)
- Modify: `src/lib/audio/__tests__/presets.test.ts`
- Modify: `src/lib/audio/nodes/saturation.ts` (add `setSatMode`)
- Modify: `src/lib/audio/nodes/__tests__/saturation.test.ts`
- Modify: `src/lib/audio/chain.ts` (route `satMode` to saturation node, accepting string values)
- Modify: `src/lib/audio/engine.ts` and `src/lib/audio/parameter-bridge.ts` (signatures accept `number | string`)

**Key Decisions / Notes:**
- New type: `export type SaturationMode = 'clean' | 'tube' | 'tape' | 'transformer';`
- `AudioParams.satMode: SaturationMode` — first non-number field on the interface.
- `DEFAULT_PARAMS.satMode = 'clean'`
- Per-genre defaults:
  ```
  pop: 'clean'
  rock: 'tube'
  hiphop: 'tube'
  electronic: 'transformer'
  jazz: 'clean'
  classical: 'clean'
  rnb: 'clean'
  lofi: 'tape'
  podcast: 'clean'
  ```
- **`applyIntensity` refactor:** iterate keys with a *runtime type guard*, not just `typeof DEFAULT_PARAMS[key]`. The existing `as number` cast at `presets.ts:247-251` must be removed — replace with a narrowed helper:
  ```ts
  function isNumericParam(key: keyof AudioParams): boolean {
    return typeof DEFAULT_PARAMS[key] === 'number';
  }
  for (const key of keys) {
    if (isNumericParam(key)) {
      const def = DEFAULT_PARAMS[key] as number;
      const target = preset[key] as number;
      (result[key] as number) = def + t * (target - def);
    } else {
      // String-valued or otherwise non-numeric; copy from preset directly (intensity has no meaning for enums)
      (result as Record<string, unknown>)[key] = preset[key];
    }
  }
  ```
- **Intensity semantics for enum fields:** `applyIntensity('rock', 0)` returns `satMode: 'tube'` (the preset's value — NOT the default 'clean'). Why: intensity scales numeric dynamics but doesn't interpolate between enums. This matches the user's mental model: switching to Rock → you get Rock's character regardless of intensity. Test matrix:
  - `applyIntensity('rock', 0).satMode === 'tube'` — preset's satMode at intensity 0
  - `applyIntensity('rock', 50).satMode === 'tube'` — same at 50%
  - `applyIntensity('rock', 100).satMode === 'tube'` — same at 100%
  - `applyIntensity('pop', 50).satMode === 'clean'` — Pop preset happens to match default
  - Numeric fields still interpolate: `applyIntensity('rock', 50).threshold ≈ -18 + 0.5 * (rock.threshold - (-18))`
- **`ParameterBridge` and `engine.updateParameter` signatures:** change from `(key: keyof AudioParams, value: number)` to `(key: keyof AudioParams, value: AudioParams[keyof AudioParams])`. This is a generic-typed refactor; TypeScript will cover the callsites.
- **Chain routing:** `case "satMode": this._saturation?.setSatMode(value as SaturationMode); break;`
- **Node wrapper:** `setSatMode(mode: SaturationMode) { this._node?.port.postMessage({ param: "satMode", value: mode }); }`
- The worklet receives the message but does nothing yet (Task 3 implements). Add `_satMode = 'clean'` state var and the message handler now; the dispatch switch in the process loop is added in Task 3.

**Definition of Done:**
- [ ] `SaturationMode` type exported from `src/types/mastering.ts`
- [ ] `DEFAULT_PARAMS.satMode === 'clean'`
- [ ] All 9 genre presets have correct `satMode` value
- [ ] `applyIntensity('rock', 0).satMode === 'clean'`; `applyIntensity('rock', 50).satMode === 'tube'`; `applyIntensity('rock', 100).satMode === 'tube'`
- [ ] `applyIntensity('hiphop', 50).satMode === 'tube'`; `applyIntensity('lofi', 50).satMode === 'tape'`; `applyIntensity('electronic', 50).satMode === 'transformer'`
- [ ] Existing intensity interpolation tests still pass (numeric fields interpolate correctly)
- [ ] `SaturationNode.setSatMode('tube')` posts correct message
- [ ] `ProcessingChain.updateParam("satMode", "tube")` routes correctly
- [ ] TypeScript compile clean across engine, parameter-bridge, chain
- [ ] Full suite passes

**Verify:**
- `pnpm test src/lib/audio/__tests__/presets.test.ts src/lib/audio/nodes/__tests__/saturation.test.ts src/lib/audio/__tests__/chain.test.ts`
- `pnpm tsc --noEmit`

---

### Task 3: Saturation Modes — Tube, Tape, Transformer Waveshapers

**Objective:** Implement the three character modes in the saturation worklet and provide canonical TS references for testing. All modes run through the existing 4× halfband polyphase oversampler (from P0). Tube adds asymmetric bias. Tape adds HF shelf pre-filter + soft-knee shaper. Transformer adds midrange emphasis biquad + piecewise soft-clip.
**Dependencies:** Task 2 (routing + mode enum in place)
**Mapped Scenarios:** TS-002

**Files:**
- Create: `src/lib/audio/dsp/sat-modes.ts`
- Create: `src/lib/audio/dsp/__tests__/sat-modes.test.ts`
- Create: `src/lib/audio/dsp/__tests__/sat-modes-switching.test.ts`
- Modify: `public/worklets/saturation-processor.js` (inline mode dispatch + pre-filter biquads + shaper formulas)
- Modify: `src/lib/audio/dsp/__tests__/saturation-alias.test.ts` (parameterize all 4 modes; each must meet the ≥30 dB alias rejection)

**Key Decisions / Notes:**
- `sat-modes.ts` exports:
  - `applyTubeSaturation(x: number, driveFactor: number): number` — `(tanh(driveFactor*x + BIAS)/tanh(driveFactor) - NOMINAL_DC)` where `BIAS = 0.1`, `NOMINAL_DC = tanh(BIAS) / tanh(driveFactor)` (removes the *nominal* zero-input DC, but note that polarity-asymmetric signals still build residual DC — see tube-dc-hpf below)
  - `applyTapeShaper(x: number, driveFactor: number): number` — soft-knee shaper **p=1.5** formula used everywhere: `y = x / Math.pow(1 + Math.pow(Math.abs(driveFactor * x), 1.5), 1 / 1.5)`. This is the single committed formula — the cbrt/cubic approximation mentioned anywhere else is INCORRECT and must not appear in code.
  - `applyTransformerShaper(x: number, driveFactor: number): number` — piecewise:
    ```
    const t = driveFactor * x;
    const a = Math.abs(t);
    if (a <= 1) return t * (1 - (a * a) / 3);
    else return Math.sign(t) * (2 / 3);
    ```
- Also export `SAT_MODE_COEFFS` with base-rate pre-filter coefficients: `TAPE_HF_COEFFS` from `highShelfCoeffs(12000, -3, 1.0, sampleRate)`, `XFMR_MID_COEFFS` from `peakingCoeffs(1500, 2, 1.2, sampleRate)`. **Computed at base rate, applied at base rate (see architecture below).**
- **Correct architecture (critical — addresses M3 from review):**
  - Pre-filter (tape HF shelf OR transformer mid peak) runs at BASE sample rate, BEFORE the 4× oversampler
  - Then 4× oversampler upsample → waveshape at 4× → downsample
  - For tube: no pre-filter; shaper is `tanh`-based; runs inside the 4× block like P0 Clean mode
  - For clean: unchanged from P0
  - This means the colored pre-filter shapes the signal *before* the nonlinearity sees it — matching analog gear physics (tape head rolls off HF, then tape magnetization saturates).
- **Worklet changes** (`saturation-processor.js`):
  - Add `this._satMode = 'clean'` state + message handler case
  - Per-channel biquad state for tape HF shelf (outer, pre-upsampler): `this._tapePreL = { z1: 0, z2: 0 }`, same for R
  - Per-channel biquad state for transformer mid peak (outer, pre-upsampler): `this._xfmrMidL`, `this._xfmrMidR`
  - Compute biquad coefficients ONCE at construction from base `sampleRate`.
  - **Hoist mode dispatch outside the per-sample inner loop** (suggestion Sg1 — minor perf + cleaner code): at block start, select the shaper formula + optional pre-filter state once, use it for the whole block. Mode only changes on message handler, so this is safe.
  - For each input sample `x`:
    1. If mode is `tape`: apply tape HF shelf biquad at base rate → `xPre`
    2. If mode is `transformer`: apply mid emphasis biquad at base rate → `xPre`
    3. Else: `xPre = x`
    4. Upsample `xPre` to 4× via two cascaded 2× halfband stages (same as P0)
    5. For each of the 4 oversampled samples: apply the mode's waveshaper
    6. Downsample 4× → 1× via two cascaded 2× halfband stages
    7. Write to output
- **Switching test** (`sat-modes-switching.test.ts`): tightened click threshold per review S7. Feed 2048 samples of 1 kHz sine at 0.3 amplitude; switch mode at sample 1024 (well past warmup). Assert no consecutive-sample pair delta > **0.01 × amplitude** (≈ −40 dBFS, much tighter than the original −20 dBFS), AND spectral energy above 10 kHz in the 10 ms window post-switch is < −60 dBFS.
- **Tube DC-build-up guard** (should_fix S2): add a 20 Hz single-pole HPF to the tube-mode output path (post-downsample). This removes DC buildup that the static nominal trim can't handle on polarity-asymmetric signals like kick drums. Cheap (2 multiplies + state). Test with a unipolar kick-drum-like signal (0-to-peak only) → output mean within 1e-4 after 200 ms.

**Definition of Done:**
- [ ] `applyTubeSaturation` at driveFactor 5.5 (drive=50%) on 1 kHz sine: magnitude at 2 kHz is ≥ 20 dB higher than Clean's 2 kHz magnitude; DC of output on a ZERO-input signal ≤ 1e-6
- [ ] **Tube DC-on-asymmetric-content:** unipolar kick signal (only positive excursions, like a half-wave-rectified sine) through Tube → with post-HPF, output mean after 200 ms ≤ 1e-3; without HPF (test comparison), mean would exceed 1e-2. Guards against kick-drum DC drift.
- [ ] `applyTapeShaper` + base-rate HF shelf: 15 kHz input attenuated ≥ 2 dB at drive=50% vs Clean
- [ ] **Shelf verification:** the tape HF shelf alone (no waveshaper) applied to a 12 kHz sine attenuates by 2.8–3.2 dB (verifies shelf is at 12 kHz, not aliased to 3 kHz from wrong-rate coefficients)
- [ ] `applyTransformerShaper` + base-rate mid emphasis: 1.5 kHz input boosted ≥ 1.5 dB at drive=50% vs Clean
- [ ] **Mid peak verification:** the transformer mid peak alone applied to a 1.5 kHz sine boosts by 1.8–2.2 dB (verifies peak is at 1.5 kHz, not aliased)
- [ ] **All four modes** meet the P0 alias rejection target: extend `saturation-alias.test.ts` to parameterize over `['clean','tube','tape','transformer']`; all must show ≥ 25 dB in-band alias reduction vs naive single-rate reference (same threshold as P0's alias test, which is currently ≥ 25 dB for the 7.5 kHz 48k case)
- [ ] **Extreme drive sanity:** all four modes at drive=100% produce finite (non-NaN, non-Inf) output and hold their respective character tests within tolerance
- [ ] `sat-modes-switching.test.ts`: no consecutive-sample delta > 0.01 × amplitude when switching modes mid-stream on continuous sine; spectral energy > 10 kHz in 10 ms post-switch < −60 dBFS
- [ ] TypeScript compile clean
- [ ] Full suite passes

**Verify:**
- `pnpm test src/lib/audio/dsp/__tests__/sat-modes.test.ts src/lib/audio/dsp/__tests__/sat-modes-switching.test.ts src/lib/audio/dsp/__tests__/saturation-alias.test.ts`

---

### Task 4: LRA + Correlation in Metering Worklet

**Objective:** Add `lra: number` and `correlation: number` to `MeteringData`. Implement LRA (10th–95th percentile of gated short-term LUFS per EBU R128) and running stereo correlation in the metering worklet. Post both via the existing `metering` message type.
**Dependencies:** None (parallelizable with Tasks 1-3)
**Mapped Scenarios:** TS-003

**Files:**
- Modify: `src/types/audio.ts` (`MeteringData.lra: number`, `MeteringData.correlation: number`)
- Modify: `src/lib/audio/nodes/metering.ts` (`MeteringMessage` gets same fields)
- Create: `src/lib/audio/dsp/correlation.ts` — pure TS running correlation
- Modify: `src/lib/audio/dsp/lufs.ts` (add `computeLRA(shortTermValues: number[]): number`)
- Create: `src/lib/audio/dsp/__tests__/lra.test.ts`
- Create: `src/lib/audio/dsp/__tests__/correlation.test.ts`
- Modify: `public/worklets/metering-processor.js` (inline LRA + correlation accumulators)
- Modify: `src/lib/stores/audio-store.ts` (default metering values include `lra: 0, correlation: 0`)
- Modify: `src/lib/audio/engine.ts` (forward `lra` + `correlation` in `metering` event)

**Key Decisions / Notes:**
- **LRA (EBU R128):** accumulate gated short-term LUFS values (the 3-second windows we already compute). Every block, compute the 10th and 95th percentiles over the distribution; LRA = P95 − P10.
  - **Warmup sentinel (should_fix S1):** expose a boolean `lraReady: boolean` in the metering payload. When fewer than 30 short-term values have accumulated (3 s), `lraReady = false` and `lra = 0`. Once `lraReady` flips true, `lra` is trustworthy (even if 0.0 — which is a valid value for a fully-compressed mix). UI shows `---` only while `!lraReady`, not when `lra <= 0`.
  - Gating: use the existing absolute gate at −70 LUFS. Also apply the EBU R128 −20 LU relative gate: `relativeGateLufs = 10·log10(mean(10^(L/10))) − 20`; include only short-term values ≥ that gate.
- **Correlation:** running EWMA-smoothed `r = E[L·R] / √(E[L²]·E[R²])`. Window coeff: one-pole with τ ≈ 100 ms. Reset state on worklet reset.
  - Formula per sample:
    ```
    const coeff = exp(-1 / (tau * sr)); // one-pole smoothing
    avgLR = coeff * avgLR + (1-coeff) * (L * R)
    avgLL = coeff * avgLL + (1-coeff) * (L * L)
    avgRR = coeff * avgRR + (1-coeff) * (R * R)
    denom = sqrt(avgLL * avgRR)
    correlation = denom < 1e-10 ? 0 : clamp(avgLR / denom, -1, 1)
    ```
  - Mono guard: if `input.length === 1`, `correlation = 1.0` (identical channels).
  - **Peak-hold for negative events (should_fix S3):** also expose `correlationPeakMin: number` — the worst (most-negative) correlation value observed in the last 500 ms. UI colors the Corr readout based on `correlationPeakMin`, but displays the smoothed `correlation` number. This way, a brief anti-phase event flashes red for half a second even though the smoothed correlation takes ~100 ms to catch up.
- **Test vectors for LRA:**
  - Steady 1 kHz sine (no dynamics): LRA ≤ 1 LU
  - Pulsed sine (loud + quiet regions): LRA 6–12 LU depending on pulse amplitude ratio
  - Three-section synthetic (quiet → loud → quiet): LRA ≥ 4 LU
  - (Real classical/rock recordings not required — synthetic tests are deterministic.)
- **Test vectors for correlation:**
  - Mono (`L === R`): +1.0 ± 0.01
  - Anti-phase (`L === -R`): −1.0 ± 0.01
  - Identical noise: +1.0
  - Independent noise streams: ≈ 0 ± 0.1 (needs enough samples to converge)
  - Silent input: 0 (guarded)

**Definition of Done:**
- [ ] `MeteringData` has `lra: number`, `lraReady: boolean`, `correlation: number`, `correlationPeakMin: number` fields
- [ ] `computeLRA([list of short-term LUFS])` returns P95 − P10 after gating; returns `{ lra: 0, ready: false }` for < 30 entries
- [ ] `RunningCorrelation` class: streaming correlation within 0.05 of batch computation after warmup
- [ ] LRA test vectors: steady sine ≤ 1 LU; three-section synthetic ≥ 4 LU; pulsed ≥ 6 LU
- [ ] LRA warmup: signal shorter than 3 s → `lraReady === false`, `lra === 0`
- [ ] Correlation test vectors: mono +1.0 ± 0.01, anti-phase −1.0 ± 0.01, silence 0 (guarded), independent-random-noise ≈ 0 ± 0.15
- [ ] Correlation peak-hold: a single 20 ms anti-phase burst followed by mono content → `correlationPeakMin ≤ -0.5` for ~500 ms after the burst, then recovers to positive
- [ ] **Audit all `MeteringData` construction sites (should_fix S6):** grep for `MeteringData` across `src/`; every constructor or default-object literal updated with the new fields. DoD includes `rg -l 'MeteringData'` returning a documented list of files, all updated.
- [ ] Metering worklet pushes `lra`, `lraReady`, `correlation`, `correlationPeakMin` in `metering` message
- [ ] `metering.test.ts` existing assertions still pass (message shape extended, not broken)
- [ ] `AudioEngine.emit('metering', ...)` forwards new fields
- [ ] `MeteringMessage` in `src/lib/audio/nodes/metering.ts` interface extended with the new fields
- [ ] TypeScript compile clean

**Verify:**
- `pnpm test src/lib/audio/dsp/__tests__/lra.test.ts src/lib/audio/dsp/__tests__/correlation.test.ts src/lib/audio/nodes/__tests__/metering.test.ts`

---

### Task 5: UI — Auto-Release Toggle + SatMode Pills

**Objective:** Add an "Auto Release" toggle button in the Dynamics section (adjacent to De-Harsh and Glue Comp). Add a 4-way segmented pill selector (Clean / Tube / Tape / Transformer) at the top of the Saturation section. Both wire through `onParamChange`.
**Dependencies:** Task 1 (autoRelease param), Task 2 (satMode param)
**Mapped Scenarios:** TS-001, TS-002

**Files:**
- Modify: `src/components/mastering/AdvancedMastering.tsx`
- Modify: `src/components/mastering/__tests__/AdvancedMastering.test.tsx` if it exists; otherwise defer to E2E coverage

**Key Decisions / Notes:**
- **Auto Release toggle:** reuse the existing `ToggleButton` primitive (lines 99-131 of `AdvancedMastering.tsx`). Place it as the third toggle in the row with De-Harsh and Glue Comp. `aria-pressed` derived from `params.autoRelease > 0`. Click calls `onParamChange("autoRelease", active ? 0 : 1)`.
- **SatMode pills:** segmented control using `role="radiogroup"` wrapper with 4 child `<button>` elements carrying `role="radio"` + `aria-checked`. Keyboard nav: Left/Right arrows move selection between pills; Enter/Space confirms. This is the idiomatic pattern for a mutually-exclusive selection (should_fix Sg4). Clicking calls `onParamChange("satMode", mode)`. Place above the existing Drive slider inside the `<Section title="Saturation">`.
- **`onParamChange` signature widening (scope gap Sg5 — owned by this task):** current signature at `src/components/mastering/AdvancedMastering.tsx` and its caller in `src/app/master/page.tsx` is `(key: keyof AudioParams, value: number) => void`. Widen to `(key: keyof AudioParams, value: AudioParams[typeof key]) => void` — let TypeScript infer. Grep for all `onParamChange` usages; `master/page.tsx` is the primary caller (it forwards to `useAudioStore.setParam`, which also needs the same widening at `audio-store.ts:31`). Task 5 owns ALL these sites — don't leave one behind.
- **Design:** pill visual style matches existing Simple-mode "Clean Up / Warm / Bright" toggle buttons (check `SimpleMastering.tsx` for the pattern).

**Definition of Done:**
- [ ] "Auto Release" toggle button exists in Dynamics row, `aria-pressed` tracks `params.autoRelease > 0`
- [ ] SatMode 4-pill selector exists inside Saturation section with `role="radiogroup"`; child buttons have `role="radio"` + `aria-checked`; only one is checked at a time
- [ ] Left/Right arrow keys move selection between pills; Enter/Space confirms (keyboard nav works)
- [ ] Clicking pills updates `params.satMode` through `onParamChange`
- [ ] Default UI reflects current preset (Pop = Clean; switching to Rock = Tube; etc.)
- [ ] **`onParamChange` signature widened at:** `AdvancedMastering.tsx` prop type, `master/page.tsx` caller, `audio-store.ts:31` `setParam` signature. TypeScript `tsc --noEmit` clean across the whole project (catches any missed caller).
- [ ] No regression in existing advanced-mode tests

**Verify:**
- `pnpm tsc --noEmit`
- `pnpm test src/components/mastering/__tests__/`

---

### Task 6: UI — LRA + Correlation Readouts + E2E Scenarios

**Objective:** Surface `MeteringData.lra` and `correlation` as numeric readouts on the transport bar next to existing LUFS and dBTP. Color-code correlation red/amber/green. Add E2E scenarios TS-001, TS-002, TS-003.
**Dependencies:** Task 4 (LRA/Correlation in metering payload), Task 5 (UI controls for TS-001/002)
**Mapped Scenarios:** TS-001, TS-002, TS-003

**Files:**
- Modify: `src/app/master/page.tsx` (transport bar readout additions around lines 325-340)
- Modify: `e2e/mastering.spec.ts` (add TS-001, TS-002, TS-003 scenarios)

**Key Decisions / Notes:**
- **LRA readout:** near the existing `metering.lufs` display. Format: `LRA: {lra.toFixed(1)} LU`. Show `LRA: --- LU` only when `lraReady === false` (warmup) — NOT when `lra <= 0`, which is a valid post-warmup value (fully compressed mix can have LRA ≈ 0).
- **Correlation readout:** near LRA. Format: `Corr: {correlation >= 0 ? '+' : ''}{correlation.toFixed(2)}`. **Color is based on `correlationPeakMin` (not `correlation` itself)** so brief anti-phase events flash red for ~500 ms even if the smoothed value lags. Colors: `text-red-400` (peakMin < 0), `text-amber-400` (peakMin 0 to 0.3), `text-green-400` (peakMin ≥ 0.3). Use Tailwind classes; match existing meter-text color palette.
- **E2E TS-001** (auto-release toggle): navigate to advanced, expand Dynamics (already open), locate `getByRole("button", { name: "Auto Release", exact: true })`, assert `aria-pressed="false"`, click, assert `aria-pressed="true"`, click, assert back to `"false"`.
- **E2E TS-002** (satMode pills): navigate to advanced, expand Saturation section, verify all four pill buttons exist (`Clean`, `Tube`, `Tape`, `Transformer`). Default pill (depending on current genre; test uses Pop → `Clean`) has `aria-pressed="true"`. Click each in sequence, verify only-one-pressed invariant.
- **E2E TS-003** (LRA + Corr visibility): navigate to master page, verify initial `LRA: --- LU` + `Corr: ---` placeholders visible. Click Play, wait 4 seconds (page.waitForTimeout is acceptable here — we're waiting for LRA accumulation, not a UI event), verify `LRA:` shows numeric and `Corr:` shows signed numeric between −1.00 and +1.00.

**Definition of Done:**
- [ ] `LRA: X.X LU` readout visible on transport bar
- [ ] `Corr: ±X.XX` readout visible, colored per value sign/magnitude
- [ ] Pre-playback: `LRA: --- LU`, `Corr: ---`
- [ ] During playback: values update live (at ~30 Hz via the metering message)
- [ ] E2E TS-001 passes
- [ ] E2E TS-002 passes
- [ ] E2E TS-003 passes
- [ ] All existing E2E tests still pass
- [ ] TypeScript + lint clean
- [ ] Full unit suite passes

**Verify:**
- `pnpm test:e2e e2e/mastering.spec.ts`
- `pnpm tsc --noEmit && pnpm lint`

---

## Open Questions

None.

### Deferred Ideas

- **Per-mode drive response curves.** Each saturation mode could have its own drive scaling (tube responds sweeter at low drive; transformer at high drive). Defer until user feedback.
- **Goniometer/vector scope.** Visual L/R stereo field scatterplot. Natural extension of correlation but much more UI/rendering work. P3+.
- **LRA target matching.** Auto-adjust compressor to hit a target LRA. Requires closed-loop control. P3+.
- **Auto-release "mode selector"** (fast / medium / slow / adaptive). More knobs but overkill for P1.
- **Saturation "Drive per mode" scaling.** Current single Drive slider works for all modes, but some pros want independent drives. Future refactor.
