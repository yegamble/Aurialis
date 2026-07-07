/**
 * Smart Master Album E2E.
 *
 * Covers the /album screen: the empty state, rows seeded from library entries,
 * the loudness chart appearing once a measured LUFS exists, and the headline
 * "Master entire album" flow producing a ZIP download.
 *
 * Entries are seeded directly through the window-exposed library store (same
 * pattern as library.spec.ts) so the suite runs without the analysis backend.
 * The master-all download test seeds a *real* decodable WAV as the entry's OPFS
 * audio so the offline renderer has something to process; if the headless
 * browser cannot complete the offline render it fails loudly rather than
 * silently passing.
 */

import { expect, test, type Page } from "@playwright/test";
import path from "path";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";

import { clearLibraryStorage } from "./helpers/library-cleanup";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_WAV = path.join(__dirname, "fixtures", "test-audio.wav");
const TEST_WAV_B64 = readFileSync(TEST_WAV).toString("base64");

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').waitFor({ state: "attached" });
  await clearLibraryStorage(page);
  await page.reload();
  await page.locator('input[type="file"]').waitFor({ state: "attached" });
});

/**
 * Seed a library entry with real WAV audio and (optionally) a measured LUFS so
 * it counts as "analyzed". Returns the fingerprint.
 */
async function seedAnalyzedEntry(
  page: Page,
  opts: { fileName: string; measuredLufs?: number | null; wavBase64: string },
): Promise<string> {
  return await page.evaluate(async (o) => {
    const w = window as unknown as {
      __aurialisLibraryStore: typeof import("@/lib/stores/library-store").useLibraryStore;
    };
    const lib = w.__aurialisLibraryStore;
    await lib.getState().hydrate();

    const bin = atob(o.wavBase64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);

    const file = new File([bytes], o.fileName, { type: "audio/wav" });
    const blob = new Blob([bytes], { type: "audio/wav" });
    const res = await lib.getState().addEntry(file, {
      audioBlob: blob,
      durationSec: 8,
    });
    if (!res.ok) throw new Error(`addEntry failed: ${res.reason}`);
    if (o.measuredLufs !== null && o.measuredLufs !== undefined) {
      await lib.getState().updateMeasuredLufs(res.entry.fingerprint, o.measuredLufs);
    }
    return res.entry.fingerprint;
  }, opts);
}

test("empty state: hero, disabled master-all, target readout", async ({ page }) => {
  await page.goto("/album");
  await expect(page.getByTestId("album-hero")).toBeVisible();
  await expect(page.getByTestId("album-empty")).toBeVisible();
  await expect(page.getByTestId("album-target-lufs")).toBeVisible();
  await expect(page.getByTestId("album-master-all")).toBeDisabled();
});

test("rows render from seeded library entries", async ({ page }) => {
  await seedAnalyzedEntry(page, {
    fileName: "seed-one.wav",
    measuredLufs: -10,
    wavBase64: TEST_WAV_B64,
  });
  await page.goto("/album");
  const rows = page.getByTestId("album-track-row");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("seed-one");
});

test("loudness chart renders once a measured LUFS exists", async ({ page }) => {
  await seedAnalyzedEntry(page, {
    fileName: "measured.wav",
    measuredLufs: -9.2,
    wavBase64: TEST_WAV_B64,
  });
  await page.goto("/album");
  await expect(page.getByTestId("album-lufs-chart")).toBeVisible();
  await expect(page.getByTestId("album-lufs-bar")).toHaveCount(1);
});

test("master-all downloads a ZIP for an analyzed entry", async ({ page }) => {
  await seedAnalyzedEntry(page, {
    fileName: "to-master.wav",
    measuredLufs: -10,
    wavBase64: TEST_WAV_B64,
  });
  await page.goto("/album");

  const masterBtn = page.getByTestId("album-master-all");
  await expect(masterBtn).toBeEnabled();

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    masterBtn.click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/mastered\.zip$/);
  // progress surfaced during the run
  await expect(page.getByTestId("album-master-progress")).toBeVisible();
});
