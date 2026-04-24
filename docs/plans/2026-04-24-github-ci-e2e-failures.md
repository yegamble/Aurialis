# GitHub CI E2E Test Failures Fix Plan

Created: 2026-04-24
Author: yegamble@gmail.com
Status: VERIFIED
Approved: Yes
Iterations: 0
Worktree: No
Type: Bugfix

## Summary

**Symptom:** `pnpm run test:e2e` fails in GitHub Actions with 4 failed + 4 skipped + 46 did-not-run (serial-describe cascade) out of 58 tests.

**Trigger:** `pnpm run build` + `pnpm run start` + Playwright against `http://localhost:3000` on Desktop Chrome (lg+ viewport).

**Root Cause:**

- **Bug A — DOM duplication:** `src/app/master/page.tsx:300` and `src/app/master/page.tsx:455` both render `<AdvancedMastering ... />` with identical props. The desktop aside (`hidden lg:block`) and the mobile `<details>` drawer (`lg:hidden`) are both in the DOM simultaneously — only CSS hides one. Every `data-testid` inside `AdvancedMastering` therefore resolves to two elements, violating Playwright strict mode.
- **Bug B — Stale tests:** Commit `1092f57` ("Rename to Aurialis, fix Docker CPU support, route uploads by type") unified the upload UX — the home page no longer has a "Mix Stems" link, and the upload input now accepts multiple files (`<input type="file" multiple>` in `src/components/upload/UploadScreen.tsx:144-152`). Two E2E tests still encode the pre-rename contract.

## Investigation

**Bug A — reproducible:** `pnpm exec playwright test e2e/multiband.spec.ts:44` fails locally with:

```
strict mode violation: getByTestId('bypass-pill-multiband') resolved to 2 elements:
  1) ... aka getByRole('button', { name: 'Bypass Multiband' })
  2) ... aka getByRole('main').getByTestId('bypass-pill-multiband')
```

The first match sits in `<aside class="... hidden lg:block">` at `master/page.tsx:272-313`. The second sits inside `<main>` → `<div class="lg:hidden"><details>...</details></div>` at `master/page.tsx:436-468`. At Desktop Chrome viewport both render; CSS hides the mobile one, but `getByTestId` matches before visibility filters run.

**Affected tests (real product bug):**

- `e2e/dsp-p4a.spec.ts:47` — TS-003: bypass pills for 6 stages (`bypass-pill-eq|compressor|limiter|saturation|stereo|multiband`).
- `e2e/multiband.spec.ts:44` — TS-001: multiband BypassPill toggle.

**Bug B — reproducible:**

- `e2e/mastering.spec.ts:268-277` — `expect(chooser.isMultiple()).toBe(false)` fails because `UploadScreen.tsx:148` sets `multiple` on the file input. The `getByRole("button", { name: /upload audio file/i })` locator still resolves correctly (the drop-zone div has `role="button"` + matching aria-label).
- `e2e/mixer.spec.ts:34-51` — `getByRole('link', { name: /mix stems/i })` finds no match because the unified UploadScreen has no explicit "Mix Stems" link. The current UX routes to `/mix` automatically when the uploaded payload is multi-file or a ZIP.

**Cascading skipped/did-not-run:** All four affected spec files use `test.describe.configure({ mode: "serial" })`. When the first test in a serial describe fails, the remaining tests in that describe are reported as "did not run" rather than executed. This explains the 46 did-not-run + 4 skipped tail — they all sit behind one of the 4 failing tests.

**Working example (no duplication):** `src/app/mix/page.tsx` renders each child component once; its E2E tests do not hit strict-mode violations.

**Secondary observation (out of scope):** Build logs show the Next warning `"next start" does not work with "output: standalone" configuration.` It is non-fatal in Next 15 — the 4 tests that passed in CI prove `next start` still serves routes. Do NOT address in this plan; track separately if log-noise becomes a problem.

## Behavior Contract

**Given:** User loads `/master` with a file loaded in "advanced" mode at a Desktop Chrome (≥ lg, 1024px) viewport.
**When:** Playwright runs `page.getByTestId("bypass-pill-<stage>")` for any stage in `{eq, compressor, limiter, saturation, stereo, multiband}`.
**Currently (bug):** The locator resolves to **2 elements** (desktop aside + mobile `<details>` drawer, both present in DOM), yielding a Playwright strict-mode violation.
**Expected (fix):** The locator resolves to **exactly 1 element** (the visible desktop rendering on lg+ viewports; the mobile rendering on <lg viewports). At no viewport width do both render simultaneously.
**Anti-regression:**

- `src/components/mastering/__tests__/AdvancedMastering-bypass-pills.test.tsx` (vitest, all 6 stage assertions) must stay green.
- `src/components/mastering/__tests__/AdvancedMastering-multiband.test.tsx` (vitest) must stay green.
- `e2e/mastering.spec.ts` transport/navigation suite (`Navigation and transport buttons`, P1-TS-003 LRA/Corr readouts, mode toggle) must stay green.
- `e2e/mixer.spec.ts` tests that use `navigateToMix(page)` (upload multiple audio files, stem count, waveform timeline) must stay green.
- Simple ↔ Advanced mode toggle on `/master` must continue to animate and switch via `AnimatePresence`.
- Mobile users (<lg viewport) must retain access to Advanced controls via the `<details>` drawer at `master/page.tsx:436-468`.

## Fix Approach

**Chosen:** Client-side media-query hook that toggles which wrapper renders `AdvancedMastering`/`SimpleMastering`.

**Why:** Removes DOM duplication at its source — the only correct answer for a strict-mode DOM contract. CSS-only responsive rendering cannot satisfy `getByTestId` strict mode because hidden-via-CSS nodes are still in the DOM. A media-query hook renders exactly one branch based on `window.matchMedia("(min-width: 1024px)")`, matching the existing Tailwind `lg` breakpoint.

**Alternatives considered:**

- Scoped testIds via prop on `BypassPill`/`MultibandSection` — rejected: couples component API to test infrastructure; still leaves duplicated, interactive buttons in the DOM (a real UX issue — keyboard tab order hits the hidden aside).
- Delete the mobile `<details>` variant — rejected: mobile UX regression; this plan is a test-green fix, not a product trim.

**Files:**

- `src/app/master/page.tsx` — add `useIsLgViewport()` hook; gate the two wrappers on it. (Also collapses duplicate `<SimpleMastering>` rendering at lines 282-290 and 444-453 with the same hook — both components are duplicated today.)
- `e2e/mastering.spec.ts` — update line 274 assertion from `toBe(false)` to `toBe(true)` (multi-file is the new contract; keep the "opens a chooser" expectation).
- `e2e/mixer.spec.ts` — rewrite the `navigate to /mix from home page` test (lines 34-51) to drive the current unified-upload flow (upload multi-file on `/`, assert navigation to `/mix`). The "Mix Stems" link no longer exists and should not be resurrected.

**Strategy:**

- Hook lives inline in `master/page.tsx` (or extracted to `src/lib/hooks/use-is-lg-viewport.ts` if reused — for now, inline keeps the diff scoped).
- SSR default: `true` (render desktop), matching current Desktop Chrome test viewport. On client mount, `useEffect` reads `window.matchMedia("(min-width: 1024px)")` and updates state; listener handles resize. This keeps the hydration mismatch minimal and the CI path deterministic (Desktop Chrome is always lg+).
- Test fixes: update assertion in `mastering.spec.ts`. For `mixer.spec.ts`, replace `getByRole('link', ...)` path with upload-driven navigation using the same `STEM_FILES` fixture already declared in the file.

**Tests:**

- Reproducing tests already exist and fail: `e2e/dsp-p4a.spec.ts:47`, `e2e/multiband.spec.ts:44`, `e2e/mastering.spec.ts:268`, `e2e/mixer.spec.ts:34`. No new test code required for Bug A (the existing E2E tests are the RED).
- Bug B is a test-contract bug, so the "reproducing test" for Bug B is the existing test's current failure — the fix is updating the test to match current product behavior, then re-running to confirm green.

**Defense-in-depth:** N/A — this is a single-layer DOM rendering bug and a test-assertion bug. No data flow involved.

## Verification Scenario

### TS-001: Per-stage BypassPill uniqueness on /master (Bug A)

**Preconditions:** Built app served via `pnpm run start`; Desktop Chrome viewport (1280×720 default).

| Step | Action | Expected Result (after fix) |
|------|--------|-----------------------------|
| 1 | `page.goto("/")`, upload `e2e/fixtures/test-audio.wav`, wait for navigation to `/master` | URL is `/master`; WaveformDisplay visible |
| 2 | Click "Advanced" mode button to ensure Advanced panel is active | Advanced panel visible in left aside |
| 3 | For each stage in `{eq, compressor, limiter, saturation, stereo, multiband}`: `page.getByTestId('bypass-pill-<stage>')` | Each locator resolves to **exactly 1 element** (no strict-mode violation) |
| 4 | Click `bypass-pill-eq`; check `aria-pressed` | Toggles between `"true"` and `"false"` on each click (unchanged from current behavior) |

### TS-002: Upload flow and mix navigation (Bug B)

**Preconditions:** Built app served via `pnpm run start`; home page.

| Step | Action | Expected Result (after fix) |
|------|--------|-----------------------------|
| 1 | `page.goto("/")`; click the role="button" drop zone (aria-label matches `/upload audio file/i`) | File chooser opens |
| 2 | Verify `chooser.isMultiple()` | `true` (unified upload accepts multi-file + ZIP) |
| 3 | Upload `STEM_FILES` (4 WAVs) via the file input on `/` | Navigation to `/mix` within 30s |
| 4 | On `/mix`, assert `stem-timeline` testid is visible | Timeline renders with the uploaded stems |

## Progress

- [x] Task 1: Write Reproducing Test (RED)
- [x] Task 2: Implement Fix at Root Cause
- [x] Task 3: Quality Gate
      **Tasks:** 3 | **Done:** 3

## Deviations (recorded during implementation)

**Surfaced after fix:** Removing the pill-duplication cascade in master/page.tsx exposed a batch of E2E tests that had been stuck in "did not run" in CI (serial describes dropped them after the first failure). All were **stale tests**, not product regressions — they encoded UI contracts from before Phase 4a (`spec/dsp-p4-triage`, commit `0f9cb02`), which split the former `Dynamics` / `Output` Sections and migrated master-bypass controls onto the unified `BypassPill` pattern. Fixed inline per the bugfix workflow:

- `e2e/mastering.spec.ts:441` — `ensureSectionExpanded(page, "Dynamics")` → `"Dynamics Toggles"` (Section was split).
- `e2e/mastering.spec.ts:491` — `ensureSectionExpanded(page, "Dynamics")` → `"Compressor"` (Sidechain HPF moved into Compressor Section).
- `e2e/mastering.spec.ts:504` — `expectSliderApprox(page, "Sidechain HPF", 100)` → `110` (master page mounts with `applyIntensity("pop", 50)` which interpolates sidechainHpfHz to 110; 100 was the raw DEFAULT_PARAMS value).
- `e2e/mastering.spec.ts:255-264` — `SECTION_EXPECTATIONS` updated: `"Dynamics"` → `"Compressor"`, `"Output"` → `"Output Target"`.
- `e2e/mastering.spec.ts:710` — `getByTestId("eq-master-bypass")` → `getByTestId("bypass-pill-eq").first()` (testId renamed during BypassPill unification).
- `e2e/multiband.spec.ts:89` — test assumed `mbLowEnabled=0` initially, but pop preset starts it at 1. Rewrote as preset-agnostic flip-and-restore using the initial `aria-pressed` attribute.
- `eslint.config.mjs` — added `.worktrees/**` to `ignores`. Pre-existing: lint was failing on webpack bundle files inside a stale `spec-dsp-p4-triage-bf1cda0` worktree (`.next` output not covered by the root `.next/**` ignore). Worktrees are Pilot-managed, ephemeral, and should not be linted.

## Tasks

### Task 1: Write Reproducing Test (RED)

**Objective:** Page-level RED is already satisfied by the 4 failing E2E tests — re-assert them locally. Additionally, add a hook-level RED at `src/hooks/__tests__/use-is-lg-viewport.test.ts` that will fail until the `useIsLgViewport` hook is created in Task 2. This keeps the unit RED proportional to the fix surface area (one hook file) rather than mocking the full `MasterPage` component tree, matching the project convention of testing pages through Playwright E2E (coverage config excludes `src/app/**`).
**Files:** `src/hooks/__tests__/use-is-lg-viewport.test.ts` (new).
**Entry point:** The `useIsLgViewport` hook imported from `@/hooks/use-is-lg-viewport` (the fix artifact).
**DoD:**

- New hook test file runs and **FAILS** before Task 2 — failure reason must be "module not found" or equivalent (because `useIsLgViewport` does not exist yet).
- Existing E2E failures re-confirmed locally (already observed during investigation; no fresh run required):
  - `e2e/dsp-p4a.spec.ts:47` → strict-mode violation on `bypass-pill-eq`
  - `e2e/multiband.spec.ts:44` → strict-mode violation on `bypass-pill-multiband`
  - `e2e/mastering.spec.ts:268` → `expect(chooser.isMultiple()).toBe(false)` fails
  - `e2e/mixer.spec.ts:34` → `getByRole('link', { name: /mix stems/i })` times out

**Verify:**

```bash
pnpm exec vitest run src/hooks/__tests__/use-is-lg-viewport.test.ts
# Must FAIL (module not found — hook file does not exist yet)
```

### Task 2: Implement Fix at Root Cause

**Objective:** Render `AdvancedMastering` and `SimpleMastering` exactly once on `/master` via a client-side media-query hook; update the two stale E2E assertions to match current upload UX.
**Files:**

- `src/app/master/page.tsx` — add `useIsLgViewport()` (inline), replace the duplicated aside/details-drawer branches with a single responsive renderer that picks one host based on the hook state.
- `e2e/mastering.spec.ts` — line 274: `expect(chooser.isMultiple()).toBe(true)`.
- `e2e/mixer.spec.ts` — lines 34-51: replace the "Mix Stems" link click with an upload-driven navigation using the existing `STEM_FILES` fixture and `page.locator('input[type="file"]').setInputFiles(...)` on `/`, then `page.waitForURL("**/mix")`.

**Strategy:**

- Hook contract: `function useIsLgViewport(): boolean` — SSR default `true`; client effect reads `window.matchMedia("(min-width: 1024px)")`, subscribes to `change`, cleans up on unmount.
- Render either the desktop aside OR the mobile `<details>` variant — never both. Keep both code paths; only the active one mounts.
- Do NOT touch `AdvancedMastering` internals or testId names — the fix is purely at the page composition layer.

**DoD:**

- New unit test from Task 1 **PASSES**.
- All 4 previously-failing E2E tests **PASS**:
  - `pnpm exec playwright test e2e/dsp-p4a.spec.ts:47` → green
  - `pnpm exec playwright test e2e/multiband.spec.ts:44` → green
  - `pnpm exec playwright test e2e/mastering.spec.ts:268` → green
  - `pnpm exec playwright test e2e/mixer.spec.ts:34` → green
- Full test suite PASSES (anti-regression gate for the fix): `pnpm run test` (vitest) + `pnpm run test:e2e` (full Playwright).
- Diff touches only `src/app/master/page.tsx`, `e2e/mastering.spec.ts`, `e2e/mixer.spec.ts`, and the new unit test file.
- No `try/catch` wrappers, no test-only branches, no `data-testid` scope hacks.

**Verify:**

```bash
pnpm exec playwright test e2e/dsp-p4a.spec.ts:47 e2e/multiband.spec.ts:44 e2e/mastering.spec.ts:268 e2e/mixer.spec.ts:34 --reporter=line
# Must PASS
```

### Task 3: Quality Gate

**Objective:** Typecheck, lint, unit tests, full E2E suite, and Next build — all green. Any auto-fixes from lint/format must not break the suite; the suite re-runs at the end of this task.
**DoD:**

- `pnpm exec tsc --noEmit` → exit 0
- `pnpm run lint` → exit 0
- `pnpm run build` → exit 0 (Next production build completes; existing `output: standalone` warning is acceptable and pre-existing)
- `pnpm run test` → exit 0 (vitest, full suite)
- `pnpm run test:e2e` → exit 0 (Playwright, full 58-test suite; 0 failed, 0 did-not-run)
- No `SPEC-DEBUG:` markers remaining in the diff (`git diff --unified=0 | grep -c 'SPEC-DEBUG:'` → 0)
- No new hot-path expensive work introduced in the render tree (the hook adds a single `useState` + one `useEffect` with a `matchMedia` listener — within project standards).

**Verify:**

```bash
pnpm exec tsc --noEmit && pnpm run lint && pnpm run build && pnpm run test && pnpm run test:e2e
# All must exit 0
```

**Why the suite runs again here:** lint/type checkers and formatters can rewrite imports or whitespace in `master/page.tsx`; the suite must be green **after** those fixes, not before.
