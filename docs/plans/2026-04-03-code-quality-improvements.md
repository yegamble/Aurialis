# Code Quality & Type Safety Improvements Plan

Created: 2026-04-03
Status: COMPLETE
Approved: Yes
Iterations: 0
Worktree: No
Type: Feature

## Summary

**Goal:** Fix broken linting, eliminate duplicated defaults, implement TPDF dither, fix fake stereo metering, tighten mastering types, centralize genre/toggle option metadata, clean up noisy export tests, and write a real README.

**Architecture:** These are 8 independent cleanup/improvement tasks touching the linting toolchain, audio-store/presets source of truth, WAV encoder, engine metering, component type contracts, UI option metadata, test mocking, and project docs. No new features — all improvements to existing code quality.

**Tech Stack:** ESLint 9 + eslint-config-next, TypeScript strict types, Vitest, Next.js 15

## Scope

### In Scope

- Replace broken `next lint` with ESLint 9 flat config + Next.js plugin
- Consolidate duplicate `defaultParams`/`DEFAULT_PARAMS` into single source of truth
- Implement TPDF dither in WAV encoder + wire to ExportPanel
- Remove `Math.random()` jitter from `getPeakLevels()` (honest mono)
- Create shared domain types for genre/toggle/param keys
- Centralize genre + toggle option metadata so UI derives from typed config
- Fix jsdom navigation noise in export tests
- Replace placeholder README with real project docs

### Out of Scope

- True stereo metering via split analysers (future work)
- Noise-shaped dither (only TPDF)
- ESLint auto-fix pass on existing codebase (just set up the tool)
- Any new audio processing features

## Approach

**Chosen:** Bottom-up type safety — create domain types first, then propagate to consumers

**Why:** Defining `GenreName`, `ToggleName`, `AudioParamKey` etc. in a shared location first means subsequent tasks (centralize options, tighten component props) can reference them immediately rather than doing string cleanup twice.

**Alternatives considered:**
- Top-down (fix components first, then types) — rejected because component changes would still use strings that need a second pass
- Single monolithic task — rejected because 8 independent concerns are easier to review/test separately

## Context for Implementer

> Write for an implementer who has never seen the codebase.

- **Patterns to follow:**
  - Presets file (`src/lib/audio/presets.ts`) is the canonical home for audio param types and defaults
  - UI presets file (`src/lib/audio/ui-presets.ts`) uses `satisfies` for type-safe records
  - Components import types from store/presets, not inline definitions
  - Tests use `vi.spyOn` for mocking, `mockBuffer()` helper for AudioBuffer stubs

- **Conventions:**
  - Package manager: **pnpm** — use `pnpm add -D` for devDependencies
  - Test runner: `pnpm test -- --reporter=dot`
  - Build: `pnpm run build`
  - File naming: kebab-case for files, PascalCase for components/types

- **Key files:**
  - `src/lib/audio/presets.ts` — genre presets, `DEFAULT_PARAMS`, `GenreName`, `PlatformName`
  - `src/lib/stores/audio-store.ts` — Zustand store with `AudioParams` interface, duplicate `defaultParams`
  - `src/lib/audio/ui-presets.ts` — toggle offsets, tone presets, output presets
  - `src/lib/audio/engine.ts` — `AudioEngine` class with `getPeakLevels()` at line 265
  - `src/lib/audio/wav-encoder.ts` — `encodeWav()` function
  - `src/components/export/ExportPanel.tsx` — export UI with dither dropdown
  - `src/components/mastering/SimpleMastering.tsx` — simple mode genre/toggle UI
  - `src/components/mastering/AdvancedMastering.tsx` — advanced mode sliders
  - `src/app/master/page.tsx` — main mastering page wiring everything together

- **Gotchas:**
  - `audio-store.ts` exports the `AudioParams` interface — any consumer importing it will keep working
  - `presets.ts` already exports `GenreName` and `PlatformName` as union types
  - `ui-presets.ts` already exports `TonePresetName` and `OutputPresetName`
  - The export test noise is from jsdom trying to navigate when `anchor.click()` fires — need to mock the anchor's click behavior
  - `next lint` in CI (`.github/workflows/ci.yml:21`) needs updating when the lint script changes

- **Domain context:**
  - Simple mode: user picks a genre + intensity slider + quick toggles → params are computed via `applyIntensity()` + `applySimpleToggles()`
  - Advanced mode: user directly adjusts individual params via sliders
  - Both modes write to the same Zustand `params` state
  - `getPeakLevels()` is a fallback analyser-based meter; real metering comes from the AudioWorklet via `chain.onMetering`

## Runtime Environment

- Start: `pnpm dev` (port 3000)
- Build: `pnpm run build`
- Deploy: `pnpm run deploy` (Cloudflare Workers via OpenNext)

## Assumptions

- ESLint 9 flat config is supported by `eslint-config-next` — supported by Next.js 15.x deprecation notice pointing to ESLint CLI migration. Tasks 1 depend on this.
- TPDF dither is well-specified (add ±1 LSB triangular noise before quantization) — standard audio engineering. Task 4 depends on this.
- The `genres` array in `SimpleMastering.tsx` is the only place that omits "rnb" — no other UI entry point exposes genre selection differently. Task 6 depends on this.
- `getPeakLevels()` is only called from `useVisualization.ts` — confirmed via grep. Task 5 depends on this.

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| ESLint config has lint errors on existing code | High | Low | Run with `--max-warnings=0` initially disabled; fix lint errors as a sub-step |
| FlatCompat silently drops Next.js rules | Low | Medium | After setup, verify with `pnpm exec eslint --print-config src/app/page.tsx` that Next.js rules appear |
| TPDF dither implementation introduces audible artifacts | Low | Medium | Unit test with known input/output; dither only applied when bit depth < 32 |
| Removing `defaultParams` from store breaks import | Low | Low | `DEFAULT_PARAMS` is already exported from presets.ts; store just imports it |

## Goal Verification

### Truths

1. `pnpm run lint` exits 0 with actual linting output (no interactive prompt)
2. CI `pnpm run lint` step passes without modification
3. Only one `DEFAULT_PARAMS` object exists; `audio-store.ts` imports it from `presets.ts`
4. `ExportPanel` dither dropdown value is passed through to `encodeWav` and affects output bytes
5. `getPeakLevels()` returns identical `left` and `right` values (no `Math.random()`)
6. `SimpleMastering.tsx` and `AdvancedMastering.tsx` props use typed keys, not `string`/`Record<string, ...>`
7. All genres from `GenreName` are represented in the UI genre selector
8. Export tests produce no jsdom navigation warnings
9. `README.md` describes Aurialis/Waveish, audio architecture, testing, and deployment
10. **Full test suite passes with zero failures** — `pnpm test -- --reporter=dot` (all 264+ unit tests) AND `pnpm exec playwright test --workers=2` (all 20 E2E tests)
11. **No regressions:** `pnpm run build` succeeds, `pnpm exec tsc --noEmit` passes

### Artifacts

- `eslint.config.mjs` — new ESLint flat config
- `src/lib/audio/presets.ts` — canonical `DEFAULT_PARAMS` + `GenreName` + new `ToggleName` type
- `src/lib/audio/wav-encoder.ts` — TPDF dither implementation
- `src/lib/audio/engine.ts` — fixed `getPeakLevels()`
- `src/types/mastering.ts` — shared domain types for mastering controls
- `README.md` — real project documentation

## Progress Tracking

- [x] Task 1: Set up ESLint with Next.js plugin
- [x] Task 3: Create shared domain types (must precede Task 2)
- [x] Task 2: Consolidate default params (depends on Task 3)
- [x] Task 4: Implement TPDF dither
- [x] Task 5: Fix stereo metering jitter
- [x] Task 6: Centralize genre/toggle option metadata (depends on Task 3)
- [x] Task 7: Clean up export test noise
- [x] Task 8: Write real README (depends on Task 1)

**Total Tasks:** 8 | **Completed:** 8 | **Remaining:** 0

**Execution order:** 1 → 3 → 2 → 4, 5, 7 (parallel) → 6 → 8

## Implementation Tasks

### Task 1: Set up ESLint with Next.js plugin

**Objective:** Replace broken `next lint` with ESLint 9 flat config so `pnpm run lint` performs real static analysis.
**Dependencies:** None
**Mapped Scenarios:** None (toolchain)

**Files:**

- Create: `eslint.config.mjs`
- Modify: `package.json` (lint script: `eslint .` instead of `next lint`)
- Modify: `.github/workflows/ci.yml` (no change needed — `pnpm run lint` already called)

**Key Decisions / Notes:**

- Use ESLint 9 flat config format (`eslint.config.mjs`)
- Install: `pnpm add -D eslint eslint-config-next @eslint/eslintrc`
- `eslint-config-next` still uses legacy format, so use the compat utility from `@eslint/eslintrc` to wrap it in flat config
- Exclude `node_modules`, `.next`, `public/worklets/` (plain JS worklet files)
- Change `package.json:10` lint script from `"next lint"` to `"eslint ."`
- Fix any lint errors that arise on existing code

**Definition of Done:**

- [x] `pnpm run lint` exits 0 with real lint output
- [x] No interactive prompt
- [x] React hooks rules are enforced
- [x] CI step works unchanged

**Verify:**

- `pnpm run lint`

---

### Task 2: Consolidate default params to single source of truth

**Objective:** Remove the duplicated `defaultParams` in `audio-store.ts` and import `DEFAULT_PARAMS` from `presets.ts` instead.
**Dependencies:** Task 3 (AudioParams must be moved to `src/types/mastering.ts` first to avoid circular imports)
**Mapped Scenarios:** None

**Note on circular imports:** `presets.ts` imports `AudioParams` from `audio-store.ts` (as `import type`). Adding a value import of `DEFAULT_PARAMS` from `presets.ts` into `audio-store.ts` would create a runtime cycle. Task 3 breaks this by moving `AudioParams` to `src/types/mastering.ts`, so both `presets.ts` and `audio-store.ts` import from the types file instead of from each other.

**Files:**

- Modify: `src/lib/stores/audio-store.ts` (remove `defaultParams` object, import `DEFAULT_PARAMS` from presets, import `AudioParams` from `@/types/mastering`)
- Modify: `src/lib/audio/presets.ts` (import `AudioParams` from `@/types/mastering` instead of `audio-store`)

**Key Decisions / Notes:**

- `audio-store.ts:57-79` defines `defaultParams` with identical values to `presets.ts:11-31` `DEFAULT_PARAMS`
- Replace all references to `defaultParams` in `audio-store.ts` (lines 98, 122) with `DEFAULT_PARAMS`
- Remove the comment on line 57-58 about drift since the problem is eliminated
- `AudioParams` interface moves to `src/types/mastering.ts` (done in Task 3) — `audio-store.ts` re-exports it for backward compatibility

**Definition of Done:**

- [x] Only one default params object exists in codebase
- [x] `audio-store.ts` imports `DEFAULT_PARAMS` from `presets.ts`
- [x] No circular imports — both `audio-store.ts` and `presets.ts` import `AudioParams` from `@/types/mastering`
- [x] All existing tests pass
- [x] No type errors (`pnpm exec tsc --noEmit`)

**Verify:**

- `pnpm test -- --reporter=dot`
- `pnpm exec tsc --noEmit`

---

### Task 3: Create shared domain types for mastering controls

**Objective:** Move `AudioParams` to a shared types file (breaking the presets↔store import dependency), define typed keys for genre, toggle, and param names so components use them instead of raw `string` and `Record<string, ...>`.
**Dependencies:** None (Task 2 depends on this)

**Files:**

- Create: `src/types/mastering.ts` (canonical home for `AudioParams`, `ToggleName`)
- Modify: `src/lib/stores/audio-store.ts` (import `AudioParams` from `@/types/mastering`, re-export for backward compat)
- Modify: `src/lib/audio/presets.ts` (import `AudioParams` from `@/types/mastering` instead of `audio-store`)
- Modify: `src/lib/audio/ui-presets.ts` (type `SIMPLE_TOGGLE_OFFSETS` key as `ToggleName`)
- Modify: `src/components/mastering/SimpleMastering.tsx` (replace `string` props with typed keys)
- Modify: `src/components/mastering/AdvancedMastering.tsx` (replace `Record<string, number>` with `AudioParams`)
- Modify: `src/app/master/page.tsx` (update handler signatures to use typed keys)

**Key Decisions / Notes:**

- **Move `AudioParams` interface** from `audio-store.ts` to `src/types/mastering.ts`. Both `audio-store.ts` and `presets.ts` then import from `@/types/mastering` — no circular dependency. `audio-store.ts` re-exports `AudioParams` so existing consumers don't break.
- `GenreName` already exists in `presets.ts` — reuse it
- Create `ToggleName` = `"cleanup" | "warm" | "bright" | "wide" | "loud" | "deharsh" | "glueComp"` (all 7 toggle keys used in `master/page.tsx` INITIAL_TOGGLES). Of these, 5 are "quick toggles" shown in SimpleMastering's toggle grid, and 2 (`deharsh`, `glueComp`) are "dynamics toggles" shown in AdvancedMastering.
- `src/types/mastering.ts` also re-exports `GenreName`, `TonePresetName`, `OutputPresetName` from their source modules for convenient single import
- `SimpleMastering` props: `genre: string` → `genre: GenreName`, `onGenreChange: (genre: GenreName) => void`, `toggles: Record<string, boolean>` → `Record<ToggleName, boolean>`, `onToggle: (key: ToggleName) => void`
- `AdvancedMastering` props: `params: Record<string, number>` → `params: AudioParams`, `onParamChange: (key: string, val: number)` → `(key: keyof AudioParams, val: number)`, `onDynamicsToggle: (key: "deharsh" | "glueComp") → void` (already typed, no change needed)
- `master/page.tsx`: `handleGenreChange(newGenre: string)` → `(newGenre: GenreName)`, remove `as GenreName` cast. `handleToggle(key: string)` → `(key: ToggleName)`, `handleAdvancedParamChange(key: string, ...)` → `(key: keyof AudioParams, ...)`

**Definition of Done:**

- [x] `AudioParams` lives in `src/types/mastering.ts` and is re-exported from `audio-store.ts`
- [x] No circular imports between `audio-store.ts` and `presets.ts`
- [x] No `as GenreName` or `as keyof typeof params` casts in `master/page.tsx`
- [x] `SimpleMastering` and `AdvancedMastering` props are fully typed
- [x] `pnpm exec tsc --noEmit` passes with no errors
- [x] All tests pass

**Verify:**

- `pnpm exec tsc --noEmit`
- `pnpm test -- --reporter=dot`

---

### Task 4: Implement TPDF dither in WAV encoder

**Objective:** Add triangular probability density function (TPDF) dither to the WAV encoder for 16-bit and 24-bit exports, and wire the ExportPanel dither setting through to the encoder.
**Dependencies:** None

**Files:**

- Modify: `src/lib/audio/wav-encoder.ts` (add dither logic)
- Modify: `src/lib/audio/export.ts` (pass dither option through)
- Modify: `src/components/export/ExportPanel.tsx` (pass dither value to ExportSettings)
- Modify: `src/app/master/page.tsx` (pass dither through handleExport)
- Modify: `src/lib/audio/__tests__/export.test.ts` (update test calls if interface changes)
- Create: `src/lib/audio/dsp/__tests__/dither.test.ts` (unit tests for dither function)

**Key Decisions / Notes:**

- TPDF dither: generate two uniform random values in [-1, 1], sum them, scale to ±1 LSB, add to sample before quantization
- Only apply dither when encoding to integer formats (16-bit, 24-bit). 32-bit float needs no dither.
- Dither type `"none" | "tpdf"` — "Noise Shaped" option in UI maps to `"tpdf"` for now (or remove it as a third option since we're not implementing noise-shaped)
- `ExportSettings` interface is defined in `src/components/export/ExportPanel.tsx:7-10` — add `dither?: "none" | "tpdf"` there (default `"tpdf"`)
- `ExportOptions` in `export.ts` gains `dither?: "none" | "tpdf"`
- `encodeWav` signature gains optional `dither` parameter
- The `ExportPanel` dropdown: change options to `["None", "TPDF"]` (remove "Noise Shaped" since it's not implemented)

**Definition of Done:**

- [x] `encodeWav` with `dither: "tpdf"` produces different output than `dither: "none"` for 16-bit
- [x] 32-bit float encoding is unchanged regardless of dither setting
- [x] Dither dropdown value in ExportPanel flows through to wav-encoder
- [x] Unit tests verify dither adds noise within ±1 LSB range
- [x] All existing tests pass

**Verify:**

- `pnpm test -- --reporter=dot src/lib/audio/dsp/__tests__/dither.test.ts`
- `pnpm test -- --reporter=dot`

---

### Task 5: Fix stereo metering — remove random jitter

**Objective:** Make `getPeakLevels()` return honest mono values (identical L/R) instead of adding `Math.random()` noise.
**Dependencies:** None

**Files:**

- Modify: `src/lib/audio/engine.ts` (line 265-282: remove jitter, return `{ left: peak, right: peak }`)
- Modify: `src/lib/audio/__tests__/engine.test.ts` (update test expectation if needed)

**Key Decisions / Notes:**

- `engine.ts:277`: `const jitter = (Math.random() - 0.5) * 0.03;` — delete this line
- Return `{ left: Math.min(1, peak), right: Math.min(1, peak) }`
- The comment "Approximate stereo from mono analyser" should change to note this returns mono until true stereo metering is wired
- Real stereo metering already exists via the metering worklet (`chain.onMetering`) — this fallback just needs to be honest

**Definition of Done:**

- [x] `getPeakLevels()` returns identical `left` and `right` values
- [x] No `Math.random()` in `getPeakLevels()`
- [x] Engine tests pass
- [x] The function is deterministic for the same input

**Verify:**

- `pnpm test -- --reporter=dot src/lib/audio/__tests__/engine.test.ts`

---

### Task 6: Centralize genre/toggle option metadata

**Objective:** Create a single typed config for genre and toggle options so the UI can't diverge from the engine. Expose "rnb" in the genre selector.
**Dependencies:** Task 3 (uses `GenreName`, `ToggleName`)

**Files:**

- Create: `src/lib/audio/option-metadata.ts` (genre labels/icons, toggle labels/icons)
- Modify: `src/components/mastering/SimpleMastering.tsx` (import genre/toggle metadata instead of hardcoding)
- Modify: `src/lib/audio/presets.ts` (no change — `GenreName` already includes "rnb")

**Key Decisions / Notes:**

- `SimpleMastering.tsx:32-41` hardcodes the `genres` array and omits "rnb". Move this to `option-metadata.ts`
- `SimpleMastering.tsx:43-49` hardcodes `quickToggles`. Move this to `option-metadata.ts`
- `option-metadata.ts` exports:
  - `GENRE_OPTIONS: { id: GenreName; label: string; icon: LucideIcon }[]` — includes all 9 genres
  - `QUICK_TOGGLE_OPTIONS: { id: ToggleName; label: string; icon: LucideIcon }[]` — the 5 quick toggles (cleanup, warm, bright, wide, loud)
  - `DYNAMICS_TOGGLE_OPTIONS: { id: ToggleName; label: string }[]` — the 2 dynamics toggles (deharsh, glueComp) used in AdvancedMastering
- Add "rnb" → `{ id: "rnb", label: "R&B", icon: Radio }` (or appropriate icon)
- SimpleMastering imports `GENRE_OPTIONS` and `QUICK_TOGGLE_OPTIONS` instead of defining its own arrays
- Use `satisfies` to ensure type completeness: `GENRE_OPTIONS satisfies { id: GenreName }[]` so adding a new GenreName without a metadata entry is a type error

**Definition of Done:**

- [x] "R&B" genre appears in the SimpleMastering genre grid
- [x] All 9 genres from `GenreName` have entries in `GENRE_OPTIONS`
- [x] All 5 quick toggle names have entries in `QUICK_TOGGLE_OPTIONS`
- [x] All 2 dynamics toggle names have entries in `DYNAMICS_TOGGLE_OPTIONS`
- [x] `SimpleMastering` imports from `option-metadata.ts`, not inline arrays
- [x] Type error if `GenreName` gets a new member without a metadata entry
- [x] All tests pass

**Verify:**

- `pnpm exec tsc --noEmit`
- `pnpm test -- --reporter=dot`

---

### Task 7: Clean up noisy export tests

**Objective:** Suppress the jsdom "navigation not implemented" errors in `export.test.ts` by fully stubbing the anchor click path.
**Dependencies:** None

**Files:**

- Modify: `src/lib/audio/__tests__/export.test.ts` (improve anchor mock to prevent navigation)

**Key Decisions / Notes:**

- The jsdom error comes from `anchor.click()` triggering jsdom's navigation handler for the blob URL
- The existing tests mock `document.createElement` but the mock anchor object still triggers jsdom navigation when `.click()` is called because the mock isn't a real element interception
- Fix: mock `URL.createObjectURL` to return a no-op string, and ensure `anchor.click` is a `vi.fn()` that doesn't delegate to jsdom's click handler
- The tests at lines 48-67 and 69-82 already partially mock this but the mock anchor leaks into jsdom's click dispatcher
- Better approach: spy on `document.createElement` and return an object with a `click: vi.fn()` that doesn't call the real element's click. Also mock `URL.createObjectURL` and `URL.revokeObjectURL`

**Definition of Done:**

- [x] `pnpm test -- --reporter=verbose src/lib/audio/__tests__/export.test.ts` produces no jsdom warnings
- [x] All 4 export tests still pass
- [x] No `Error: Not implemented: navigation` in test output

**Verify:**

- `pnpm test -- --reporter=verbose src/lib/audio/__tests__/export.test.ts 2>&1 | grep -i "not implemented"`

---

### Task 8: Write real README

**Objective:** Replace the placeholder README with documentation covering app purpose, architecture, testing, deployment, and browser limitations.
**Dependencies:** Task 1 (mentions lint setup)

**Files:**

- Modify: `README.md`

**Key Decisions / Notes:**

- Current README is a Figma bundle placeholder
- Cover: what Waveish/Aurialis is, audio processing architecture (DSP chain → AudioWorklets → nodes → chain → engine), testing (unit with Vitest, E2E with Playwright), deployment (Cloudflare Workers via OpenNext), browser requirements (AudioWorklet, COOP/COEP headers for SharedArrayBuffer)
- Keep concise — this is a project README, not full docs
- Mention: `pnpm dev`, `pnpm test`, `pnpm run build`, `pnpm run deploy`
- Note browser requirements: Chrome/Edge (full), Firefox (partial AudioWorklet), Safari (partial)

**Definition of Done:**

- [x] README describes Waveish as an AI-powered audio mastering app
- [x] Audio architecture section present
- [x] Development, testing, and deployment commands documented
- [x] Browser compatibility noted
- [x] No Figma bundle reference

**Verify:**

- Visual review of README.md

---

## Open Questions

None — all clarifications resolved.

### Deferred Ideas

- True stereo metering: split the analyser into separate L/R channels for `getPeakLevels()`
- Noise-shaped dither: more complex algorithm, could be added as a third dither option later
- ESLint auto-fix pass: once the config is set up, run `eslint --fix .` to auto-fix all existing issues
