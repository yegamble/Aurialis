# Simple Mode Toggle Consistency Fix Plan

Created: 2026-03-28
Status: VERIFIED
Approved: Yes
Iterations: 0
Worktree: No
Type: Bugfix

## Summary

**Symptom:** Toggles in simple mode engage and disengage inconsistently. After toggling genres and quick toggles, params jump unexpectedly — turning off a toggle doesn't restore the previous values.

**Trigger:** First toggle/genre/intensity click in a session, or any toggle click after Auto Master.

**Root Cause:** Two sources of param drift:

1. **Store defaults diverge from preset defaults** — `audio-store.ts:57-77` defines `defaultParams` with `ratio: 3, attack: 20, release: 250`, but `presets.ts:11-31` defines `DEFAULT_PARAMS` with `ratio: 2, attack: 30, release: 300`. The preset defaults are the interpolation base used by `applyIntensity()`. Since `recomputeParams` is never called on mount, the store starts with mismatched values. The first toggle click triggers `recomputeParams`, which snaps ratio/attack/release to the preset system — an unexpected jump unrelated to the toggle.

2. **`handleAutoMaster` bypasses the toggle system** — `page.tsx:166-174` calls `setParams(result.params)` directly (not `recomputeParams`). It doesn't reset toggle state. After Auto Master, toggles show as ON but don't affect audio. The first toggle click snaps params from Auto Master's custom values to genre-interpolated values.

## Investigation

- Store `defaultParams` (ratio:3, attack:20, release:250) ≠ preset `DEFAULT_PARAMS` (ratio:2, attack:30, release:300)
- `recomputeParams` is only called inside event handlers (lines 138, 143, 149) — never on mount
- `handleAutoMaster` (line 166-174) calls `setParams` directly, bypassing `recomputeParams`; does not reset toggles
- `applyToggles` logic is correct — always recomputes from base, no state accumulation
- The 5 quick toggles (cleanup, warm, bright, wide, loud) have minimal param overlap (only makeup shared between cleanup and loud), so toggle interaction isn't the issue

## Fix Approach

**Chosen:** Sync defaults + init on mount + fix Auto Master

**Why:** Addresses all three sources of inconsistency with minimal changes. No architectural redesign needed.

**Alternatives considered:**
- Store auto-master corrections as toggle-like offsets: Over-engineered for the current issue
- Only sync defaults without init effect: Would still have first-click jump when store is already hydrated from a previous page

**Files:** `src/lib/stores/audio-store.ts`, `src/app/master/page.tsx`
**Strategy:**
1. Import `DEFAULT_PARAMS` from presets in the store → single source of truth for defaults
2. Add `useEffect` in MasterPage to call `recomputeParams` on mount (syncs params with initial genre/intensity/toggles)
3. In `handleAutoMaster`: reset toggles to all-OFF, use `recomputeParams(result.genre, result.intensity, allOff)` instead of direct `setParams`

**Tests:** `e2e/mastering.spec.ts` — new tests for toggle engage/disengage consistency

**Defense-in-depth:** Eliminating duplicate default definitions prevents future drift.

## Verification Scenario

### TS-006: Toggle Engage/Disengage Consistency
**Preconditions:** File uploaded, simple mode active, default genre (Pop)

| Step | Action | Expected Result (after fix) |
|------|--------|-----------------------------|
| 1 | Note initial params (switch to advanced, read Threshold slider) | Initial values match genre preset at intensity 50 |
| 2 | Switch to simple, toggle "Warm" ON | eq250 and satDrive change; other params unchanged |
| 3 | Toggle "Warm" OFF | All params revert to exact values from step 1 |
| 4 | Toggle each quick toggle ON then OFF individually | Each toggle only affects its declared params |
| 5 | Change genre to Rock, toggle Warm ON, then OFF | Params match Rock preset at current intensity |
| 6 | Click Auto Master, verify toggles are all OFF | All toggle buttons inactive, params reflect detected genre |

## Progress

- [x] Task 1: Fix store defaults, mount sync, and Auto Master
- [x] Task 2: Verify
      **Tasks:** 2 | **Done:** 2

## Tasks

### Task 1: Fix store defaults, mount sync, and Auto Master

**Objective:** Eliminate param drift between store defaults and preset system

**Files:**
- `src/lib/stores/audio-store.ts` — import `DEFAULT_PARAMS` from presets, use as `defaultParams`
- `src/app/master/page.tsx` — add mount effect to call `recomputeParams`; fix `handleAutoMaster` to reset toggles and use `recomputeParams`

**TDD:**
1. Write E2E test: toggle Warm ON → read threshold in advanced mode → toggle Warm OFF → read threshold again → values must match
2. Verify test FAILS on current code (threshold changes on first toggle due to store/preset mismatch)
3. Implement the three fixes
4. Verify test PASSES

**Changes:**
- `audio-store.ts`: Replace hardcoded `defaultParams` with import from `@/lib/audio/presets`
- `page.tsx`: Add `useEffect(() => { recomputeParams(genre, intensity, toggles); }, [])` after `recomputeParams` definition
- `page.tsx`: In `handleAutoMaster`, reset toggles to all-OFF, call `recomputeParams(result.genre, result.intensity, resetToggles)`

**Verify:** `npx playwright test e2e/mastering.spec.ts`

### Task 2: Verify

**Objective:** Full test suite, lint, type check
**Verify:** `npm test -- --reporter=dot && npx playwright test --workers=2 && npm run build`
