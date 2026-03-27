# Aurialis Phase 2: DSP Processing Chain

Created: 2026-03-27
Status: PENDING
Approved: Yes
Iterations: 0
Worktree: No
Type: Feature

## Summary

**Goal:** Implement production-quality DSP processing chain with AudioWorklet processors (compressor, limiter, saturation, LUFS metering), 5-band parametric EQ, stereo width, signal chain builder, genre/platform presets, A/B bypass, and parameter bridge — all with extensive testing verifying each processor audibly affects audio.

**Architecture:** DSP algorithms extracted as pure TypeScript functions in `src/lib/audio/dsp/` for thorough unit testing. Runtime AudioWorklet processors in `public/worklets/` implement the same algorithms. Node wrappers in `src/lib/audio/nodes/` manage worklet lifecycle and parameter updates from the main thread. A processing chain builder connects: InputGain → EQ → Compressor → Saturation → StereoWidth → Limiter → OutputGain → Metering → Analyser → Destination. Zustand param changes flow through a parameter bridge to engine setters.

**Tech Stack:** Web Audio API (AudioWorklet, BiquadFilterNode, ChannelSplitter/Merger), TypeScript, Vitest, Playwright

## Scope

### In Scope
- 4 AudioWorklet processors: compressor, limiter, saturation, metering
- Pure DSP math functions: gain computation, envelope follower, K-weighting, oversampling, waveshaping
- 5-band parametric EQ using native BiquadFilterNode
- Stereo width processor using ChannelSplitter/Merger
- Processing chain builder with bypass per node
- Parameter bridge: Zustand store → engine setters
- 8 genre presets + 5 platform presets
- A/B bypass comparison
- Unit tests for all DSP math (pure functions)
- Integration tests verifying signal modification
- Playwright E2E tests verifying meters respond to parameter changes
- Programmatic WAV test signal generation

### Out of Scope
- Export/offline rendering (Phase 3)
- UI component polish/accessibility (Phase 4)
- GR meter visualization, EQ curve SVG (Phase 5)
- Pre-analysis/auto-master suggestions (Phase 5)
- Undo/redo, session persistence (Phase 5)

## Approach

**Chosen:** Full AudioWorklet DSP with 4x oversampling

**Why:** Maximum control over DSP algorithms, real-time gain reduction metering, true-peak detection, and professional-grade processing — at the cost of more implementation complexity and worklet loading overhead.

**Alternatives considered:**
- *Hybrid native+worklet* — Uses browser's DynamicsCompressorNode for compression. Rejected because it doesn't expose gain reduction data and has limited parameter control.
- *Native-only* — All built-in nodes. Rejected because no true-peak limiting, no LUFS metering, no oversampled saturation.

## Context for Implementer

> Write for an implementer who has never seen the codebase.

- **Patterns to follow:**
  - `src/lib/audio/engine.ts` — Existing AudioEngine class with init(), play(), pause(), stop(), seek(). Signal chain currently: inputGain → outputGain → analyser → destination. The processing chain inserts between inputGain and outputGain.
  - `src/lib/audio/visualization.ts` — Pure function pattern (no class state). Follow for DSP math.
  - `src/lib/stores/audio-store.ts` — Zustand store with AudioParams interface containing all 19 parameter keys. The parameter bridge subscribes to store changes.

- **Conventions:**
  - Files in `src/lib/audio/` for core audio logic
  - Tests in `__tests__/` sibling directories
  - `"use client"` directive on all React components/hooks
  - AudioWorklet JS files in `public/worklets/` (served statically by Next.js)
  - AudioParam changes use `linearRampToValueAtTime()` for click-free transitions

- **Key files:**
  - `src/lib/audio/engine.ts:57-73` — init() creates AudioContext, gain nodes, analyser. Must be extended to load worklets.
  - `src/lib/audio/engine.ts:106-139` — play() creates BufferSourceNode, connects to inputGain. Source → inputGain connection stays, processing chain is after inputGain.
  - `src/lib/stores/audio-store.ts:63-83` — defaultParams defines all 19 parameter defaults with their value ranges.
  - `src/hooks/useAudioEngine.ts` — React hook wrapping engine. Returns engine ref for direct access.
  - `src/app/master/page.tsx` — Master page using useAudioEngine and useVisualization hooks.
  - `next.config.ts` — COOP/COEP headers already configured for AudioWorklet SharedArrayBuffer.
  - `src/test/setup.ts` — Mock AudioContext with createGain, createAnalyser, createBiquadFilter, createBufferSource, createChannelSplitter, createChannelMerger. Must be extended for audioWorklet.addModule mock.

- **Gotchas:**
  - AudioWorklet processors are plain JS (no TypeScript, no imports from main bundle). DSP math must be duplicated or inlined.
  - `audioContext.audioWorklet.addModule()` requires COOP/COEP headers (already set).
  - BiquadFilterNode coefficients for K-weighting filters depend on sample rate — must recalculate for rates other than 48kHz using bilinear transform.
  - AudioWorkletProcessor.process() returns `true` to keep alive — returning `false` kills the node.
  - Parameter messages to worklets use `port.postMessage()` and worklet reads in `process()` or via `parameterDescriptors`.

- **Domain context:**
  - Compressor: Reduces dynamic range. Envelope follower tracks signal level (RMS or peak), gain computer applies threshold/ratio/knee, smoothing applies attack/release time constants.
  - Limiter: Brick-wall peak prevention. Uses lookahead buffer to anticipate peaks, applies fast gain reduction to enforce ceiling. True peak detection uses oversampled signal.
  - Saturation: Harmonic distortion via waveshaping (tanh). Oversampling prevents aliasing from generated harmonics.
  - LUFS (ITU-R BS.1770-4): Loudness measurement standard. K-weighting filters + gated loudness integration over time windows (400ms momentary, 3s short-term, full integrated).
  - EQ: 5-band parametric using biquad filters. Low shelf, 3 peaking, high shelf.
  - Stereo Width: Mid/side processing. Mid = (L+R)/2, Side = (L-R)/2. Width scales side level.

## Assumptions

- COOP/COEP headers in next.config.ts are correctly served in both dev and production — supported by `next.config.ts:4-12` — Tasks 2, 4 depend on this
- MockAudioContext in setup.ts can be extended with `audioWorklet.addModule` mock without breaking existing tests — supported by `src/test/setup.ts:5-80` — Tasks 2, 4 depend on this
- BiquadFilterNode provides professional-quality IIR filters matching dedicated plugin implementations — supported by Web Audio spec — Task 3 depends on this
- The existing AudioEngine event system (on/off/emit) can carry metering data from worklet nodes — supported by `engine.ts:234-243` — Tasks 4, 5 depend on this

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| AudioWorklet addModule() fails in dev (path resolution) | Medium | High | Test with both `npm run dev` and `npm run build && npm start`. Use absolute path `/worklets/xxx.js`. |
| 4x oversampling too CPU-heavy for real-time | Low | Medium | Benchmark with 10s buffer. If >50% CPU, reduce to 2x for real-time, keep 4x for offline export. |
| LUFS measurement inaccuracy | Medium | High | Validate against EBU R128 reference: -23 LUFS 1kHz tone at -23 dBFS must read -23.0 ±0.5 LUFS in Phase 2 unit tests. Tighter ±0.1 validation deferred to Phase 3 with offline rendering. |
| Parameter changes cause audio clicks | Medium | Medium | All AudioParam changes use linearRampToValueAtTime with 10ms ramp. Worklet params use exponential smoothing. |
| Worklet-to-main-thread metering latency | Low | Low | port.postMessage at 30Hz max (every ~33ms). UI meters already smoothed via rAF. |

## Goal Verification

### Truths
1. Loading a file and playing back with neutral parameters (all EQ at 0, satDrive=0, stereoWidth=100, threshold=0, ratio=1:1) produces audible output identical to Phase 1. Note: satDrive default must be changed from 40 to 0 in audio-store.ts to ensure neutral defaults.
2. Adjusting EQ band gains audibly changes the frequency balance
3. Increasing compressor threshold and ratio audibly reduces dynamic range
4. Increasing saturation drive adds audible harmonic content
5. The limiter prevents output from exceeding the ceiling (measurable via peak detection)
6. LUFS metering displays a numeric value that changes when processing is applied
7. A/B bypass toggle produces an audible difference between processed and unprocessed audio
8. Genre/platform presets change multiple parameters simultaneously

### Artifacts
- `public/worklets/compressor-processor.js` — real compressor implementation
- `public/worklets/limiter-processor.js` — real limiter with lookahead
- `public/worklets/saturation-processor.js` — real saturation with oversampling
- `public/worklets/metering-processor.js` — real LUFS measurement
- `src/lib/audio/dsp/` — pure function DSP math (tested)
- `src/lib/audio/nodes/` — node wrappers
- `src/lib/audio/chain.ts` — processing chain builder
- `src/lib/audio/presets.ts` — genre/platform presets

## E2E Test Scenarios

### TS-001: Audio Processing Affects Playback
**Priority:** Critical
**Preconditions:** App running, no file loaded
**Mapped Tasks:** Task 4, Task 5, Task 6

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/` | Upload page visible with drag zone |
| 2 | Upload a test WAV file via file input | File accepted, redirected to `/master` |
| 3 | Wait for waveform to render | Waveform bars visible in canvas container |
| 4 | Click play button | Play button changes to pause icon |
| 5 | Switch to advanced mode | Advanced controls panel visible with EQ/Dynamics/Saturation sections |
| 6 | Adjust EQ 1kHz slider to +12 dB | Slider updates, level meters continue to respond |
| 7 | Click A/B bypass button | Button toggles state, indicating comparison mode |

### TS-002: Preset Selection Updates Parameters
**Priority:** High
**Preconditions:** File loaded on `/master`, advanced mode active
**Mapped Tasks:** Task 5, Task 6

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/master` with file loaded | Master page renders with controls |
| 2 | Switch to advanced mode | Advanced panel visible |
| 3 | Click "Spotify" output preset button | Spotify button shows active state |
| 4 | Read Target LUFS slider value | Shows -14.0 LUFS |
| 5 | Click "Apple Music" output preset button | Apple Music button shows active state |
| 6 | Read Target LUFS slider value | Shows -16.0 LUFS |

### TS-003: Level Meters Respond to Audio
**Priority:** High
**Preconditions:** File loaded, playback active
**Mapped Tasks:** Task 4, Task 6

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Load file and start playback | Audio playing, meters visible in right sidebar |
| 2 | Snapshot the level meter area | L/R bars have non-zero width, LUFS value is not "---" |
| 3 | Stop playback | Meters return to zero/quiet state |

## Progress Tracking

- [x] Task 1: DSP math library (pure functions)
- [x] Task 2: AudioWorklet processors
- [x] Task 3: Node wrappers + EQ + Stereo Width
- [x] Task 4: Processing chain + Engine integration
- [x] Task 5: Parameter bridge + Presets
- [ ] Task 6: A/B bypass + UI wiring
- [ ] Task 7: Integration tests with programmatic test signals
- [ ] Task 8: Playwright E2E + CI workflow + commit/push

**Total Tasks:** 8 | **Completed:** 5 | **Remaining:** 3

## Implementation Tasks

### Task 1: DSP Math Library

**Objective:** Create pure TypeScript functions implementing all DSP algorithms — testable without Web Audio.

**Dependencies:** None

**Files:**
- Create: `src/lib/audio/dsp/envelope.ts` — RMS envelope follower, peak detector
- Create: `src/lib/audio/dsp/compressor.ts` — Gain computer (threshold/ratio/knee), gain smoothing
- Create: `src/lib/audio/dsp/limiter.ts` — Lookahead gain reduction, true peak detection via 4x sinc interpolation
- Create: `src/lib/audio/dsp/saturation.ts` — tanh waveshaping, 4x oversampling (upsample/downsample with LP filter)
- Create: `src/lib/audio/dsp/lufs.ts` — K-weighting biquad coefficients, gated loudness computation (400ms/3s/integrated)
- Create: `src/lib/audio/dsp/biquad.ts` — Biquad filter implementation for K-weighting (process function, coefficient calculation)
- Create: `src/lib/audio/dsp/oversampling.ts` — Upsample/downsample with anti-alias LP filter
- Test: `src/lib/audio/dsp/__tests__/compressor.test.ts`
- Test: `src/lib/audio/dsp/__tests__/limiter.test.ts`
- Test: `src/lib/audio/dsp/__tests__/saturation.test.ts`
- Test: `src/lib/audio/dsp/__tests__/lufs.test.ts`
- Test: `src/lib/audio/dsp/__tests__/oversampling.test.ts`

**Key Decisions / Notes:**
- Compressor gain computer: `gain = threshold + (input - threshold) / ratio` with soft knee smoothing. Attack/release as exponential coefficients: `coeff = exp(-1 / (time_seconds * sampleRate))`.
- Limiter lookahead: Circular buffer of 66 samples at 44.1kHz (~1.5ms). True peak via 4-point sinc interpolation on 4x upsampled signal.
- Saturation: `output = tanh(drive * input) / tanh(drive)` normalized for unity gain at low levels. Drive 0-100% maps to factor 1-10.
- LUFS K-weighting: Pre-filter (high shelf +4dB ~1.5kHz) + RLB (highpass ~38Hz). Published 48kHz coefficients, bilinear transform for other rates.
- All functions operate on Float32Array buffers, return Float32Array or scalar values.

**Definition of Done:**
- [ ] All tests pass
- [ ] No diagnostics errors
- [ ] Compressor: 1kHz sine at -10 dBFS with threshold=-20, ratio=4:1 produces ~7.5 dB gain reduction
- [ ] Limiter: Signal exceeding ceiling is reduced to ceiling ±0.1 dB
- [ ] Saturation: tanh waveshaping produces non-zero harmonic content (THD > 0) at drive > 0
- [ ] LUFS: -23 dBFS 1kHz sine measures approximately -23 LUFS (±0.5 LUFS for unit test tolerance)
- [ ] 4x oversampling: Output length equals input length after upsample→downsample

**Verify:**
- `npx vitest run src/lib/audio/dsp/`

---

### Task 2: AudioWorklet Processors

**Objective:** Create plain JS AudioWorklet processor files that implement the DSP algorithms for real-time audio processing.

**Dependencies:** Task 1 (algorithms defined)

**Files:**
- Create: `public/worklets/compressor-processor.js` — Envelope follower + gain computer + smoothing + makeup gain
- Create: `public/worklets/limiter-processor.js` — Lookahead buffer + true peak detection + fast attack/program-dependent release + ceiling enforcement
- Create: `public/worklets/saturation-processor.js` — 4x oversampling + tanh waveshaping + dry/wet mix
- Create: `public/worklets/metering-processor.js` — K-weighting + momentary/short-term/integrated LUFS + true peak, sends data via port.postMessage

**Key Decisions / Notes:**
- These are plain JS files — no TypeScript, no module imports. DSP math is inlined.
- Each processor extends `AudioWorkletProcessor` and implements `process(inputs, outputs, parameters)`.
- Parameters received via `port.onmessage` (object with param values) rather than AudioParam descriptors for simplicity and fewer restrictions.
- Metering processor posts data every ~33ms (30Hz) to avoid flooding the main thread.
- All processors return `true` from `process()` to stay alive.
- Compressor/limiter send gain reduction data via port.postMessage for future GR meter display.

**Definition of Done:**
- [ ] All 4 worklet files exist and are syntactically valid JS (`node --check` passes)
- [ ] Each processor class extends AudioWorkletProcessor
- [ ] Each processor handles stereo (2-channel) input/output
- [ ] Build succeeds (worklets in public/ are served statically)
- [ ] Code review confirms DSP logic in each worklet matches the corresponding pure function from Task 1 (compressor-processor.js ↔ compressor.ts, etc.)

**Verify:**
- `npm run build` (verifies worklets are in public/)
- Manual syntax check: `node --check public/worklets/compressor-processor.js`

---

### Task 3: Node Wrappers + EQ + Stereo Width

**Objective:** Create TypeScript wrappers around AudioWorkletNode for each processor, plus EQ using BiquadFilterNode and stereo width using ChannelSplitter/Merger.

**Dependencies:** Task 2 (worklet files exist)

**Files:**
- Create: `src/lib/audio/nodes/compressor.ts` — AudioWorkletNode wrapper. Methods: setThreshold(), setRatio(), setAttack(), setRelease(), setKnee(), setMakeup(). Receives GR via port.onmessage.
- Create: `src/lib/audio/nodes/limiter.ts` — AudioWorkletNode wrapper. Methods: setCeiling(), setRelease(). Receives GR + true peak.
- Create: `src/lib/audio/nodes/saturation.ts` — AudioWorkletNode wrapper. Methods: setDrive(), setMix().
- Create: `src/lib/audio/nodes/metering.ts` — AudioWorkletNode wrapper. Receives LUFS + true peak via port.onmessage.
- Create: `src/lib/audio/nodes/eq.ts` — 5-band parametric EQ using BiquadFilterNode: lowshelf 80Hz, peaking 250Hz, peaking 1kHz, peaking 4kHz, highshelf 12kHz. Methods: setBandGain(band, db).
- Create: `src/lib/audio/nodes/stereo-width.ts` — ChannelSplitter → mid/side computation → width scaling → ChannelMerger. Methods: setWidth(), setBassMonoFreq(), setMidGain(), setSideGain().
- Test: `src/lib/audio/nodes/__tests__/eq.test.ts`
- Test: `src/lib/audio/nodes/__tests__/stereo-width.test.ts`

**Key Decisions / Notes:**
- Worklet node wrappers create AudioWorkletNode in constructor, require pre-loaded worklet modules.
- EQ bands are connected in series: input → lowshelf → peak1 → peak2 → peak3 → highshelf → output.
- Each EQ band gain defaults to 0 dB (flat). Range: -12 to +12 dB.
- Stereo width at 100% = original, 0% = mono, 200% = exaggerated stereo.
- All node wrappers implement a common interface: `connect(destination)`, `disconnect()`, `dispose()`.
- Update `src/test/setup.ts` to mock `audioWorklet.addModule()` on MockAudioContext and add AudioWorkletNode mock.

**Definition of Done:**
- [ ] All tests pass
- [ ] No diagnostics errors
- [ ] EQ: Creating a 5-band EQ with default params connects 5 BiquadFilterNodes in series
- [ ] Stereo width: setWidth(0) produces mono output (left = right)
- [ ] All worklet node wrappers can be instantiated with mocked AudioContext

**Verify:**
- `npx vitest run src/lib/audio/nodes/`

---

### Task 4: Processing Chain + Engine Integration

**Objective:** Build the processing chain connecting all DSP nodes and integrate it into the existing AudioEngine.

**Dependencies:** Task 3 (node wrappers exist)

**Files:**
- Create: `src/lib/audio/chain.ts` — ProcessingChain class: creates and connects InputGain → EQ → Compressor → Saturation → StereoWidth → Limiter → OutputGain → Metering → Analyser → Destination. Supports per-node bypass.
- Modify: `src/lib/audio/engine.ts` — Add `loadWorklets()` (called during init), `buildProcessingChain()`, `updateParameter()`. Restructure signal chain to route through processing chain.
- Modify: `src/types/audio.ts` — Add "metering" and "paramchange" to AudioEngineEventType. Add ProcessingChainParams interface. **MUST FIX:** Replace the stub MeteringData (leftLevel/rightLevel/leftPeak/rightPeak) with the full Phase 2 shape (leftLevel/rightLevel/lufs/truePeak/dynamicRange) and update audio-store.ts to import it from here instead of redeclaring.
- Modify: `src/lib/stores/audio-store.ts` — Remove duplicate MeteringData declaration, import from `@/types/audio`. Change satDrive default from 40 to 0 for neutral defaults.
- Modify: `src/test/setup.ts` — Add audioWorklet.addModule mock, AudioWorkletNode mock.
- Test: `src/lib/audio/__tests__/chain.test.ts`
- Test: Update `src/lib/audio/__tests__/engine.test.ts` with processing chain tests

**Key Decisions / Notes:**
- `loadWorklets()` calls `audioContext.audioWorklet.addModule()` for each worklet file. Called once during `init()`. All addModule() calls must be awaited and wrapped in try/catch. If addModule() rejects (path, CSP, suspended context), set `processingChainAvailable=false` and fall back to direct inputGain → outputGain path. Log the rejection reason. Add test: loadWorklets() rejects → engine falls back to bypass without throwing.
- Processing chain is built after worklets are loaded. If worklet loading fails (unsupported browser), fall back to bypass mode (direct inputGain → outputGain).
- Bypass per node: disconnect node from chain, create direct connection around it.
- Metering node is always last before analyser — it measures the final output.
- Engine emits "metering" events when metering worklet posts data. useAudioEngine hook syncs this to Zustand metering state.
- Current signal chain `engine.ts:69-72` changes from `inputGain → outputGain → analyser → dest` to `inputGain → [chain] → outputGain → analyser → dest`.

**Definition of Done:**
- [ ] All tests pass
- [ ] No diagnostics errors
- [ ] Engine init() loads worklets and builds processing chain
- [ ] Audio plays through the full chain with default (neutral) params
- [ ] Per-node bypass works (connecting around bypassed node)
- [ ] Metering data flows from worklet → engine event → hook → Zustand store
- [ ] Build succeeds with no type errors

**Verify:**
- `npx vitest run src/lib/audio/`
- `npm run build`

---

### Task 5: Parameter Bridge + Presets

**Objective:** Connect Zustand store parameter changes to engine setters, implement genre and platform presets.

**Dependencies:** Task 4 (engine has updateParameter method)

**Files:**
- Create: `src/lib/audio/parameter-bridge.ts` — Subscribes to Zustand store, calls engine.updateParameter() on change. Debounces rapid slider movements (16ms). Maps simple mode (intensity + genre + toggles) to advanced parameter values.
- Create: `src/lib/audio/presets.ts` — Genre presets: Pop, Rock, HipHop, Electronic, Jazz, Classical, R&B, Podcast → complete AudioParams objects. Platform presets: Spotify (-14 LUFS/-1 dBTP), Apple Music (-16/-1), YouTube (-14/-1), SoundCloud (-14/-1), CD (-9/-0.1). Intensity 0-100 interpolates between neutral and genre target.
- Test: `src/lib/audio/__tests__/presets.test.ts`
- Test: `src/lib/audio/__tests__/parameter-bridge.test.ts`

**Key Decisions / Notes:**
- Parameter bridge uses `useAudioStore.subscribe()` to react to param changes.
- Debounce at 16ms (~60fps) to prevent overwhelming AudioParam ramps during fast slider drags.
- Simple mode mapping: intensity knob (0-100) linearly interpolates between `defaultParams` and the selected genre's target params. Quick toggles (cleanup, warm, bright, wide, loud) apply additive offsets to specific params.
- Platform presets set targetLufs and ceiling. Genre presets set all other params.
- When switching from simple to advanced mode, current interpolated params become the advanced params (no jump).

**Definition of Done:**
- [ ] All tests pass
- [ ] No diagnostics errors
- [ ] Changing a Zustand param triggers engine.updateParameter() within 16ms
- [ ] Genre presets produce valid AudioParams (all values within documented ranges)
- [ ] Platform presets set correct LUFS/ceiling targets
- [ ] Intensity interpolation: 0 = neutral, 100 = full genre preset values

**Verify:**
- `npx vitest run src/lib/audio/__tests__/presets.test.ts src/lib/audio/__tests__/parameter-bridge.test.ts`

---

### Task 6: A/B Bypass + UI Wiring

**Objective:** Add A/B comparison toggle and wire all mastering UI controls to real processing parameters.

**Dependencies:** Task 5 (parameter bridge active)

**Files:**
- Create: `src/lib/audio/bypass.ts` — A/B toggle: when active, disconnects processing chain and routes inputGain directly to outputGain for instant comparison.
- Create: `src/components/mastering/ABToggle.tsx` — Toggle button for A/B comparison. Shows "A" (processed) / "B" (bypass) state.
- Modify: `src/app/master/page.tsx` — Initialize parameter bridge on mount. Add ABToggle to transport controls. Wire SimpleMastering genre/toggles to real preset system. Wire AdvancedMastering params to Zustand store (already partially done). Add `data-testid="mode-toggle-advanced"` and `data-testid="mode-toggle-simple"` to mode toggle buttons for E2E test selectors.
- Modify: `src/hooks/useAudioEngine.ts` — Add setBypass(), metering event handler that updates Zustand metering state.
- Test: `src/lib/audio/__tests__/bypass.test.ts`

**Key Decisions / Notes:**
- A/B bypass is separate from per-node bypass in the chain. It bypasses the ENTIRE processing chain.
- When bypass is active, audio routes: inputGain → outputGain (skipping EQ, compressor, saturation, stereo, limiter).
- Metering node stays connected even in bypass mode — so meters show unprocessed levels.
- ABToggle placed next to play/pause controls for quick access.
- SimpleMastering's intensity/genre/toggles now call into the preset system which sets real params.
- AdvancedMastering already writes to Zustand params — the parameter bridge handles the rest.

**Definition of Done:**
- [ ] All tests pass
- [ ] No diagnostics errors
- [ ] A/B toggle switches between processed and bypass audio
- [ ] Simple mode: changing genre/intensity updates the real processing parameters
- [ ] Advanced mode: slider changes audibly affect the processing
- [ ] LUFS value displays in the level meter (not "---") during playback

**Verify:**
- `npx vitest run src/lib/audio/__tests__/bypass.test.ts`
- `npm run build`

---

### Task 7: Integration Tests with Programmatic Test Signals

**Objective:** Create programmatic WAV test signal generator and integration tests that verify DSP processors actually modify audio characteristics.

**Dependencies:** Task 4 (full chain operational)

**Files:**
- Create: `src/test/signal-generator.ts` — Generate programmatic test signals as Float32Array: sine wave (any frequency/amplitude), white noise, silence, impulse, swept sine. Also create AudioBuffer-like objects for testing.
- Create: `src/lib/audio/dsp/__tests__/integration.test.ts` — Integration tests:
  - Compressor reduces peak level of signal above threshold
  - Limiter enforces ceiling on signal exceeding ceiling
  - Saturation adds harmonics (output spectrum differs from input)
  - EQ: +12 dB at 1kHz increases 1kHz component amplitude
  - Full chain: process signal through all stages, verify output differs from input
  - LUFS: -23 dBFS 1kHz sine at 48kHz measures approximately -23 LUFS
- Test: `src/test/__tests__/signal-generator.test.ts` — Verify signal generator produces correct waveforms

**Key Decisions / Notes:**
- Test signals are generated as Float32Array, wrapped in mock AudioBuffer objects. No actual WAV files needed for unit/integration tests.
- Integration tests use the DSP pure functions directly (not through AudioWorklets) to verify algorithm correctness.
- Key test: process a known signal through compressor with known params, verify gain reduction matches expected value within tolerance.
- LUFS test: Use published EBU R128 test methodology. Generate 1kHz sine at -23 dBFS at 48kHz, verify measurement is -23.0 ±0.5 LUFS.
- Signal generator also used by Playwright E2E tests (Task 8) to create test files.

**Definition of Done:**
- [ ] All tests pass
- [ ] No diagnostics errors
- [ ] Signal generator produces correct sine wave (frequency verified via zero crossings)
- [ ] Compressor integration test: input peak -10 dBFS, threshold -20 dB, ratio 4:1 → output peak reduced
- [ ] Limiter integration test: input peak -3 dBFS, ceiling -1 dBTP → output peak ≤ -1 dBTP
- [ ] LUFS integration test: -23 dBFS 1kHz sine → measured LUFS within ±0.5 of -23

**Verify:**
- `npx vitest run src/lib/audio/dsp/__tests__/integration.test.ts src/test/__tests__/signal-generator.test.ts`

---

### Task 8: Playwright E2E + CI Workflow + Commit/Push

**Objective:** Create Playwright E2E tests verifying the mastering UI works end-to-end, update CI workflow, commit all changes and push to GitHub.

**Dependencies:** Task 6, Task 7 (all features operational, integration tested)
**Mapped Scenarios:** TS-001, TS-002, TS-003

**Files:**
- Create: `e2e/mastering.spec.ts` — Playwright tests:
  - TS-001: Upload test signal → play → switch to advanced → adjust EQ → verify meters respond
  - TS-002: Verify preset selection changes slider values
  - TS-003: Verify level meters show values during playback
- Create: `e2e/fixtures/generate-test-wav.ts` — Script to generate a small WAV test file (1kHz sine, 2 seconds, 44.1kHz, 16-bit stereo) for Playwright tests. Run as build step.
- Modify: `.github/workflows/ci.yml` — Ensure test signal generation runs before E2E tests. Add coverage thresholds.
- Modify: `playwright.config.ts` — Add global setup for test signal generation.
- Modify: `package.json` — Add `test:generate-signals` script.

**Key Decisions / Notes:**
- E2E tests use a pre-generated WAV file (created by a setup script, not committed to repo).
- Playwright `setInputFiles()` used to upload the test WAV without actual drag-and-drop.
- Meter assertions check for non-zero values (not exact dB values — that's what unit/integration tests verify).
- CI workflow: lint → typecheck → test (with coverage) → build → e2e.
- After all tests pass: `git add`, `git commit`, `git push origin main`.

**Definition of Done:**
- [ ] All Playwright E2E tests pass locally
- [ ] All Vitest unit/integration tests pass
- [ ] `npm run build` succeeds
- [ ] CI workflow YAML is valid and would pass
- [ ] All changes committed and pushed to GitHub

**Verify:**
- `npx vitest run`
- `npm run build`
- `npx playwright test`
- `git status` (clean working tree after push)

## Open Questions

None — all design decisions resolved.

### Deferred Ideas
- Real-time GR meter visualization component (Phase 5)
- SVG EQ frequency response curve (Phase 5)
- Worklet performance profiling and 2x oversampling fallback option
- WebAssembly DSP for additional performance (future)
