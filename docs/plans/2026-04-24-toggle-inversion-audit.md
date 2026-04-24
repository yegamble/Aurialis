# Toggle Inversion Audit Fix Plan

Created: 2026-04-24
Author: yegamble@gmail.com
Status: VERIFIED
Approved: Yes
Iterations: 0
Worktree: No
Type: Bugfix

## Summary

**Symptom:** No reported reproduction. User concern: some bypass/disable buttons in mastering / stem mixer might be wired inverted so that clicking "disable"/"bypass" actually enables the feature (or vice versa). User explicitly chose a proactive behavioral audit over a single-bug trace.
**Trigger:** Hypothetical — any click on a bypass/disable/mute button whose UI says "Bypassed" but whose audio path keeps processing (or the inverse).
**Root Cause:** **Coverage gap, not a located code bug.** A full static trace of every toggle — `BypassPill` (6 stages in `src/components/mastering/AdvancedMastering.tsx:238`), `ABToggle` (`src/components/mastering/ABToggle.tsx:12`), per-band enables (`BandRow` / `EqBandStrip`), Simple-mastering Quick Toggles, Auto Release, Dynamics toggles, and mixer mute/solo (`src/components/mixer/ChannelStrip.tsx:128`) — through Zustand (`src/lib/stores/audio-store.ts`), `ParameterBridge` (`src/lib/audio/parameter-bridge.ts:22`), `ProcessingChain.updateParam` (`src/lib/audio/chain.ts:180–200`), per-node `setBypass`/`setEnabled`, and the AudioWorklets (`public/worklets/*.js`) shows **no inversion**. Every layer treats `*Enabled = 1` as "processing" and `0` as "bypassed" consistently. The Law-1 root cause is therefore *"the live-playback toggle path has no behavioral regression test, so an inversion introduced by a future change would ship undetected"*. The audit itself is the fix.

## Investigation

Audit breadcrumbs (each line is a link in the verified chain):

- **BypassPill.active semantics** (`AdvancedMastering.tsx:238-271`) — button displays "Bypassed" when `active=true`, i.e. when `(*Enabled ?? default) === 0`. Confirmed for all 6 stages: `compressorEnabled` (default 1), `multibandEnabled` (default 0), `parametricEqEnabled` (default 1), `saturationEnabled` (default 1), `stereoWidthEnabled` (default 1), `limiterEnabled` (default 1).
- **ABToggle.isActive semantics** (`ABToggle.tsx:12-31`) — `isActive=true` ⇒ label "B / Bypass"; wired in `master/page.tsx:410` to `useAudioEngine.isBypassed`, which drives `engine.setBypass(active=true)` ⇒ `AudioBypass.enable()` (direct input→output route). Correct.
- **ProcessingChain.updateParam** (`chain.ts:180-200`) — `compressorEnabled`, `saturationEnabled`, `stereoWidthEnabled`, `limiterEnabled` each forward to `node.setBypass(n === 0)`; `parametricEqEnabled` and `multibandEnabled` forward to `node.setEnabled(n)`. Consistent with the UI contract.
- **Per-node `setBypass`** (`compressor.ts:63`, `limiter.ts:46`, `saturation.ts:39`) — all send `{ param: 'enabled', value: !bypass }` to their worklet. Worklets check `if (!this._enabled)` → passthrough (`compressor-processor.js:93`, `limiter-processor.js:144`, `saturation-processor.js:230`). Correct.
- **EQ + Multiband master-enable** (`eq.ts:44`, `multiband-compressor.ts:64`) — pass `on` directly; worklets check `if (!this._enabled || this._<feature>Enabled <= 0)` → passthrough (`parametric-eq-processor.js:276`, `multiband-compressor-processor.js:238`). Correct.
- **ChannelStrip mute/solo** (`ChannelStrip.tsx:128-152`) — calls `onMuteToggle(stemId)` / `onSoloToggle(stemId)`; hook (`useMixEngine.ts:246-270`) flips store state and forwards via `engine.setMute(stemId, muted)` / `engine.setSolo(stemId, soloed)` (`mix-engine.ts:426-438`). `isEffectivelyMuted` correctly returns `!ch.soloed` when any channel is soloed, else `ch.muted`. Correct.
- **Existing coverage** — `renderer-bypass-parity.test.ts:96` already proves the **offline** export path honors every `*Enabled` bit-exact. `mastering.spec.ts:707` (TS-005) asserts the **EQ** bypass pill flips visual state. **Gap:** no test verifies every *other* bypass pill, nor that the live playback path's engine was actually reconfigured.
- **Recent context signal** — `AdvancedMastering` Section children render only when `open=true` (observation #862). If a Section is collapsed, its BypassPill stays visible in the header (`rightSlot`), so that pattern doesn't hide any toggles from the audit.

## Behavior Contract

**Given:** App is loaded and playback is possible (audio file loaded in /master, or stems loaded in /mix).
**When:** The user clicks any bypass/disable/mute button listed in "Fix Approach → Surfaces".
**Currently (bug):** *Unknown — the audit replaces "hope" with "proof".* For every listed button: (a) visual state (`aria-pressed`, label text) flips; (b) the underlying `AudioParams` field or channel state flips in the Zustand store; (c) the engine is reconfigured so the next audio block reflects the new state.
**Expected (fix):** All three invariants above hold for every listed button, and a single parameterized test enforces them. If any button fails any invariant, that failure is the real bug and is fixed at its root cause in Task 2.
**Anti-regression:** Existing suites stay green — specifically `renderer-bypass-parity.test.ts`, `mastering.spec.ts` (all TS-* scenarios including TS-005), `multiband.spec.ts`, `mixer.spec.ts`, and the audio-store / parameter-bridge unit tests.

## Fix Approach

**Chosen:** *Dual-layer audit — E2E for UI-to-store wiring, unit for store-to-engine wiring.* The audit itself is the reproducing test; any real inversion it surfaces becomes a follow-up fix at the traced root cause.
**Why:** The user's concern spans UI perception ("button says off but audio is on") and runtime behavior. A single E2E test can't cheaply prove the engine was actually reconfigured without exposing internals. Two lean tests — one E2E (DOM + store snapshot) and one unit (Zustand → spy-on-engine) — cover both without needing to decode real audio in CI.
**Alternatives considered:**
- *Pure E2E with audio rendering & FFT comparison* — heavy CI cost, flaky on CI audio backends, large infra lift. Rejected.
- *Single parameterized unit test covering UI + engine* — can't validate the DOM side (label text, `aria-pressed`) reliably. Rejected.
- *No new tests, close the spec* — user explicitly rejected this path. Rejected.

**Surfaces (authoritative list — audit iterates over this):**

| Button | Testid / Role | Param / Channel field | Default | Expected "off" text |
|--------|---------------|------------------------|---------|----------------------|
| Global A/B bypass | `ab-toggle` | `useAudioEngine.isBypassed` (local hook state) | `false` | Label flips `A/Processed` ↔ `B/Bypass` |
| Compressor bypass | `bypass-pill-compressor` | `params.compressorEnabled` | `1` | `Bypass` ↔ `Bypassed` |
| Multiband bypass | `bypass-pill-multiband` | `params.multibandEnabled` | `0` | `Bypass` ↔ `Bypassed` |
| EQ bypass | `bypass-pill-eq` | `params.parametricEqEnabled` | `1` | `Bypass` ↔ `Bypassed` |
| Saturation bypass | `bypass-pill-saturation` | `params.saturationEnabled` | `1` | `Bypass` ↔ `Bypassed` |
| Stereo-width bypass | `bypass-pill-stereo-width` | `params.stereoWidthEnabled` | `1` | `Bypass` ↔ `Bypassed` |
| Limiter bypass | `bypass-pill-limiter` | `params.limiterEnabled` | `1` | `Bypass` ↔ `Bypassed` |
| Stem mute (per stem) | `button[aria-label="Mute"]` (per `ChannelStrip`) | `stem.channelParams.mute` | `false` | `aria-pressed` flips |

(Solo, per-EQ-band enables, per-multiband-band enables, Quick Toggles, Dynamics Toggles, and Auto Release are additive enablement — not bypass/disable semantics — and are out of scope for this plan. They already have partial E2E coverage via TS-005 / P1-TS-001 / quick-toggle tests and are not at risk of the "disable enables" class.)

**Files:**
- **New:** `e2e/toggle-audit.spec.ts` — parameterized E2E iterating the Surfaces table, asserting visual + store invariants.
- **New:** `src/lib/audio/__tests__/parameter-bridge-audit.test.ts` — parameterized unit test asserting that a Zustand write to each `*Enabled` field triggers exactly one `engine.updateParameter(key, value)` call with the correct `value`.
- **Modified (test hook only):** `src/lib/stores/audio-store.ts` — add a guarded, dev-only `window.__aurialisAudioStore` reference behind `if (typeof window !== "undefined" && process.env.NODE_ENV !== "production")` so the E2E test can snapshot `state.params` without scraping the DOM. No production behavior change.

**Strategy:**
1. Extend `audio-store.ts` with the guarded window hook (pattern: `window.__aurialisAudioStore = useAudioStore`). ~3 lines.
2. In `toggle-audit.spec.ts`, use the existing `uploadAndNavigate(page)` helper from `mastering.spec.ts`. Iterate the Surfaces table: for each row, read `defaultValue`, click, assert flipped state in DOM + store, click again, assert restored. For stem mute, use the `mixer.spec.ts` stem-upload helper.
3. In `parameter-bridge-audit.test.ts`, mock the engine (`vi.fn()` on `updateParameter`), instantiate `ParameterBridge`, flip each `*Enabled` via `useAudioStore.getState().setParam(key, value)`, advance timers past `DEBOUNCE_MS`, assert the engine saw exactly one call per flip with the correct value.
4. Run audit. If any case fails, that is the real root cause and is fixed at the failing site in Task 2. Expected: all cases pass on first run (static audit already proved the code correct).

**Tests:** See "Files" above — both test files are created in Task 1 and are the sole reproducing tests.

**Defense-in-depth:** Not applicable — no data is flowing through multiple layers with invalid values. The audit is the single layer of new coverage.

## Verification Scenario

### TS-001: Every bypass/disable button round-trips correctly
**Preconditions:** App built and served locally; audio fixture uploaded to /master; a stem is loaded in /mix.

| Step | Action | Expected Result (after fix) |
|------|--------|-----------------------------|
| 1 | On /master, for each of the 6 BypassPills and the ABToggle: read initial `aria-pressed` + label; assert it matches the default row in the Surfaces table. | All 7 controls match their default entry. |
| 2 | Click each once; read `aria-pressed` + label + `window.__aurialisAudioStore.getState().params[<key>]` (or `isBypassed` for ABToggle). | Visual state flipped; store param flipped to the opposite of default. |
| 3 | Click each again; read same values. | Fully restored to the default-row state. No residual side effects. |
| 4 | On /mix with at least one stem loaded, click the stem's Mute button once, then again. | `aria-pressed` flips `true` then back to `false`; stem appears dim (opacity-40) when muted and normal when unmuted. |
| 5 | Full `pnpm test` and `pnpm test:e2e` run. | 0 failures across the full suite including the existing `renderer-bypass-parity.test.ts` parity matrix. |

## Progress

- [x] Task 1: Write Reproducing Test (RED)
- [x] Task 2: Implement Fix at Root Cause — **no inversions found** (see note below)
- [x] Task 3: Quality Gate
      **Tasks:** 3 | **Done:** 3

### Task 2 outcome

Full audit ran green on first invocation (8 E2E cases + 7 unit cases + 1 round-trip unit case = 16 new passing assertions). Full `pnpm test` suite: **1002/1002 passing** including the new audit files and the existing `renderer-bypass-parity.test.ts` parity matrix. No `file:line` root cause to fix.

**One test-expectation issue was surfaced by the first audit run** (and is documented here so future readers understand the diff):

- The first draft of `toggle-audit.spec.ts` asserted each pill's *initial* state against `DEFAULT_PARAMS` (`multibandEnabled: 0`, etc.). That failed for `bypass-pill-multiband` because the /master page runs `recomputeParams(genre="pop", …)` on mount (`src/app/master/page.tsx:128-131`), and the `pop` genre preset sets `multibandEnabled: 1` (`src/lib/audio/presets.ts:159`). The fix was in the *test* — assert the semantic invariant `aria-pressed === (paramValue === 0)` using the live initial state — not in the app. No production code needed a change.
- This is worth noting: the production page's visible "default" is genre-dependent, and any future hardcoded-default assumption in a test for this surface should use the runtime value via `window.__aurialisAudioStore` rather than `DEFAULT_PARAMS`.

## Tasks

### Task 1: Write Reproducing Test (RED)

**Objective:** Add the dual-layer audit described above. On first run the audit is expected to pass (static review found no inversions); the RED is synthesized by temporarily inverting one expected value in each new test file (a single-line flip in `toggle-audit.spec.ts` and `parameter-bridge-audit.test.ts`) to prove the test can *detect* an inversion, then restoring the correct expectation in the same task.
**Files:**
- `e2e/toggle-audit.spec.ts` (new)
- `src/lib/audio/__tests__/parameter-bridge-audit.test.ts` (new)
- `src/lib/stores/audio-store.ts` (add guarded `window.__aurialisAudioStore` hook for E2E snapshotting; ~3 lines under `typeof window !== "undefined" && process.env.NODE_ENV !== "production"`).
**Entry point:** DOM buttons rendered by `/master` and `/mix` pages; Zustand store actions (`useAudioStore.getState().setParam`); `ParameterBridge` public constructor.
**DoD:** Both new test files exist. Each contains a "detects-inversion canary" assertion run first: the canary temporarily expects the wrong `aria-pressed`/`params` value and is proven to fail; expectation is then corrected in the same diff so the suite lands green. Tests are named `toggle audit — every bypass button round-trips (<surface>)` (E2E) and `parameter bridge audit — <enabled-key> forwards to engine` (unit).
**Verify:** `pnpm test src/lib/audio/__tests__/parameter-bridge-audit.test.ts` (must PASS); `pnpm test:e2e toggle-audit` (must PASS). Canary commit snapshots shown in PR description prove RED capability.

### Task 2: Implement Fix at Root Cause

**Objective:** For any button in the Surfaces table whose audit case fails, fix the single root cause at its traced `file:line`. If the audit passes in full on first run — the expected outcome based on static audit — this task's deliverable is an explicit "no inversions found" note on the plan, linked to the passing audit commit. No speculative changes.
**Files:** *Determined by audit results.* Likely candidates if a failure surfaces: `src/components/mastering/AdvancedMastering.tsx` (UI handler inversion), `src/lib/audio/chain.ts:180-200` (`n === 0` vs `n !== 0` flip), or the relevant worklet in `public/worklets/`.
**Strategy:** Minimal surgical change at the failing layer. No "defense-in-depth" patches sprinkled elsewhere — fix the single wrong operator/argument and rely on the new audit plus existing suites as the regression barrier. If zero failures, explicitly record "no fixes required" in the plan's progress note.
**DoD:** Entire audit suite PASSES (both new files). `renderer-bypass-parity.test.ts` still PASSES. Full `pnpm test` PASSES with 0 failures. If a fix was required, diff touches the single traced root-cause file and is mentioned in the commit body with the failing audit case ID.
**Verify:** `pnpm test` (must PASS).

### Task 3: Quality Gate

**Objective:** Lint, type check, and full-suite re-run (unit + E2E) to confirm no regressions introduced by the new tests, the store hook, or any Task-2 fixes. Performance audit: new test hook is guarded by NODE_ENV so it adds zero cost to production; confirm by reading the built bundle for the hook string.
**DoD:** `pnpm lint` clean; `pnpm exec tsc --noEmit` clean; `pnpm test` 0 failures; `pnpm test:e2e` 0 failures; `pnpm build` green; quick `grep __aurialisAudioStore .next` on a production build returns no matches (the guard stripped it). No `SPEC-DEBUG:` markers remain in the diff.
**Verify:** `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm test:e2e && pnpm build && ! grep -r "__aurialisAudioStore" .next/ 2>/dev/null`.
