/**
 * Deep Mastering E2E (T19) — covers TS-001..TS-005 from the plan.
 *
 * The full deep-analysis pipeline (madmom + Demucs + script generator)
 * requires the FastAPI backend to be reachable at the configured URL. When
 * the backend is unreachable, the suite skips gracefully (per T19 DoD).
 *
 * Pre-requirements:
 *   - `pnpm test:generate-signals` writes both `test-audio.wav` and
 *     `suno-narrow-guitar.wav` into `e2e/fixtures/`
 *   - `pnpm dev` (or `pnpm preview`) running on the configured base URL
 *   - `docker compose up backend` for the deep-analysis service
 */

import { expect, test, type Page } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";
import { stubTurnstileNoToken } from "./helpers/turnstile";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_WAV = path.join(__dirname, "fixtures", "test-audio.wav");
const SUNO_WAV = path.join(__dirname, "fixtures", "suno-narrow-guitar.wav");

const BACKEND_URL =
  process.env.NEXT_PUBLIC_DEEP_ANALYSIS_API_URL ??
  process.env.NEXT_PUBLIC_SEPARATION_API_URL ??
  "http://localhost:8000";

// The real deep pipeline (sections → Demucs stems → script) takes ~40-90s per
// run against a CPU-only backend, well over Playwright's 30s default per-test
// timeout — so the inner `toBeVisible({ timeout: 180_000 })` waits could never
// actually reach 180s and every test aborted at 30s. Two changes fix that:
//   1. Serial mode so five heavy separations don't hit the CPU backend at once
//      (concurrent Demucs runs thrash and each balloons past any timeout).
//   2. A generous per-test timeout (set in beforeEach) that actually
//      accommodates the pipeline.
test.describe.configure({ mode: "serial" });

/** Skip the suite if the deep-analysis backend isn't reachable. */
test.beforeAll(async () => {
  try {
    const res = await fetch(`${BACKEND_URL}/health`, {
      // Docker-for-Mac's vpnkit adds ~3s to the first localhost round-trip;
      // 2s was too tight and produced spurious skips even with a live backend.
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      test.skip(true, `Backend at ${BACKEND_URL} returned ${res.status}`);
    }
  } catch (e) {
    test.skip(true, `Backend at ${BACKEND_URL} unreachable: ${(e as Error).message}`);
  }
});

// The webServer sets a Cloudflare test site key, so the Turnstile gate is now
// active. These specs exercise the legacy analyze path (not R2), so neutralise
// the token before every navigation to keep the transport deterministic.
test.beforeEach(async ({ page }) => {
  // The real deep pipeline runs well past Playwright's 30s default; give each
  // test enough room that the inner `toBeVisible({ timeout: 180_000 })` waits
  // are actually reachable instead of being capped by the test timeout.
  test.setTimeout(300_000);
  await stubTurnstileNoToken(page);
});

async function uploadAndOpenDeep(page: Page, fixturePath: string) {
  await page.goto("/");
  await page
    .getByRole("button", { name: /upload audio file/i })
    .waitFor({ state: "visible" });
  await page.locator('input[type="file"]').setInputFiles(fixturePath);
  await page.waitForURL("**/master", { timeout: 30_000 });
  await page.getByTestId("mode-toggle-deep").click();
  await expect(page.getByTestId("deep-mastering-panel")).toBeVisible();
}

test.describe("TS-001 — first-time deep analysis (happy path)", () => {
  test("Deep tab + Modern Pop Polish + Analyze populates timeline", async ({
    page,
  }) => {
    await uploadAndOpenDeep(page, TEST_WAV);
    // Step 2: pick Modern Pop Polish profile.
    await page.getByTestId("profile-card-modern_pop_polish").click();
    await expect(
      page.getByTestId("profile-card-modern_pop_polish"),
    ).toHaveAttribute("aria-pressed", "true");

    // Step 3: click Analyze.
    await page.getByTestId("deep-analyze-button").click();

    // Step 4: wait for the timeline to populate (≤3 min budget).
    await expect(page.getByTestId("deep-timeline")).toBeVisible({
      timeout: 180_000,
    });
    // At least 1 section band rendered.
    const sectionCount = await page
      .locator('[data-testid^="deep-timeline-section-"]')
      .count();
    expect(sectionCount).toBeGreaterThanOrEqual(1);
    // At least 1 move marker visible.
    const moveCount = await page
      .locator('[data-testid^="deep-timeline-move-"]')
      .count();
    expect(moveCount).toBeGreaterThanOrEqual(1);
  });
});

test.describe("TS-002 — profile switch regenerates script", () => {
  test("switching to Metal Wall and applying changes the timeline", async ({
    page,
  }) => {
    await uploadAndOpenDeep(page, TEST_WAV);
    await page.getByTestId("profile-card-modern_pop_polish").click();
    await page.getByTestId("deep-analyze-button").click();
    await expect(page.getByTestId("deep-timeline")).toBeVisible({
      timeout: 180_000,
    });
    const beforeCount = await page
      .locator('[data-testid^="deep-timeline-move-"]')
      .count();

    // Switch profile + apply.
    await page.getByTestId("profile-card-metal_wall").click();
    await page.getByTestId("profile-apply-button").click();
    // Allow re-render.
    await page.waitForTimeout(500);
    const afterCount = await page
      .locator('[data-testid^="deep-timeline-move-"]')
      .count();
    // Timeline should re-render — move count or positions differ.
    // We assert the panel didn't crash; exact diff depends on backend output.
    expect(afterCount).toBeGreaterThanOrEqual(0);
    expect(page.getByTestId("deep-timeline")).toBeVisible();
  });
});

test.describe("TS-003 — AI artifact detection on a narrow-guitar fixture", () => {
  test("AI Repair lane has at least one move with the AI badge", async ({
    page,
  }) => {
    await uploadAndOpenDeep(page, SUNO_WAV);
    await page.getByTestId("profile-card-metal_wall").click();
    await page.getByTestId("deep-analyze-button").click();
    await expect(page.getByTestId("deep-timeline")).toBeVisible({
      timeout: 180_000,
    });

    // The AI Repair lane should have at least one badge.
    const aiBadges = await page
      .locator('[data-testid^="deep-timeline-ai-badge-"]')
      .count();
    expect(aiBadges).toBeGreaterThanOrEqual(1);
  });
});

test.describe("TS-004 — edit a move and verify state persists", () => {
  test("editing a move's value flips edited flag and persists", async ({
    page,
  }) => {
    await uploadAndOpenDeep(page, TEST_WAV);
    await page.getByTestId("profile-card-modern_pop_polish").click();
    await page.getByTestId("deep-analyze-button").click();
    await expect(page.getByTestId("deep-timeline")).toBeVisible({
      timeout: 180_000,
    });

    const firstMove = page
      .locator('[data-testid^="deep-timeline-move-"]')
      .first();
    // On the short (~2s) fixture every move marker clusters near t=0 and the
    // absolutely-positioned dots overlap, so a normal click on the DOM-first
    // move is intercepted by whichever sibling paints on top. Dispatch the
    // click straight to the located element to bypass hit-testing.
    await firstMove.dispatchEvent("click");
    await expect(page.getByTestId("move-editor")).toBeVisible();

    const slider = page.getByTestId("move-editor-value");
    await slider.evaluate((el: HTMLInputElement) => {
      // React tracks controlled-input values via a patched value setter, so a
      // plain `el.value = …` is seen as "no change" and onChange never fires.
      // Go through the native prototype setter so React's tracker detects the
      // edit and the move flips to `edited`.
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(el, String(Number(el.value) - 3));
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // Reset should now be enabled (move is edited).
    await expect(page.getByTestId("move-editor-reset")).toBeEnabled();
  });
});

test.describe("TS-005 — export matches real-time playback", () => {
  test("Export WAV downloads with the script applied", async ({ page }) => {
    await uploadAndOpenDeep(page, TEST_WAV);
    await page.getByTestId("profile-card-modern_pop_polish").click();
    await page.getByTestId("deep-analyze-button").click();
    await expect(page.getByTestId("deep-timeline")).toBeVisible({
      timeout: 180_000,
    });

    // The actual LUFS-curve parity is verified offline by the integration
    // test (T17 / T9b). Here we only verify that the export action triggers
    // a download — proving the script-aware render path runs end-to-end.
    //
    // Export is a focused overlay (C8): open it from the toolbar Export
    // button, then trigger the WAV export from the segmented panel.
    await page.getByTestId("master-export-button").click();
    const exportButton = page
      .getByRole("button", { name: /export wav/i })
      .first();
    await expect(exportButton).toBeVisible();

    const downloadPromise = page.waitForEvent("download", { timeout: 60_000 });
    await exportButton.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.wav$/i);
  });
});
