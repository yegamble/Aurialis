# WAV Export Missing Mastering Processing Fix Plan

Created: 2026-04-04
Author: yegamble@gmail.com
Status: VERIFIED
Approved: Yes
Iterations: 0
Worktree: No
Type: Bugfix

## Summary

**Symptom:** Exported WAV file only has EQ and gain applied — compressor, saturation, stereo width, and limiter processing are all missing from the export, even though they play back in real-time.

**Trigger:** Any export via Export WAV button when mastering settings are enabled.

**Root Cause:** `src/lib/audio/renderer.ts:18` — `renderOffline()` builds a chain of only `Source → InputGain → EQ (5 bands) → OutputGain (makeup) → Destination`. The comment on line 9 says "Compressor, limiter, and saturation DSP is applied inline after rendering" but this was **never implemented**. The function returns after `offlineCtx.startRendering()` without applying any of the 4 remaining DSP stages. The real-time chain (`chain.ts:74-81`) processes `EQ → Compressor → Saturation → StereoWidth → Limiter → Metering`, so the exported audio is fundamentally different from what the user hears during playback.

## Investigation

- **Real-time chain** (`chain.ts:74-81`): InputGain → EQ → Compressor → Saturation → StereoWidth → Limiter → Metering → OutputGain
- **Offline renderer** (`renderer.ts:70-78`): Source → InputGain → EQ → OutputGain(makeup) → Destination — **4 DSP stages missing**
- All DSP pure functions already exist and are tested:
  - `dsp/compressor.ts`: `computeGainReduction()`, `makeAttackReleaseCoeffs()`, `applyGainSmoothing()`
  - `dsp/envelope.ts`: `followEnvelope()`
  - `dsp/saturation.ts`: `applySaturation()`, `drivePctToFactor()`
  - `dsp/limiter.ts`: `processLimiter()`, `dbToLin()`
  - Stereo width: M/S encode/decode is pure math (no DSP module exists, but trivial)
- The compressor worklet (`compressor-processor.js`) uses per-sample envelope following with attack/release smoothing + gain reduction + makeup — same algorithm as the DSP pure functions
- `AudioParams` has no `knee` field — worklet defaults to `knee = 6` dB. Offline renderer should match.
- Makeup gain is currently applied as the output gain node (`renderer.ts:68-69`), but in the real-time chain it's applied inside the compressor worklet after gain reduction. Needs to move into the compressor stage.

## Fix Approach

**Chosen:** Inline DSP after OfflineAudioContext EQ render

Keep the OfflineAudioContext for EQ + input gain (native BiquadFilter nodes are accurate and handle sample-rate conversion). After rendering, apply the remaining DSP stages inline on the raw Float32Array channel data in the same order as the real-time chain:

1. **Compressor** — per-sample envelope follower + gain reduction + makeup gain (mirror worklet algorithm using existing `dsp/compressor.ts` and `dsp/envelope.ts` functions)
2. **Saturation** — `applySaturation(channel, drivePctToFactor(params.satDrive))` per channel
3. **Stereo Width** — M/S encode (mid=(L+R)/2, side=(L-R)/2), apply width scaling + mid/side gain, M/S decode
4. **Limiter** — `processLimiter(channel, dbToLin(params.ceiling), ...)` per channel

Remove makeup from the output gain node (it belongs in the compressor stage).

**Why:** Uses existing tested pure DSP functions, avoids AudioWorklet-in-OfflineAudioContext browser issues, follows the existing code's stated intent (the TODO comment). Minimal code change — all DSP functions already exist.

**Alternatives considered:**
- *Full offline chain with AudioWorklets* — AudioWorklet support in OfflineAudioContext is inconsistent across browsers. Rejected for reliability.
- *All-pure-DSP (no OfflineAudioContext)* — Would need to rewrite EQ handling and lose browser-native resampling. More code for no benefit.

**Files:** `src/lib/audio/renderer.ts` (modify), `src/lib/audio/__tests__/renderer.test.ts` (modify)
**Tests:** `src/lib/audio/__tests__/renderer.test.ts`

## Progress

- [x] Task 1: Write regression tests for missing DSP stages
- [x] Task 2: Implement inline DSP in renderer
- [x] Task 3: Verify full suite + build
      **Tasks:** 3 | **Done:** 3

## Tasks

### Task 1: Write regression tests for missing DSP stages

**Objective:** Add tests to `renderer.test.ts` that prove the rendered output applies compressor, saturation, stereo width, and limiter processing — not just EQ.
**Files:** `src/lib/audio/__tests__/renderer.test.ts`
**TDD:**
- Test: "applies compressor gain reduction when signal exceeds threshold" — render with low threshold, high ratio → output RMS should be lower than input RMS
- Test: "applies saturation when satDrive > 0" — render with high satDrive → output should have harmonic content / different waveform than input
- Test: "applies stereo width when stereoWidth != 100" — render with stereoWidth=0 → L and R channels should be identical (mono)
- Test: "applies limiter when signal exceeds ceiling" — render with low ceiling → output peak should not exceed ceiling level
- Test: "applies makeup gain via compressor, not as output gain" — render with makeup > 0 and no compression → output should be louder
- Verify tests FAIL against current implementation (they will, since DSP is missing)
**Verify:** `pnpm test -- --reporter=dot src/lib/audio/__tests__/renderer.test.ts`

### Task 2: Implement inline DSP in renderer

**Objective:** After OfflineAudioContext renders EQ + input gain, apply compressor → saturation → stereo width → limiter inline on channel data. Remove makeup from the output gain node.
**Files:** `src/lib/audio/renderer.ts`
**Implementation:**
1. Remove `outputGain` node (makeup will be part of compressor stage)
2. Connect `eq12k` directly to `offlineCtx.destination`
3. After `startRendering()`, extract channel data from rendered buffer
4. Apply compressor: per-sample envelope + gain reduction + makeup (same algorithm as `compressor-processor.js`, using functions from `dsp/compressor.ts` + `dsp/envelope.ts`)
5. Apply saturation: `applySaturation(channel, drivePctToFactor(params.satDrive))` per channel (skip if satDrive=0)
6. Apply stereo width: M/S encode → scale side by `stereoWidth/100` → apply midGain/sideGain → M/S decode (skip if stereoWidth=100 and midGain=0 and sideGain=0)
7. Apply limiter: `processLimiter(channel, dbToLin(params.ceiling), ...)` per channel
8. Write processed data back into a new AudioBuffer (or modify in-place if getChannelData returns writable arrays)
**TDD:** All Task 1 tests should now PASS
**Verify:** `pnpm test -- --reporter=dot src/lib/audio/__tests__/renderer.test.ts`

### Task 3: Verify

**Objective:** Full test suite, type check, build
**Verify:** `pnpm test -- --reporter=dot && pnpm run build`
