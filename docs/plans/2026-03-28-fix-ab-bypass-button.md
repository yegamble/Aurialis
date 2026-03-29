# Fix A/B Bypass Button Plan

Created: 2026-03-28
Status: VERIFIED
Approved: Yes
Iterations: 0
Worktree: No
Type: Bugfix

## Summary

**Symptom:** The A/B bypass button toggles visually (A ↔ B) but audio continues through the full processing chain — no audible bypass occurs.

**Trigger:** Clicking the A/B toggle button at any time after uploading audio.

**Root Cause:** `src/hooks/useAudioEngine.ts:192-200` — `toggleBypass` is a stub that only sets React state (`isBypassed`) but never instantiates or toggles an `AudioBypass` instance. Additionally, `AudioEngine` keeps `inputGain`, `chain`, and `outputGain` as private fields with no accessors, so even if the hook tried to create `AudioBypass`, it couldn't wire it up.

## Investigation

- `ABToggle.tsx` — Pure UI component, correctly passes `isActive`/`onToggle`. Not the issue.
- `useAudioEngine.ts:192-200` — `toggleBypass` has a comment "For now, use the engine's processingAvailable flag as a bypass signal" but never actually does anything besides `setIsBypassed(next)`. The `bypassRef` is never populated.
- `AudioBypass` class (`bypass.ts`) — Fully implemented. `enable()` disconnects `inputGain → chain.input` and connects `inputGain → outputGain` directly. `disable()` reverses this. Works correctly — just never instantiated.
- `AudioEngine` (`engine.ts:12-15`) — `inputGain`, `chain`, `outputGain` are all `private`. No getter or bypass method exists.
- Signal chain in `engine.ts:93-97`: `inputGain → [ProcessingChain] → outputGain → analyser → destination`
- `AudioBypass` needs exactly `inputGain`, `chain` (as `ChainLike` with `.input`/`.output`), and `outputGain` — all of which `AudioEngine` has internally.

## Fix Approach

**Chosen:** Add `setBypass(active: boolean)` to `AudioEngine` + wire `toggleBypass` in hook

**Why:** Keeps audio graph management inside the engine (where it belongs), minimal surface area change. The `AudioBypass` class is already complete — just needs to be instantiated and called.

**Alternatives considered:**
- Expose getters for internal nodes: Leaks audio graph internals into the React layer — bad separation of concerns
- Create AudioBypass in the hook via engine getter: Same leak issue, and the hook already has too many responsibilities

**Files:** `src/lib/audio/engine.ts`, `src/hooks/useAudioEngine.ts`
**Strategy:**
1. `engine.ts`: Import `AudioBypass`, add private `_bypass: AudioBypass | null`, add `setBypass(active: boolean)` method that lazily creates `AudioBypass` from internal nodes and calls `enable()`/`disable()`. Clean up in `dispose()`.
2. `useAudioEngine.ts`: Replace stub `toggleBypass` with a call to `engine.setBypass(next)`.

**Tests:** `e2e/mastering.spec.ts` — new test verifying A/B toggle changes aria-pressed state (UI already tested in TS-003, but we need a test that confirms the engine method is called; since bypass is an audio-graph operation, E2E is the right level)

## Verification Scenario

### TS-007: A/B Bypass Button
**Preconditions:** File uploaded, master page visible

| Step | Action | Expected Result (after fix) |
|------|--------|----------------------------|
| 1 | Click A/B toggle | Button shows "B" / "Bypass", aria-pressed="true" |
| 2 | Click A/B toggle again | Button shows "A" / "Processed", aria-pressed="false" |
| 3 | Play audio, click A/B toggle | Audio routing changes (bypass active — no processing chain in signal path) |

## Progress

- [x] Task 1: Wire up AudioBypass in engine and hook
- [x] Task 2: Verify
      **Tasks:** 2 | **Done:** 2

## Tasks

### Task 1: Wire up AudioBypass in engine and hook

**Objective:** Make the A/B bypass button actually bypass the processing chain

**Files:**
- `src/lib/audio/engine.ts` — add `setBypass(active: boolean)` method with lazy `AudioBypass` creation
- `src/hooks/useAudioEngine.ts` — replace stub `toggleBypass` to call `engine.setBypass(next)`

**TDD:**
1. Existing E2E test in TS-003 already verifies A/B toggle UI state — confirm it passes
2. Implement the engine + hook wiring
3. Verify all tests pass

**Changes:**
- `engine.ts`: Import `AudioBypass`, add `private _bypass: AudioBypass | null = null`, add:
  ```typescript
  setBypass(active: boolean): void {
    if (!this.inputGain || !this.chain || !this.outputGain) return;
    if (!this._bypass) {
      this._bypass = new AudioBypass(this.inputGain, this.chain, this.outputGain);
    }
    if (active) this._bypass.enable();
    else this._bypass.disable();
  }
  ```
  In `dispose()`: add `this._bypass = null;`
- `useAudioEngine.ts`: Replace `toggleBypass` body:
  ```typescript
  const toggleBypass = useCallback(() => {
    const next = !isBypassed;
    setIsBypassed(next);
    engine.setBypass(next);
  }, [isBypassed, engine]);
  ```
  Remove unused `bypassRef` and `AudioBypass` import.

**Verify:** `npx playwright test e2e/mastering.spec.ts`

### Task 2: Verify

**Objective:** Full test suite, lint, type check
**Verify:** `npm test -- --reporter=dot && npx playwright test --workers=2 && npm run build`
