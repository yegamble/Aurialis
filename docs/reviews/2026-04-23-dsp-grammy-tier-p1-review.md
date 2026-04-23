# P1 Plan Adversarial Review — 2026-04-23

Reviewer: brahma-analyzer (independent)
Subject: `docs/plans/2026-04-23-dsp-grammy-tier-p1.md`

## must_fix

### M1. `saturation-alias.test.ts` does not exist
Task 3 DoD says "extend that test to parameterize over 4 modes". Grep of `src/lib/audio/dsp/__tests__` returns no such file. Either P0 never shipped it, or the path is wrong. **Fix:** Task 3 must *create* the alias test (or locate the real file — possibly `oversampling-alias.test.ts` or inside `halfband-parity.test.ts`) before parameterizing. Otherwise the DoD is unverifiable.

### M2. Tape shaper formula is algebraically broken
Plan §Task 3 states the shaper as `x / (1 + |x·drive|^1.5)^(1/1.5)`, then immediately offers the "approximation" `x / cbrt(1 + (drive·x)^3)`. The cbrt form uses exponent **3**, not **1.5** — these are **different curves**. The cubic form is much harder-clipping than the 1.5 form; at drive=50% it will limit, not gently soften. Pick one and match the unit tests to the actual formula shipped in the worklet. **Fix:** Commit to `p=1.5` everywhere, or specify that cbrt is used and update the "tape-like curve" claim accordingly.

### M3. Biquads running at 4× rate with base-rate coefficients
Plan §Task 3: "Biquads run at the 4× rate (inside the oversampling block)". Coefficients are computed from `highShelfCoeffs(12000, -3, 1.0, sampleRate)` with **base** `sampleRate`. If the biquad runs on 4×-upsampled samples, coefficients must be designed at `4 × sampleRate` — otherwise the shelf lands at 3 kHz, not 12 kHz. **Fix:** Either compute coefficients at `4 × sampleRate` and comment this explicitly, or run the pre-filter *before* oversampling (at base rate) for the colored pre-shaping and keep only the waveshaper inside the 4× block.

### M4. `max(fast_env, slow_env)` during release increases hold, does NOT reduce pumping directly
The plan asserts this reduces pumping. That is actually **wrong framing**: fast decays faster than slow, so during release `slow > fast` almost immediately → effective env follows the slow envelope → GR *holds longer* → this is "auto-hold", not "auto-release". SSL's actual G-Series auto uses a **dual-release** where recovery rate depends on how long the over-threshold state persisted. The `max()` formulation can cause *under*-compression on the very next transient because GR hasn't recovered yet — opposite of "transients recover fast". **Fix:** Correct the Truth-1 language and algorithm description. Also add a truth that explicitly measures transient punch preservation — not just variance. Variance can drop while punch is destroyed.

### M5. `autoRelease=0` backward-compat claim is undertested
DoD §Task 1: "output identical to single-envelope behavior within 1e-6". But if `_envSlow` is always maintained (plan says zero-init and survives block boundaries), it still consumes state — fine. The real risk: the plan never gates `_envSlow` updates on `autoRelease > 0`. If the slow env is computed every sample regardless, there's no correctness bug but there IS a perf hit. More importantly, the test must verify *sample-exact* parity vs the P0 compressor output on a varied signal, not just silence. **Fix:** Add explicit test: run P0-era compressor vs P1 compressor with `autoRelease=0` on a 10-second pink-noise input; bit-exact (or ≤ 1e-9) diff.

## should_fix

### S1. LRA with < 3 s warmup: UI shows `---` forever on short clips
Gotchas say "return 0 before warmup", UI shows `---` when `lra <= 0`. But LRA of a very compressed real mix can be *legitimately* 0.0–0.5 LU → UI stays stuck on `---`. **Fix:** Use a separate sentinel (e.g., return `-1` or expose `lraReady: boolean`), and only show `---` when not ready.

### S2. Tube DC trim is only correct at input `x=0`
`DC_TRIM = tanh(bias)/tanh(driveFactor)` subtracts the DC component **of a zero-input signal**. For non-zero signals, asymmetric clipping produces signal-dependent DC that this static trim does *not* remove — the output still drifts on content with consistent polarity asymmetry (kick drums, bass). **Fix:** Add a high-pass (e.g., 20 Hz single-pole) after the tube shaper to remove drifting DC; document static trim as "nominal offset removal" only. Add a test with a polarity-asymmetric signal.

### S3. Correlation with τ=100 ms at 30 Hz poll → visible aliasing
One-pole τ=100ms has ~1.6 Hz cutoff. 30 Hz UI poll is fine in Nyquist terms but visually the meter will *lag* 100 ms behind stereo events. The real problem: on fast panning content the UI displays *smoothed mono-ness* rather than instant correlation. Document this, OR add a peak-hold so sudden anti-phase events are visible for ~500 ms. **Fix:** Add "corrPeakMin" (worst-case negative in last 500 ms) to payload; color the readout by that, display smoothed number.

### S4. `ParameterBridge` signature claim is wrong
Plan says ParameterBridge has signature `(key, value: number)`. Actual code (`parameter-bridge.ts:39`) calls `this._engine.updateParameter(key, params[key])` — the value is implicitly `AudioParams[keyof AudioParams]`. The signature to widen is on `AudioEngine.updateParameter` and `ProcessingChain.updateParam` (chain.ts:92 is typed `value: number`). **Fix:** Correct the Gotcha paragraph; the refactor target is `engine.updateParameter` + `chain.ts:updateParam`, not `parameter-bridge.ts`.

### S5. `applyIntensity` refactor under-specified for mixed genre presets
Plan says "if `typeof DEFAULT_PARAMS[key] === 'number'`, interpolate; else copy preset value". But the current loop at `presets.ts:247-251` casts `as number` unconditionally. With `satMode` added, the cast would silently coerce a string. **Fix:** Use a runtime guard **and** replace `as number` casts with a properly narrowed helper. Add test for `applyIntensity('pop', 50)` → `satMode === 'clean'` (default, not genre) — the plan's DoD conflates intensity-0 vs intensity-50 behavior.

### S6. No Task touches `MeteringData` default shape in `audio-store`
`src/types/audio.ts` has `MeteringData` but no default object exported. Task 4 mentions updating `audio-store.ts` defaults but Task 4's Files list says "Modify: src/lib/stores/audio-store.ts" — OK — but the DoD doesn't assert initial payload shape, and no grep confirms where `MeteringData` is *constructed*. If it's constructed in multiple places (engine, store, worklet message handler), all must be updated. **Fix:** Audit every `MeteringData` construction site; add DoD bullet to Task 4.

### S7. Mode-switch "no discontinuity" test is weak
Threshold of `0.1 × amplitude` is ~−20 dBFS — a huge click. A real click under that threshold is still audible. **Fix:** Tighten to `0.01 × amplitude` (−40 dBFS) OR measure spectral content above 10 kHz for 10 ms after switch; assert < −60 dBFS.

## suggestion

### Sg1. Branch prediction concern (inline 4-mode dispatch)
A `switch(satMode)` inside the 4× oversampled inner loop is called 4× per input sample. V8 will specialize, but cold starts add cost. Consider: hoist the dispatch outside the sample loop by assigning `const shaperFn = MODES[this._satMode]` once per block. Minor perf win, cleaner code.

### Sg2. Extreme-drive tests missing
Plan tests modes at `drive=50%`. Add drive=100% for each mode to verify no NaN/Inf and alias rejection holds at worst-case. Particularly tube — `tanh(big·x + 0.1)` with large drive is numerically fine, but verify.

### Sg3. E2E TS-001 doesn't verify audible effect
Only checks `aria-pressed`. Add integration test: toggle → param post to worklet → measure GR variance.

### Sg4. Task 5 pill selector keyboard nav
Plan says "native `<button>` elements, standard tab order". Better pattern for segmented control: `role="radiogroup"` with arrow-key nav between `role="radio"` children. Just `aria-pressed` buttons are technically fine but less idiomatic for a mutually-exclusive selection.

### Sg5. Scope gap: `onParamChange` signature
Task 5 notes "`onParamChange` signature must widen" but there's no Task owning this refactor. `master/page.tsx` and `AdvancedMastering.tsx` both reference it. Add explicit DoD bullet to Task 2 or Task 5 calling out the signature site.

---

**Severity tally:** 5 must_fix, 7 should_fix, 5 suggestion. Plan is fundamentally sound but M2 (algebraic mismatch), M3 (biquad sample-rate), and M4 (algorithm naming is inverted from behavior) are blocking — they cause either wrong audio or wrong marketing. Fix before approval.
