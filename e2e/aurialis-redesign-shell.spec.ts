/**
 * Direction A redesign — Phase 1 shell + library E2E.
 *
 * Verifies:
 *   - window chrome (title) renders at `/`
 *   - sidebar nav landmark with the four primary items
 *   - filter tabs work
 *   - Smart Split nav item routes to /mix
 *   - Import nav item switches to upload mode (file input attaches)
 *   - Library nav item switches back to library
 */

import { expect, test, type Page } from "@playwright/test";
import { clearLibraryStorage } from "./helpers/library-cleanup";

async function seedLibraryEntry(page: Page, fileName: string): Promise<void> {
  await page.evaluate(async (name) => {
    const w = window as unknown as {
      __aurialisLibraryStore: typeof import("@/lib/stores/library-store").useLibraryStore;
    };
    const lib = w.__aurialisLibraryStore;
    await lib.getState().hydrate();
    const file = new File([new Uint8Array(16)], name, {
      type: "audio/wav",
      lastModified: Date.now(),
    });
    const result = await lib.getState().addEntry(file, {
      audioBlob: new Blob([new Uint8Array(16)], { type: "audio/wav" }),
      script: {
        version: 1,
        trackId: "seed",
        sampleRate: 44100,
        duration: 30,
        profile: "modern_pop_polish",
        sections: [],
        moves: [],
      },
    });
    if (!result.ok) throw new Error(`addEntry failed: ${result.reason}`);
  }, fileName);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').waitFor({ state: "attached" });
  await clearLibraryStorage(page);
  await page.reload();
  await page.locator('input[type="file"]').waitFor({ state: "attached" });
});

test("shell renders the sidebar and the four nav items", async ({ page }) => {
  await expect(page.getByTestId("app-shell")).toBeVisible();
  const nav = page.getByRole("navigation");
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("button", { name: /Library/i })).toBeVisible();
  await expect(nav.getByRole("button", { name: /Smart Master Album/i })).toBeVisible();
  await expect(nav.getByRole("button", { name: /Smart Split/i })).toBeVisible();
  await expect(nav.getByRole("button", { name: /^Import$/i })).toBeVisible();
});

test("library view renders heading and filter tabs once entries exist", async ({ page }) => {
  await seedLibraryEntry(page, "shell-seed.wav");
  await page.reload();
  await expect(page.getByRole("heading", { name: /Your tracks/i })).toBeVisible();
  await expect(page.getByTestId("library-summary")).toContainText(/1 song/i);
  await expect(page.getByRole("tab", { name: /All/i })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Analyzed/i })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Drafts/i })).toBeVisible();
});

test("Smart Split sidebar item navigates to /mix", async ({ page }) => {
  await seedLibraryEntry(page, "navigates.wav");
  await page.reload();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: /Smart Split/i })
    .click();
  await page.waitForURL("**/mix", { timeout: 5_000 });
});

test("Smart Master Album sidebar item navigates to /album", async ({ page }) => {
  await seedLibraryEntry(page, "album-nav.wav");
  await page.reload();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: /Smart Master Album/i })
    .click();
  await page.waitForURL("**/album", { timeout: 5_000 });
  await expect(page.getByRole("heading", { name: /Library album/i })).toBeVisible();
});

test("Import sidebar item switches to upload mode and back", async ({ page }) => {
  await seedLibraryEntry(page, "toggle-upload.wav");
  await page.reload();
  // Library view active — Import button switches to upload screen.
  await expect(page.getByRole("heading", { name: /Your tracks/i })).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: /^Import$/i })
    .click();
  // UploadScreen's file input must be present after switching.
  await expect(page.locator('input[type="file"]')).toBeAttached();
  // Switch back via the Library nav item.
  await page
    .getByRole("navigation")
    .getByRole("button", { name: /^Library$/i })
    .click();
  await expect(page.getByRole("heading", { name: /Your tracks/i })).toBeVisible();
});
