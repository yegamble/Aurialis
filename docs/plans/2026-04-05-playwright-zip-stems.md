# Playwright ZIP Stems E2E Test Plan

Created: 2026-04-05
Author: yegamble@gmail.com
Status: VERIFIED
Approved: Yes
Iterations: 0
Worktree: No
Type: Feature

## Summary

**Goal:** Run the Playwright E2E tests for the stem mixer ZIP upload flow, identify and fix any failures so the tests pass reliably.
**Architecture:** Existing E2E tests in `e2e/mixer.spec.ts` with test fixtures in `e2e/fixtures/stems.zip`. Dev server on localhost:3000.
**Tech Stack:** Playwright, Next.js dev server, existing stem mixer components.

## Scope

### In Scope

- Run the full `e2e/mixer.spec.ts` suite (TS-001 through TS-007 + playback controls)
- Focus on TS-002 (ZIP upload) — the user's primary ask
- Fix any test failures or production code bugs discovered
- Ensure the ZIP upload flow works end-to-end in browser

### Out of Scope

- Writing new features
- Refactoring existing components
- Adding new test scenarios beyond what exists

## Approach

**Chosen:** Run existing tests, debug and fix failures
**Why:** Tests and fixtures already exist — the work is validation and bug-fixing, not creation.
**Alternatives considered:** Rewrite tests from scratch — rejected, existing tests are well-structured.

## Context for Implementer

- **E2E test file:** `e2e/mixer.spec.ts` — 301 lines, 7 test groups, serial mode
- **ZIP fixture:** `e2e/fixtures/stems.zip` (345K) containing `bass.wav`, `vocals.wav`, `drums.wav`, `guitar.wav`
- **Playwright config:** `playwright.config.ts` — Chromium only, dev server on :3000, html reporter
- **Mix page:** `src/app/mix/page.tsx` — the page under test
- **Home page link:** `src/components/upload/UploadScreen.tsx:165` has "Mix Stems" link to `/mix`
- **Stem upload component:** `src/components/mixer/StemUpload.tsx` — handles drag/drop and file input
- **ZIP handling:** `src/lib/audio/stem-loader.ts` — `loadStemsFromZip()` uses JSZip
- **Hook:** `src/hooks/useMixEngine.ts` — `loadStems()` detects ZIP files and routes to `loadStemsFromZip`
- **Global setup:** `e2e/global-setup.ts` — generates test WAV fixture for mastering E2E tests (separate from stem fixtures)

**Key pattern:** The test navigates to `/mix`, uploads files via `input[type="file"]`, waits for `[data-testid="stem-timeline"]` to appear, then verifies stem names and count.

## Runtime Environment

- **Start:** `pnpm dev` → `http://localhost:3000`
- **E2E command:** `pnpm exec playwright test e2e/mixer.spec.ts --workers=1` (serial — matches test file's `mode: "serial"`)
- **ZIP-only:** `pnpm exec playwright test e2e/mixer.spec.ts -g "ZIP" --workers=1`
- **Global setup:** `e2e/global-setup.ts` — runs `generateTestWav()` from `e2e/fixtures/generate-test-wav.js` before tests. If this fails, all tests error before first assertion.

## Assumptions

- Dev server is running on localhost:3000 — Task 1 depends on this
- Test fixtures exist at `e2e/fixtures/stems.zip` and `e2e/fixtures/stems/*.wav` — verified above
- The "Mix Stems" link on the home page navigates to `/mix` — verified via grep

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Audio decoding fails in headless Chromium | Medium | High | First try headless; if `stem-timeline` appears but canvases are empty, run `--headed` to confirm. Fallback: verify canvases have non-zero pixels via Playwright screenshot comparison |
| Stem timeline doesn't appear after ZIP upload (async timing) | Medium | Medium | Increase timeout, add explicit waits for loading states |
| Channel strip controls not visible on default viewport | Low | Low | Use desktop viewport (default in Playwright config is Desktop Chrome) |

## Goal Verification

### Truths

1. `pnpm exec playwright test e2e/mixer.spec.ts -g "ZIP"` passes with 0 failures
2. ZIP upload extracts all 4 stems and displays them in the UI
3. Full `e2e/mixer.spec.ts` suite passes with no regressions

### Artifacts

1. `e2e/mixer.spec.ts` — E2E test file (may be modified to fix flakiness)
2. Any production files fixed to resolve test failures

## E2E Test Scenarios

### TS-001: Run ZIP Upload Test
**Priority:** Critical
**Preconditions:** Dev server running on localhost:3000
**Mapped Tasks:** Task 1

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Run `pnpm exec playwright test e2e/mixer.spec.ts -g "ZIP"` | Test executes |
| 2 | Check test output | All assertions pass |
| 3 | If failures, diagnose root cause | Clear error message identifying the issue |

### TS-002: Run Full Mixer Test Suite
**Priority:** High
**Preconditions:** ZIP test passes
**Mapped Tasks:** Task 2

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Run `pnpm exec playwright test e2e/mixer.spec.ts` | All tests execute |
| 2 | Check test output | All tests pass |

## Progress Tracking

- [x] Task 1: Run and fix ZIP upload E2E test
- [x] Task 2: Run full mixer E2E suite and fix any remaining failures
      **Total Tasks:** 2 | **Completed:** 2 | **Remaining:** 0

## Implementation Tasks

### Task 1: Run and Fix ZIP Upload E2E Test

**Objective:** Execute the TS-002 ZIP upload Playwright test, diagnose any failures, and fix them so the test passes.

**Dependencies:** None

**Mapped Scenarios:** TS-001

**Files:**

- Test: `e2e/mixer.spec.ts` (may need timing/assertion fixes)
- Modify: Production files as needed (if the app has bugs the test reveals)

**Key Decisions / Notes:**

- Run with `--headed` first to visually debug if headless fails
- Use `--debug` flag to step through if assertion failures are unclear
- Common issues: AudioContext not available in headless Chromium, async timing gaps between upload and UI render, missing COOP/COEP headers for AudioWorklet
- The `loadStemsFromZip` function uses JSZip which is pure JS — no Chromium limitations expected for the ZIP extraction itself
- The audio decoding (`ctx.decodeAudioData`) is the most likely failure point in headless

**Definition of Done:**

- [ ] `pnpm exec playwright test e2e/mixer.spec.ts -g "ZIP"` passes
- [ ] ZIP upload extracts 4 stems visible in the UI
- [ ] "4 stems loaded" text visible
- [ ] No console errors in browser

**Verify:**

- `pnpm exec playwright test e2e/mixer.spec.ts -g "ZIP" --reporter=line`

---

### Task 2: Run Full Mixer E2E Suite

**Objective:** Run the complete `e2e/mixer.spec.ts` suite and fix any remaining failures discovered.

**Dependencies:** Task 1

**Mapped Scenarios:** TS-002

**Files:**

- Test: `e2e/mixer.spec.ts`
- Modify: Production files as needed

**Key Decisions / Notes:**

- Run with `--workers=1` first (serial) for reliability, then try `--workers=2`
- Focus on tests that interact with audio (playback controls, auto-mix, send-to-master) — these are most likely to have headless-specific issues
- The `serial` mode config means tests in each describe block run in order

**Definition of Done:**

- [ ] `pnpm exec playwright test e2e/mixer.spec.ts --workers=1` passes with 0 failures on two consecutive runs
- [ ] No test timeouts

**Verify:**

- `pnpm exec playwright test e2e/mixer.spec.ts --workers=1 --reporter=line`
- Re-run: `pnpm exec playwright test e2e/mixer.spec.ts --workers=1 --reporter=line`
