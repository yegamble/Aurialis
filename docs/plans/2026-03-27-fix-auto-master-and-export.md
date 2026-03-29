# Fix Auto Master & WAV Export

Created: 2026-03-27
Status: COMPLETE
Approved: Yes
Iterations: 0
Worktree: No
Type: Bugfix

## Summary

**Symptom:** (1) Auto Master button in Simple mode does nothing when clicked. (2) WAV export button does nothing when clicked.
**Trigger:** (1) Click "Auto Master" in Simple mode. (2) Click "Export WAV" in Export panel.
**Root Cause:**
1. `src/app/master/page.tsx:243,362` — `onAutoMaster={() => {}}` is a no-op. No analysis module exists. The DSP building blocks (`computeIntegratedLufs`, `computeRmsLevel`, `computePeakLevel` from `src/lib/audio/dsp/`) are available but never used for analysis.
2. `src/components/export/ExportPanel.tsx:62-69` — Export button has no `onClick` handler. No export pipeline exists (no renderer, no WAV encoder for export, no download logic). The test-only `encodeWav` in `src/test/signal-generator.ts` exists but is not wired for production export.

## Investigation

- **Auto Master:** `onAutoMaster` prop is defined in `SimpleMastering.tsx:29` and called on button click at `:159`, but the parent `master/page.tsx` passes `() => {}` (no-op) at lines 243 and 362. No `src/lib/audio/analysis.ts` module exists. However, all required DSP functions are available: `computeIntegratedLufs` (LUFS measurement), `computeRmsLevel`/`computePeakLevel` (level detection) from `src/lib/audio/dsp/`. The `AudioBuffer` is accessible via `engine.audioBuffer`.
- **WAV Export:** `ExportPanel.tsx` renders format/sampleRate/bitDepth/dither selection UI, but the "Export WAV" `<motion.button>` at line 62 has no `onClick` handler at all. No `src/lib/audio/export.ts`, `renderer.ts`, or `wav-encoder.ts` files exist. The test utility `encodeWav` in `src/test/signal-generator.ts` handles 16-bit stereo WAV encoding and can be extracted for production use.
- **Engine access:** `useAudioEngine()` hook exposes `engine` ref which has `.audioBuffer` (AudioBuffer | null) and `.context` (AudioContext). The store has `setParams()` for bulk param updates.

## Fix Approach

**Chosen:** Implement both features minimally — analysis as pure function + export using OfflineAudioContext rendering.

**Why:** Both bugs are "unimplemented features" — the UI exists but the logic was never connected. The DSP building blocks and WAV encoding utility already exist, so the fix is wiring them together with minimal new code.

**Auto Master strategy:**
1. Create `src/lib/audio/analysis.ts` — `analyzeAudio(buffer: AudioBuffer): AnalysisResult` that computes LUFS, peak, dynamic range, spectral balance (RMS per frequency band via existing BiquadFilter)
2. Create `src/lib/audio/auto-master.ts` — `computeAutoMasterParams(analysis: AnalysisResult, genre: GenreName): AudioParams` that maps analysis results to mastering parameters (e.g., if LUFS is already -14, don't push louder; if bass-heavy, reduce eq80)
3. Wire `onAutoMaster` in `master/page.tsx` to call analysis → compute → `setParams()`

**Export strategy:**
1. Create `src/lib/audio/wav-encoder.ts` — extract/adapt `encodeWav` from test utility with 16/24/32-bit support
2. Create `src/lib/audio/renderer.ts` — OfflineAudioContext rendering with the processing chain
3. Create `src/lib/audio/export.ts` — orchestrator: render → encode → download via `URL.createObjectURL` + anchor click
4. Wire `ExportPanel.tsx` to accept `onExport` callback, connect in `master/page.tsx`

**Tests:**
- Unit tests for analysis and auto-master parameter computation
- Unit tests for WAV encoder (16/24/32-bit, correct headers)
- Playwright E2E: Auto Master changes slider values, Export triggers download

## Verification Scenario

### TS-001: Auto Master Changes Parameters
**Preconditions:** File loaded on /master, Simple mode active

| Step | Action | Expected Result (after fix) |
|------|--------|-----------------------------|
| 1 | Upload test WAV and navigate to /master | Master page loads with Simple mode |
| 2 | Note the initial intensity value | Default intensity displayed |
| 3 | Click "Auto Master" button | Parameters update — genre may change, intensity adjusts, LUFS meter shows different reading when playing |
| 4 | Switch to Advanced mode | Advanced sliders reflect the auto-master settings (not default values) |

### TS-002: WAV Export Downloads File
**Preconditions:** File loaded on /master

| Step | Action | Expected Result (after fix) |
|------|--------|-----------------------------|
| 1 | Upload test WAV and navigate to /master | Master page loads |
| 2 | Click "Export WAV" button | Export begins (button shows progress or disables) |
| 3 | Wait for export to complete | WAV file download is triggered |

## Progress

- [x] Task 1: Implement Auto Master (analysis + parameter computation + wiring)
- [x] Task 2: Implement WAV Export (encoder + renderer + orchestrator + wiring)
- [x] Task 3: Unit tests for analysis, auto-master, and WAV encoder
- [x] Task 4: Playwright E2E tests for Auto Master and Export
- [x] Task 5: Verify — full suite + build
      **Tasks:** 5 | **Done:** 5

## Tasks

### Task 1: Implement Auto Master

**Objective:** Make the Auto Master button analyze the loaded audio and apply appropriate mastering parameters.

**Files:**
- Create: `src/lib/audio/analysis.ts` — `analyzeAudio(buffer: AudioBuffer)` using existing DSP functions
- Create: `src/lib/audio/auto-master.ts` — `computeAutoMasterParams(analysis, genre)` returns AudioParams
- Modify: `src/app/master/page.tsx` — replace `onAutoMaster={() => {}}` with real handler that calls analysis → auto-master → setParams/setIntensity/setGenre

**Key approach:**
- `analyzeAudio` extracts: integrated LUFS (via `computeIntegratedLufs`), peak level (`computePeakLevel`), RMS level (`computeRmsLevel`), spectral balance (low/mid/high energy ratios using `BiquadFilter` from `src/lib/audio/dsp/biquad.ts`), dynamic range (peak - RMS in dB)
- `computeAutoMasterParams` logic:
  - If LUFS > -12: audio is already loud → use gentle settings (low intensity ~30)
  - If LUFS < -20: audio is quiet → higher intensity (~70-80)
  - If bass-heavy (low energy > 40%): reduce eq80, boost eq4k
  - If bright (high energy > 30%): reduce eq12k
  - Genre detection heuristic: dynamic range > 15dB → classical/jazz, < 8dB → pop/electronic, bass-heavy → hiphop
  - Returns: suggested genre, intensity, and toggle states
- `onAutoMaster` handler: get audioBuffer from engine → `analyzeAudio()` → `computeAutoMasterParams()` → `setGenre()`, `setIntensity()`, `recomputeParams()`

**TDD:** Write test for analysis → verify fails → implement → pass
**Verify:** `npx vitest run src/lib/audio/__tests__/analysis.test.ts src/lib/audio/__tests__/auto-master.test.ts`

---

### Task 2: Implement WAV Export

**Objective:** Make the Export WAV button render processed audio offline and download as WAV.

**Files:**
- Create: `src/lib/audio/wav-encoder.ts` — `encodeWav(buffer: AudioBuffer, bitDepth: 16|24|32): ArrayBuffer` supporting 16-bit int, 24-bit int, 32-bit float PCM
- Create: `src/lib/audio/renderer.ts` — `renderOffline(sourceBuffer: AudioBuffer, params: AudioParams, sampleRate: number): Promise<AudioBuffer>` using OfflineAudioContext with processing chain
- Create: `src/lib/audio/export.ts` — `exportWav(engine: AudioEngine, options: ExportOptions): Promise<void>` orchestrating render → encode → download
- Modify: `src/components/export/ExportPanel.tsx` — add `onExport` prop with format/bitDepth/sampleRate/dither options, `isExporting` state, wire onClick
- Modify: `src/app/master/page.tsx` — pass `onExport` handler to ExportPanel that calls `exportWav()`

**Key approach:**
- `wav-encoder.ts`: Adapt from `src/test/signal-generator.ts:encodeWav()`. Add 24-bit (3 bytes per sample, packed) and 32-bit float (IEEE 754) support. Proper RIFF/WAV headers with correct format tags (1=PCM for 16/24, 3=IEEE_FLOAT for 32).
- `renderer.ts`: Create OfflineAudioContext at target sample rate with source buffer duration. Rebuild the EQ chain (5 BiquadFilterNodes — same as `nodes/eq.ts` but on the offline context). For compressor/limiter/saturation: apply the pure DSP functions from `src/lib/audio/dsp/` in a post-processing pass on the rendered buffer (avoids needing AudioWorklet in OfflineAudioContext). Apply gain (inputGain/makeup) and stereo width processing.
- `export.ts`: Validate params, call renderer, encode WAV, trigger download via `URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }))` + hidden anchor click.
- `ExportPanel.tsx`: Parse format presets (Streaming: 44.1/16/TPDF, CD: 44.1/16/TPDF, Hi-Res: 96/24/None), pass to `onExport`. Show loading state during export.

**TDD:** Write test for WAV encoder → verify fails → implement → pass
**Verify:** `npx vitest run src/lib/audio/__tests__/wav-encoder.test.ts src/lib/audio/__tests__/renderer.test.ts`

---

### Task 3: Unit Tests

**Objective:** Comprehensive unit tests for all new modules.

**Files:**
- Create: `src/lib/audio/__tests__/analysis.test.ts`
- Create: `src/lib/audio/__tests__/auto-master.test.ts`
- Create: `src/lib/audio/__tests__/wav-encoder.test.ts`
- Create: `src/lib/audio/__tests__/renderer.test.ts`
- Create: `src/lib/audio/__tests__/export.test.ts`

**Tests:**
- analysis: silent audio returns -Infinity LUFS, known 1kHz sine returns expected LUFS (±0.5), spectral balance for low/mid/high frequency signals
- auto-master: quiet audio (< -20 LUFS) gets high intensity, loud audio (> -12 LUFS) gets low intensity, bass-heavy audio gets reduced eq80, returns valid AudioParams
- wav-encoder: 16-bit produces correct RIFF header and file size, 24-bit produces 3 bytes per sample, 32-bit uses IEEE float format tag, stereo interleaving correct
- renderer: processes a buffer and returns non-null AudioBuffer with correct duration/sample rate
- export: calls renderer → encoder → triggers download (mock URL.createObjectURL)

**Verify:** `npx vitest run src/lib/audio/__tests__/`

---

### Task 4: Playwright E2E Tests

**Objective:** E2E tests verifying Auto Master changes parameters and Export triggers download.

**Files:**
- Modify: `e2e/mastering.spec.ts` — add test sections for Auto Master and Export

**Tests:**
- Auto Master: upload file → click Auto Master → verify that advanced mode sliders changed from defaults (e.g., threshold or EQ values differ from initial)
- Export: upload file → click Export WAV → verify download triggered (check for download event or file)

**Verify:** `npx playwright test`

---

### Task 5: Verify

**Objective:** Full suite + quality checks
**Verify:** `npm test && npx tsc --noEmit && npx next lint && npm run build && npx playwright test`
