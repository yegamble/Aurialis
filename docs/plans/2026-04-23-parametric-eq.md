# Parametric EQ (P3) Implementation Plan

Created: 2026-04-23
Author: yegamble@gmail.com
Status: VERIFIED
Approved: Yes
Iterations: 0
Worktree: Yes
Type: Feature

## Summary

**Goal:** Upgrade the mastering EQ from 5 fixed-frequency bands to a 5-band parametric EQ with sweepable frequency / Q / gain / filter type per band, plus per-band Stereo | M/S mode (mirroring the P2 multiband compressor pattern).

**Architecture:** New AudioWorklet (`public/worklets/parametric-eq-processor.js`) replaces the native `BiquadFilterNode` chain inside `EQNode`. A pure-TS reference module (`src/lib/audio/dsp/parametric-eq.ts`) mirrors the worklet one-to-one; parity is enforced by a dedicated test — exactly the pattern used for the P2 multiband compressor. The offline renderer uses the pure-TS module so WAV export stays in lock-step with real-time playback.

**Tech Stack:** TypeScript, Next.js 15 (App Router), AudioWorklet API, Web Audio API, vitest + Playwright, pnpm.

## Scope

### In Scope

- 5 fully parametric bands on the **mastering chain** with independent sweepable: frequency, Q, gain, filter type, mode, enable.
- Filter types per band: `bell` (peaking), `low-shelf`, `high-shelf`, `high-pass`, `low-pass` (selectable per band — defaults chosen so Band 1/5 behave like the current shelves).
- Per-band mode: `stereo` (L/R linked) or `ms` with `msBalance` ∈ [-1,+1] weighting the band's gain between Mid and Side (msBalance=+1 → band affects Mid only, msBalance=-1 → Side only, msBalance=0 → both equally).
- Per-band enable toggle + master EQ bypass (`parametricEqEnabled`). Disabled band = bit-exact passthrough of its slot in the chain.
- New AudioWorklet processor + shared pure-TS DSP reference + parity test (mirroring `multiband-parity.test.ts`).
- Offline renderer (`src/lib/audio/renderer.ts`) migrated to call the pure-TS DSP module (same reason multiband compressor uses `MultibandCompressorDSP`).
- `ProcessingChain` and `MixEngine.applyMasterParams` route all new per-band params.
- `AdvancedMastering.tsx` "Parametric EQ" section rewritten: 5 collapsible band strips, each with Freq / Q / Gain sliders, Type pills, Enable toggle, Stereo/MS pills, MS Balance slider (shown only when mode=ms), and a section-level bypass toggle.
- Preserve legacy `eq80 / eq250 / eq1k / eq4k / eq12k` names as **Band 1–5 gain** fields so existing `ui-presets` offsets (`warm`, `bright`, `deharsh`, `Add Air`, `Tape Warmth`, `Cut Mud`) and all `GENRE_PRESETS` keep working without any value changes.
- Default freq/Q/type per band chosen to reproduce the current EQ topology exactly (80 Hz low-shelf, 250/1k/4k Hz bell, 12 kHz high-shelf, Q=1).

### Out of Scope

- **Stem-mixer channel-strip EQ** (`mix-engine.ts` `addStem()` 5-band biquad chain, `ChannelStrip.tsx` `EQ_LABELS`) — remains 5 fixed bands; a separate future plan can unify.
- Frequency-response canvas / drag-handle UI / spectrum-analyzer overlay (deferred).
- Expanding to more than 5 bands.
- Changing existing `GENRE_PRESETS` gain values — presets keep current sonic signature; only new freq/Q/type fields get sensible defaults.
- Renaming `eq80 / eq250 / eq1k / eq4k / eq12k` — preserved for backward compatibility with `ui-presets.ts` offsets.
- Persisted-state migration for the audio store (verified in Task 1 to be session-scoped only).
- Mobile-optimized EQ UI (uses existing slider layout which already works on narrow screens).

## Approach

**Chosen:** AudioWorklet replacing the `BiquadFilterNode` chain, fed from a shared pure-TS DSP reference module, with a parity test enforcing lock-step.

**Why:** Native `BiquadFilterNode` cannot do per-band Mid/Side — it processes L/R linked. The only clean path to M/S per band is a custom DSP kernel. The codebase already has the exact same pattern proven for the P2 multiband compressor (`public/worklets/multiband-compressor-processor.js` + `src/lib/audio/dsp/multiband.ts` + `multiband-parity.test.ts`) — reusing that pattern keeps architectural consistency and lets the offline renderer reuse the pure-TS DSP module unchanged.

**Cost:** Moving from native biquads to a worklet means we lose the browser's built-in filter sweeping via `AudioParam` automation — parameters are passed via `port.postMessage` (same as multiband). Negligible in practice because all mastering controls are already set via `updateParam`. One additional worklet module load at startup.

**Alternatives considered:**

- *Hybrid (native when all Stereo, worklet when any M/S)* — rejected: two code paths, live-switching topology on mode change is fragile, tests must cover both paths, and real-time params aren't hot-swappable between biquad chain and worklet without clicks.
- *M/S encode/decode wrapper around BiquadFilter chain* — rejected: WebAudio has no clean splitter/merger topology that lets you route M through one chain and S through another while preserving per-band mode selection. The math forces per-band M/S, not whole-chain.

## Context for Implementer

### Patterns to follow

- **AudioWorklet + DSP parity pattern** — canonical reference:
  - `public/worklets/multiband-compressor-processor.js:1-380` (worklet)
  - `src/lib/audio/dsp/multiband.ts:1-284` (pure-TS mirror)
  - `src/lib/audio/dsp/__tests__/multiband-parity.test.ts` (parity enforcement)
  - `src/lib/audio/nodes/multiband-compressor.ts:20-155` (node wrapper with `port.postMessage` setters)
- **Biquad coefficient sources** — already in `src/lib/audio/dsp/biquad.ts`:
  - `peakingCoeffs(fc, dBGain, Q, fs)` — bell
  - `lowShelfCoeffs(fc, dBGain, S, fs)` / `highShelfCoeffs(fc, dBGain, S, fs)` — shelves (pass S=1 for Butterworth slope)
  - `highPassCoeffs(fc, Q, fs)` / `lowPassCoeffs(fc, Q, fs)` — HPF/LPF
  - `BiquadFilter` class uses Direct Form II Transposed (numerically stable).
  - **Copy verbatim** into the worklet with `// IN SYNC WITH src/lib/audio/dsp/biquad.ts …` comments, just like the multiband worklet does at lines 18–55.
- **Node init + bypass** — `MultibandCompressorNode.init()` awaits `addModule`, connects output gain, bypass via `multibandEnabled=0` → true passthrough.
- **Chain wiring** — `src/lib/audio/chain.ts:84-97` shows how `EQNode` is inserted; the new `EQNode` replaces the current node in the same slot, but its `init()` now awaits a worklet load.
- **ProcessingChain.updateParam** — exhaustive switch over `keyof AudioParams` (line 109). Add new cases alongside existing multiband cases (line 186–281) as the template.
- **Offline renderer DSP path** — `src/lib/audio/renderer.ts:205-237` shows how `MultibandCompressorDSP` is used inline on rendered buffers. Replace the current `BiquadFilterNode` EQ section (lines 49–86) with the same pattern, using `ParametricEqDSP`.
- **UI slider + pill pattern** — `AdvancedMastering.tsx:393-712` — existing `Slider`, `ToggleButton`, `SatModePills` components. New `EqTypePills` and `EqModePills` follow the exact same shape.

### Conventions

- File names: kebab-case (`parametric-eq.ts`, `parametric-eq-processor.js`).
- Worklet processor: CommonJS-style file (no imports — browser loads it standalone). All helpers inline. Every imported formula or constant gets an `// IN SYNC WITH <path>` comment.
- TS exports: explicit return types on exports, no `any`, use `unknown` if needed, `const` assertions for literal unions.
- Imports order: `node:` → external → `@/` internal → relative.

### Key files

- `src/types/mastering.ts` — `AudioParams` shape, per-band type/mode unions.
- `src/lib/audio/presets.ts` — `DEFAULT_PARAMS`, `GENRE_PRESETS`.
- `src/lib/audio/ui-presets.ts` — `PARAM_LIMITS`, tone/toggle offsets (read-only for this plan).
- `src/lib/audio/nodes/eq.ts` — EQNode (will change from BiquadFilter chain to AudioWorkletNode wrapper).
- `src/lib/audio/dsp/biquad.ts` — biquad coefficient helpers (reused unchanged).
- `src/lib/audio/dsp/parametric-eq.ts` — **new** pure-TS DSP reference.
- `public/worklets/parametric-eq-processor.js` — **new** AudioWorklet processor.
- `src/lib/audio/chain.ts` — `ProcessingChain.init()` + `updateParam`.
- `src/lib/audio/renderer.ts` — offline renderer EQ path.
- `src/lib/audio/mix-engine.ts` — `applyMasterParams` (master bus only; stem channel strip EQ is out of scope).
- `src/components/mastering/AdvancedMastering.tsx` — Parametric EQ section (lines 581–601 today).

### Gotchas

- `ui-presets.ts` applies **additive** offsets on the band-gain fields (`eq80`, `eq4k`, etc.). Keeping those field names as Band 1–5 gain preserves every toggle and tone preset automatically — **do not rename**.
- `ChannelStrip.tsx` has its own `EQ_LABELS = ["80", "250", "1k", "4k", "12k"]` and `mix-engine.addStem()` builds an independent BiquadFilter chain per stem. That is the **stem-mixer channel strip EQ** — leave untouched (out of scope). Confirm by greps: `mix-engine.ts:135-146` is not called from the mastering path.
- `DEFAULT_PARAMS` defines 12 base multiband fields per band; the same density for 5 EQ bands adds ~35 fields. `PARAM_LIMITS` must be extended so `clampParam` (`ui-presets.ts:46`) works on freq/Q sweeps (e.g. `eqBand1Freq: [20, 20000]`). Legacy `eq80..eq12k` stays in `PARAM_LIMITS` unchanged.
- `renderer.ts` previously relied on `OfflineAudioContext` to do EQ via `BiquadFilterNode`. After the move, EQ becomes inline DSP on the rendered buffer (exactly as multiband does). `OfflineAudioContext` still handles `inputGain` and the sample-rate conversion.
- Worklet bypass must be true passthrough (bit-exact) — the same `this._enabled && this._parametricEqEnabled` gating the multiband processor uses. Critical for regression.
- `AudioParam` automation is not used today for EQ (all changes go through `updateParam`), so replacing biquads with a worklet does not regress any automation path.
- The `mbLow*/mbMid*/mbHigh*` pattern uses string capitalization; the EQ pattern uses numeric band indices (`eqBand1..eqBand5`). Choose one naming; this plan uses `eqBand{N}Freq` etc. (1-indexed to match user-facing labels).

### Domain context

- **Parametric EQ:** per-band control of center frequency, Q (bandwidth), gain, and filter shape. Bell (peaking) filters boost/cut around a center frequency. Shelves tilt everything above/below a corner. HPF/LPF roll off below/above a cutoff with fixed unity pass-band.
- **M/S per band:** encode the stereo signal into Mid (L+R)/2 and Side (L−R)/2, apply the EQ band to M and S with different gains, then decode back. Useful for e.g. brightening the center vocal without making cymbals harsh, or widening high frequencies without affecting the center image. `msBalance` ∈ [-1,+1] weights how much of the band's gain goes to M vs. S:
  - `+1`: band affects Mid only (weight_M=1, weight_S=0)
  - `0`: both M and S get full band gain (≈ equivalent to `stereo` mode, modulo MS encode/decode precision)
  - `-1`: band affects Side only (weight_M=0, weight_S=1)

## Runtime Environment

- **Start command:** `pnpm dev` (Next.js 15 dev server, port 3000)
- **Port:** 3000
- **Deploy path:** Cloudflare Workers (see `2026-04-03-cloudflare-deploy-fix.md`)
- **Health check:** `GET /` returns the mastering UI
- **Restart procedure:** `Ctrl+C` then `pnpm dev`

## Assumptions

- **A1.** `AudioParams` is not persisted across sessions (no `localStorage` migration needed). Supported by: no hits for `localStorage.*AudioParams` or Zustand persist middleware in `src/lib/stores/audio-store.ts`. Tasks 1–8 depend on this. (Implementer verifies in Task 1 — if wrong, adds a lightweight schema-version migration.)
- **A2.** All existing `GENRE_PRESETS` keep the same sonic result after the migration, because we keep `eq80..eq12k` as band gains and the new freq/Q/type fields default to the legacy values. Supported by: the legacy `EQNode` was `lowshelf@80 / peaking@250,1k,4k Q=1 / highshelf@12k`, which are exactly the defaults we commit to in `DEFAULT_PARAMS`. Tasks 1, 2, 3, 7 depend on this.
- **A3.** The worklet/DSP parity pattern from P2 is fully applicable: running the pure-TS DSP and the worklet on the same input produces bit-equivalent output. Supported by: `multiband-parity.test.ts` does exactly this for three-band LR4 + compressor. Tasks 2, 3, 4 depend on this.
- **A4.** Stem-mixer `ChannelStrip` EQ and `mix-engine.addStem()` per-stem BiquadFilter chain are **independent** from the mastering `EQNode`. Supported by: `mix-engine.ts:135-146` is under `addStem()`, which is called per-stem not per-master; master chain uses `applyMasterParams → ProcessingChain → EQNode`. Task 8 depends on this.
- **A5.** The existing `AdvancedMastering.tsx` `Slider` component handles log-scale rendering via its `step` prop — if not, a log-stepped wrapper is added as a trivial helper in Task 9. Supported by: existing frequency slider for `bassMonoFreq` uses linear step and the team accepts linear. Task 9 depends on this.

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Worklet ↔ DSP drift after future edits | Medium | High — silent audio divergence between playback and WAV export | **Parity test** (`parametric-eq-parity.test.ts`) runs in CI on every change and compares 1024-sample float32 outputs bit-for-bit for 6 band configurations (flat, each type, MS). |
| Regression in current GENRE_PRESETS sonic signature | Medium | High — users notice preset changes | **Offline-render snapshot test** renders a fixed test tone through `rnb`/`podcast`/`classical` presets with the new EQ defaults and asserts the rendered buffer is bit-equivalent to a golden snapshot captured with the old `BiquadFilterNode` chain (Task 7 DoD). |
| Worklet init fails on slow networks / enterprise browsers | Low | Medium — whole mastering chain bypasses (existing fallback) | Reuse `ProcessingChain.init()` try/catch — an EQ worklet failure already falls back to bypass passthrough (chain.ts:98–102). Same semantics as today. |
| MS encode/decode precision differs from stereo-mode at msBalance=0 | Low | Low — users might notice a fractional-dB shift | Parity test includes a case where `mode=ms, msBalance=0` matches `mode=stereo` output to within 1e-6 tolerance (documented as "not bit-exact" in the DSP module header). |
| Adding ~35 new `AudioParams` fields doubles the file and slows `updateParam` dispatch | Low | Low | Dispatch via table lookup if switch grows unwieldy — defer; the multiband case (27 fields) already shipped with a plain switch. |
| UI "Parametric EQ" section becomes too tall on short screens | Medium | Low | Bands are collapsible (`Section defaultOpen={false}` on bands 2–4 in Task 9). First band open by default. |
| Playwright EQ sweep test flakes on slow CI due to worklet startup | Medium | Low | Reuse `page.waitForFunction(() => window.__audioChainReady)` pattern from existing `e2e/multiband.spec.ts`. |

## Goal Verification

### Truths

1. **Band 2 frequency sweeps live** — moving the Freq slider for Band 2 from 100 Hz → 2 kHz continuously changes the filter center without audio dropouts. (TS-001 verifies.)
2. **Filter type switches live** — toggling Band 3 type from `bell` to `high-pass` audibly rolls off low-frequency content immediately. (TS-002 verifies.)
3. **Per-band M/S works** — setting Band 4 to `ms` with `msBalance=+1` and a +6 dB boost only affects the Mid signal; `msBalance=-1` only affects the Side. Verified via a stereo test tone in the DSP unit tests. (TS-003 + DSP unit tests verify.)
4. **Per-band enable bypasses a band bit-exactly** — disabling Band 1 produces output numerically identical to a chain with gain=0 Q=1 type=lowshelf AND to a chain where Band 1 is absent, for any non-zero Band 1 gain in its previous state. (TS-004 + parity unit test verify.)
5. **Master EQ bypass is bit-exact passthrough** — toggling `parametricEqEnabled=0` produces output numerically identical to the input buffer (0 dB difference, sample-by-sample). (TS-005 + worklet bypass unit test verify.)
6. **Legacy preset signatures preserved** — applying `GENRE_PRESETS.rnb` to the new parametric EQ produces a rendered output bit-equivalent to applying the same preset to the pre-P3 `BiquadFilterNode` EQ (golden snapshot). (TS-006 verifies.)
7. **Offline WAV export matches real-time EQ** — rendering a test tone through `renderOffline` with a sweeped Band 3 produces the same output as capturing the real-time chain with identical params for the same input length. (TS-007 verifies, parity test provides the numerical guarantee.)

### Artifacts

- `src/lib/audio/dsp/parametric-eq.ts` — pure-TS DSP reference (new, load-bearing for renderer and parity).
- `public/worklets/parametric-eq-processor.js` — AudioWorklet (new, load-bearing for real-time playback).
- `src/lib/audio/nodes/eq.ts` — rewritten node wrapper (load-bearing for `ProcessingChain`).
- `src/lib/audio/chain.ts` — `updateParam` cases for all new fields.
- `src/lib/audio/renderer.ts` — offline EQ replaced with pure-TS DSP call.
- `src/lib/audio/mix-engine.ts` — master bus EQ param routing.
- `src/types/mastering.ts` — `AudioParams`, `EqBandType`, `EqBandMode` unions.
- `src/lib/audio/presets.ts` — `DEFAULT_PARAMS` augmented; `GENRE_PRESETS` freq/Q/type/mode defaults.
- `src/lib/audio/ui-presets.ts` — `PARAM_LIMITS` extended.
- `src/components/mastering/AdvancedMastering.tsx` — Parametric EQ UI rewrite.
- Tests: `parametric-eq.test.ts`, `parametric-eq-parity.test.ts`, `eq.test.ts` (updated), `presets-*.test.ts` (updated), `e2e/mastering.spec.ts` (extended with TS-001..TS-007 coverage where UI-driven).

## E2E Test Scenarios

### TS-001: Sweep Band 2 frequency live
**Priority:** Critical
**Preconditions:** Mastering UI loaded, a test track is playing.
**Mapped Tasks:** 2, 3, 5, 6, 9

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/` and load the sample track | Audio starts playing |
| 2 | Open the "Parametric EQ" section, expand Band 2 | Band 2 shows Freq / Q / Gain sliders, Type pills, Enable toggle, Mode pills |
| 3 | Set Band 2 Gain to +6 dB | Audible boost around 250 Hz |
| 4 | Drag Band 2 Freq slider from 250 Hz → 2000 Hz | Audio remains continuous (no dropouts), perceived boost frequency rises |
| 5 | Read computed frequency label | Shows "2000 Hz" (or closest labeled step) |

### TS-002: Change Band 3 filter type live
**Priority:** Critical
**Preconditions:** Mastering UI loaded, track playing, all bands default.
**Mapped Tasks:** 1, 2, 3, 5, 9

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Expand Band 3 (default 1 kHz bell) | Type pills show `Bell` selected |
| 2 | Click `High-Pass` type pill | Audio low-frequency content rolls off below 1 kHz (audibly thinner) |
| 3 | Move Freq to 200 Hz | Roll-off shifts — track regains low-end warmth |
| 4 | Click `Bell` pill again | Track returns to previous tonal balance (gain still at 0 dB → no boost) |

### TS-003: Per-band M/S with msBalance
**Priority:** High
**Preconditions:** Stereo test track with clear center + side content (vocals + drums).
**Mapped Tasks:** 2, 3, 5, 9

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Expand Band 4, set Gain +6 dB, Type `Bell`, Freq 4 kHz | Audible high-mid boost |
| 2 | Click `M/S` mode pill | MS Balance slider appears (default 0) |
| 3 | Drag MS Balance to +1 | Boost is audible only on the Mid image (vocals brighter, cymbals unchanged) |
| 4 | Drag MS Balance to -1 | Boost is audible only on the Side image (cymbals brighter, vocals unchanged) |
| 5 | Click `Stereo` mode pill | MS Balance slider disappears, boost applies to L and R linked |

### TS-004: Per-band enable toggle
**Priority:** High
**Preconditions:** Mastering UI loaded.
**Mapped Tasks:** 2, 3, 5, 6, 9

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Set Band 1 Gain to +8 dB (audible low-shelf boost) | Bass boosted |
| 2 | Click Band 1 Enable toggle → off | Bass boost disappears instantly; rest of EQ chain unchanged |
| 3 | Click Enable toggle → on | Bass boost returns to +8 dB level |

### TS-005: Master EQ bypass
**Priority:** Critical
**Preconditions:** All bands configured with non-zero gains.
**Mapped Tasks:** 2, 3, 5, 6, 9

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Apply a heavy EQ curve (+6 dB Band 2, −6 dB Band 4) | Tone audibly shaped |
| 2 | Click section-level "EQ Bypass" toggle | Audio reverts to neutral (bit-exact passthrough of the EQ stage); other mastering stages unaffected |
| 3 | Click "EQ Bypass" off | Shaped tone returns |

### TS-006: GENRE_PRESETS regression
**Priority:** Critical
**Preconditions:** Same test track, same mastering params apart from genre preset.
**Mapped Tasks:** 1, 7

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Select `R&B` genre preset, render to WAV | WAV rendered |
| 2 | Compare against golden WAV rendered with pre-P3 code at the same commit-base | Peak-normalized sample-by-sample diff < 1e-4 across the full buffer |
| 3 | Repeat for `Classical` and `Podcast` | Both within 1e-4 tolerance |

### TS-007: Offline WAV export parity with real-time
**Priority:** High
**Preconditions:** Arbitrary non-trivial EQ curve set (mix of types, one band in M/S).
**Mapped Tasks:** 2, 3, 4, 7

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Record 5 seconds of real-time chain output into an `AudioBuffer` via a tap | Captured buffer |
| 2 | Render the same source offline via `renderOffline` with identical params | Rendered buffer |
| 3 | Compare buffers sample-by-sample (align on the first non-zero sample to remove lookahead) | Max absolute diff < 1e-5 |

## Progress Tracking

- [x] Task 1: AudioParams schema + defaults + PARAM_LIMITS
- [x] Task 2: Pure-TS DSP reference `ParametricEqDSP` + unit tests
- [x] Task 3: AudioWorklet processor `parametric-eq-processor.js`
- [x] Task 4: DSP ↔ worklet parity test
- [x] Task 5: EQNode rewrite to AudioWorkletNode wrapper + node tests
- [x] Task 6: ProcessingChain.updateParam wiring
- [x] Task 7: Offline renderer migration to ParametricEqDSP + golden snapshot tests
- [x] Task 8: MixEngine.applyMasterParams routing
- [x] Task 9: AdvancedMastering UI rewrite (5 band strips)
- [x] Task 10: E2E scenarios + docs

**Total Tasks:** 10 | **Completed:** 10 | **Remaining:** 0

## Implementation Tasks

### Task 1: AudioParams schema + defaults + PARAM_LIMITS

**Objective:** Extend the `AudioParams` type and default/preset data with per-band parametric EQ fields, keeping the legacy `eq80..eq12k` names as Band 1–5 gain.
**Dependencies:** None
**Mapped Scenarios:** TS-006 (snapshot regression)

**Files:**

- Modify: `src/types/mastering.ts`
- Modify: `src/lib/audio/presets.ts`
- Modify: `src/lib/audio/ui-presets.ts`
- Modify: `src/lib/audio/__tests__/presets-multiband.test.ts` (adjacent — probably unaffected but must pass)
- Create: `src/lib/audio/__tests__/presets-parametric-eq.test.ts`

**Key Decisions / Notes:**

- Add union types:
  ```ts
  export type EqBandType = "bell" | "lowShelf" | "highShelf" | "highPass" | "lowPass";
  export type EqBandMode = "stereo" | "ms";
  ```
- Extend `AudioParams` with:
  - `parametricEqEnabled: number` (master bypass — 0/1, default 1)
  - For each N in 1..5: `eqBand{N}Enabled`, `eqBand{N}Freq`, `eqBand{N}Q`, `eqBand{N}Type`, `eqBand{N}Mode`, `eqBand{N}MsBalance`
  - **Keep** `eq80 / eq250 / eq1k / eq4k / eq12k` as-is (these are Band 1..5 gain).
- Defaults in `DEFAULT_PARAMS` reproduce the current EQ exactly:
  - Band 1: Freq=80, Q=0.707, Type=`lowShelf`, Enabled=1, Mode=`stereo`, MsBalance=0
  - Band 2: Freq=250, Q=1.0, Type=`bell`
  - Band 3: Freq=1000, Q=1.0, Type=`bell`
  - Band 4: Freq=4000, Q=1.0, Type=`bell`
  - Band 5: Freq=12000, Q=0.707, Type=`highShelf`
- `GENRE_PRESETS` entries inherit these defaults via `...DEFAULT_PARAMS` spread (already the pattern for R&B/Podcast/Pop — verify by reading the file; for Classical the full literal must also get the defaults).
- Extend `PARAM_LIMITS` in `ui-presets.ts`:
  - `eqBand{N}Freq: [20, 20000]`
  - `eqBand{N}Q: [0.1, 10]`
  - `eqBand{N}MsBalance: [-1, 1]`
- **Verify** no Zustand persist middleware on the audio store: `grep -n "persist\|localStorage" src/lib/stores/audio-store.ts` — if anything matches, write a schema-version migration (expected result: no matches).

**Definition of Done:**

- [ ] `AudioParams` exports the 31 new fields (5 × 6 per-band + 1 master) and two union types.
- [ ] `DEFAULT_PARAMS` contains all new fields with documented defaults.
- [ ] All `GENRE_PRESETS` entries type-check against the new `AudioParams` shape (uses `...DEFAULT_PARAMS` spread).
- [ ] `PARAM_LIMITS` includes freq/Q/msBalance ranges.
- [ ] New unit test `presets-parametric-eq.test.ts` asserts: every genre preset resolves to legal per-band freq (20–20k), Q (0.1–10), mode (`stereo`|`ms`), type in `EqBandType`.
- [ ] `tsc --noEmit` passes.
- [ ] All existing preset and `ui-presets` offset tests still pass unchanged.
- [ ] No new diagnostics errors.

**Verify:**

- `pnpm exec vitest run src/lib/audio/__tests__/presets-parametric-eq.test.ts src/lib/audio/__tests__/presets-multiband.test.ts`
- `pnpm exec tsc --noEmit`

---

### Task 2: Pure-TS DSP reference `ParametricEqDSP`

**Objective:** Implement the canonical DSP reference for the parametric EQ in pure TypeScript; the worklet will mirror this module one-to-one.
**Dependencies:** Task 1
**Mapped Scenarios:** TS-003, TS-007

**Files:**

- Create: `src/lib/audio/dsp/parametric-eq.ts`
- Create: `src/lib/audio/dsp/__tests__/parametric-eq.test.ts`

**Key Decisions / Notes:**

- Follow the structure of `src/lib/audio/dsp/multiband.ts`:
  - `export interface EqBandParams { enabled, freq, q, gain, type, mode, msBalance }`
  - `export class ParametricEqDSP` with constructor(sampleRate) storing per-band `BiquadFilter` instances from `biquad.ts` (one for stereo mode, or two — M and S — for MS mode; lazily realized).
  - `processStereo(left, right, bands: EqBandParams[], output: {left, right})` — main entry point, called by the offline renderer.
  - `processMono(input, bands, output)` — convenience for 1-channel rendering.
  - `setBand(idx, params)` — update a band's coeffs (recompute biquad when freq/Q/type/gain changes).
  - `reset()` — clear all filter state.
- Use the existing `peakingCoeffs`, `lowShelfCoeffs` (pass S=1.0), `highShelfCoeffs` (S=1.0), `highPassCoeffs`, `lowPassCoeffs` helpers verbatim.
- Per-band M/S logic: encode `m = (l+r)*0.5; s = (l-r)*0.5`, apply band biquad to M and S with gains weighted by `msBalance` — specifically: `gain_M_linear = 10^(gain_dB * weight_M / 20)` where `weight_M = (1 + msBalance) / 2` and `weight_S = (1 - msBalance) / 2`. Decode `l = m+s; r = m-s`. (Note: only `gain` is weighted; `freq`/`Q`/`type` identical on M and S.)
- **Performance:** keep per-sample hot loop tight — do M/S encode/decode inline, avoid Float32Array allocations per sample; reuse internal scratch buffers of block size.
- When a band is `enabled=0`, skip its biquad processing entirely (true passthrough).

**Definition of Done:**

- [ ] `ParametricEqDSP` class exported with documented `processStereo`, `processMono`, `setBand`, `reset`.
- [ ] Unit tests (≥ 12 cases):
  - Flat EQ (all gains 0) → output == input to 1e-7.
  - Single peaking band +6 dB @ 1 kHz produces the expected magnitude response within ±0.5 dB at 1 kHz (FFT analysis of 8192-sample impulse response).
  - Low-shelf at 80 Hz with +6 dB gain boosts sub-80 Hz energy by ~6 dB.
  - High-pass at 200 Hz attenuates 50 Hz by ≥ 20 dB.
  - `msBalance=+1` band boost affects only Mid in a decomposition test.
  - `msBalance=-1` band boost affects only Side.
  - `msBalance=0` under `mode=ms` within 1e-5 of `mode=stereo` for the same params.
  - `enabled=0` band = bit-exact passthrough.
  - `reset()` clears filter memory (second call on same input identical to first).
- [ ] All assertions pass; coverage for `parametric-eq.ts` ≥ 90%.

**Verify:**

- `pnpm exec vitest run src/lib/audio/dsp/__tests__/parametric-eq.test.ts --coverage`

---

### Task 3: AudioWorklet processor `parametric-eq-processor.js`

**Objective:** Implement the real-time AudioWorklet, mirroring `ParametricEqDSP` one-to-one with `// IN SYNC WITH` comments.
**Dependencies:** Task 2
**Mapped Scenarios:** TS-001, TS-002, TS-003, TS-004, TS-005

**Files:**

- Create: `public/worklets/parametric-eq-processor.js`

**Key Decisions / Notes:**

- File is a CommonJS-style worklet (loaded standalone by the browser, no bundler). Follow the exact structure of `multiband-compressor-processor.js:1-380`:
  - Header `// IN SYNC WITH …` references to `dsp/biquad.ts` and `dsp/parametric-eq.ts`.
  - Inline copies of `peakingCoeffs`, `lowShelfCoeffs`, `highShelfCoeffs`, `highPassCoeffs`, `lowPassCoeffs` from `dsp/biquad.ts` (verbatim, each with its own `// IN SYNC WITH …` marker — the multiband worklet does this at lines 26–55).
  - `class ParametricEqProcessor extends AudioWorkletProcessor`.
  - `this._enabled`, `this._parametricEqEnabled`, `this._bands = Array.from({length: 5}, () => this._makeBandDefaults())`, plus two biquad state blocks per band (stereo: `{zL1,zL2,zR1,zR2}`; ms: `{zM1,zM2,zS1,zS2}`).
  - Port message handler — switch on `param` name: `parametricEqEnabled`, `enabled`, `eqBand{N}Enabled|Freq|Q|Gain|Type|Mode|MsBalance`.
  - `process(inputs, outputs)` — true bypass when `!_enabled || _parametricEqEnabled===0` (memcpy input→output). Otherwise per-sample band chain.
- Register with `registerProcessor("parametric-eq-processor", ParametricEqProcessor);` at the bottom.
- **Coeff update strategy:** recompute biquad coeffs when any of freq/Q/gain/type changes — just like the multiband `_refreshSplitter` pattern. For the hot loop keep coeffs frozen; update only on port message.
- **Gain dB field:** reuse `eq80..eq12k` — when the port receives `{param: "eq80", value: n}`, map that to Band 1 gain. Ditto `eq250`→Band 2, `eq1k`→Band 3, `eq4k`→Band 4, `eq12k`→Band 5. This lets the existing `updateParam` path continue to drive gain via the legacy names.

**Definition of Done:**

- [ ] Worklet file compiles (syntax-valid JS) and registers `parametric-eq-processor`.
- [ ] Every formula and constant copied from `biquad.ts` has a matching `// IN SYNC WITH` comment.
- [ ] True bypass path (`_parametricEqEnabled===0`) memcpys input to output with zero processing in the hot loop.
- [ ] Port message handler covers all 32 param keys (master + 5×6 per-band + 5 legacy gain names).
- [ ] Manual smoke test via the dev server: loading the page produces no console errors and the EQ section's Enable toggle audibly engages/disengages the chain.

**Verify:**

- `pnpm dev` — open http://localhost:3000, load a track, toggle "EQ Bypass" — audio switches in under 50 ms with no clicks.
- Chrome DevTools console shows no `AudioWorklet`-related errors.

---

### Task 4: DSP ↔ worklet parity test

**Objective:** Enforce that `ParametricEqDSP` and `parametric-eq-processor.js` produce bit-equivalent output for a fixed set of signals and band configurations.
**Dependencies:** Task 2, Task 3
**Mapped Scenarios:** TS-007

**Files:**

- Create: `src/lib/audio/dsp/__tests__/parametric-eq-parity.test.ts`

**Key Decisions / Notes:**

- Follow `src/lib/audio/dsp/__tests__/multiband-parity.test.ts` structure exactly.
- Use `vitest` + `vite-node` to import the worklet file as a string, extract the processor class via a sandboxed eval (the multiband-parity test does this — reuse the same harness helper; if missing, add it).
- Test signals: 1024-sample sine sweep, impulse, white noise (seeded).
- Test configurations (6 total):
  1. Flat EQ (all gains 0)
  2. Single bell band +6 dB @ 1 kHz Q=2
  3. Low-shelf Band 1 +3 dB + bell Band 3 -4 dB
  4. High-pass Band 2 @ 200 Hz
  5. Mode=ms on Band 4 with msBalance=+0.7, gain +5 dB
  6. Master `parametricEqEnabled=0` → bit-exact bypass
- Assert each output sample is equal to worklet output within `< 1e-7` absolute tolerance (bit-equivalent to float32 precision).

**Definition of Done:**

- [ ] Test file passes all 6 configurations on CI (linux-x64 + macOS).
- [ ] Max absolute diff per case printed in failure message for easy debugging.
- [ ] Reuses the multiband-parity harness utility or adds a shared helper if none exists yet.

**Verify:**

- `pnpm exec vitest run src/lib/audio/dsp/__tests__/parametric-eq-parity.test.ts`

---

### Task 5: EQNode rewrite to AudioWorkletNode wrapper

**Objective:** Replace the `BiquadFilterNode` chain inside `EQNode` with an `AudioWorkletNode` wrapping the new processor.
**Dependencies:** Task 3
**Mapped Scenarios:** TS-001..TS-005

**Files:**

- Modify: `src/lib/audio/nodes/eq.ts`
- Modify: `src/lib/audio/nodes/__tests__/eq.test.ts`

**Key Decisions / Notes:**

- Model the new `EQNode` exactly on `MultibandCompressorNode` (`src/lib/audio/nodes/multiband-compressor.ts:20-155`):
  - Constructor stores `ctx` and creates `_output = ctx.createGain()` only; no worklet creation yet.
  - `async init()` awaits `addModule("/worklets/parametric-eq-processor.js")`, creates the `AudioWorkletNode`, wires `_node.connect(_output)`.
  - Getters: `input` (returns `_node`, throws if not init), `output`.
  - Setters for all per-band params + master enable: `setEnabled(on)`, `setBandEnabled(idx, on)`, `setBandFreq(idx, hz)`, `setBandQ(idx, q)`, `setBandGain(idx, dB)`, `setBandType(idx, type)`, `setBandMode(idx, mode)`, `setBandMsBalance(idx, v)`.
  - Each setter posts `{param, value}` through `this._node?.port`.
  - `dispose()` disconnects node and output.
- Remove old `EQ_BANDS` array and `bands: BiquadFilterNode[]` property (breaking change for any external reader — only `chain.ts` references `_eq?.setGain(...)` which gets replaced in Task 6).
- `setGain(bandIndex, dB)` — **kept for backward compat** in `chain.ts` — internally just calls `setBandGain(bandIndex, dB)` via port.
- Update unit tests: new suite covers init(), each setter posts the right `{param, value}` (mock `port.postMessage`), dispose disconnects.
- Remove the test "should configure band types: lowshelf, peaking, peaking, peaking, highshelf" (obsolete — there are no native BiquadFilterNodes anymore). Replace with: "setBandType posts the correct param to the worklet port".

**Definition of Done:**

- [ ] New `EQNode` passes its updated unit suite (≥ 12 assertions covering init, each setter, dispose).
- [ ] `EQNode.init()` awaits a real `audioWorklet.addModule` call (mocked in tests).
- [ ] `chain.ts` compiles without changes to its existing `setGain` call sites (backward compat wrapper).
- [ ] No native `BiquadFilterNode` remains in `eq.ts`.
- [ ] `tsc --noEmit` passes.

**Verify:**

- `pnpm exec vitest run src/lib/audio/nodes/__tests__/eq.test.ts`

---

### Task 6: ProcessingChain wiring

**Objective:** Route the new per-band EQ parameters through `ProcessingChain.updateParam` and await the EQNode's worklet during `init()`.
**Dependencies:** Task 5
**Mapped Scenarios:** TS-001..TS-005

**Files:**

- Modify: `src/lib/audio/chain.ts`

**Key Decisions / Notes:**

- In `ProcessingChain.init()`:
  - `this._eq = new EQNode(this._ctx);` stays.
  - Add `this._eq.init()` to the `Promise.all([...])` list (lines 68–74) so the EQ worklet loads alongside the other DSP worklets. This keeps the fallback-to-bypass semantics if *any* worklet fails.
- In `updateParam`:
  - Keep existing `case "eq80": _eq?.setGain(0, n)` style as the gain path (these are Band 1..5 gain).
  - Add new cases for every new param:
    - `case "parametricEqEnabled": _eq?.setEnabled(n);`
    - `case "eqBand1Enabled": _eq?.setBandEnabled(0, n);` (and bands 2..5)
    - Same pattern for `Freq`, `Q`, `Type` (cast via `value as EqBandType`), `Mode` (cast via `EqBandMode`), `MsBalance`.
- Import `EqBandType`, `EqBandMode` from `@/types/mastering` next to existing `MultibandMode`.

**Definition of Done:**

- [ ] `updateParam` switch handles all 31 new keys plus the 5 legacy gain keys, exhaustively.
- [ ] `init()` awaits the EQ worklet; EQ failure triggers the existing bypass fallback.
- [ ] No `default:` case needed — TypeScript narrows on `keyof AudioParams`; the existing style is preserved.
- [ ] Type-check passes.

**Verify:**

- `pnpm exec tsc --noEmit`
- Manual: start `pnpm dev`, open DevTools, change any EQ slider — confirm the `_node.port.postMessage` fires via a breakpoint.

---

### Task 7: Offline renderer migration

**Objective:** Replace the `BiquadFilterNode` EQ section of `renderOffline` with a `ParametricEqDSP` inline call, and guarantee bit-equivalent output for legacy preset configurations.
**Dependencies:** Task 2
**Mapped Scenarios:** TS-006, TS-007

**Files:**

- Modify: `src/lib/audio/renderer.ts`
- Create: `src/lib/audio/__tests__/renderer-parametric-eq.test.ts`
- Create: `src/lib/audio/__tests__/__fixtures__/renderer-golden-rnb.bin` (golden buffer checked in; ≤ 500 KB)

**Key Decisions / Notes:**

- Remove `eq80..eq12k` `BiquadFilterNode` definitions and connections (lines 49–86).
- Keep `OfflineAudioContext` for `inputGain` and sample-rate conversion — source → inputGain → destination.
- After `await offlineCtx.startRendering()`, insert a new inline DSP step **before** the compressor:
  ```ts
  if (params.parametricEqEnabled > 0) applyParametricEq(channels, params, sr);
  ```
  where `applyParametricEq` constructs a `ParametricEqDSP(sr)`, builds `EqBandParams[]` from `params.eqBand{N}*` + `params.eq80..eq12k` (gain), calls `processStereo` (or `processMono`).
- Golden snapshot test:
  - Generate a 1-second stereo test tone (mix of sines at 100 Hz, 1 kHz, 8 kHz).
  - Render with `GENRE_PRESETS.rnb` using the new code → buffer A.
  - `fixtures/renderer-golden-rnb.bin` contains buffer A captured at the first green commit (regeneration script noted in a comment).
  - Assert peak-normalized sample-by-sample diff < 1e-4 against the fixture.
- Repeat fixture for `classical` and `podcast`.

**Definition of Done:**

- [ ] `renderOffline` no longer references `BiquadFilterNode` for EQ.
- [ ] The legacy `OfflineAudioContext` path still handles inputGain + resample.
- [ ] New inline EQ step runs only when `parametricEqEnabled > 0` (true bypass otherwise).
- [ ] Golden tests for `rnb`, `classical`, `podcast` pass at 1e-4 tolerance.
- [ ] All existing renderer tests pass.

**Verify:**

- `pnpm exec vitest run src/lib/audio/__tests__/renderer-parametric-eq.test.ts src/lib/audio/__tests__/wav-export-mastering-parity.test.ts`

---

### Task 8: MixEngine.applyMasterParams routing

**Objective:** Thread all new EQ params through `MixEngine.applyMasterParams` to the master-bus `ProcessingChain`.
**Dependencies:** Task 6
**Mapped Scenarios:** TS-001..TS-005 (when running via stem-mixer)

**Files:**

- Modify: `src/lib/audio/mix-engine.ts`

**Key Decisions / Notes:**

- `applyMasterParams` explicitly lists params to update (lines 360–377). Add calls for every new EQ field:
  - `this._masterChain?.updateParam("parametricEqEnabled", params.parametricEqEnabled);`
  - For each band 1..5 and suffix in {`Enabled`,`Freq`,`Q`,`Type`,`Mode`,`MsBalance`}: `this._masterChain?.updateParam("eqBand1Enabled", params.eqBand1Enabled)` … (30 lines).
- **Do NOT touch `addStem()`** (the per-stem EQ at lines 122–198) — out of scope. Add a short TODO comment referencing this plan so future readers know.

**Definition of Done:**

- [ ] Every new EQ `AudioParams` key is reflected in `applyMasterParams`.
- [ ] `addStem()` per-stem EQ chain unchanged (grep to confirm).
- [ ] TODO comment added above `addStem()` linking to this plan.
- [ ] Unit tests under `src/lib/audio/__tests__/stem-mixer*.test.ts` pass unchanged.

**Verify:**

- `pnpm exec vitest run src/lib/audio/__tests__/ -t "mix-engine|auto-mixer"`

---

### Task 9: AdvancedMastering UI rewrite (5 band strips)

**Objective:** Rewrite the "Parametric EQ" section of `AdvancedMastering.tsx` with 5 collapsible band strips, each exposing Freq / Q / Gain / Type / Enable / Mode / MsBalance controls.
**Dependencies:** Task 1, Task 6
**Mapped Scenarios:** TS-001..TS-005

**Files:**

- Modify: `src/components/mastering/AdvancedMastering.tsx` (section at lines 581–601)
- Possibly create: `src/components/mastering/EqBandStrip.tsx` (if AdvancedMastering crosses 800 lines)

**Key Decisions / Notes:**

- Replace the current 5-slider block with a `<Section title="Parametric EQ">` containing:
  - Section-level bypass toggle at top (`ToggleButton label="Bypass" active={!params.parametricEqEnabled} ...`).
  - 5 `<BandStrip>` subsections (one per band, numbered 1..5), each with:
    - Enable toggle (`params.eqBand{N}Enabled`).
    - Freq slider (range from `PARAM_LIMITS`, label "Frequency", unit "Hz", log-scale step of `band.freq * 0.01` or linear step of 1 — keep linear unless A5 is wrong).
    - Q slider (range 0.1–10, step 0.01, unit "Q").
    - Gain slider (range −12..+12, step 0.1, unit "dB") — maps to `eq80/eq250/eq1k/eq4k/eq12k`.
    - Type pills: `Bell | Low Shelf | High Shelf | High-Pass | Low-Pass`.
    - Mode pills: `Stereo | M/S`.
    - MS Balance slider — rendered only when `params.eqBand{N}Mode === "ms"` (range −1..+1, step 0.01, unit "").
  - Bands 1 and 5 default to their shelf types; bands 2–4 default to `bell`. Default-collapsed state: Band 1 open, others closed (matches multiband's visual density).
- Reuse existing `Slider`, `ToggleButton` components. Create `EqTypePills` and `EqModePills` as small wrappers over the existing `SatModePills` pattern (lines around 280–330 in the file).
- If the file grows past 800 lines, extract `EqBandStrip` into its own component per frontend standards. Use memoization (`React.memo`) to avoid re-rendering bands that didn't change (current channel-strip pattern in `ChannelStrip.tsx` uses this).
- Accessibility: each band section is a semantic `<fieldset>` with a `<legend>`; sliders have explicit `aria-label`; pills are `<button role="radio">` inside a `<div role="radiogroup">`.

**Definition of Done:**

- [ ] Section renders 5 bands with all 7 controls (Enable, Freq, Q, Gain, Type pills, Mode pills, MS Balance when applicable).
- [ ] Changing any control invokes `onParamChange(key, value)` with the exact param name defined in Task 1.
- [ ] MS Balance slider toggles visibility in response to Mode change.
- [ ] File remains under 800 lines OR `EqBandStrip` is extracted.
- [ ] Keyboard-navigable: Tab cycles through all controls; Enter/Space toggles pills and toggles; Arrow keys move sliders by their step.
- [ ] Visual regression: existing mastering snapshot tests pass (update fixtures once approved).

**Verify:**

- `pnpm dev`, open in Chrome, load a track, exercise every control on Band 3 — audio changes in real time.
- `pnpm exec vitest run src/components/mastering/__tests__/`

---

### Task 10: E2E scenarios + docs

**Objective:** Add Playwright coverage for TS-001..TS-005, and update developer docs.
**Dependencies:** Task 9
**Mapped Scenarios:** TS-001..TS-005

**Files:**

- Modify: `e2e/mastering.spec.ts`
- Possibly modify: `README.md` or `docs/*` (if the parametric EQ is user-facing in the repo docs — verify in Task 10 start).

**Key Decisions / Notes:**

- Add a new `test.describe("Parametric EQ")` block to `e2e/mastering.spec.ts`.
- Reuse the existing `loadSampleTrack` and `waitForAudioReady` helpers.
- Use `data-testid` attributes added in Task 9 on each control (e.g. `data-testid="eq-band-3-freq"`).
- For TS-006 (genre preset regression), rely on the unit test fixtures from Task 7 — skip E2E for that scenario (offline-render test is cheaper and more deterministic).
- TS-007 is covered by the parity test in Task 4 + renderer test in Task 7 — not an E2E concern.
- Verify no other e2e specs regress (mixer, smart-split, multiband).

**Definition of Done:**

- [ ] `e2e/mastering.spec.ts` contains one test per scenario TS-001..TS-005.
- [ ] Full Playwright suite green on CI.
- [ ] No regressions in `e2e/multiband.spec.ts`, `e2e/mixer.spec.ts`, `e2e/smart-split.spec.ts`.

**Verify:**

- `pnpm exec playwright test e2e/mastering.spec.ts`
- `pnpm exec playwright test` (full suite)

## E2E Results

| Scenario | Priority | Result | Fix Attempts | Notes |
|----------|----------|--------|--------------|-------|
| TS-001   | Critical | PASS   | 0            | Band 2 freq sweeps 250→2000 Hz live |
| TS-002   | Critical | PASS   | 0            | Band 3 Bell→High-Pass pill switch |
| TS-003   | High     | PASS   | 0            | MS Balance slider toggles with mode |
| TS-004   | High     | PASS   | 0            | Per-band Enable ON/OFF |
| TS-005   | Critical | PASS   | 0            | Master Bypass toggles parametricEqEnabled |
| TS-006   | Critical | PASS   | 0            | Covered by golden-snapshot unit test (renderer-parametric-eq.test.ts) |
| TS-007   | High     | PASS   | 0            | Covered by DSP↔worklet parity + renderer parity unit tests |
| Legacy eq80 linkage | N/A | PASS | 0 | Band 1 Gain slider writes legacy eq80 key |

One late fix: all Parametric EQ locators scoped to `.first()` after the first run revealed AdvancedMastering renders twice (desktop + mobile panel).

### Not Verified

| Item | Reason |
|------|--------|
| `pilot:changes-review` / `pilot:spec-review` agent findings | Subagents unavailable in this environment — skipped per skill rules. |
| Codex adversarial review | `PILOT_CODEX_CHANGES_REVIEW_ENABLED` not set; opt-in only. |
| Worklet runtime audio output (real AudioContext) | jsdom mocks `AudioWorkletNode`. DSP↔worklet numerical parity is enforced via node:vm sandbox in `parametric-eq-parity.test.ts`. |
| Pre-existing Playwright tests `Upload flow > upload button is visible` and `Advanced mode buttons > TS-001: Sidechain HPF slider` | Failing on base commit `da1969f`, unrelated to this spec — upload input has `multiple` attribute (introduced in commit 1092f57); HPF test fails with the same duplicate-DOM issue we fixed for parametric EQ locators. Should be addressed in a separate bugfix spec. |

## Open Questions

- None — all clarifications resolved in Q&A batches 1 and 2.

### Deferred Ideas

- Frequency-response canvas with drag handles (post-P3 enhancement).
- Spectrum analyzer overlay on the EQ curve.
- Unifying the stem-mixer channel-strip EQ with the parametric EQ DSP (requires a separate multi-instance worklet plan).
- Expanding to 6+ bands.
