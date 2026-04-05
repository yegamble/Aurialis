# Stem Mixer with Auto-Mix Implementation Plan

Created: 2026-04-05
Author: yegamble@gmail.com
Status: VERIFIED
Approved: Yes
Iterations: 0
Worktree: Yes
Type: Feature

## Summary

**Goal:** Add a stem mixing mode where users upload separate audio stems (ZIP or multiple files), mix them with full per-stem channel strips (volume, pan, mute/solo, EQ, compressor, saturation), visualize them on a stacked waveform timeline with drag-to-offset, and optionally run an **auto-mixer** that analyzes each stem via DSP heuristics and applies Grammy-level per-stem + master bus processing automatically — similar to Waves Online Mastering but operating at the individual instrument level.

**Architecture:** New `MixEngine` class manages per-stem Web Audio graphs (gain → pan → EQ → compressor → saturation → summing bus). The summing bus feeds into the existing `ProcessingChain` for master bus processing. A new `StemAnalyzer` module classifies stems by frequency/dynamics content and generates per-stem processing presets. New `/mix` route with stacked waveform timeline, channel strip controls, and one-click auto-mix.

**Tech Stack:** Next.js 15 App Router, Web Audio API, JSZip (ZIP extraction), Zustand (state), Canvas (waveforms), existing DSP library (biquad, compressor, saturation, limiter, LUFS).

## Scope

### In Scope

- Multi-file audio upload (drag & drop or file picker) for stems
- ZIP upload with automatic extraction of audio files
- Per-stem channel strip: volume fader, pan knob, mute/solo, 5-band EQ, compressor, saturation
- Stacked waveform timeline with per-stem lanes and drag handles for time offset
- Synchronized playback across all stems with play/pause/stop/seek
- Auto-mixer: DSP analysis → stem classification → automatic per-stem EQ/compression/gain/pan/saturation
- Auto master bus processing after auto-mix
- "Send to Master" flow: render mixed stems → feed into existing mastering page
- Direct export of mixed stems as WAV
- New `/mix` route accessible from home page
- Comprehensive unit tests for all audio logic
- E2E tests for full workflow

### Out of Scope

- Server-side processing (all client-side)
- LLM/AI API calls for analysis (pure DSP heuristics)
- Per-stem reverb/delay (time-based effects)
- Recording/live input
- Stem separation (splitting a mixed track into stems — inverse of what we're doing)
- Undo/redo history
- Project save/load

## Approach

**Chosen:** Separate MixEngine with DSP-based auto-analyzer

**Why:** Clean separation of concerns — the MixEngine manages multi-stem audio graphs independently, then pipes its summed output into the existing ProcessingChain. The auto-mixer uses frequency analysis, dynamics analysis, and spectral content classification to determine stem types and apply appropriate processing — no API dependency, instant results, fully client-side.

**Alternatives considered:**
- *Extend AudioEngine directly* — Rejected: would bloat the clean single-source engine with multi-source concerns
- *LLM-assisted analysis* — Rejected: adds API dependency, latency, cost; DSP heuristics are deterministic and fast
- *Standalone with no mastering integration* — Rejected: user explicitly wants mix → master pipeline

## Context for Implementer

> Write for an implementer who has never seen the codebase.

**Patterns to follow:**
- Audio node wrapper pattern: see `src/lib/audio/nodes/eq.ts:14` — constructor takes AudioContext, exposes `input`/`output` AudioNode getters, has `dispose()` method
- Processing chain wiring: see `src/lib/audio/chain.ts:74-81` — nodes connected in series via `.connect()`
- Hook pattern: see `src/hooks/useAudioEngine.ts:27` — `useSyncExternalStore` for engine state, `useCallback` for actions, event listeners for engine→store sync
- Store pattern: see `src/lib/stores/audio-store.ts` — Zustand with typed state + actions
- Upload pattern: see `src/components/upload/UploadScreen.tsx` — drag/drop + file input, progress animation
- File validation: see `src/lib/audio/loader.ts:19` — `validateFile()` checks type/size, `loadAudioFile()` decodes
- Waveform rendering: see `src/components/visualization/WaveformDisplay.tsx` — canvas-based, bar-style, click-to-seek
- Offline rendering: see `src/lib/audio/renderer.ts:27` — OfflineAudioContext for EQ, then inline DSP for compressor/saturation/limiter
- Page routing: see `src/app/page.tsx` — upload page sets file in store, navigates to `/master`
- Export: see `src/lib/audio/export.ts` — render → encode WAV → browser download

**Conventions:**
- File names: kebab-case (`mix-engine.ts`, `stem-analyzer.ts`)
- Components: PascalCase (`ChannelStrip.tsx`, `StemTimeline.tsx`)
- Tests: `__tests__/` sibling directories with `.test.ts`/`.test.tsx`
- CSS: Tailwind utility classes, dark theme (black bg, white/blue accents)
- Color palette: `#0a84ff` primary blue, `rgba(255,255,255,0.XX)` for text/borders

**Key files:**
- `src/lib/audio/engine.ts` — Existing single-source audio engine (DO NOT modify)
- `src/lib/audio/chain.ts` — ProcessingChain that MixEngine output feeds into
- `src/lib/audio/nodes/eq.ts` — EQNode pattern to follow for per-stem EQ
- `src/lib/audio/dsp/` — Pure DSP functions (biquad, compressor, saturation, limiter, lufs)
- `src/lib/audio/loader.ts` — File validation and audio decoding
- `src/lib/audio/presets.ts` — Genre presets + DEFAULT_PARAMS (used by auto-mixer)
- `src/lib/stores/audio-store.ts` — Audio state store
- `src/app/page.tsx` — Home/upload page (add /mix navigation)
- `src/app/master/page.tsx` — Master page (reference for layout patterns)

**Gotchas:**
- AudioBufferSourceNode cannot be restarted — must create new ones each play (see `engine.ts:164`)
- React StrictMode double-mounts — engine refs need disposed/recreated pattern (see `useAudioEngine.ts:37`)
- AudioWorklet modules load from `/public/worklets/` — existing compressor/limiter/saturation worklets can be reused on master bus but per-stem processing should use built-in Web Audio nodes (DynamicsCompressorNode, BiquadFilterNode) to avoid loading N worklet instances
- COOP/COEP headers required for SharedArrayBuffer (AudioWorklet) — already configured in `next.config.ts`
- All stems must be resampled to the same sample rate before mixing — AudioContext handles this during `decodeAudioData()`

**Domain context:**
- "Stem" = individual instrument track (vocals, drums, bass, guitar, synth, etc.)
- "Channel strip" = the processing chain for a single stem (volume → pan → EQ → compressor → saturation)
- "Summing bus" = where all stems merge into a single stereo signal
- "Auto-mix" = automatic analysis and processing — DSP heuristics classify stem type then apply genre-appropriate settings
- Stem classification signals: spectral centroid (bright vs dark), transient density (percussive vs sustained), frequency band energy distribution, RMS level, crest factor (dynamic range)

## Runtime Environment

- **Start:** `pnpm dev` → `http://localhost:3000`
- **Build:** `pnpm run build`
- **Deploy:** `pnpm run deploy` (Cloudflare Workers via OpenNext)

## Assumptions

- Browser's `decodeAudioData()` handles resampling all stems to AudioContext sample rate — Tasks 2, 3 depend on this
- JSZip can extract common ZIP formats used by DAWs and stem export tools — Task 2 depends on this
- Built-in Web Audio `DynamicsCompressorNode` + `BiquadFilterNode` provide sufficient per-stem processing quality (vs AudioWorklet custom DSP) — Task 3 depends on this
- Stems from the same song are similar duration (±5s); large discrepancies are user error, not our problem to solve — Task 7 depends on this
- Canvas-based stacked waveforms perform adequately for up to ~16 stems — Task 6 depends on this
- Frequency analysis via `AnalyserNode` + FFT provides enough signal for stem classification — Task 4 depends on this

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Many stems (10+) cause audio glitching | Medium | High | Limit to 16 stems max; use built-in Web Audio nodes (GPU-accelerated) instead of JS processing; show warning at 8+ stems |
| ZIP files with nested folders or non-audio files | Medium | Low | Recursively scan ZIP entries, filter by audio extension, ignore non-audio; show "N audio files found, M ignored" |
| Stems with very different sample rates cause timing drift | Low | Medium | AudioContext normalizes sample rate during decode; verify durations match post-decode |
| Auto-mixer misclassifies stems | Medium | Medium | Use filename hints as primary signal, DSP analysis as secondary; always show classification to user with manual override |
| Stacked waveform canvas performance with many stems | Low | Medium | Virtualize: only render visible lanes; use offscreen canvas for waveform generation |
| Large stems (10+ stems × 5min × 48kHz stereo) exceed memory | Low | High | Calculate memory footprint on load; warn at >1GB; suggest closing unused browser tabs |

## Goal Verification

### Truths

1. User can upload multiple audio files and see them as separate stems in the mixer — TS-001
2. User can upload a ZIP file and stems are automatically extracted — TS-002
3. Each stem has working volume, pan, mute/solo, EQ, and compressor controls — TS-003
4. Stacked waveform timeline displays all stems with playhead — TS-004
5. User can drag stems to offset them in time — TS-004
6. One-click auto-mix analyzes stems and applies per-stem processing automatically — TS-005
7. Mixed output can be sent to the existing mastering page for further processing — TS-006
8. Mixed output can be exported directly as WAV — TS-006

### Artifacts

1. `src/lib/audio/mix-engine.ts` — MixEngine class with per-stem graphs and summing
2. `src/lib/audio/stem-analyzer.ts` — DSP analysis and stem classification
3. `src/lib/audio/stem-loader.ts` — Multi-file and ZIP stem loading
4. `src/lib/audio/auto-mixer.ts` — Auto-mix preset generation from analysis
5. `src/lib/stores/mixer-store.ts` — Mixer state management
6. `src/hooks/useMixEngine.ts` — React hook for MixEngine
7. `src/components/mixer/` — ChannelStrip, StemTimeline, StemUpload, MixerControls
8. `src/app/mix/page.tsx` — Mix page route

## E2E Test Scenarios

### TS-001: Multi-File Stem Upload
**Priority:** Critical
**Preconditions:** On home page, no stems loaded
**Mapped Tasks:** Task 2, Task 5, Task 8

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to /mix (click "Mix Stems" on home) | Mix page loads with upload area visible |
| 2 | Upload 3 audio files via file picker | Upload progress shown, then 3 stems appear in mixer |
| 3 | Verify stem names displayed | Each stem shows its filename |
| 4 | Verify waveforms rendered | 3 waveform lanes visible in timeline |

### TS-002: ZIP Upload and Extraction
**Priority:** Critical
**Preconditions:** On /mix page, no stems loaded
**Mapped Tasks:** Task 2, Task 5

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Upload a ZIP file containing audio stems | "Extracting..." progress shown |
| 2 | Wait for extraction to complete | Stems appear in mixer with filenames from ZIP |
| 3 | Verify non-audio files in ZIP are ignored | Only audio files shown as stems |

### TS-003: Per-Stem Channel Strip Controls
**Priority:** Critical
**Preconditions:** 3+ stems loaded in mixer
**Mapped Tasks:** Task 3, Task 6

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Adjust volume fader on stem 1 | Volume changes audibly during playback |
| 2 | Pan stem 2 hard left | Audio shifts to left channel |
| 3 | Click mute on stem 3 | Stem 3 goes silent, mute button highlighted |
| 4 | Click solo on stem 1 | Only stem 1 audible, solo button highlighted |
| 5 | Adjust EQ band on stem 2 | Frequency response changes audibly |

### TS-004: Timeline with Offset
**Priority:** High
**Preconditions:** 2+ stems loaded
**Mapped Tasks:** Task 6, Task 8

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Verify stacked waveforms visible | Each stem has its own lane |
| 2 | Click on timeline to seek | Playhead moves, all stems seek to same position |
| 3 | Drag stem 2 waveform to the right | Stem 2 offset increases, waveform shifts visually |
| 4 | Play and verify offset | Stem 2 starts later than stem 1 |

### TS-005: Auto-Mix
**Priority:** Critical
**Preconditions:** 3+ stems loaded, no processing applied
**Mapped Tasks:** Task 4, Task 8

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click "Auto Mix" button | Analysis progress indicator shown |
| 2 | Wait for analysis to complete | Per-stem controls update to auto-generated values |
| 3 | Verify stem classifications shown | Each stem labeled (e.g., "Vocals", "Drums", "Bass") |
| 4 | Play the auto-mixed result | Professional-sounding mix with balanced levels |
| 5 | Verify controls are adjustable after auto-mix | User can tweak any auto-generated setting |

### TS-006: Send to Master / Export
**Priority:** High
**Preconditions:** Stems loaded and mixed (manual or auto)
**Mapped Tasks:** Task 9

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click "Send to Master" | Progress indicator while rendering mixdown |
| 2 | Wait for render to complete | Navigated to /master page with mixed audio loaded |
| 3 | Verify mastering controls work on mixed audio | EQ, compression, etc. apply to the mixed stem output |
| 4 | Go back to /mix, click "Export Mix" | WAV file downloads with mixed audio |

### TS-007: Error Handling
**Priority:** Medium
**Preconditions:** On /mix page
**Mapped Tasks:** Task 2, Task 5

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Upload a non-audio file | Error message: "Unsupported format" |
| 2 | Upload a ZIP with no audio files inside | Error message: "No audio files found in ZIP" |
| 3 | Upload more than 16 stems | Warning message about stem limit |

## Progress Tracking

- [x] Task 1: Types & Mixer Store
- [x] Task 2: Stem Loader with ZIP Support
- [x] Task 3: MixEngine Core with Channel Strips
- [x] Task 4: Stem Analyzer & Auto-Mixer
- [x] Task 5: Stem Upload UI
- [x] Task 6: Mixer Channel Strip UI
- [x] Task 7: Stacked Waveform Timeline
- [x] Task 8: Mix Page Assembly
- [x] Task 9: Mix → Master Pipeline & Export
- [x] Task 10: E2E Tests
      **Total Tasks:** 10 | **Completed:** 10 | **Remaining:** 0

## Implementation Tasks

### Task 1: Types & Mixer Store

**Objective:** Define all TypeScript types for the stem mixer domain and create the Zustand store for mixer state management.

**Dependencies:** None

**Mapped Scenarios:** None (foundation)

**Files:**

- Create: `src/types/mixer.ts`
- Create: `src/lib/stores/mixer-store.ts`
- Test: `src/types/__tests__/mixer.test.ts`
- Test: `src/lib/stores/__tests__/mixer-store.test.ts`

**Key Decisions / Notes:**

- Follow the existing `AudioParams` pattern from `src/types/mastering.ts` for type definitions
- Follow the existing Zustand store pattern from `src/lib/stores/audio-store.ts`
- `StemTrack` interface: id, name, file, audioBuffer, waveformPeaks, classification (auto-detected stem type), channel strip params (volume, pan, mute, solo, eq bands, compressor, saturation), time offset in seconds
- `StemClassification`: union type — `"vocals" | "drums" | "bass" | "guitar" | "keys" | "synth" | "strings" | "fx" | "other"`
- `StemChannelParams`: volume (dB), pan (-1 to 1), mute, solo, eq5Band (array of 5 gains), compThreshold, compRatio, compAttack, compRelease, compMakeup, satDrive
- `MixerState`: stems array, isPlaying, currentTime, duration, masterVolume, isAutoMixing, selectedStemId
- Actions: addStems, removeStem, updateStemParam, setClassification, setStemOffset, setAutoMixResults, reset
- Max stems constant: 16

**Definition of Done:**

- [ ] All types exported and compile cleanly with `tsc --noEmit`
- [ ] Mixer store creates/reads/updates/deletes stems correctly
- [ ] Store actions tested: addStems, removeStem, updateStemParam, reset
- [ ] No diagnostics errors

**Verify:**

- `pnpm test -- --reporter=dot src/types/__tests__/mixer.test.ts src/lib/stores/__tests__/mixer-store.test.ts`

---

### Task 2: Stem Loader with ZIP Support

**Objective:** Build the stem loading system: validate files, decode audio, extract ZIPs. Handles both multi-file upload and ZIP upload.

**Dependencies:** Task 1

**Mapped Scenarios:** TS-001, TS-002, TS-007

**Files:**

- Create: `src/lib/audio/stem-loader.ts`
- Test: `src/lib/audio/__tests__/stem-loader.test.ts`
- Modify: `package.json` (add `jszip` dependency)

**Key Decisions / Notes:**

- Add JSZip: `pnpm add jszip` + `pnpm add -D @types/jszip`
- Reuse existing `validateFile()` from `src/lib/audio/loader.ts:19` for individual file validation
- Reuse `loadAudioFile()` from `src/lib/audio/loader.ts:46` for audio decoding
- ZIP handling: use JSZip to read ZIP, iterate entries, filter by audio extension (`.wav`, `.mp3`, `.flac`, `.ogg`, `.aac`, `.m4a`), skip directories and non-audio files
- Return array of `{ name: string, buffer: AudioBuffer, file: File }` — one per stem
- Generate waveform peaks for each stem (downsample to ~500 points for display)
- Error handling: empty ZIP, no audio in ZIP, decode failures (skip bad files, report which ones failed)
- Function signatures: `loadStemsFromFiles(files: File[], ctx: AudioContext)` and `loadStemsFromZip(zipFile: File, ctx: AudioContext)`
- Detect ZIP by extension (`.zip`) or MIME type (`application/zip`, `application/x-zip-compressed`)

**Definition of Done:**

- [ ] `loadStemsFromFiles` decodes multiple audio files to AudioBuffers
- [ ] `loadStemsFromZip` extracts ZIP, filters audio, decodes each
- [ ] Non-audio files in ZIP are silently skipped
- [ ] Empty ZIP returns descriptive error
- [ ] Waveform peaks generated for each stem
- [ ] All file validation from existing loader is applied per-stem
- [ ] Tests mock JSZip and AudioContext.decodeAudioData

**Verify:**

- `pnpm test -- --reporter=dot src/lib/audio/__tests__/stem-loader.test.ts`

---

### Task 3: MixEngine Core with Channel Strips

**Objective:** Build the MixEngine class — the Web Audio graph that manages multiple stems with per-stem channel strips and a summing bus.

**Dependencies:** Task 1

**Mapped Scenarios:** TS-003, TS-004

**Files:**

- Create: `src/lib/audio/mix-engine.ts`
- Test: `src/lib/audio/__tests__/mix-engine.test.ts`

**Key Decisions / Notes:**

- Follow the AudioEngine pattern (`src/lib/audio/engine.ts`) for lifecycle (init/dispose/play/pause/stop/seek)
- Per-stem audio graph: `AudioBufferSourceNode → GainNode (volume) → StereoPannerNode (pan) → BiquadFilterNode×5 (EQ) → DynamicsCompressorNode → WaveShaperNode (saturation) → channelGain`
- Use built-in Web Audio nodes (NOT AudioWorklet) for per-stem processing — avoids loading N worklet instances
- `StereoPannerNode` for pan (simpler than ChannelSplitter/Merger)
- `DynamicsCompressorNode` for per-stem compression (built-in, good enough for per-stem)
- `WaveShaperNode` with tanh curve for saturation (same math as `src/lib/audio/dsp/saturation.ts`)
- Summing bus: all channel outputs connect to a single `GainNode` (master volume)
- Mute: set channel gain to 0. Solo: mute all non-solo'd stems
- Time offset: `sourceNode.start(audioContext.currentTime + stem.offset)` — the first argument is AudioContext absolute time, delaying playback start. Do NOT use the second argument (buffer offset/seek position) for this purpose. All stems start at the same `audioContext.currentTime` base, with per-stem delay added on top. This is different from `engine.ts:184` which uses `start(0, this._startOffset)` for seek — that's a different pattern.
- Duration = max(stem.duration + stem.offset) across all stems
- Playback sync: all source nodes created and started together; seek destroys all and recreates
- Event system: same pattern as AudioEngine (`on`/`off`/`emit`)
- Expose `summingBus` output node so it can connect to ProcessingChain

**Definition of Done:**

- [ ] MixEngine creates per-stem audio graphs with all channel strip nodes
- [ ] Play/pause/stop/seek work synchronously across all stems
- [ ] Volume, pan, mute, solo, EQ, compressor, saturation parameters update in real-time
- [ ] Time offset delays stem start correctly
- [ ] Summing bus output node exposed for external connection
- [ ] Dispose cleans up all nodes and context
- [ ] Tests cover: init, add/remove stems, play/pause/stop, parameter updates, mute/solo logic, offset timing

**Verify:**

- `pnpm test -- --reporter=dot src/lib/audio/__tests__/mix-engine.test.ts`

---

### Task 4: Stem Analyzer & Auto-Mixer

**Objective:** Build the DSP analysis pipeline that classifies stems by instrument type and generates professional per-stem + master bus processing presets. This is the "Grammy-level producer" engine.

**Dependencies:** Task 1

**Mapped Scenarios:** TS-005

**Files:**

- Create: `src/lib/audio/stem-analyzer.ts`
- Create: `src/lib/audio/auto-mixer.ts`
- Test: `src/lib/audio/__tests__/stem-analyzer.test.ts`
- Test: `src/lib/audio/__tests__/auto-mixer.test.ts`

**Key Decisions / Notes:**

- **Stem Analyzer** (`stem-analyzer.ts`): analyzes a single AudioBuffer and returns classification + audio features
  - Features to extract: spectral centroid, spectral rolloff, transient density, RMS energy, crest factor (peak/RMS), frequency band energy (sub/low/mid/high/air), zero-crossing rate
  - Compute features directly from Float32Array samples (`AudioBuffer.getChannelData()`) — do NOT use AnalyserNode in OfflineAudioContext as it requires frame-synchronous callbacks that are unreliable offline. For spectral centroid/rolloff, implement a simple DFT on windowed frames. For transient density, compute sample-by-sample RMS in short windows (~10ms) and count peaks above threshold. For frequency band energy, sum DFT bins within each band range.
  - Classification heuristics:
    - **Drums**: high transient density, high crest factor, energy spread across bands
    - **Bass**: >60% energy below 300Hz, low spectral centroid
    - **Vocals**: energy concentrated 200Hz-4kHz, moderate transient density, high spectral centroid variance
    - **Guitar**: mid-range energy (200Hz-5kHz), moderate transients
    - **Keys/Synth**: energy varies, typically sustained (low transient density), can be bright or dark
    - **Strings**: smooth spectral envelope, low transient density, mid-high energy
    - **FX**: high spectral variance, irregular patterns
  - Also use filename hints as primary signal: if filename contains "vocal", "vox", "drum", "bass", "guitar", "keys", "synth", etc., use that classification with high confidence; DSP analysis as tiebreaker/validation
  - Return: `{ classification: StemClassification, confidence: number, features: StemFeatures }`

- **Auto-Mixer** (`auto-mixer.ts`): takes array of analyzed stems, generates per-stem `StemChannelParams` + master `AudioParams`
  - Gain staging: normalize all stems to ~-18 dBFS RMS, then apply role-based offsets (vocals +2dB, drums +1dB, bass 0dB, etc.)
  - Pan placement: vocals center, bass center, drums center (or slight spread for overheads), guitars L/R spread, keys offset, strings wide
  - Per-stem EQ: surgical cuts for each stem type (e.g., high-pass bass at 30Hz, cut mud at 200-400Hz on guitars, presence boost 2-5kHz on vocals, air boost 10kHz+ on overheads)
  - Per-stem compression: drums get fast attack/release, vocals get medium, bass gets slow attack, strings/pads get gentle
  - Per-stem saturation: subtle on vocals (warmth), moderate on bass (harmonics), none on drums (preserve transients)
  - Master bus: generate AudioParams based on overall mix characteristics (genre detection from stems, appropriate loudness target)
  - All processing values use existing parameter ranges from the codebase

**Definition of Done:**

- [ ] `analyzeStem(buffer: AudioBuffer)` returns classification + features
- [ ] Classification correctly identifies vocals, drums, bass, guitar, keys from test signals
- [ ] Filename hints override/boost DSP classification
- [ ] `generateAutoMix(stems: AnalyzedStem[])` returns per-stem params + master params
- [ ] Auto-mix gain staging normalizes stems to reasonable levels
- [ ] Auto-mix pan placement follows standard mixing conventions
- [ ] Per-stem EQ/compression/saturation presets are genre-appropriate
- [ ] Tests use synthetic test signals (sine waves, noise, impulses) to verify classification

**Verify:**

- `pnpm test -- --reporter=dot src/lib/audio/__tests__/stem-analyzer.test.ts src/lib/audio/__tests__/auto-mixer.test.ts`

---

### Task 5: Stem Upload UI

**Objective:** Build the upload component for the mix page — supports multi-file selection and ZIP upload with extraction progress.

**Dependencies:** Task 1, Task 2

**Mapped Scenarios:** TS-001, TS-002, TS-007

**Files:**

- Create: `src/components/mixer/StemUpload.tsx`
- Test: `src/components/mixer/__tests__/StemUpload.test.tsx`

**Key Decisions / Notes:**

- Follow existing `UploadScreen.tsx` pattern for drag & drop and file input
- Key differences: `accept="audio/*,.zip"`, `multiple` attribute on input
- Detect ZIP files (`.zip` extension or `application/zip` MIME) → call `loadStemsFromZip`
- Non-ZIP files → call `loadStemsFromFiles`
- Show per-file loading progress (filename + progress bar)
- After load: display stem count summary ("Loaded 5 stems")
- Error display: show which files failed and why (unsupported format, decode error)
- Stem limit enforcement: reject uploads that would exceed 16 total, show clear error
- Design: match existing dark theme, use same blue accent color (#0a84ff), motion animations

**Definition of Done:**

- [ ] Multi-file upload via drag & drop works
- [ ] Multi-file upload via click-to-browse works
- [ ] ZIP file detected and extracted automatically
- [ ] Loading progress shown per file
- [ ] Error messages displayed for invalid files
- [ ] Stem limit (16) enforced with user-visible message
- [ ] Component renders correctly with no console errors

**Verify:**

- `pnpm test -- --reporter=dot src/components/mixer/__tests__/StemUpload.test.tsx`

---

### Task 6: Mixer Channel Strip UI

**Objective:** Build the per-stem channel strip component with all controls: volume fader, pan knob, mute/solo toggles, 5-band EQ, compressor, and saturation.

**Dependencies:** Task 1

**Mapped Scenarios:** TS-003

**Files:**

- Create: `src/components/mixer/ChannelStrip.tsx`
- Create: `src/components/mixer/StemList.tsx`
- Test: `src/components/mixer/__tests__/ChannelStrip.test.tsx`
- Test: `src/components/mixer/__tests__/StemList.test.tsx`

**Key Decisions / Notes:**

- ChannelStrip: single stem's controls in a vertical card layout
  - Top: stem name + classification badge + color indicator
  - Volume: vertical `@radix-ui/react-slider` (-60dB to +12dB)
  - Pan: horizontal slider (-1 to +1), center detent
  - Mute/Solo: toggle buttons (M/S), mute = red when active, solo = yellow
  - EQ: collapsible section, 5 horizontal sliders (80Hz, 250Hz, 1kHz, 4kHz, 12kHz), ±12dB
  - Compressor: collapsible section — threshold, ratio, attack, release, makeup (use same ranges as mastering)
  - Saturation: single drive knob (0-100%)
- StemList: horizontal scrollable container of ChannelStrip components
- Use existing Radix UI components (Slider, Switch) where possible
- Each strip ~200px wide, vertically scrollable if controls overflow
- Color per stem: assign from a palette (8 colors that cycle)
- Follow `AdvancedMastering.tsx` pattern for parameter controls layout

**Definition of Done:**

- [ ] ChannelStrip renders all controls: volume, pan, mute, solo, EQ, compressor, saturation
- [ ] All controls fire callbacks with correct parameter key and value
- [ ] Mute/solo buttons toggle visually and functionally
- [ ] EQ and compressor sections collapsible
- [ ] StemList scrolls horizontally when many stems present
- [ ] Stem classification badge displayed
- [ ] Accessible: all controls have aria labels, keyboard navigable

**Verify:**

- `pnpm test -- --reporter=dot src/components/mixer/__tests__/ChannelStrip.test.tsx src/components/mixer/__tests__/StemList.test.tsx`

---

### Task 7: Stacked Waveform Timeline

**Objective:** Build the timeline component showing stacked waveform lanes per stem with a synchronized playhead and draggable offset handles.

**Dependencies:** Task 1

**Mapped Scenarios:** TS-004

**Files:**

- Create: `src/components/mixer/StemTimeline.tsx`
- Test: `src/components/mixer/__tests__/StemTimeline.test.tsx`

**Key Decisions / Notes:**

- Follow existing `WaveformDisplay.tsx` canvas pattern
- Layout: vertically stacked lanes, each ~48px tall, with stem name label on the left
- Each lane: canvas-rendered waveform bars, colored by stem (matching ChannelStrip color)
- Playhead: vertical white line spanning all lanes, moves with currentTime
- Click-to-seek: click anywhere on timeline to seek all stems
- Offset handles: each waveform can be dragged horizontally to adjust time offset
  - Drag interaction: `mousedown` on waveform → track mouse movement → update stem offset
  - Visual: waveform shifts right by offset amount, gap shown as empty space
  - Snap: optional snap to grid (disabled by default)
- Time scale: show time markers at top (0:00, 0:30, 1:00, etc.)
- Total timeline width based on longest stem + max offset
- Performance: pre-compute waveform peaks once on load, re-render only on offset/playhead change
- Use `requestAnimationFrame` for playhead animation (same pattern as engine.ts:334)

**Definition of Done:**

- [ ] Stacked waveform lanes render for each stem
- [ ] Waveforms colored per stem
- [ ] Playhead moves during playback
- [ ] Click-to-seek works
- [ ] Drag-to-offset moves waveform and updates stem offset state
- [ ] Time markers displayed
- [ ] Handles 8+ stems without visible performance issues

**Verify:**

- `pnpm test -- --reporter=dot src/components/mixer/__tests__/StemTimeline.test.tsx`

---

### Task 8: Mix Page Assembly

**Objective:** Create the `/mix` route that assembles all mixer components, wire up the `useMixEngine` hook, and add navigation from the home page.

**Dependencies:** Task 2, Task 3, Task 4, Task 5, Task 6, Task 7

**Mapped Scenarios:** TS-001, TS-002, TS-003, TS-004, TS-005

**Files:**

- Create: `src/app/mix/page.tsx`
- Create: `src/hooks/useMixEngine.ts`
- Modify: `src/app/page.tsx` (add "Mix Stems" button/link alongside existing upload)
- Modify: `src/components/upload/UploadScreen.tsx` (add secondary action for stem mixing)
- Test: `src/hooks/__tests__/useMixEngine.test.ts`

**Key Decisions / Notes:**

- `useMixEngine` hook: wraps MixEngine with React lifecycle (same pattern as `useAudioEngine.ts`)
  - `useSyncExternalStore` for playback state
  - Zustand sync for mixer store
  - Stable callbacks: play, pause, stop, seek, loadStems, updateStemParam, autoMix
- Mix page layout (follow master page pattern):
  - Header: "Waveish" branding, back button, "Auto Mix" button, "Send to Master" button, "Export Mix" button
  - Left sidebar: StemList with ChannelStrips (scrollable)
  - Main content: StemTimeline (top), playback controls (middle), level meters (bottom)
  - Right sidebar: master bus metering (reuse existing LevelMeter)
- Home page modification: add "Mix Stems" option alongside existing single-file upload
  - Could be a toggle ("Master" / "Mix") or two separate upload zones
  - Simple approach: add a secondary button "Mix Stems" below the upload area that navigates to `/mix`
- Mix page has its own upload area (StemUpload) at the top, replaced by mixer controls after stems are loaded

**Definition of Done:**

- [ ] `/mix` route loads and renders
- [ ] `useMixEngine` hook manages MixEngine lifecycle correctly (including StrictMode)
- [ ] Home page has visible path to /mix
- [ ] Stem upload → channel strips + timeline appear
- [ ] Playback controls work (play/pause/stop/seek)
- [ ] Auto-mix button triggers analysis and applies results
- [ ] All stems playback synchronized
- [ ] No console errors or warnings

**Verify:**

- `pnpm test -- --reporter=dot src/hooks/__tests__/useMixEngine.test.ts`
- `pnpm run build` (verify /mix route compiles)

---

### Task 9: Mix → Master Pipeline & Export

**Objective:** Implement the "Send to Master" flow (offline render mixed stems → navigate to /master with buffer) and direct "Export Mix" (render → encode WAV → download).

**Dependencies:** Task 3, Task 8

**Mapped Scenarios:** TS-006

**Files:**

- Create: `src/lib/audio/mix-renderer.ts`
- Modify: `src/app/mix/page.tsx` (wire up send-to-master and export actions)
- Modify: `src/lib/stores/audio-store.ts` (add ability to set buffer from external source — already has `setAudioBuffer`)
- Test: `src/lib/audio/__tests__/mix-renderer.test.ts`

**Key Decisions / Notes:**

- `renderMix(stems: StemTrack[], sampleRate: number)`: renders all stems with their per-stem processing into a single stereo AudioBuffer
  - Uses OfflineAudioContext
  - Per-stem: applies volume, pan, EQ, compressor, saturation, time offset
  - Sums all stems to stereo output
  - Returns rendered AudioBuffer
- "Send to Master" flow:
  1. Render mix offline → get AudioBuffer
  2. Encode rendered buffer to WAV blob, create synthetic File: `new File([wavBlob], "mixed-stems.wav", { type: "audio/wav" })`
  3. Call `useAudioStore.getState().setFile(syntheticFile)` FIRST — master page reads `file.name` for display
  4. Then call `useAudioStore.getState().setAudioBuffer(renderedBuffer)` — this also sets `isLoaded: true`
  5. Navigate to `/master`
  6. Master page picks up both file (for filename display) and buffer (for playback/processing)
- "Export Mix" flow:
  1. Render mix offline → get AudioBuffer
  2. Reuse existing `exportWav()` from `src/lib/audio/export.ts` — but pass identity params (flat EQ, no compression, unity gain) since processing is already baked in
  3. Or encode directly without mastering chain: just `encodeWav(rendered, bitDepth, dither)` + download
- Show progress during rendering (approximate from sample position)

**Definition of Done:**

- [ ] `renderMix` correctly applies all per-stem processing offline
- [ ] Rendered mix sounds identical to real-time playback
- [ ] "Send to Master" navigates to /master with mixed audio loaded
- [ ] Mastering controls on /master work on the mixed audio
- [ ] "Export Mix" downloads a WAV file with the mixed audio
- [ ] Progress indicator shown during rendering
- [ ] Tests verify renderMix with known inputs produces expected output

**Verify:**

- `pnpm test -- --reporter=dot src/lib/audio/__tests__/mix-renderer.test.ts`

---

### Task 10: E2E Tests

**Objective:** Write end-to-end browser tests covering the full stem mixer workflow — upload, mix, auto-mix, timeline, send to master, export.

**Dependencies:** Task 8, Task 9

**Mapped Scenarios:** TS-001 through TS-007

**Files:**

- Create: `e2e/mixer.spec.ts`
- Create: `e2e/fixtures/stems/` (test stem fixtures — short sine wave WAVs at different frequencies)
- Create: `e2e/fixtures/stems.zip` (ZIP containing test stems)

**Key Decisions / Notes:**

- Follow existing E2E pattern from `e2e/mastering.spec.ts`
- **Fixture generation**: Create `scripts/generate-test-stems.ts` that generates WAV files by writing raw PCM bytes with a 44-byte WAV header (no external library needed). Also create `stems.zip` using JSZip. Run once: `pnpm tsx scripts/generate-test-stems.ts`. Commit generated fixtures to `e2e/fixtures/stems/`. Add to package.json: `"generate:fixtures": "tsx scripts/generate-test-stems.ts"`
- Test fixtures: 4 short (1-2 second) WAV files at different frequencies:
  - `bass.wav`: 80Hz sine wave (simulates bass stem)
  - `vocals.wav`: 1kHz sine wave (simulates vocal stem)
  - `drums.wav`: white noise burst (simulates percussive stem)
  - `guitar.wav`: 440Hz sine wave (simulates guitar stem)
- ZIP fixture: same files packaged as `e2e/fixtures/stems.zip`
- Test scenarios aligned with TS-001 through TS-007
- Use Playwright (already configured in project)
- Use `page.locator('input[type="file"]').setInputFiles()` for uploads

**Definition of Done:**

- [ ] E2E test for multi-file upload (TS-001)
- [ ] E2E test for ZIP upload (TS-002)
- [ ] E2E test for channel strip controls (TS-003)
- [ ] E2E test for timeline seek and offset (TS-004)
- [ ] E2E test for auto-mix (TS-005)
- [ ] E2E test for send-to-master flow (TS-006)
- [ ] E2E test for error handling (TS-007)
- [ ] All E2E tests pass with `pnpm exec playwright test e2e/mixer.spec.ts`

**Verify:**

- `pnpm exec playwright test e2e/mixer.spec.ts --workers=2`

---

## Open Questions

None — all major decisions resolved during planning.

## Deferred Ideas

- **Stem separation** — given a full mix, use ML to split into stems (inverse operation). Would be a separate feature.
- **Per-stem reverb/delay** — time-based effects add significant complexity (impulse response convolution, delay line management)
- **Project save/load** — serialize mixer state to JSON + audio buffers to IndexedDB for persistent sessions
- **Undo/redo** — state history stack for mixer operations
- **Waveform zoom/scroll** — horizontal zoom on timeline for precise editing
- **MIDI learn** — map hardware MIDI controllers to mixer parameters
