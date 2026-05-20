/**
 * Pro Mode toggle — Phase 5 of the Direction A redesign.
 *
 * Verifies:
 *   - sidebar Pro Mode toggle is OFF by default
 *   - clicking the toggle persists via zustand-persist (localStorage)
 *   - turning Pro Mode ON reveals the Goniometer on /master
 *   - turning Pro Mode OFF hides the Goniometer
 */

import { expect, test } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";
import { clearLibraryStorage } from "./helpers/library-cleanup";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_WAV = path.join(__dirname, "fixtures", "test-audio.wav");

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').waitFor({ state: "attached" });
  await clearLibraryStorage(page);
  // Also clear the persisted settings store so each test starts with proMode=false.
  await page.evaluate(() => {
    localStorage.removeItem("aurialis-settings-v1");
  });
  await page.reload();
  await page.locator('input[type="file"]').waitFor({ state: "attached" });
});

test("Pro Mode toggle is off by default and persists when toggled on", async ({ page }) => {
  const toggle = page.getByTestId("pro-mode-toggle");
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  const persisted = await page.evaluate(() =>
    localStorage.getItem("aurialis-settings-v1"),
  );
  expect(persisted).not.toBeNull();
  expect(JSON.parse(persisted!).state.proMode).toBe(true);

  // Reload — toggle remains ON.
  await page.reload();
  await expect(page.getByTestId("pro-mode-toggle")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("Pro Mode reveals the Goniometer on /master, hides it when off", async ({ page }) => {
  // Upload + navigate to /master.
  await page.locator('input[type="file"]').setInputFiles(TEST_WAV);
  await page.waitForURL("**/master", { timeout: 30000 });
  await expect(page.getByTestId("master-right-rail")).toBeAttached();

  // Pro Mode is OFF — no Goniometer.
  await expect(page.getByTestId("master-goniometer-slot")).toHaveCount(0);

  // Flip Pro Mode on via the store directly (sidebar isn't on /master).
  await page.evaluate(() => {
    const w = window as unknown as {
      __aurialisSettingsStore?: typeof import("@/lib/stores/settings-store").useSettingsStore;
    };
    if (w.__aurialisSettingsStore) {
      w.__aurialisSettingsStore.getState().setProMode(true);
    } else {
      // Fallback: write directly to localStorage and reload.
      localStorage.setItem(
        "aurialis-settings-v1",
        JSON.stringify({ state: { proMode: true }, version: 0 }),
      );
    }
  });

  // Re-check after a tick (zustand fires async re-render).
  await expect(page.getByTestId("master-goniometer-slot")).toBeVisible({
    timeout: 5_000,
  });

  // Flip off via direct call → hides again.
  await page.evaluate(() => {
    const w = window as unknown as {
      __aurialisSettingsStore?: typeof import("@/lib/stores/settings-store").useSettingsStore;
    };
    if (w.__aurialisSettingsStore) {
      w.__aurialisSettingsStore.getState().setProMode(false);
    } else {
      localStorage.setItem(
        "aurialis-settings-v1",
        JSON.stringify({ state: { proMode: false }, version: 0 }),
      );
      location.reload();
    }
  });
  await expect(page.getByTestId("master-goniometer-slot")).toHaveCount(0, {
    timeout: 5_000,
  });
});
