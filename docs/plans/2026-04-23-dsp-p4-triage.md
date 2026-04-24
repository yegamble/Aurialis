# DSP Phase 4a — Multiband Polish, Visibility & Roadmap Implementation Plan

Created: 2026-04-23
Author: yegamble@gmail.com
Status: VERIFIED
Approved: Yes
Iterations: 1
Worktree: Yes
Type: Feature

## Summary

**Goal:** Promote five of the eleven surfaced P4+ mastering ideas into a shippable "Phase 4a" — per-genre multiband defaults, intensity-driven multiband engagement, per-band MB gain-reduction meters in the transport, per-stage A/B bypass pills (supplementing the existing global A/B), and a vectorscope/goniometer in the right rail — while recording the remaining six ideas as a P5+ roadmap with verdicts and rationale.

**Architecture:** Additive changes on top of the existing `InputGain → EQ → Compressor → Multiband → Saturation → StereoWidth → Limiter → Metering` chain. Four new master-enable fields on `AudioParams` (`compressorEnabled`, `saturationEnabled`, `stereoWidthEnabled`, `limiterEnabled`) get wired to the **already-existing** `setBypass()` methods on each node (compressor/saturation/limiter/parametric-eq worklets already accept an `enabled` param; EQNode already delegates to `setEnabled`). The one exception is `StereoWidthNode` — it is a native Web Audio graph (ChannelSplitter → M/S gain matrix → ChannelMerger), not a worklet, and its existing `setBypass()` is a dead no-op; this plan implements a real bypass by rewiring the internal graph. Genre presets gain tuned multiband fields so `applyIntensity()` smoothly scales them — `*Enabled` fields are snapped to {0,1} inside `applyIntensity()` to keep binary flags binary. Existing `onMultibandGR` callback is surfaced in the transport readout. A new `Goniometer` component consumes L/R samples from a pair of main-thread `AnalyserNode`s (not from the BS.1770-4 metering worklet, which is correctness-critical).

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Tailwind, Zustand (audio-store), AudioWorklet (pnpm). No new runtime deps.

## Scope

### In Scope (Phase 4a — implement now)

- **Item 6** Curated per-genre multiband defaults (all 9 genres classified; non-trivial changes for pop/rock/hiphop/electronic/rnb/podcast; jazz/classical/lofi remain MB-off).
- **Item 7** Intensity-driven multiband engagement — falls out of item 6 because `applyIntensity()` interpolates every numeric field including the `*Enabled` flags. Explicit verification test, not new code.
- **Item 3** Per-band multiband GR readout (inline numeric `MB L/M/H: -2.1 / -0.4 / -1.3 dB`) in the existing transport stats column.
- **Item 8** Per-stage A/B bypass pills in each Advanced section (EQ, Comp, MB, Sat, Width, Limiter). Supplements the existing global `ABToggle` in the transport — the global toggle stays.
- **Item 9** Vectorscope / goniometer visual in the right sidebar, directly under `LevelMeter`.
- **Triage record:** P5+ roadmap section covering items 1, 2, 4, 5, 10, 11 with verdicts, rationale, and tentative phase assignment.

### Out of Scope (defer to P5+)

- **Item 1** Per-band parametric EQ inside the multiband stage — requires extending `multiband.ts` and its worklet to host filter banks per band; separate large plan warranted.
- **Item 2** Per-band independent M/S parameter sets — ~24 new `AudioParams` fields (8 per band × 3 bands) + worklet refactor; breaks the shared-threshold + `msBalance` bias model.
- **Item 4** 4-band / 5-band variants — `ThreeWaySplitter` would need to be generalized; UI would need dynamic band rows; genre presets would need per-N-band variants.
- **Item 5** Preset crossover schemes (Standard / Bass-focused / Vocal-focused pills) — trivial once item 4 lands or can ship standalone as P5a.
- **Item 10** FIR linear-phase crossover — rejected for real-time due to latency. Kept in roadmap as **"export/print-only"** P5+ item; would sit in `renderer.ts` with an opt-in flag, never on the live path.
- **Item 11** LRA target matching / automatic makeup gain — `computeLRA()` already exists; needs a target field on `AudioParams`, analysis-driven suggestion in `auto-master.ts`, and a UI affordance. Deferred as its own plan.

## Approach

**Chosen:** MVP — Multiband polish, visibility, and per-stage A/B. Implement items 3, 6, 7, 8, 9 in this phase.

**Why:** Highest user-visible impact for the DSP work already shipped. Items 3/6/7 make the existing 3-band multiband audibly useful out of the box instead of hidden off-by-default. Items 8/9 are UX depth that riff on primitives already in the codebase (`parametricEqEnabled` pattern, `RunningCorrelation`, `onMultibandGR` callback). No worklet topology changes. Cost: the deeper DSP ideas (per-band EQ, per-band M/S, variable band counts) wait another phase.

**Alternatives considered:**
- **DSP depth** (items 1, 2, 6): heavier worklet lift, larger schema churn, less immediate user-visible payoff.
- **Visibility + polish** (items 3, 8, 9, 11): safer change but doesn't actually improve what the multiband sounds like.
- **Everything except FIR**: 10 ideas in one phase; high risk of task creep and long review with parallel DSP and UI surfaces.

## Context for Implementer

> Write for an implementer who has never seen the codebase.

- **Chain order (authoritative):** `src/lib/audio/chain.ts:88-96` — `inputGain → EQ → Compressor → MultibandCompressor → Saturation → StereoWidth → Limiter → Metering → outputGain`.
- **Master-enable pattern — already exists on most nodes:** `parametricEqEnabled` (see `src/lib/audio/chain.ts:134-136` and `src/lib/audio/nodes/eq.ts:107-109` — `setBypass(b)` delegates to `setEnabled(b ? 0 : 1)`) and `multibandEnabled` (see `src/lib/audio/dsp/multiband.ts:112-129` — bit-exact bypass when no bands are enabled and no solos are active). Worklets for compressor, saturation, limiter, and parametric-eq **already accept an `enabled` param** and their node classes **already expose `setBypass(boolean)`**. What's missing is not new worklet bypass infrastructure — it's the `AudioParams` fields, `DEFAULT_PARAMS` defaults, `chain.ts` switch cases, `renderer.ts` parity skips, and UI wiring.
- **StereoWidthNode exception:** `src/lib/audio/nodes/stereo-width.ts:108-109` — `setBypass()` today sets a private `_bypassed` flag that is never read. Real bypass requires disconnecting the internal M/S graph (splitter → merger path) and routing `_input` directly to `_output`. This plan implements that as part of Task 5.
- **Global vs per-stage A/B ownership (important design decision):** `engine.setBypass()` (`src/lib/audio/engine.ts:112-119`) uses `AudioBypass` (`src/lib/audio/bypass.ts`), which rewires `inputGain → outputGain` at the chain boundary. It does **NOT** touch any per-node `_bypassed` or `enabled` flag — the two state paths are fully independent. This means per-stage pill state persists across global A/B toggles without extra work. Document this explicitly in comments; do not regress it.
- **Parameter bridging:** `src/lib/audio/chain.ts` `updateParam()` switch-case — every new `AudioParams` field needs a case.
- **Presets (source of truth):** `src/lib/audio/presets.ts` — `DEFAULT_PARAMS` + `GENRE_PRESETS` spread the defaults then override. `applyIntensity()` interpolates every numeric field, copies enums verbatim.
- **Multiband metering wiring:** `src/lib/audio/chain.ts:82-84` already subscribes to `_multiband.onGainReduction`. `ProcessingChain.onMultibandGR` is exposed but the `useAudioEngine` hook doesn't forward it to the store yet — do that in Task 3.
- **Transport stats column:** `src/app/master/page.tsx:321-356` — matches the existing "tabular-nums" + color-coded correlation pattern. Insert the MB readout right below Correlation.
- **Goniometer data source:** Do **NOT** extend `metering-processor.js` — it is the ITU-R BS.1770-4 LUFS / 4× true-peak / LRA / correlation hot path and is parity-tested against `oversampling.ts`. Instead, the goniometer pulls L/R time-domain data from a pair of main-thread `AnalyserNode`s (same pattern as `SpectrumDisplay`) tapped off the end of the chain. No worklet changes needed. `RunningCorrelation` is orthogonal and stays as-is.
- **Right sidebar:** `src/app/master/page.tsx:432-441` currently holds only `<LevelMeter>`. Goniometer mounts directly below it.
- **Advanced sections — actual layout:** The current `<Section>` titles in `AdvancedMastering.tsx` are **Input, Dynamics, Multiband, Tone, Parametric EQ, Saturation, Stereo, Output** — there is **no "Compressor"** section (compressor sliders live inside *Dynamics* alongside de-harsh / glue-comp / auto-release toggles) and **no "Limiter"** section (limiter sliders live inside *Output* alongside Target LUFS / Platform). A naive "one pill per Section" pass would put a compressor-bypass on the whole Dynamics panel and a limiter-bypass on the whole Output panel. Task 5 therefore restructures the UI: split *Dynamics* into a new **Compressor** Section + **Dynamics Toggles** Section, and split *Output* into a new **Limiter** Section + **Output Target** Section. Post-restructure, Section ↔ stage is 1:1 for the 6 DSP stages (EQ, Compressor, Multiband, Saturation, Stereo, Limiter).
- **Bypass pill pattern — already exists:** The Parametric EQ Section already ships a bypass button (`src/components/mastering/AdvancedMastering.tsx:584-603`). Task 5 extracts it into a reusable `BypassPill` sub-component, migrates it to the Section header, and applies it to the 6 stage Sections.
- **Offline parity:** `src/lib/audio/renderer.ts` — every new enable field must be honored in offline rendering. Keep parity tests (`src/lib/audio/__tests__/renderer-multiband.test.ts` is the template).
- **`applyIntensity()` snaps `*Enabled` fields (new in this plan):** Task 2 modifies `applyIntensity()` so that fields ending in `Enabled` are snapped — `result[key] = t > 0 ? preset[key] : DEFAULT_PARAMS[key]` — instead of linearly interpolated. This keeps binary flags binary, prevents partial-engagement surprises at mid-intensity for per-stage master flags, and means multiband engagement is "off at intensity=0, on at intensity>0 with smoothly scaled threshold/ratio/makeup/attack/release". Non-enable numeric fields (thresholds, ratios, etc.) continue to interpolate linearly.
- **Gotcha:** `ThreeWaySplitter` LR4 crossovers impose all-pass summation phase shift when summed. The current multiband bit-exact bypass (`!anyEnabled && !anySolo`) skips the splitter entirely — DO NOT break this path when touching multiband code.
- **Domain:** "A/B" in mastering = press B to hear the input (dry) vs A = processed (wet). Per-stage A/B = bypass **one** stage to hear only its contribution. Classic mastering workflow.

## Runtime Environment

- **Start:** `pnpm dev` (Next.js 15, defaults to port 3000)
- **Deploy:** Cloudflare Workers via `pnpm build && pnpm deploy`
- **Worklets:** Served from `public/worklets/`, loaded by each audio node's `init()`
- **Health check:** `/master` page with file loaded → play/pause works → meters update
- **Restart:** Worklet code changes require a hard reload (Cmd+Shift+R) because worklets are cached in the AudioContext

## Autonomous Decisions

Questions toggle is enabled; Batch 1 and Batch 2 both ran. No autonomous defaults applied.

## Assumptions

- `onMultibandGR` fires at the worklet processing-quantum rate (~128 samples / ~2.9 ms at 44.1 kHz). Supported by `src/lib/audio/nodes/multiband-compressor.ts` posting per-quantum. Task 3 depends on this (throttled to ~30 Hz for display).
- Compressor, saturation, limiter, and parametric-eq worklets already accept an `enabled` port message; each node class already exposes `setBypass(boolean)`. Supported by `src/lib/audio/nodes/eq.ts:107-109`, `compressor.ts`, `saturation.ts`, `limiter.ts` and corresponding `public/worklets/*-processor.js`. Tasks 4, 5 depend on this — they wire new AudioParams fields to existing methods rather than building new worklet plumbing.
- `StereoWidthNode` currently has a no-op `setBypass()` (`src/lib/audio/nodes/stereo-width.ts:108-109`) and is the only stage that needs a real bypass implementation (native-graph disconnect/reconnect). Task 5 depends on this.
- Global A/B (`engine.setBypass` via `AudioBypass`) rewires at the chain boundary and does not touch per-node bypass flags — so per-stage pill state persists across global A/B toggles. Supported by `src/lib/audio/bypass.ts` + `engine.ts:112-119`. Task 5 depends on this — **if engine.ts ever clobbers per-node state, this invariant breaks silently**, so Task 5's E2E (TS-004) explicitly exercises it.
- Main-thread `AnalyserNode` at `fftSize: 2048` + `getFloatTimeDomainData()` provides sufficient resolution for a goniometer on mid-range laptops. Supported by existing `SpectrumDisplay` pattern. Task 6 depends on this.
- After Task 2 snaps `*Enabled` fields in `applyIntensity()`, no existing preset or test depends on interpolated values (0.5 etc.) for multiband fields. **Verify** — `src/lib/audio/__tests__/preset-regression-multiband.test.ts` and `presets.test.ts` may assert continuous numeric values; expected values get updated. Tasks 1, 2 depend on this.
- No production code path serializes `AudioParams` across sessions (no localStorage / save-preset-to-JSON flow today) — so adding four new `*Enabled` fields is safe schema-wise. **Verify by grep** in Task 4.

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Enabling multiband in genre presets breaks existing preset regression tests | High | Medium | Run `preset-regression-multiband.test.ts` early; update expected values to match new genre curation (tests lock behavior, not a guarantee that old values are correct). Document the change in the test file. |
| LR4 phase shift becomes audible when multiband engages at low intensity for the first time per genre | Medium | Medium | Tune each genre's per-band `threshold` and `ratio` so intensity=50 produces ≤1 dB GR on typical material; add a perceptual A/B verification scenario. |
| Adding 4 master-enable fields inflates every test fixture that spreads `DEFAULT_PARAMS` | High | Low | All genre presets spread `DEFAULT_PARAMS` — new fields flow through automatically. Grep for literal `AudioParams =` test fixtures; fewer than a dozen call sites. |
| Per-stage bypass diverges from offline renderer bypass | High | High | Mirror the exact bypass path in `renderer.ts` for each stage in the same PR; parity test uses 14 deterministic combinations (all-on, all-off, each-single-off × 6, each-single-on × 6) via `test.each()`, not random sampling. |
| Global A/B toggle silently clobbers per-stage pill state | Low | High | Confirmed independent in current `engine.ts:112-119` (global rewires chain boundary, does not touch per-node flags); invariant locked by E2E TS-004 step 2. If future refactor of `engine.setBypass` ever touches per-node state, this test catches it. |
| `AudioParams` schema change breaks persisted user presets | Low | Medium | Task 4 grep confirms no serialization today; if any found, add defaulting logic (missing `*Enabled` → 1) before the four fields land. |
| Stereo-width bypass (native graph rewire) introduces click at toggle | Medium | Low | Implement with `AudioParam.setTargetAtTime` ramp on output gain (~5 ms), or crossfade — accept a tiny non-bit-exact deviation for UX reasons. Document in the node's comment. Parity test uses a settled-state comparison (skip first 10 ms of buffer). |
| Goniometer rendering dropped frames on weak devices | Medium | Low | Respect `prefers-reduced-motion`; expose a toggle to disable; cap draw rate via `requestAnimationFrame` and skip frames when tab hidden. |
| `onMultibandGR` callback flooding main thread | Low | Medium | Throttle display-layer updates to ~30 Hz (store latest value, render on rAF). |

## Goal Verification

### Truths

1. Selecting Hip-hop at intensity=50 shows active multiband processing (low-band GR meter shows ≤0 dB value, not dashes).
2. Moving the intensity slider from 0 to 100 smoothly transitions multiband from bypassed to fully engaged with no audible click, pop, or discontinuity.
3. The transport stats column displays `MB L/M/H: -X.X / -Y.Y / -Z.Z dB` during playback, updating at ~30 Hz.
4. Every Advanced section (EQ, Compressor, Multiband, Saturation, Stereo Width, Limiter) has a visible Bypass pill that toggles only that stage.
5. Clicking a per-stage Bypass pill while audio is playing A/B-compares that stage's contribution without dropouts or discontinuities.
6. The global transport `ABToggle` still fully bypasses the chain end-to-end, independent of per-stage pill state.
7. The right sidebar shows a live goniometer: silent audio renders as a single point at origin, fully mono as a 45° line, fully out-of-phase as a −45° line, stereo content as a filled Lissajous cloud.
8. Offline WAV export with any combination of per-stage bypasses produces a sample buffer bit-equal (within 1e-6 tolerance) to what real-time playback produced through the same chain.
9. The `## P5+ Roadmap` section of this plan catalogs items 1, 2, 4, 5, 10, 11 with a verdict, rationale, and tentative phase assignment for each.

### Artifacts

- `src/lib/audio/presets.ts` — genre multiband defaults (real values, not zeros)
- `src/types/mastering.ts` — 4 new enable fields in `AudioParams`
- `src/lib/audio/chain.ts` — 4 new switch cases, multiband GR forwarding
- `public/worklets/{compressor,saturation,stereo-width,limiter}-processor.js` — internal bypass paths
- `src/lib/audio/renderer.ts` — offline bypass parity
- `src/app/master/page.tsx` — transport MB readout + goniometer mount
- `src/components/visualization/Goniometer.tsx` — new component
- `src/lib/audio/dsp/goniometer.ts` — stereo scatter buffer primitive (L/R decimated ring buffer)
- `src/components/mastering/AdvancedMastering.tsx` — per-stage Bypass pills in every Section header
- `docs/plans/2026-04-23-dsp-p4-triage.md` — this plan's P5+ Roadmap section

## E2E Test Scenarios

### TS-001: Hip-hop genre engages multiband at mid intensity
**Priority:** Critical
**Preconditions:** File loaded on `/master`; Simple mode; default genre=pop, intensity=50.
**Mapped Tasks:** Task 1, Task 3

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click genre chip "Hip-hop" | Genre button shows active state |
| 2 | Press Play | Audio plays |
| 3 | Observe transport stats column | `MB L/M/H` row shows a negative value on the Low band (≤ −0.2 dB) within 3 seconds |
| 4 | Click genre chip "Classical" | `MB L/M/H` readout transitions to dashes or `0.0` on all three bands |

### TS-002: Intensity slider drives multiband smoothly
**Priority:** Critical
**Preconditions:** Hip-hop selected, file loaded, playing.
**Mapped Tasks:** Task 1, Task 2 (verification)

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Drag intensity slider to 0 | `MB L/M/H` readout shows `---` or `0.0` on all bands; no audible multiband effect |
| 2 | Slowly drag intensity from 0 to 100 | No audible clicks or pops; GR values increase monotonically |
| 3 | Stop at intensity=50 | Low-band GR shows a stable value between −0.1 and −3 dB |

### TS-003: Per-stage bypass pills
**Priority:** Critical
**Preconditions:** Advanced mode, file loaded, playing. Post-restructure Section list is in effect (Task 5).
**Mapped Tasks:** Task 4, Task 5

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Expand the new **Compressor** Section (split out of Dynamics in Task 5) | Section shows `BypassPill` (`data-testid=bypass-pill-compressor`) in header |
| 2 | Click the Compressor BypassPill | Pill shows active (amber) state; audio continues without dropout; character audibly changes (less compressed) |
| 3 | Click again | Pill returns to inactive; compression restored |
| 4 | Repeat for EQ (`bypass-pill-eq`), Multiband (`bypass-pill-multiband`), Saturation (`bypass-pill-saturation`), Stereo (`bypass-pill-stereo-width`), Limiter (`bypass-pill-limiter`) | Each Section's pill toggles independently; stages can be bypassed in any combination |

### TS-004: Global A/B still works alongside per-stage
**Priority:** High
**Preconditions:** Advanced mode, Compressor and Multiband bypassed via per-stage pills.
**Mapped Tasks:** Task 4

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click global ABToggle in transport | Full chain bypassed (dry signal) |
| 2 | Click global ABToggle again | Chain restored; EQ/Saturation/Width/Limiter active; Compressor and Multiband remain per-stage bypassed |

### TS-005: Goniometer renders live
**Priority:** High
**Preconditions:** File loaded, playing on `/master` at xl+ viewport width.
**Mapped Tasks:** Task 6

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Observe right sidebar | `<canvas>` goniometer visible below LevelMeter |
| 2 | Press Play | Canvas shows an animated Lissajous cloud for stereo content |
| 3 | Set `stereoWidth` to 0 (mono collapse) | Cloud collapses toward a vertical (+45°) line |
| 4 | Toggle `prefers-reduced-motion` via devtools | Canvas either freezes or updates at ≤5 Hz; no continuous animation |

### TS-006: Offline export parity with per-stage bypasses
**Priority:** High
**Preconditions:** File loaded, at least one per-stage bypass active.
**Mapped Tasks:** Task 4, Task 5

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Set any 2 per-stage bypasses (e.g., Saturation + Limiter) | UI shows pills active |
| 2 | Click Export WAV | Export succeeds; downloaded file plays back identical to real-time monitoring of the same bypass config |

## Progress Tracking

- [x] Task 0: Write `## P5+ Roadmap` triage record in this plan file (independent, no dependencies — the user's "triage" deliverable)
- [x] Task 1: Curate per-genre multiband defaults in `GENRE_PRESETS` + publish per-genre inventory table
- [x] Task 2: Snap `*Enabled` fields in `applyIntensity()` + verify intensity-driven multiband engagement
- [x] Task 3: Surface per-band MB GR in audio-store + transport readout (throttled 30 Hz)
- [x] Task 4: Add `compressorEnabled`, `saturationEnabled`, `stereoWidthEnabled`, `limiterEnabled` to `AudioParams` → wire to **existing** `setBypass()` / worklet `enabled` param, real bypass for StereoWidthNode; renderer parity (14-combo test) + persistence grep
- [x] Task 5: Restructure AdvancedMastering UI (Dynamics → Compressor + Dynamics Toggles; Output → Limiter + Output Target) + extract reusable `BypassPill` + attach to 6 stage Section headers
- [x] Task 6: `Goniometer.tsx` canvas component driven by main-thread `AnalyserNode` pair (no worklet changes) + mount in right sidebar
- [x] Task 7: Update `## P5+ Roadmap` with any learnings from implementation (revisit + close)

**Total Tasks:** 8 | **Completed:** 8 | **Remaining:** 0

## Implementation Tasks

### Task 0: Write P5+ Roadmap record (triage deliverable)

**Objective:** Write the `## P5+ Roadmap` section of this plan *now*, at approval time, so the triage artifact is independently reviewable before any implementation work begins. Task 7 later revisits it with implementation learnings.
**Dependencies:** None
**Mapped Scenarios:** — (documentation)

**Files:**
- Modify: `docs/plans/2026-04-23-dsp-p4-triage.md` (append `## P5+ Roadmap` section with the template below)

**Key Decisions / Notes:**
- Template per item: **Item | Verdict (Promoted | Accepted-for-P5a | Accepted-for-P5b | Accepted-for-P5c | Rejected) | Tentative phase | Rationale (1-2 sentences) | Prerequisites**.
- Pre-agreed classifications (from Batch 1 + Batch 2 clarifications):
  - Item 1 (per-band EQ in MB): **Accepted-for-P5b** — extend `multiband.ts` + worklet to host per-band filter banks; large plan on its own.
  - Item 2 (per-band M/S param sets): **Accepted-for-P5b** — schema churn (~24 fields); gate on item 1 landing first.
  - Item 4 (4-band / 5-band variants): **Accepted-for-P5c** — generalize `ThreeWaySplitter` to N-way first.
  - Item 5 (crossover scheme pills — Standard / Bass / Vocal): **Accepted-for-P5a** — cheap (preset data + 3 pills); ships standalone.
  - Item 10 (FIR linear-phase crossover): **Accepted-for-P5a as export-only** — lives exclusively in `renderer.ts`; never on the live path (latency disqualifies real-time).
  - Item 11 (LRA target matching / auto-makeup): **Accepted-for-P5a** — `computeLRA()` already exists; needs `targetLra` field on `AudioParams` + analysis-driven suggestion in `auto-master.ts` + UI affordance.

**Definition of Done:**
- [ ] `## P5+ Roadmap` section exists in this plan file
- [ ] All 6 deferred items documented (1, 2, 4, 5, 10, 11) — each has a Verdict line
- [ ] Plan renders correctly in markdown (no broken headings)

**Verify:**
- `grep -c '^Verdict:' docs/plans/2026-04-23-dsp-p4-triage.md` → 6

---

### Task 1: Curate per-genre multiband defaults

**Objective:** Give each genre in `GENRE_PRESETS` tuned multiband fields so that selecting the genre at intensity=100 engages the multiband with genre-appropriate settings. Jazz, classical, lofi remain multiband-off.
**Dependencies:** None
**Mapped Scenarios:** TS-001, TS-002

**Files:**
- Modify: `src/lib/audio/presets.ts`
- Modify: `src/lib/audio/__tests__/presets.test.ts`
- Modify: `src/lib/audio/__tests__/preset-regression-multiband.test.ts`
- Test: `src/lib/audio/__tests__/presets-multiband-genre.test.ts` (NEW)

**Key Decisions / Notes:**

Per-genre multiband inventory (source of truth for Task 1; all 9 genres listed explicitly):

| Genre | `multibandEnabled` | `mbLowEnabled` | `mbMidEnabled` | `mbHighEnabled` | Low thr/ratio/att/rel/makeup | Mid thr/ratio/att/rel/makeup | High thr/ratio/att/rel/makeup | Crossovers | Rationale |
|-------|---|---|---|---|---|---|---|---|---|
| pop       | 1 | 1 | 0 | 0 | -20 / 2.5 / 15 / 200 / 1.0 | default | default | 200 / 2000 | Gentle low glue for modern radio-pop mix |
| rock      | 1 | 1 | 1 | 0 | -18 / 3.0 / 10 / 150 / 1.0 | -16 / 2.5 / 15 / 180 / 0.5 | default | 200 / 2000 | Body + mid clarity against guitar mass |
| hiphop    | 1 | 1 | 0 | 0 | -22 / 3.0 / 10 / 150 / 1.5 | default | default | 200 / 2000 | Low-band glue (kick/808) without squashing the high-end |
| electronic| 1 | 0 | 0 | 1 | default | default | -14 / 3.5 / 5 / 100 / 0.5  | 200 / 2000 | High-band control against ride/shaker masking |
| jazz      | 0 | 0 | 0 | 0 | default | default | default | 200 / 2000 | Preserve dynamics — no MB compression |
| classical | 0 | 0 | 0 | 0 | default | default | default | 200 / 2000 | Preserve dynamics |
| rnb       | 1 | 1 | 0 | 0 | -20 / 2.5 / 20 / 220 / 1.0 | default | default | 200 / 2000 | Subtle low glue without pumping |
| podcast   | 1 | 0 | 1 | 0 | default | -20 / 3.0 / 15 / 180 / 2.0 | default | 200 / 2000 | Vocal-band leveling for speech consistency |
| lofi      | 0 | 0 | 0 | 0 | default | default | default | 200 / 2000 | Dynamics/character preserved; lofi is about texture, not glue |

("default" = the neutral `DEFAULT_PARAMS` values: threshold=-18, ratio=2, attack=20, release=250, makeup=0.)

- Crossovers stay at the defaults (200 / 2000) across all genres in this phase — preset crossover schemes are P5a (item 5).
- This table is the inventory that `presets-multiband-genre.test.ts` (new) locks in.
- Update `preset-regression-multiband.test.ts` expected values to reflect the new defaults; add a comment block documenting the 2026-04-23 genre curation.

**Definition of Done:**
- [ ] All tests pass (including updated regression test)
- [ ] No diagnostics errors
- [ ] `GENRE_PRESETS.hiphop.multibandEnabled === 1` and `mbLowEnabled === 1`
- [ ] `GENRE_PRESETS.jazz.multibandEnabled === 0` (unchanged)
- [ ] New test file asserts multiband engagement state for each of the 9 genres

**Verify:**
- `pnpm test presets`
- `pnpm test preset-regression`

---

### Task 2: Snap `*Enabled` fields in `applyIntensity()` + intensity tests

**Objective:** Modify `applyIntensity()` so that any key ending in `Enabled` is snapped (`t > 0 ? preset[key] : DEFAULT_PARAMS[key]`) rather than linearly interpolated. This keeps binary flags binary and prevents partial-engagement surprises for per-stage master flags that future presets might set to 0.
**Dependencies:** Task 1
**Mapped Scenarios:** TS-002

**Files:**
- Modify: `src/lib/audio/presets.ts` — inside the `applyIntensity` loop, branch on `key.endsWith("Enabled")` before the numeric interpolation
- Test: `src/lib/audio/__tests__/presets-multiband-intensity.test.ts` (NEW)

**Key Decisions / Notes:**
- Exact snap rule: `if (typeof defVal === "number" && typeof targetVal === "number" && key.endsWith("Enabled")) { result[key] = t > 0 ? targetVal : defVal; }` — only enable fields get this treatment; all other numerics continue linear interpolation.
- Test matrix (for each multiband-engaging genre pop/rock/hiphop/electronic/rnb/podcast):
  - `applyIntensity(genre, 0).multibandEnabled === 0` (exactly off — from default)
  - `applyIntensity(genre, 1).multibandEnabled === 1` (snapped on at the smallest positive t)
  - `applyIntensity(genre, 50).multibandEnabled === 1` (snapped on — no longer 0.5)
  - `applyIntensity(genre, 100).multibandEnabled === 1`
  - Per-band enables (`mbLowEnabled` etc.) follow the same snap rule per the genre table
- For jazz/classical/lofi (MB stays off): `multibandEnabled === 0` at all t.
- For the four new master-enable fields (Task 4 adds them with DEFAULT=1, preset=1): snap is a no-op (1 → 1), so behavior is unchanged but the rule is in place for future presets.
- Non-enable numerics (threshold, ratio, makeup, etc.): continue to interpolate linearly — test a few representative interpolations to lock in the behavior.

**Definition of Done:**
- [ ] All tests pass
- [ ] No diagnostics errors
- [ ] `applyIntensity` snap logic in place for all `*Enabled` keys
- [ ] Existing `presets.test.ts` still passes (non-enable numerics unchanged)
- [ ] New test covers all 9 genres × {0, 1, 50, 100} intensity grid

**Verify:**
- `pnpm test presets-multiband-intensity`
- `pnpm test presets` (regression)

---

### Task 3: Per-band multiband GR readout in transport

**Objective:** Forward the existing `ProcessingChain.onMultibandGR` callback into the audio store; display `MB L/M/H: -X.X / -Y.Y / -Z.Z dB` in the transport stats column below the Correlation row. Throttle display updates to ~30 Hz.
**Dependencies:** None
**Mapped Scenarios:** TS-001, TS-003

**Files:**
- Modify: `src/lib/stores/audio-store.ts` (add `multibandGR: { low: number; mid: number; high: number }` to metering state; default `{ low: 0, mid: 0, high: 0 }`)
- Modify: `src/hooks/useAudioEngine.ts` (subscribe to `chain.onMultibandGR`, call `setMetering` with the new field, throttle to ~30 Hz via `rafThrottle` or `setTimeout` guard)
- Modify: `src/app/master/page.tsx` (add a row between Correlation and the existing bottom of the stats column)
- Test: `src/lib/stores/__tests__/audio-store.test.ts` (NEW or extend existing if present)
- Test: extend `src/components/mastering/__tests__/*.test.tsx` pattern for the new readout (or `e2e/dsp-p4a.spec.ts` in Task 5)

**Key Decisions / Notes:**
- Display format: `MB L/M/H: -2.1 / -0.4 / -1.3 dB`. When any band is exactly 0 dB, show `0.0`. When the multiband is fully bypassed (`multibandEnabled === 0`), show `MB: ---`.
- Color-code each value red when GR ≥ 6 dB (heavy compression), amber 3-6 dB, default otherwise — following the existing Correlation color logic.
- Throttle: store the latest raw GR on every callback but only flush to Zustand state at 30 Hz to avoid re-render storm. Use a `useRef` + `requestAnimationFrame` gate.

**Definition of Done:**
- [ ] All tests pass
- [ ] No diagnostics errors
- [ ] Readout visible in `/master` transport during playback with Hip-hop genre
- [ ] Readout shows `---` when all bands disabled
- [ ] Re-render frequency measured: no more than 30 renders/sec from MB meter updates

**Verify:**
- `pnpm test audio-store`
- Manual: `pnpm dev`, load a file, play with Hip-hop, inspect transport stats

---

### Task 4: Wire 4 new `*Enabled` AudioParams fields to existing bypass methods + real bypass for StereoWidthNode + renderer parity

**Objective:** Add `compressorEnabled`, `saturationEnabled`, `stereoWidthEnabled`, `limiterEnabled` to `AudioParams`. Wire them through `chain.ts` to the **already-existing** `setBypass()` methods on `CompressorNode`, `SaturationNode`, and `LimiterNode` (which delegate to the already-existing worklet `enabled` params). Implement a **real** bypass for `StereoWidthNode` (native graph, no worklet). Mirror in `renderer.ts`. Grep for `AudioParams` serialization to confirm no schema-break risk.
**Dependencies:** None
**Mapped Scenarios:** TS-003, TS-004, TS-006

**Files:**
- Modify: `src/types/mastering.ts` (add 4 fields to `AudioParams` with doc comments)
- Modify: `src/lib/audio/presets.ts` (add to `DEFAULT_PARAMS`: `compressorEnabled: 1`, `saturationEnabled: 1`, `stereoWidthEnabled: 1`, `limiterEnabled: 1` — all genre presets inherit via `...DEFAULT_PARAMS` spread)
- Modify: `src/lib/audio/chain.ts` (4 new switch cases; each calls the corresponding `node.setBypass(n === 0)`)
- Modify: `src/lib/audio/nodes/stereo-width.ts` — replace the no-op `setBypass(bypass: boolean)` with a real implementation: when `bypass=true`, disconnect `_splitter`-fed path and connect `_input` directly to `_output`; when `bypass=false`, restore the original graph. Use `setTargetAtTime(target, ctx.currentTime, 0.005)` on `_output.gain` during rewire to avoid clicks.
- Modify: `src/lib/audio/renderer.ts` — honor all 4 new enables: skip `applyCompressor`, `applySaturation`, `applyStereoWidth`, `processLimiter` respectively when the enable is 0
- Test: `src/lib/audio/nodes/__tests__/stereo-width.test.ts` (extend — assert graph rewires on `setBypass(true)` and `setBypass(false)`; settled-state output bit-equal to input when bypassed, skipping first 10 ms to ignore click-avoidance ramp)
- Test: `src/lib/audio/nodes/__tests__/compressor.test.ts`, `saturation.test.ts`, `limiter.test.ts` (extend — confirm `setBypass(true)` → output bit-equal to input within existing worklet tolerance)
- Test: `src/lib/audio/__tests__/renderer-bypass-parity.test.ts` (NEW — 14-combo deterministic test via `test.each`: all-on; all-off; each-single-off × 6; each-single-on × 6; assert `max(|real - offline|) < 1e-6`)
- Test: `src/lib/audio/__tests__/presets-defaults.test.ts` (NEW or extend — assert every genre preserves `compressorEnabled === 1 && saturationEnabled === 1 && stereoWidthEnabled === 1 && limiterEnabled === 1` after `applyIntensity(g, t)` for t ∈ {0, 50, 100})

**Key Decisions / Notes:**
- **Do NOT reinvent worklet bypass** — compressor/saturation/limiter/parametric-eq worklets already read an `enabled` port message (confirmed via `nodes/eq.ts:107-109` pattern and worklet source). The chain.ts switch cases just call `setBypass(n === 0)` on the existing method.
- **StereoWidthNode is the sole exception** — its `setBypass()` is a dead no-op today. Real implementation rewires the native graph: on bypass, `_input.disconnect()` from the splitter path and `_input.connect(_output)`; on restore, reverse. Ramp `_output.gain` down 5 ms before the disconnect and up 5 ms after the reconnect to avoid audible clicks. This is a **non-bit-exact** transition at the toggle moment — the parity test uses a settled-state comparison (skip first 10 ms of the post-toggle buffer).
- **Persistence grep (mandatory first step of Task 4):** `grep -rn "JSON.stringify.*AudioParams\|localStorage.*params\|audio-store.*persist" src/` — if any serialization path exists, add defaulting logic (missing `*Enabled` treated as 1) before the four fields land. If no serialization exists (expected), note that in a comment on the `AudioParams` interface to inform future developers.
- **Performance:** No new audio-thread work — existing worklets already have the `enabled` early-return path.
- **Global vs per-stage invariant:** `engine.setBypass(true/false)` only rewires the chain boundary via `AudioBypass` — it does not touch any node-level `setBypass()`. Per-stage pill state persists across global A/B toggles. Do not regress this; TS-004 locks it in.

**Definition of Done:**
- [ ] All tests pass (unit + parity)
- [ ] No diagnostics errors
- [ ] `compressorEnabled=0` → compressor-stage output bit-equal to input
- [ ] `saturationEnabled=0` → saturation-stage output bit-equal to input
- [ ] `limiterEnabled=0` → limiter-stage output bit-equal to input
- [ ] `stereoWidthEnabled=0` → stereo-width output bit-equal to input within click-avoidance window (parity test skips first 10 ms)
- [ ] 14-combo parity test passes
- [ ] Persistence grep documented in a plan-note or code comment (no serialization → safe)

**Verify:**
- `pnpm test compressor saturation limiter stereo-width`
- `pnpm test renderer-bypass-parity`
- `pnpm test presets-defaults`

---

### Task 5: Restructure AdvancedMastering Sections + reusable `BypassPill` + attach to 6 stage Sections

**Objective:** Split the existing *Dynamics* Section into **Compressor** + **Dynamics Toggles**, and split *Output* into **Limiter** + **Output Target**, so that every DSP stage has its own Section. Extract a reusable `BypassPill` component from the existing EQ bypass button. Attach one pill to each of the 6 stage Section headers (EQ, Compressor, Multiband, Saturation, Stereo, Limiter), each wired to the corresponding `*Enabled` field from Task 4.
**Dependencies:** Task 4
**Mapped Scenarios:** TS-003, TS-004

**Files:**
- Modify: `src/components/mastering/AdvancedMastering.tsx`
  - Split *Dynamics* into two Sections:
    - **Compressor** — holds Threshold, Ratio, Attack, Release, Makeup, Sidechain HPF sliders (currently ~lines 440-497)
    - **Dynamics Toggles** — holds De-Harsh, Glue Comp, Auto-Release toggles (currently ~lines 435-440)
  - Split *Output* into two Sections:
    - **Limiter** — holds Ceiling, Release sliders (limiter-specific)
    - **Output Target** — holds Target LUFS, Platform pills (currently the top of the Output Section)
  - Create a shared `BypassPill` sub-component from the existing inline button at lines 584-603 — accept `active: boolean` + `onToggle: () => void` + optional `label` override
  - Attach `<BypassPill>` in each of the 6 stage Section headers (EQ, Compressor, Multiband, Saturation, Stereo, Limiter)
  - The existing EQ Section bypass button migrates into the header — delete the inline version (exactly one bypass control per section)
  - The existing Multiband "Multiband" ToggleButton (lines 502-511) becomes the Multiband bypass pill — no duplicate control
- Test: `src/components/mastering/__tests__/AdvancedMastering.test.tsx` (NEW or extend — assert: 6 stage Sections each render a `BypassPill` with the correct `data-testid`; toggling each calls `onParamChange` with the corresponding enable field)
- Test: `e2e/dsp-p4a.spec.ts` (NEW — Playwright scenarios TS-003, TS-004)

**Key Decisions / Notes:**
- Post-restructure Section list: **Input, Compressor, Dynamics Toggles, Multiband, Tone, Parametric EQ, Saturation, Stereo, Limiter, Output Target** (10 Sections, 6 of which have bypass pills — the non-stage ones Input / Dynamics Toggles / Tone / Output Target do not get pills).
- `BypassPill` `data-testid` format: `bypass-pill-{eq|compressor|multiband|saturation|stereo-width|limiter}` — stable E2E handles.
- Pill visual: reuse the existing EQ bypass button's amber-active style (yellow-ish when bypassed). `aria-pressed` reflects bypass state; `aria-label` says "Bypass {stage}" or "{Stage} active — click to bypass".
- Transport global `ABToggle` continues to bypass the full chain independently — this UI change is purely about per-stage controls.
- Pill placement: right-aligned in the `<Section>` header row, same vertical rhythm as the existing chevron. `<Section>` may need a new optional prop `rightSlot?: ReactNode` to accept the pill without polluting the title text.

**Definition of Done:**
- [ ] All tests pass (unit + component + E2E)
- [ ] No diagnostics errors
- [ ] 10 Sections visible in Advanced panel (4 new or renamed)
- [ ] Each of 6 stage Sections has a visible, functional `BypassPill` in its header
- [ ] Clicking a pill updates the corresponding `*Enabled` field in the store
- [ ] Global A/B toggle still bypasses full chain regardless of per-stage state (TS-004 passes)
- [ ] No duplicate bypass controls exist anywhere in the Advanced panel

**Verify:**
- `pnpm test AdvancedMastering`
- `pnpm exec playwright test e2e/dsp-p4a.spec.ts`

---

### Task 6: Goniometer component — main-thread `AnalyserNode` driven (no worklet changes)

**Objective:** Build a canvas-based `Goniometer` component that reads L/R time-domain data from a pair of main-thread `AnalyserNode`s tapped off the end of the processing chain. Mount it in the right sidebar of `/master` under `LevelMeter`. **Do not** extend `metering-processor.js` — that worklet is the BS.1770-4 correctness-critical hot path.
**Dependencies:** None
**Mapped Scenarios:** TS-005

**Files:**
- Create: `src/components/visualization/Goniometer.tsx`
- Create: `src/components/visualization/__tests__/Goniometer.test.tsx`
- Modify: `src/lib/audio/chain.ts` — create two `AnalyserNode`s (one per channel), tap them off the end of the chain via a `ChannelSplitter` between metering and `_outputGain`, expose them as `get leftAnalyser(): AnalyserNode` and `get rightAnalyser(): AnalyserNode`
- Modify: `src/hooks/useVisualization.ts` — expose `leftAnalyser` / `rightAnalyser` from the engine (or pass through existing pattern)
- Modify: `src/app/master/page.tsx` — mount `<Goniometer>` in right sidebar after `<LevelMeter>`, pass the two analyser refs

**Key Decisions / Notes:**
- **Data source:** main-thread `AnalyserNode` with `fftSize: 2048`, pulled via `getFloatTimeDomainData(buffer)` on every `requestAnimationFrame`. Same pattern as `SpectrumDisplay`. No worklet changes, no `postMessage` overhead, no BS.1770-4 risk.
- **No explicit ring buffer / decimation math needed** — `getFloatTimeDomainData` already returns the most recent 2048 samples (~46 ms at 44.1 kHz, ~42 ms at 48 kHz). This is the Lissajous trail length.
- **Canvas size:** fixed `192×192` in the sidebar. Rotate axes 45° so mono is vertical (+y) and side-only is horizontal (+x) — standard goniometer convention.
- **Render rate:** `requestAnimationFrame` on a visibility-gated loop (`document.visibilityState === "visible"`). Respect `window.matchMedia("(prefers-reduced-motion: reduce)")` — when true, render at 5 Hz via `setTimeout`; when false, every rAF.
- **Silent audio:** draw a single point at origin with low opacity (rms(L,R) < 1e-5 threshold).
- **Memory:** component reuses two Float32Array(2048) buffers across renders — no per-frame allocation.
- **Tap point:** after the Limiter/Metering stages so the goniometer reflects the mastered output (not the dry signal). Global A/B bypass routes around the chain, so during global bypass the analyser sees the dry input — document this.

**Definition of Done:**
- [ ] All tests pass
- [ ] No diagnostics errors
- [ ] Goniometer visible on `/master` at xl+ viewport
- [ ] Silent input renders as a single low-opacity origin point
- [ ] Stereo content renders as an animated cloud
- [ ] Mono content (stereoWidth=0) collapses toward a vertical 45° line
- [ ] Respects `prefers-reduced-motion` (reduced cadence; no freeze)
- [ ] `metering-processor.js` is **unchanged** (verify via diff)

**Verify:**
- `pnpm test Goniometer`
- Manual: `pnpm dev`, play stereo audio, confirm Lissajous; set stereo width 0 → vertical line; toggle `prefers-reduced-motion` in devtools

---

### Task 7: Revisit P5+ Roadmap with implementation learnings

**Objective:** Update the `## P5+ Roadmap` section (written in Task 0) with anything learned during Tasks 1-6 that changes a verdict, prerequisite, or phase assignment. Close out the triage record.
**Dependencies:** Tasks 1-6 complete
**Mapped Scenarios:** —

**Files:**
- Modify: `docs/plans/2026-04-23-dsp-p4-triage.md` — revisit the `## P5+ Roadmap` section written by Task 0

**Key Decisions / Notes:**
- Common triggers for an update:
  - Task 4 or 5 revealed a dependency that moves item 2 (per-band M/S) from P5b → P5a, or vice versa
  - The new `BypassPill` component or restructured Section layout unexpectedly unblocks item 5 (crossover-scheme pills)
  - Serialization grep (Task 4) surfaces a persistence layer, which implies item 11 (LRA target match) needs schema-versioning groundwork first
- If no updates warranted, add an "Implementation learnings: no roadmap changes" note dated 2026-xx-xx and close.

**Definition of Done:**
- [ ] `## P5+ Roadmap` has a dated "Implementation learnings" note (even if no changes)
- [ ] All 6 deferred items still documented with current verdicts
- [ ] Plan file renders correctly

**Verify:**
- `grep -c '^Verdict:' docs/plans/2026-04-23-dsp-p4-triage.md` → 6
- Visual read of the roadmap section

## Deferred Ideas (summary — full record written by Task 0, revisited by Task 7)

- Item 1: Per-band parametric EQ inside multiband — P5b
- Item 2: Per-band M/S param sets — P5b
- Item 4: 4-band / 5-band variants — P5c
- Item 5: Preset crossover schemes — P5a (can ship standalone)
- Item 10: FIR linear-phase crossover as export-only — P5a
- Item 11: LRA target matching / auto-makeup — P5a

---

## P5+ Roadmap

*Written 2026-04-23 (Task 0). Revisit at end-of-phase (Task 7).*

The six items below were surfaced alongside the Phase 4a MVP but deliberately deferred. Each row records the promotion verdict, tentative phase, rationale, and prerequisites that must land first.

---

### Item 1 — Per-band parametric EQ inside the multiband stage

Verdict: Accepted-for-P5b
Tentative phase: P5b
Rationale: The existing multiband stage only applies compression to each split band. Adding a per-band parametric EQ (so the Low band can get a 120 Hz bell boost without affecting Mid/High) is a substantial DSP extension — `multiband.ts` + `multiband-compressor-processor.js` must host a small `ParametricEqDSP`-like filter bank per band, and the offline renderer must mirror it. High-value feature but warrants a standalone plan with its own parity tests.
Prerequisites: None technical. Phase 4a `BypassPill` restructure (Task 5) unblocks the UI convention for per-band EQ bypass.

---

### Item 2 — Per-band independent Mid and Side parameter sets

Verdict: Accepted-for-P5b
Tentative phase: P5b (gated on Item 1)
Rationale: Today each MB band has one shared `threshold/ratio/attack/release/makeup` set with an `msBalance` ∈ [-1, +1] biasing the threshold ±6 dB. Replacing this with fully independent M and S parameter sets costs ~24 new `AudioParams` fields (8 fields × 3 bands), a worklet refactor to maintain two envelope followers per band, and schema migration for any persisted presets. The payoff is real for vocal-heavy content (squash Side only) but the schema churn is large enough that it shares a plan with Item 1.
Prerequisites: Item 1 (so the multiband stage is already being extended for per-band EQ in the same phase — amortize the worklet refactor cost).

---

### Item 4 — 4-band / 5-band multiband variants

Verdict: Accepted-for-P5c
Tentative phase: P5c
Rationale: `ThreeWaySplitter` (`src/lib/audio/dsp/crossover.ts`) is hard-coded to three LR4 bands. A variable-N splitter + UI dynamic band-row rendering + genre presets with per-N-band variants is a wide surface area. Most users are well-served by three bands; move to four/five only if users consistently request finer control (e.g., for full-range mastering of classical or film).
Prerequisites: Items 1 and 2 (don't add band-count variation on top of a per-band EQ / per-band M/S refactor — land them first, then generalize).

---

### Item 5 — Preset crossover schemes (Standard / Bass-focused / Vocal-focused)

Verdict: Accepted-for-P5a
Tentative phase: P5a (can ship standalone)
Rationale: Low cost — three preset crossover-frequency pairs + three pills in the Multiband Section header. Standard = 200/2000 (current), Bass-focused = 120/2000 (more bass separation), Vocal-focused = 200/3000 (isolates presence band). Falls out of the existing `mbCrossLowMid` / `mbCrossMidHigh` params, no DSP changes. Good standalone ship before Item 1.
Prerequisites: None. Phase 4a `BypassPill` in the Multiband Section header confirms the header-pill pattern.

---

### Item 10 — FIR linear-phase crossover (export-only)

Verdict: Accepted-for-P5a-as-export-only
Tentative phase: P5a
Rationale: Real-time FIR linear-phase crossover is rejected — latency disqualifies it (several hundred samples of pre-ring + delay). But for **export** it's ideal: no preview constraint, produces a phase-coherent multiband pass. Implementation lives entirely in `src/lib/audio/renderer.ts` behind an opt-in `linearPhaseMultiband: boolean` flag on the export settings. The real-time chain stays IIR LR4 and `multiband-parity.test.ts` is untouched.
Prerequisites: None. Orthogonal to Items 1/2/4.

---

### Item 11 — LRA target matching / automatic makeup gain

Verdict: Accepted-for-P5a
Tentative phase: P5a
Rationale: `computeLRA()` already exists (`src/lib/audio/dsp/lufs.ts`). Gap: a `targetLra` field on `AudioParams` + an analysis-driven suggestion in `auto-master.ts` (if source LRA exceeds target by > 2 LU, propose a multiband compression preset with specific makeup) + a target-LRA slider in the Output Target Section. Automatic makeup gain = solve for the makeup dB that brings post-chain integrated LUFS to `targetLufs` after compression; this is a one-pass offline measurement on the rendered buffer. Moderate cost, high user value, no worklet changes.
Prerequisites: None. Phase 4a `Output Target` Section split (Task 5) is the natural home for the target-LRA slider.

---

### Cross-cutting notes

- **P5a** is intended as a small, independent follow-up plan bundling Items 5, 10, 11 — all three touch `renderer.ts` / presets / `Output Target` with no worklet changes.
- **P5b** is the large DSP plan covering Items 1 + 2 — per-band EQ + per-band M/S inside the multiband stage.
- **P5c** is the longest-horizon plan covering Item 4 — N-band variants, gated on P5b landing first.
- **Not in roadmap:** All other items from the original 11 either shipped in Phase 4a (Items 3, 6, 7, 8, 9) or were explicitly the subject of this plan (no Item 12).

---

### Implementation learnings (Task 7, 2026-04-23)

Six implementation observations from Tasks 1-6 that refine the roadmap above:

1. **BypassPill + Section rightSlot now exists** (Task 5). Item 5 (preset crossover schemes) can now drop its 3 pills straight into the existing Multiband Section header via the `rightSlot` prop or alongside the crossover sliders. **No roadmap change — confirms P5a is cheap.**
2. **`applyProcessingPipeline` helper was extracted from `renderer.ts`** (Task 4). Item 10 (FIR linear-phase crossover export-only) now has a clean integration point: add a new `applyMultibandFir()` function and gate it behind `params.linearPhaseMultiband` inside the same helper. **No roadmap change — P5a integration clarified.**
3. **`applyIntensity` `*Enabled` snap** (Task 2) means future presets for Items 1/2 can safely set `mbLowParamEqEnabled=0` in genre presets without accidental partial engagement at mid intensities. **Confirms P5b schema expansion is safe.**
4. **Per-stage master-enable pattern proven** (Task 4) — 4 new `*Enabled` fields, `DEFAULT=1`, genre presets inherit, chain.ts switch case, renderer gate. Future phases extending `AudioParams` (Item 2's ~24 fields for per-band M/S) should follow this exact pattern. **Confirms P5b plan shape.**
5. **No persistence layer exists today** (Task 4 grep). If P5a (Item 11: LRA targeting) ever stores user-tuned targets across sessions, it will be the first serialization path — and will need a schema-version field from the start. **Adds implicit prerequisite to Item 11.**
6. **metering-processor.js is off-limits** (Task 6 reviewer insight). Any future visual added to the right rail should follow the Goniometer pattern (tap off a main-thread AnalyserNode post-chain), not extend the BS.1770-4 worklet. Applies to any future spectrum-of-a-sidechain or loudness-history visual. **Adds architectural rule for any future visual work.**

No verdicts or phase assignments change. Triage record closed.
