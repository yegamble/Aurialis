# Smart Split — Unified Upload with Stem Separation & Artifact Repair

Created: 2026-04-05
Author: yegamble@gmail.com
Status: COMPLETE
Approved: Yes
Iterations: 0
Worktree: Yes
Type: Feature

## Summary

**Goal:** Unified single upload path where a single audio file is auto-separated into stems via self-hosted Demucs (4 or 6 stem models, user's choice), then repaired by Smart Split DSP (spectral de-bleed, compression expansion, transient restoration, phase coherence). Panned instruments (guitars, synths) are further sub-split via stereo M/S decoding, and the "other" stem can optionally run a second Demucs pass. Multi-file/ZIP uploads bypass separation and go straight to the mixer. All repaired stems load into the existing mixer with auto-mix.

**Architecture:** Self-hosted Python/FastAPI backend in Docker with GPU support runs Demucs. Frontend uploads audio via REST API, polls for progress, downloads separated stems as WAV. Client-side Smart Repair DSP processes each stem before loading into the mixer. Unified upload component auto-detects single vs multi-file.

**Tech Stack:** Python 3.11, FastAPI, Demucs (htdemucs / htdemucs_6s), Docker + nvidia-container-toolkit, Next.js frontend (existing), Web Audio API DSP (existing patterns).

## Scope

### In Scope

- Self-hosted Demucs backend API (Docker, FastAPI, GPU)
- REST API: POST /separate, GET /jobs/{id}/status, GET /jobs/{id}/stems
- User choice of 4-stem or 6-stem model before separation
- Stereo sub-split for panned instruments (M/S decoding + pan detection)
- Optional second Demucs pass on "other" stem
- Smart Repair DSP pipeline (client-side):
  - Spectral de-bleed (frequency-aware gating per stem type)
  - Compression expansion (detect + invert master bus compressor envelope)
  - Transient restoration (re-sharpen attacks softened by separation)
  - Phase coherence verification (ensure stems sum cleanly)
- Unified upload UX (single path, auto-detect single vs multi)
- Progress UI with job status polling
- Integration with existing mixer + auto-mix
- Unit tests for all DSP algorithms
- E2E tests for the separation flow

### Out of Scope

- Third-party API integration (self-hosted only)
- Cloud GPU deployment (local Docker only for v1)
- Real-time separation (batch only)
- Custom Demucs model training/fine-tuning
- Audio file format conversion on backend (accept WAV/MP3/FLAC, output WAV)

## Approach

**Chosen:** FastAPI + Demucs in Docker, client-side Smart Repair DSP

**Why:** FastAPI is lightweight and async-native for file uploads + job management. Demucs is the state-of-the-art open-source separator. Client-side DSP for repair keeps latency low after separation completes and reuses existing DSP patterns. Polling for progress is simple and reliable.

**Alternatives considered:**
- *WASM Demucs in browser* — Rejected: 80MB model download, 2-5 min processing, poor UX
- *Third-party API (LALAL.AI, AudioStrip)* — Rejected: user wants self-hosted
- *Server-side repair DSP* — Rejected: would require Python DSP library, slower iteration, existing JS DSP is well-tested

## Context for Implementer

**Patterns to follow:**
- Existing DSP functions: `src/lib/audio/dsp/compressor.ts` (gain reduction, envelope follower), `src/lib/audio/dsp/envelope.ts` (RMS/peak level, one-pole follower)
- Stem loading: `src/lib/audio/stem-loader.ts` — `loadStemsFromFiles()` and `generateWaveformPeaks()`
- Store pattern: `src/lib/stores/mixer-store.ts` — Zustand with typed state + actions
- Upload: `src/components/mixer/StemUpload.tsx` — the component to extend
- Hook: `src/hooks/useMixEngine.ts:129` — `loadStems()` is where single-file detection + separation triggers

**Key files:**
- `src/app/page.tsx` — Current home page (upload single → master, link to /mix)
- `src/app/mix/page.tsx` — Mix page (will become the unified destination)
- `src/components/upload/UploadScreen.tsx` — Has "Mix Stems" link, upload zone
- `src/types/mixer.ts` — `StemClassification`, `StemTrack`, `StemChannelParams`
- `src/lib/audio/auto-mixer.ts` — Auto-mix with sum attenuation (recently fixed)

**Gotchas:**
- COOP/COEP headers in `next.config.ts` may conflict with cross-origin API calls to Docker backend — need to configure CORS on the API
- Docker GPU passthrough requires `nvidia-container-toolkit` on the host
- Demucs outputs WAV files to a temp directory — API must serve them and clean up
- The "other" stem second-pass Demucs separation doubles processing time

**Domain context:**
- "Smart Split" = separation + repair (the full pipeline)
- "De-bleed" = suppress spectral content that leaked from one stem to another (e.g., kick drum ghost in vocal stem)
- "Expansion" = inverse of compression — detect the original master bus compressor's gain envelope and apply the opposite, restoring dynamics
- "Transient restoration" = re-sharpen attack transients that Demucs softened during neural separation
- "Phase coherence" = verify that when all repaired stems are summed, they reconstruct the original without cancellation artifacts
- "Stereo sub-split" = use Mid/Side decoding to separate left-panned vs right-panned content within a single stem (e.g., left rhythm guitar vs right rhythm guitar)

## Runtime Environment

- **Frontend:** `pnpm dev` → `http://localhost:3000`
- **Backend:** `docker compose up` → `http://localhost:8000`
- **API docs:** `http://localhost:8000/docs` (FastAPI Swagger)
- **Health check:** `GET http://localhost:8000/health`

## Assumptions

- Host machine has Docker installed — all backend tasks depend on this
- GPU is available for Demucs (CUDA) — falls back to CPU if not (slower: ~5x) — Tasks 1-3 depend on this
- Demucs htdemucs and htdemucs_6s models are available via `torch.hub` — Task 2 depends on this
- Audio files uploaded are under 200MB (existing validation in `src/lib/audio/loader.ts`) — Task 7 depends on this
- The existing DSP envelope follower (`src/lib/audio/dsp/envelope.ts`) is suitable for compression detection — Task 5 depends on this
- Stems from Demucs are stereo WAV at the source sample rate — Task 3 depends on this

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| No GPU on host → very slow separation | Medium | High | Detect GPU in Docker, show estimated time (CPU: ~2-5 min/song, GPU: ~20-40s). Warn user before starting. |
| Demucs model download (~1.5GB) on first run | Certain | Medium | Pre-download models in Dockerfile. Show "Downloading models..." on first `docker compose up`. |
| CORS issues between Next.js (port 3000) and FastAPI (port 8000) | High | Low | Configure CORS middleware in FastAPI to allow localhost:3000. Add API URL env var to frontend. |
| Large audio files cause OOM in Docker | Low | High | Set `--shm-size=4g` in Docker Compose. Limit input file size to 200MB (existing validation). |
| Expansion algorithm produces gain artifacts | Medium | Medium | Clamp expansion ratio to 1:4 max. Apply gentle smoothing to the inverted envelope. Bypass expansion if detected pumping is below threshold. |
| Second Demucs pass on "other" produces low-quality results | Medium | Low | Mark as "experimental" in UI. User can skip the second pass. |
| Docker container restart loses in-flight jobs | Low | Medium | Write job state to a temp JSON file on disk (survives restarts). Frontend handles 404 on status poll as terminal error with retry-from-scratch option. |

## Goal Verification

### Truths

1. User uploads a single audio file → sees "Separating stems..." progress → stems appear in mixer — TS-001
2. User can choose 4-stem or 6-stem model before separation — TS-001
3. Separated stems have reduced spectral bleeding compared to raw Demucs output — TS-003
4. Separated stems from heavily compressed source (Suno) have restored dynamics — TS-003
5. Panned instruments are sub-split into left/right stems — TS-002
6. Multi-file/ZIP upload still goes directly to mixer (no separation) — TS-004
7. Stems sum back to approximate original (phase coherence) — TS-003
8. Docker backend starts with `docker compose up` and serves API on :8000 — TS-005

### Artifacts

1. `backend/` — FastAPI + Demucs service (Dockerfile, main.py, separation logic)
2. `docker-compose.yml` — Local dev orchestration
3. `src/lib/audio/smart-repair.ts` — Client-side repair DSP pipeline
4. `src/lib/audio/stereo-split.ts` — M/S decoding for sub-stem separation
5. `src/lib/api/separation.ts` — Frontend API client for backend
6. `src/components/mixer/SeparationProgress.tsx` — Progress UI during separation
7. Modified: `src/components/mixer/StemUpload.tsx` — Unified upload flow
8. Modified: `src/hooks/useMixEngine.ts` — Separation integration

## E2E Test Scenarios

### TS-001: Single File → Separation → Mixer
**Priority:** Critical
**Preconditions:** Docker backend running on :8000, dev server on :3000
**Mapped Tasks:** Task 2, Task 3, Task 7, Task 8

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to / (home page) | Upload area visible |
| 2 | Upload a single audio file | Stem count selection appears (4 or 6) |
| 3 | Select "6 stems" | "Separating stems..." progress bar appears |
| 4 | Wait for separation to complete | Progress reaches 100%, stems appear in mixer |
| 5 | Verify stem names | vocals, drums, bass, guitar, piano, other (6 stems) |
| 6 | Verify waveform timeline shows all stems | 6 waveform lanes visible |

### TS-002: Stereo Sub-Split
**Priority:** High
**Preconditions:** Stems loaded from separation (guitar or other panned stem)
**Mapped Tasks:** Task 4

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | After separation, check if any stem has stereo sub-split indicator | Panned stems show "Split L/R" option |
| 2 | Click "Split L/R" on the guitar stem | Guitar stem splits into "Guitar (L)" and "Guitar (R)" sub-stems |
| 3 | Verify both sub-stems appear in mixer | Two new stems with distinct pan positions |

### TS-003: Smart Repair Quality
**Priority:** High
**Preconditions:** Stems separated from a compressed source (Suno/Udio track)
**Mapped Tasks:** Task 5, Task 6

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Separate a known Suno-generated track | Stems appear in mixer |
| 2 | Toggle "Smart Repair" on/off via UI | Audible difference — repaired stems sound cleaner |
| 3 | Solo the vocal stem | Less bleed from drums/instruments compared to raw |
| 4 | Check metering on repaired stems | Dynamic range is wider than raw Demucs output |

### TS-004: Multi-File Upload Bypass
**Priority:** Critical
**Preconditions:** On home page or /mix page
**Mapped Tasks:** Task 8

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Upload multiple audio files at once | Files go directly to mixer (no separation) |
| 2 | Upload a ZIP file | ZIP extracted, stems loaded directly |
| 3 | Verify no separation progress shown | Mixer loads immediately |

### TS-005: Backend Health Check
**Priority:** Critical
**Preconditions:** Docker compose running
**Mapped Tasks:** Task 1

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | `curl http://localhost:8000/health` | Returns `{"status": "ok", "gpu": true/false, "models": ["htdemucs", "htdemucs_6s"]}` |
| 2 | `curl http://localhost:8000/docs` | FastAPI Swagger UI loads |

### TS-006: Second Demucs Pass on "Other"
**Priority:** Medium
**Preconditions:** Song already separated with "other" stem present
**Mapped Tasks:** Task 9

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Locate the "other" stem in the mixer | "Other" stem visible with "Split Further" button |
| 2 | Click "Split Further" | Progress indicator for second separation pass |
| 3 | Wait for completion | "Other" stem replaced by sub-stems (e.g., "Other → Vocals 2", "Other → Guitar 2") |
| 4 | Verify sub-stems in mixer | New stems have waveforms and channel strip controls |

## Progress Tracking

- [x] Task 1: Backend Docker + FastAPI scaffold
- [x] Task 2: Demucs separation endpoint
- [x] Task 3: Job status + stem download endpoints
- [x] Task 4: Stereo sub-split DSP
- [x] Task 5: Smart Repair — de-bleed + expansion
- [x] Task 6: Smart Repair — transient restore + phase coherence
- [x] Task 7: Frontend API client + separation progress UI
- [x] Task 8: Unified upload UX + mixer integration
- [x] Task 9: Second Demucs pass on "other" stem
- [x] Task 10: Unit tests for all DSP + E2E tests
      **Total Tasks:** 10 | **Completed:** 10 | **Remaining:** 0

## Implementation Tasks

### Task 1: Backend Docker + FastAPI Scaffold

**Objective:** Create the Docker-based FastAPI backend with GPU support, health check, and CORS configuration.

**Dependencies:** None

**Mapped Scenarios:** TS-005

**Files:**

- Create: `backend/Dockerfile`
- Create: `backend/requirements.txt`
- Create: `backend/main.py`
- Create: `docker-compose.yml`
- Create: `backend/.dockerignore`

**Key Decisions / Notes:**

- Python 3.11 + FastAPI + uvicorn
- Base image: `nvidia/cuda:12.1-runtime-ubuntu22.04` for GPU support; fallback to `python:3.11-slim` if no GPU
- Install `torch`, `torchaudio`, `demucs` via pip
- Pre-download Demucs models in Dockerfile (htdemucs + htdemucs_6s) using `python -c "import demucs.pretrained; demucs.pretrained.get_model('htdemucs'); demucs.pretrained.get_model('htdemucs_6s')"`
- CORS middleware: allow `http://localhost:3000`
- Health endpoint: `GET /health` returns `{"status": "ok", "gpu": bool, "models": [...]}`
- Docker Compose: `backend` service with `runtime: nvidia` (GPU), port 8000, `shm_size: 4g`, volume mount for temp files
- Add `NEXT_PUBLIC_SEPARATION_API_URL=http://localhost:8000` to `.env.local`

**Definition of Done:**

- [ ] `docker compose up --build` starts the backend without errors
- [ ] `curl http://localhost:8000/health` returns valid JSON with gpu status
- [ ] CORS headers present on response for localhost:3000 origin
- [ ] No GPU → service still starts (CPU fallback)

**Verify:**

- `docker compose up --build -d && sleep 10 && curl http://localhost:8000/health`

---

### Task 2: Demucs Separation Endpoint

**Objective:** Implement `POST /separate` endpoint that accepts an audio file, runs Demucs, and returns a job ID for polling.

**Dependencies:** Task 1

**Mapped Scenarios:** TS-001

**Files:**

- Create: `backend/separation.py` (Demucs wrapper)
- Modify: `backend/main.py` (add /separate endpoint)
- Create: `backend/jobs.py` (in-memory job store)

**Key Decisions / Notes:**

- `POST /separate` accepts multipart form upload (`file: UploadFile`, `model: str = "htdemucs"`)
- `model` parameter: `"htdemucs"` (4 stems) or `"htdemucs_6s"` (6 stems)
- Save uploaded file to temp dir, start Demucs in background thread (or asyncio.to_thread)
- Return `{"job_id": uuid, "status": "queued"}` immediately
- Demucs separation via CLI: `demucs.separate.main(["-n", model_name, "--out", output_dir, input_path])` (no `--two-stems` flag — that flag takes a stem name for 2-stem mode, not needed for full multi-stem separation)
- Or use the Python API (preferred — enables progress tracking): `demucs.pretrained.get_model(model_name)` → `demucs.apply.apply_model(model, wav, device=device)`
- Output: one WAV per stem in `{output_dir}/{model_name}/{filename}/`
- Store job state: `{id, status, progress, model, stems: [{name, path}], error}`

**Definition of Done:**

- [ ] `POST /separate` with a WAV file returns `{"job_id": "...", "status": "queued"}`
- [ ] Demucs processes the file and produces stem WAVs in the output directory
- [ ] Both htdemucs (4 stems) and htdemucs_6s (6 stems) work
- [ ] Invalid files return 400 with error message

**Verify:**

- `curl -X POST -F "file=@test.wav" -F "model=htdemucs" http://localhost:8000/separate`

---

### Task 3: Job Status + Stem Download Endpoints

**Objective:** Implement `GET /jobs/{id}/status` for polling and `GET /jobs/{id}/stems/{name}` for downloading individual stem WAVs.

**Dependencies:** Task 2

**Mapped Scenarios:** TS-001

**Files:**

- Modify: `backend/main.py` (add status + download endpoints)
- Modify: `backend/jobs.py` (track progress, cleanup)

**Key Decisions / Notes:**

- `GET /jobs/{id}/status` returns `{"job_id": str, "status": "queued" | "processing" | "done" | "error", "progress": 0-100, "stems": [{"name": "vocals", "ready": true}], "error": str | null, "model": str}`
- Progress tracking: use coarse milestones since Demucs doesn't expose a native progress callback. Report: 0% = queued, 10% = file loaded + model initialized, 50% = separation running (single update when `apply_model` is called), 90% = writing stem WAVs to disk, 100% = done. This gives 4 distinct progress values. For finer granularity in future: monkey-patch the segment loop in `demucs.apply` to count processed segments.
- `GET /jobs/{id}/stems/{name}` returns the WAV file as `audio/wav` with `Content-Disposition: attachment`
- Cleanup: delete temp files after stems are downloaded (or after 30 min TTL)
- 404 for unknown job ID or stem name

**Definition of Done:**

- [ ] Status endpoint returns correct state transitions: queued → processing → done
- [ ] Progress updates during processing (at least 3 distinct values between 0 and 100)
- [ ] Stem download returns valid WAV files
- [ ] 404 for invalid job/stem IDs
- [ ] Temp files cleaned up after download or timeout

**Verify:**

- Poll status until done, then download each stem and verify WAV header

---

### Task 4: Stereo Sub-Split DSP

**Objective:** Client-side DSP that splits a stereo stem into left-panned and right-panned sub-stems using Mid/Side decoding and pan detection.

**Dependencies:** None (client-side only)

**Mapped Scenarios:** TS-002

**Files:**

- Create: `src/lib/audio/stereo-split.ts`
- Test: `src/lib/audio/__tests__/stereo-split.test.ts`

**Key Decisions / Notes:**

- Takes an AudioBuffer (stereo), outputs two AudioBuffers (left-panned content, right-panned content)
- Algorithm:
  1. M/S encode: mid = (L+R)/2, side = (L-R)/2
  2. Analyze side channel energy in short windows (~50ms) — high side energy = panned content
  3. Split: left sub-stem = mid + positive-side, right sub-stem = mid + negative-side (simplified)
  4. More sophisticated: windowed FFT, separate frequency bins based on pan position estimation
- Simpler approach for v1: just split the stereo field at center (>0 pan → right sub-stem, <0 → left sub-stem) using inter-channel level difference (ILD)
- Return `{ left: AudioBuffer, right: AudioBuffer, hasPannedContent: boolean }`
- `hasPannedContent` flag: true if side energy > 20% of total energy (significant stereo spread)
- Follow existing DSP pattern from `src/lib/audio/dsp/` — pure functions, unit-testable
- This applies to any panned instrument — guitars, synths, strings, etc.

**Definition of Done:**

- [ ] `stereoSplit(buffer)` produces two sub-stem AudioBuffers
- [ ] Left sub-stem contains predominantly left-panned content
- [ ] Right sub-stem contains predominantly right-panned content
- [ ] `hasPannedContent` correctly identifies mono vs stereo stems
- [ ] Tests with synthetic stereo test signals verify correct separation

**Verify:**

- `pnpm test -- --reporter=dot src/lib/audio/__tests__/stereo-split.test.ts`

---

### Task 5: Smart Repair — De-bleed + Compression Expansion

**Objective:** Client-side DSP for the two most impactful repair algorithms: spectral de-bleeding and compression envelope expansion.

**Dependencies:** None (client-side only)

**Mapped Scenarios:** TS-003

**Files:**

- Create: `src/lib/audio/smart-repair.ts`
- Test: `src/lib/audio/__tests__/smart-repair.test.ts`

**Key Decisions / Notes:**

- **Spectral de-bleed:**
  - Per-stem-type frequency masks: vocals pass 100Hz-8kHz, bass pass 20Hz-400Hz, drums pass 30Hz-12kHz (wider), guitar pass 80Hz-6kHz
  - Apply gentle spectral gate: for each frequency bin, if energy is below the stem-type mask threshold, attenuate by 12-18 dB (not hard cut — preserves natural tail)
  - Use windowed DFT (same frame approach as `stem-analyzer.ts`), apply mask, inverse DFT
  - Overlap-add reconstruction for seamless output

- **Compression expansion:**
  - Detect the original master bus compressor's gain envelope by analyzing the mix's RMS envelope in short windows (~10ms)
  - Compare each stem's envelope against the mix envelope — correlated dips indicate compression pumping
  - Invert the detected envelope: where the original compressor reduced gain, apply the inverse gain (expansion)
  - Clamp expansion ratio to 1:4 max to avoid artifacts
  - Use existing `followEnvelope()` from `src/lib/audio/dsp/envelope.ts` for smooth envelope tracking
  - Use existing `makeAttackReleaseCoeffs()` from `src/lib/audio/dsp/compressor.ts` for timing

- Both algorithms operate on Float32Array samples directly (same pattern as `src/lib/audio/renderer.ts`)
- Export: `applyDebleed(samples, sampleRate, stemType)` and `applyExpansion(stemSamples, mixSamples, sampleRate)`

**Definition of Done:**

- [ ] `applyDebleed` attenuates out-of-band content for each stem type
- [ ] `applyExpansion` increases dynamic range of compressed stems
- [ ] Expansion doesn't introduce clipping (output peak ≤ 0 dBFS)
- [ ] Tests verify de-bleed reduces energy outside frequency mask
- [ ] Tests verify expansion increases RMS variance (dynamic range)

**Verify:**

- `pnpm test -- --reporter=dot src/lib/audio/__tests__/smart-repair.test.ts`

---

### Task 6: Smart Repair — Transient Restore + Phase Coherence

**Objective:** Complete the Smart Repair pipeline with transient restoration and phase coherence verification.

**Dependencies:** Task 5

**Mapped Scenarios:** TS-003

**Files:**

- Modify: `src/lib/audio/smart-repair.ts` (add transient restore + phase check)
- Modify: `src/lib/audio/__tests__/smart-repair.test.ts` (add tests)

**Key Decisions / Notes:**

- **Transient restoration:**
  - Detect transients via short-window RMS derivative (same approach as `stem-analyzer.ts:computeTransientDensity`)
  - Where a transient is detected (RMS jump > threshold), sharpen the attack by applying a fast gain ramp (0.5ms attack) that boosts the first 2-5ms of the transient by 2-4 dB
  - Only apply to stems classified as drums, guitar, keys — not vocals or strings (they don't have sharp transients)
  - Use a sidechain approach: detect from original, apply to repaired

- **Phase coherence verification:**
  - Sum all repaired stems → compare against original mix
  - Compute correlation coefficient between sum and original in short windows
  - If correlation < 0.9 in any window, flag that window
  - Generate a "coherence score" (0-100%) — display in UI
  - Do NOT auto-fix phase issues — just report them. Phase correction is complex and could make things worse.

- Export: `applyTransientRestore(samples, sampleRate, stemType)` and `checkPhaseCoherence(stems, originalMix, sampleRate)`

**Definition of Done:**

- [ ] `applyTransientRestore` sharpens transient attacks on percussive stems
- [ ] Transient restore doesn't affect sustained content (vocals, strings)
- [ ] `checkPhaseCoherence` returns coherence score 0-100%
- [ ] Tests verify transient restoration increases crest factor on drum stems
- [ ] Tests verify phase coherence detects intentional phase inversion

**Verify:**

- `pnpm test -- --reporter=dot src/lib/audio/__tests__/smart-repair.test.ts`

---

### Task 7: Frontend API Client + Separation Progress UI

**Objective:** Build the TypeScript API client for the separation backend and a progress component that shows separation status.

**Dependencies:** Task 3

**Mapped Scenarios:** TS-001

**Files:**

- Create: `src/lib/api/separation.ts`
- Create: `src/components/mixer/SeparationProgress.tsx`
- Test: `src/lib/api/__tests__/separation.test.ts`
- Test: `src/components/mixer/__tests__/SeparationProgress.test.tsx`

**Key Decisions / Notes:**

- API client: `startSeparation(file, model)` → `{ jobId }`, `pollStatus(jobId)` → `{ status, progress, stems }`, `downloadStem(jobId, stemName)` → `ArrayBuffer`
- Use `fetch` for API calls (no extra HTTP library)
- API URL from `process.env.NEXT_PUBLIC_SEPARATION_API_URL` (default `http://localhost:8000`)
- Polling: 2-second interval, auto-stop when status is "done" or "error"
- SeparationProgress component: shows model name, progress bar (0-100%), stem names appearing as they complete, estimated time remaining
- Handle errors: backend unreachable (show "Start Docker backend" message), separation failed (show error from API)
- Model selection: dropdown or toggle (4 stems / 6 stems) shown before separation starts

**Definition of Done:**

- [ ] API client correctly calls all 3 endpoints
- [ ] Polling stops automatically on completion or error
- [ ] Progress component shows real-time progress updates
- [ ] Error states handled gracefully (backend down, separation failed)
- [ ] Model selection UI works

**Verify:**

- `pnpm test -- --reporter=dot src/lib/api/__tests__/separation.test.ts src/components/mixer/__tests__/SeparationProgress.test.tsx`

---

### Task 8: Unified Upload UX + Mixer Integration

**Objective:** Merge the upload flows into a single path. Single file → separation → repair → mixer. Multi-file/ZIP → mixer directly. Remove the separate mastering upload path.

**Dependencies:** Task 4, Task 5, Task 6, Task 7

**Mapped Scenarios:** TS-001, TS-004

**Files:**

- Modify: `src/app/page.tsx` (unified upload → always go to /mix)
- Modify: `src/components/upload/UploadScreen.tsx` (remove "Mix Stems" link, handle all uploads)
- Modify: `src/app/mix/page.tsx` (add separation flow + repair toggle)
- Modify: `src/hooks/useMixEngine.ts` (add `separateAndLoad` action)
- Modify: `src/components/mixer/StemUpload.tsx` (detect single vs multi, trigger separation)

**Key Decisions / Notes:**

- Home page upload: ANY upload goes to /mix
  - Single audio file → show model selection → start separation → show progress → load repaired stems
  - Multiple files → load directly into mixer (existing flow)
  - ZIP → extract and load (existing flow)
- Remove the `router.push("/master")` from home page — everything goes through /mix first
- User can still "Send to Master" from the mixer (existing button)
- Add "Smart Repair" toggle in the mixer header — on by default for separated stems, off for direct uploads
- The repair pipeline runs client-side after stems are downloaded from the backend
- `useMixEngine.separateAndLoad(file, model)`: decode original file to AudioBuffer first (retain as `originalMixBuffer` in mixer store for phase coherence check) → upload to API → poll → download stems → apply repair (passing originalMixBuffer to phase coherence) → load into engine
- Add `originalMixBuffer: AudioBuffer | null` field to mixer store

**Definition of Done:**

- [ ] Single file upload triggers separation flow
- [ ] Multi-file/ZIP upload goes directly to mixer
- [ ] Smart Repair toggle visible and functional
- [ ] Separated + repaired stems load into mixer with classifications
- [ ] "Send to Master" still works from mixer
- [ ] Home page has single unified upload area
- [ ] `src/app/mix/page.tsx` still routes to /master when user clicks "Send to Master" (retained, not removed)

**Verify:**

- `pnpm run build` (verify all pages compile)
- E2E: upload single file → verify separation progress → verify stems in mixer

---

### Task 9: Second Demucs Pass on "Other" Stem

**Objective:** Optional feature — run Demucs again on the "other" stem to extract additional instruments.

**Dependencies:** Task 2, Task 3, Task 8

**Mapped Scenarios:** TS-006

**Files:**

- Modify: `backend/separation.py` (add recursive separation option)
- Modify: `backend/main.py` (add `recursive` parameter to /separate)
- Modify: `src/lib/api/separation.ts` (support recursive option)
- Modify: `src/app/mix/page.tsx` (add "Split Other" button on the "other" stem)

**Key Decisions / Notes:**

- After initial separation, if the "other" stem exists, offer a "Split Further" button
- Clicking it: uploads the "other" stem back to the API with `POST /separate` (same endpoint, different file)
- The second pass uses the same model — htdemucs_6s on the "other" stem may extract synths, strings, etc.
- Replace the single "other" stem with the sub-stems in the mixer
- Mark second-pass stems with lower confidence scores
- Label in UI: "Other → Vocals 2", "Other → Guitar 2", etc.

**Definition of Done:**

- [ ] "Split Further" button appears on "other" stem
- [ ] Clicking it sends the stem to the API for re-separation
- [ ] New sub-stems replace the "other" stem in the mixer
- [ ] Progress shown during second pass

**Verify:**

- Upload a song → separate → click "Split Further" on "other" → verify new stems appear

---

### Task 10: Unit Tests for All DSP + E2E Tests

**Objective:** Comprehensive test coverage for Smart Repair DSP and full E2E test for the separation flow.

**Dependencies:** Task 8, Task 9

**Mapped Scenarios:** TS-001 through TS-005

**Files:**

- Create: `e2e/smart-split.spec.ts`
- Modify: existing test files to ensure no regressions

**Key Decisions / Notes:**

- E2E tests need the Docker backend running — use `test.skip` if backend is not available (check /health endpoint in global setup)
- Test fixtures: generate `e2e/fixtures/mixed-track.wav` by summing the existing stem WAV files (bass + vocals + drums + guitar) in the fixture generator script. Upload this mixed track as the "single file" for separation E2E tests. Individual stem fixtures are NOT suitable since separating an already-isolated signal is not a meaningful test.
- For E2E, the real Demucs output quality isn't verifiable — just verify the flow works (upload → progress → stems appear)
- Unit tests for smart-repair: use synthetic test signals
  - De-bleed: generate signal with known frequency content, verify out-of-band suppression
  - Expansion: generate signal with known compression envelope, verify dynamic range increases
  - Transient restore: generate signal with softened transients, verify crest factor increases
  - Phase coherence: sum modified stems, verify correlation with original

**Definition of Done:**

- [ ] All smart-repair unit tests pass
- [ ] E2E test for single-file separation flow passes (when backend is running)
- [ ] E2E test for multi-file bypass passes
- [ ] Existing mastering + mixer E2E tests still pass (no regressions)
- [ ] `pnpm test -- --reporter=dot` shows all unit tests green

**Verify:**

- `pnpm test -- --reporter=dot`
- `pnpm exec playwright test --workers=1 --reporter=line` (with Docker running)

---

## Open Questions

None — all major decisions resolved during planning.

## Deferred Ideas

- **Cloud GPU deployment** — Deploy the Demucs backend to a cloud GPU instance (RunPod, Lambda, etc.) for users without local GPU
- **Custom Demucs fine-tuning** — Train on specific genres (metal, EDM) for better separation quality
- **Real-time separation preview** — Stream partial separation results as they become available
- **Repair strength slider** — Per-algorithm intensity control (de-bleed strength, expansion amount, transient boost)
- **A/B comparison** — Toggle between raw Demucs output and Smart Repair output for each stem
- **Batch processing** — Separate multiple songs in a queue
