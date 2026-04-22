# Adversarial Review: Grammy-Tier DSP P0 Plan

**Reviewed:** `/Users/yosefgamble/github/Aurialis/docs/plans/2026-04-22-dsp-grammy-tier-p0.md`
**Date:** 2026-04-22

## Verified Claims (true)
- `limiter-processor.js:14` — `_lookaheadSize = 66`. Confirmed.
- `metering-processor.js:135-137` — computes `truePeak` from `Math.max(|left[i]|, |right[i]|)` (sample-peak masquerading as TP). Confirmed.
- `saturation-processor.js:55-70` — linear interp + 1st-order IIR LP (`alpha = exp(-2π·0.25)`). Confirmed.
- `parameter-bridge.ts:29` — iterates `Object.keys(params) as (keyof AudioParams)[]` and routes via `_engine.updateParameter(key, …)`. Confirmed.
- `mixer-store.ts:52` — spreads `DEFAULT_PARAMS`; new fields propagate automatically. Confirmed.
- `biquad.ts:86` exports `highPassCoeffs`. Confirmed.

---

## Findings

### must_fix

**M1. `SaturationNode.setMix()` is still called by tests and (likely) callers — Task 5 DoD is incomplete.**
`src/lib/audio/nodes/__tests__/saturation.test.ts:36-39` calls `sat.setMix(75)`. Task 5 says "remove `setMix`" but also "update saturation.test.ts to remove the mix test". Plan must explicitly grep for all callsites (`setMix`, `mix` messages in worklets, any `mix` param routing in `chain.ts`) and delete them. Add a DoD item: "No references to `setMix` or `'mix'` param message remain in codebase (grep clean)." Otherwise TypeScript compiles but a dead API lingers.

**M2. Halfband-parity test via regex-parsing JS is brittle — add a sanity guard.**
Task 4 plans to "read worklet files as text, regex-extract `HALFBAND_TAPS`". A stray comment, multiline formatting, or trailing comma will silently skip the array and the test will false-pass. Require the parser to: (a) assert it extracted exactly `HALFBAND_TAPS.length` numeric values, (b) fail loudly if the regex match count is zero, (c) include a negative-control test (corrupt the file in a tmp copy → parity test must fail).

**M3. 3-sample signal delay is insufficient for cascaded 4x halfband group delay.**
Task 4 Section/Assumption 99 claims +3 samples compensates the FIR. A 23-tap halfband at 2x-stage rate has group delay = (23−1)/2 = 11 samples at *fast* rate = 5.5 samples at input rate per stage. Cascaded 4x (two 2x stages) → ~11 input-rate samples of group delay, **not 3**. Even the plan's own Task 1 note (line 184) says `HALFBAND_GROUP_DELAY_SAMPLES = 11`. Lookahead must grow from 66 → 66+round(total_group_delay_at_input_rate). Recompute precisely; likely 77–80, not 69. Add a DoD that measures end-to-end group delay empirically (impulse in, find output peak) and asserts the signal delay matches.

**M4. Sample-rate hardcoding — 48 kHz / 96 kHz contexts not covered.**
`limiter-processor.js:14` comment says "~1.5ms at 44.1kHz" — the 66-sample lookahead is already not ms-equivalent at 48 kHz. The plan never mentions that `AudioContext` sampleRate varies by device (48 kHz is the browser default on most laptops; user may encounter 96 kHz). Plan must: (a) compute `_lookaheadSize` from `sampleRate` global (ms → samples), and (b) verify halfband FIR performance targets hold at 48 and 96 kHz (stopband moves to fs/2). Add a test: "oversampling round-trip at 48000 and 96000 preserves amplitude ±0.1 dB."

**M5. Mono input handling unspecified in limiter and saturation.**
`limiter-processor.js:33` already handles `!input[0]`, but new TP detection code must handle `input.length === 1` (mono). Plan Task 4 Key Notes line 327 writes `mid = (L+R)/2` without guarding mono — if `input[1]` is undefined, `undefined * 0.5 = NaN` corrupts the detector forever (state rides on the max). Add DoD: "mono input produces finite output and TP tracks |x|."

### should_fix

**S1. Metering UI contract change — `truePeak` value will drop (was too low, will rise) — Goal 4 says "UI needs no change" but value shifts ~0-2 dB.**
`metering-processor.js` currently reports sample-peak as `truePeak`. After fix, values will be **higher** (TP ≥ sample peak). Any saved user preferences/reference screenshots depending on current values shift. Add release-note item. Also: the `dynamicRange` field (line 193) depends on `truePeak` — changing TP silently changes "DR" readout. Call this out explicitly.

**S2. `applyIntensity` interpolates numerically — but `sidechainHpfHz=100` default interpolated with genre=`classical: 40` gives 70 at intensity 50. Task 2 line 238 says "linear interp between 100 and 80" but that's `hiphop`. DoD for classical/jazz should verify interp values (and that the lowered floor still audibly HPFs — at 40 Hz, it barely filters). Consider whether HPF < 60 Hz is useful at all; may want to snap to a minimum.

**S3. Zero-length / small block guard.**
If `blockSize < HALFBAND_TAPS.length` on first call (it will be — AudioWorklet blocks are 128), the upsampler ring buffer must be pre-primed. Plan doesn't state initial-state behavior. Add DoD: "first N output samples of streamed oversampler match batch version (steady-state) within 1e-6 after warmup."

**S4. `renderer.test.ts` regression listed but offline renderer path not detailed.**
Task 4/5 DoD mentions "no regression in `renderer.test.ts`" but offline render (likely used for WAV export) may not go through worklets at all — it uses `dsp/*.ts`. If `dsp/limiter.ts` adds `useTruePeak: boolean` option (Task 4 line 339), existing renderer call sites need review. Add a task note: "audit `renderer.ts` call site of `processLimiter` — update to pass `useTruePeak: true` for parity with worklet."

**S5. E2E TS-001 tolerance is 0.51 — but slider step is 1 Hz.**
`e2e/mastering.spec.ts:67-78` gives 0.51 tolerance to HPF-type sliders because of floating-point display. `sidechainHpfHz` step=1 integer → tolerance should be 0 or 0.01. Plan line 156 inherits 0.51 which is loose. Tighten.

**S6. Parity test file-read path dependency on worktree location.**
Reading `public/worklets/limiter-processor.js` via `fs.readFileSync` in Vitest requires `process.cwd()` = repo root. Vitest sometimes runs from `src/`. Use `path.resolve(__dirname, '../../../../public/worklets/...')` explicitly; plan doesn't call this out.

### suggestion

**U1. Consider exposing `sidechainHpfHz` via AudioWorklet `parameterDescriptors`** (a-rate param) rather than `port.postMessage` — gives sample-accurate automation and avoids the 16ms debounce in `ParameterBridge`. Not required for P0 but worth a note.

**U2. Task 3's inline biquad code duplicates `biquad.ts` — add a generator script.**
Plan says "keep in sync with biquad.ts". Safer pattern: a `scripts/generate-worklet-coeffs.ts` that emits a `.js` snippet imported by the worklet via a build-time copy. Defer if out of scope.

**U3. Aliasing-energy metric (Task 5 line 383) — "20 dB lower" is weak.**
Pro specs target ≥60 dB alias rejection. 20 dB just beats the IIR hack. Strengthen to ≥40 dB or document why 20 is acceptable for P0.

**U4. `podcast: 150` default HPF — aggressive for a podcast with music beds.**
Lower to 120 Hz unless content-specific testing justifies 150.

**U5. StrictMode double-mount not addressed for new worklet state.**
Plan line 78 mentions it in Context; no Task explicitly verifies new coefficient-precompute logic is idempotent on re-init. Add a bullet to Task 3/4/5/6 DoD: "init/dispose cycle leaves no stale state."

---

## Task Ordering / Blocking

No circular dependencies. Task 1 correctly gates 4/5/6. Task 2 correctly gates 3 and 7. **However:** Task 6 claims "conceptually depends on Task 4 for inline FIR pattern but can proceed in parallel" — if both write the parity test, there's a merge conflict. Designate Task 4 as sole owner of `halfband-parity.test.ts`; Task 5/6 extend the existing test.

## Test Coverage Gaps

1. **No DC-offset test** on oversampler (DC should pass unchanged).
2. **No saturation-at-zero-drive test** — worklet early-returns at `_drive===0` (line 32); ensure rewrite preserves this bypass.
3. **No A/B null test** for sidechain HPF when `hz=20` (near min) — should be near-transparent on music, but 2nd-order Butterworth at 20 Hz still has phase shift; document.
4. **No CPU regression test** despite Risk table claiming ~0.5%. Risk row mentions "<500 ms for 60s buffer" but it's not in any DoD. Add to Task 6 DoD.

---

## Summary

**Verdict:** Plan is technically strong and well-researched but has **4 must_fix** issues that would break implementation (M3 group delay math is mathematically wrong and is the highest-risk item). With must_fix and should_fix items addressed, plan is ready for implementation.

**Score estimate:** 72/100 as written; 88/100 with fixes.
