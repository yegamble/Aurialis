import { expect, test, type Page } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

test.describe.configure({ mode: "serial" });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_WAV = path.join(__dirname, "fixtures", "test-audio.wav");
const STEMS_DIR = path.join(__dirname, "fixtures", "stems");

const STEM_FILES = [
  path.join(STEMS_DIR, "bass.wav"),
  path.join(STEMS_DIR, "vocals.wav"),
];

async function uploadMasterAndShowAdvanced(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: /upload audio file/i })
    .waitFor({ state: "visible" });
  await page.locator('input[type="file"]').setInputFiles(TEST_WAV);
  await page.waitForURL("**/master", { timeout: 30000 });
  await page.getByTestId("mode-toggle-advanced").click();
  await expect(page.getByTestId("mode-toggle-advanced")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText("Parametric EQ").first()).toBeVisible();
}

async function readStoreParam(
  page: Page,
  key: string,
): Promise<number | undefined> {
  return await page.evaluate((k) => {
    const w = window as unknown as {
      __aurialisAudioStore?: { getState: () => { params: Record<string, number> } };
    };
    if (!w.__aurialisAudioStore) {
      throw new Error(
        "window.__aurialisAudioStore is not exposed — NODE_ENV=production or hook missing",
      );
    }
    return w.__aurialisAudioStore.getState().params[k];
  }, key);
}

interface BypassPill {
  testid: string;
  key: string;
}

// Authoritative list of every bypass pill rendered by AdvancedMastering.
// Keep in sync with src/components/mastering/AdvancedMastering.tsx.
// The test asserts the semantic invariant (aria-pressed === (param === 0))
// rather than a hardcoded default — the /master page applies a genre preset
// on mount, so the runtime "default" depends on `genre="pop"` + intensity.
const BYPASS_PILLS: readonly BypassPill[] = [
  { testid: "bypass-pill-compressor", key: "compressorEnabled" },
  { testid: "bypass-pill-multiband", key: "multibandEnabled" },
  { testid: "bypass-pill-eq", key: "parametricEqEnabled" },
  { testid: "bypass-pill-saturation", key: "saturationEnabled" },
  { testid: "bypass-pill-stereo-width", key: "stereoWidthEnabled" },
  { testid: "bypass-pill-limiter", key: "limiterEnabled" },
] as const;

async function readPillState(
  page: Page,
  testid: string,
  paramKey: string,
): Promise<{ ariaPressed: boolean; text: string; paramValue: number }> {
  const button = page.getByTestId(testid).first();
  const ariaPressedRaw = await button.getAttribute("aria-pressed");
  const text = (await button.textContent())?.trim() ?? "";
  const paramValue = (await readStoreParam(page, paramKey)) ?? NaN;
  return {
    ariaPressed: ariaPressedRaw === "true",
    text,
    paramValue,
  };
}

test.describe("Toggle Audit — Mastering bypass pills round-trip", () => {
  test.beforeEach(async ({ page }) => {
    await uploadMasterAndShowAdvanced(page);
  });

  for (const pill of BYPASS_PILLS) {
    test(`${pill.testid} flips UI + store param and restores on second click`, async ({
      page,
    }) => {
      const button = page.getByTestId(pill.testid).first();
      await expect(button).toBeVisible();

      // Invariant: aria-pressed=true (label "Bypassed") iff param===0.
      const initial = await readPillState(page, pill.testid, pill.key);
      expect(
        initial.ariaPressed,
        `${pill.testid} initial: aria-pressed should mirror (${pill.key} === 0)`,
      ).toBe(initial.paramValue === 0);
      expect(initial.text).toBe(initial.ariaPressed ? "Bypassed" : "Bypass");

      // Click once: both visual state AND store param flip.
      await button.click();
      await expect(button).toHaveAttribute(
        "aria-pressed",
        String(!initial.ariaPressed),
      );
      const flipped = await readPillState(page, pill.testid, pill.key);
      expect(flipped.ariaPressed).toBe(!initial.ariaPressed);
      expect(flipped.paramValue).toBe(initial.paramValue === 0 ? 1 : 0);
      expect(flipped.text).toBe(flipped.ariaPressed ? "Bypassed" : "Bypass");

      // Click again: restored.
      await button.click();
      await expect(button).toHaveAttribute(
        "aria-pressed",
        String(initial.ariaPressed),
      );
      const restored = await readPillState(page, pill.testid, pill.key);
      expect(restored.ariaPressed).toBe(initial.ariaPressed);
      expect(restored.paramValue).toBe(initial.paramValue);
      expect(restored.text).toBe(initial.text);
    });
  }
});

test.describe("Toggle Audit — Global A/B toggle", () => {
  test.beforeEach(async ({ page }) => {
    // ABToggle is in the transport bar and visible in both simple and
    // advanced modes — no need to switch modes.
    await page.goto("/");
    await page
      .getByRole("button", { name: /upload audio file/i })
      .waitFor({ state: "visible" });
    await page.locator('input[type="file"]').setInputFiles(TEST_WAV);
    await page.waitForURL("**/master", { timeout: 30000 });
  });

  test("ab-toggle starts as Processed, flips to Bypass, restores", async ({
    page,
  }) => {
    const button = page.getByTestId("ab-toggle");
    await expect(button).toBeVisible();

    // Initial: processed (aria-pressed=false, label contains "Processed")
    await expect(button).toHaveAttribute("aria-pressed", "false");
    await expect(button).toContainText("Processed");

    // Click: bypass (aria-pressed=true, label contains "Bypass")
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(button).toContainText("Bypass");

    // Click: restored
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "false");
    await expect(button).toContainText("Processed");
  });
});

test.describe("Toggle Audit — Stem mute in /mix", () => {
  test("mute button flips aria-pressed and restores on second click", async ({
    page,
  }) => {
    await page.goto("/mix");
    await page
      .getByTestId("stem-upload-zone")
      .waitFor({ state: "visible", timeout: 15000 });
    await page.locator('input[type="file"]').setInputFiles(STEM_FILES);
    await page.waitForSelector('[data-testid="stem-timeline"]', {
      timeout: 30000,
    });

    const muteBtn = page.getByRole("button", { name: /mute/i }).first();
    await expect(muteBtn).toBeVisible();
    await expect(muteBtn).toHaveAttribute("aria-pressed", "false");

    await muteBtn.click();
    await expect(muteBtn).toHaveAttribute("aria-pressed", "true");

    await muteBtn.click();
    await expect(muteBtn).toHaveAttribute("aria-pressed", "false");
  });
});
