import { expect, test, type Page } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Phase 4a (plan: docs/plans/2026-04-23-dsp-p4-triage.md) E2E coverage.
 * Scenarios TS-003, TS-004 from the plan.
 */

test.describe.configure({ mode: "serial" });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_WAV = path.join(__dirname, "fixtures", "test-audio.wav");

async function uploadAndNavigate(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: /upload audio file/i })
    .waitFor({ state: "visible" });
  await page.locator('input[type="file"]').setInputFiles(TEST_WAV);
  await page.waitForURL("**/master", { timeout: 30000 });
}

async function showAdvanced(page: Page) {
  await page.getByTestId("mode-toggle-advanced").click();
  await expect(page.getByTestId("mode-toggle-advanced")).toHaveAttribute(
    "aria-pressed",
    "true"
  );
}

const STAGE_PILLS = [
  "bypass-pill-eq",
  "bypass-pill-compressor",
  "bypass-pill-multiband",
  "bypass-pill-saturation",
  "bypass-pill-stereo-width",
  "bypass-pill-limiter",
];

test.describe("Phase 4a DSP polish — per-stage bypass pills (TS-003, TS-004)", () => {
  test.beforeEach(async ({ page }) => {
    await uploadAndNavigate(page);
    await showAdvanced(page);
  });

  test("TS-003: all six stage sections render a BypassPill, and each toggles independently", async ({
    page,
  }) => {
    for (const testId of STAGE_PILLS) {
      const pill = page.getByTestId(testId);
      await expect(pill, `pill ${testId} should be visible`).toBeVisible();

      const initial = await pill.getAttribute("aria-pressed");
      await pill.click();
      const afterFirst = await pill.getAttribute("aria-pressed");
      expect(
        afterFirst,
        `clicking ${testId} should flip aria-pressed`
      ).not.toBe(initial);

      // Click back to restore
      await pill.click();
      const afterSecond = await pill.getAttribute("aria-pressed");
      expect(afterSecond, `${testId} should return to initial`).toBe(initial);
    }
  });

  test("TS-004: global ABToggle bypasses chain; per-stage pills persist across global toggles", async ({
    page,
  }) => {
    // Bypass two per-stage pills first (Compressor, Multiband)
    const compPill = page.getByTestId("bypass-pill-compressor");
    const mbPill = page.getByTestId("bypass-pill-multiband");

    // Note initial states (defaults vary by genre)
    const compInitial = await compPill.getAttribute("aria-pressed");
    const mbInitial = await mbPill.getAttribute("aria-pressed");

    // Flip each to opposite state
    await compPill.click();
    await mbPill.click();
    const compAfter = await compPill.getAttribute("aria-pressed");
    const mbAfter = await mbPill.getAttribute("aria-pressed");
    expect(compAfter).not.toBe(compInitial);
    expect(mbAfter).not.toBe(mbInitial);

    // Toggle global A/B bypass on, then off
    const abToggle = page.getByTestId("ab-toggle");
    await abToggle.click();
    await expect(abToggle).toHaveAttribute("aria-pressed", "true");
    await abToggle.click();
    await expect(abToggle).toHaveAttribute("aria-pressed", "false");

    // Per-stage pill states must be unchanged by global A/B (independent
    // bypass paths — global rewires the chain boundary, per-stage flips the
    // node's enabled flag).
    expect(await compPill.getAttribute("aria-pressed")).toBe(compAfter);
    expect(await mbPill.getAttribute("aria-pressed")).toBe(mbAfter);
  });

  test("TS-003b: transport MB L/M/H readout is visible", async ({ page }) => {
    // Mobile breakpoint may collapse transport stats; at xl+ the readout is
    // in the top-right stats column and always rendered.
    const readout = page.getByTestId("mb-gr-readout");
    await expect(readout).toBeVisible();
  });
});
