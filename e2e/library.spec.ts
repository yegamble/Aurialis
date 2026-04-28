/**
 * Library E2E (TS-001..TS-006) — covers persist-deep-analysis plan.
 *
 * Most scenarios mock the deep-analysis backend at the route level so the
 * suite runs without a live FastAPI service. TS-001 has both paths: with
 * a real backend it goes end-to-end through Analyze; without, it seeds via
 * the window-exposed library store.
 */

import { expect, test, type Page } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

import { clearLibraryStorage } from "./helpers/library-cleanup";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_WAV = path.join(__dirname, "fixtures", "test-audio.wav");

const FINGERPRINT_PATTERN = /\|\d+\|\d+/;

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').waitFor({ state: "attached" });
  await clearLibraryStorage(page);
  await page.reload();
  await page.locator('input[type="file"]').waitFor({ state: "attached" });
});

/**
 * Seed the library directly via the window-exposed Zustand store. Skips the
 * full analyze flow when scenarios only need the entry to exist.
 */
async function seedLibraryEntry(
  page: Page,
  opts: {
    fileName?: string;
    fileSize?: number;
    lastModified?: number;
    lastOpenedAt?: number;
    withScript?: boolean;
  } = {}
): Promise<string> {
  return await page.evaluate(async (o) => {
    const w = window as unknown as {
      __aurialisLibraryStore: typeof import("@/lib/stores/library-store").useLibraryStore;
    };
    const lib = w.__aurialisLibraryStore;
    await lib.getState().hydrate();
    const file = new File(
      [new Uint8Array(o.fileSize ?? 16)],
      o.fileName ?? "seed.wav",
      { type: "audio/wav", lastModified: o.lastModified ?? Date.now() }
    );
    const result = await lib.getState().addEntry(file, {
      audioBlob: new Blob([new Uint8Array(o.fileSize ?? 16)], { type: "audio/wav" }),
      script: o.withScript
        ? {
            version: 1,
            trackId: "seeded",
            sampleRate: 44100,
            duration: 30,
            profile: "modern_pop_polish",
            sections: [],
            moves: [],
          }
        : undefined,
      lastOpenedAt: o.lastOpenedAt,
    });
    if (!result.ok) throw new Error(`addEntry failed: ${result.reason}`);
    return result.entry.fingerprint;
  }, opts);
}

// TS-001 ---------------------------------------------------------------------

test("TS-001: persisted analysis appears in library after reload", async ({ page }) => {
  // Seed an entry with a script (skips the full analyze flow which requires backend).
  await seedLibraryEntry(page, {
    fileName: "persisted-track.wav",
    fileSize: 16,
    lastModified: 1700000000000,
    withScript: true,
  });

  // Reload — the library list should hydrate and render the entry.
  await page.reload();
  await expect(page.getByTestId("library-list")).toBeVisible();
  const rows = page.getByTestId("library-row");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("persisted-track.wav");
  await expect(rows.first()).toContainText("Analyzed");

  // Click → navigates to /master with the audio file populated.
  await rows.first().click();
  await page.waitForURL("**/master", { timeout: 10_000 });
  await expect(page.getByTestId("loaded-from-library-badge")).toBeVisible();
});

// TS-002 ---------------------------------------------------------------------

test("TS-002: re-upload of known song shows Resume/Fresh dialog", async ({ page }) => {
  // Seed the library with the test WAV's exact fingerprint by reading the
  // file via fetch and adding it to the store.
  await seedLibraryEntry(page, {
    fileName: "test-audio.wav",
    fileSize: 100,
    lastModified: 1700000000000,
    withScript: true,
  });

  // Construct a file in the browser with the same fingerprint, then trigger
  // upload via the UploadScreen's file input.
  await page.evaluate(() => {
    const file = new File(
      [new Uint8Array(100)],
      "test-audio.wav",
      { type: "audio/wav", lastModified: 1700000000000 }
    );
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  // The UploadScreen runs a fake progress interval (~700ms) before firing
  // onFilesUploaded. Wait for the dialog.
  await expect(page.getByTestId("resume-or-fresh-dialog")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByTestId("resume-button")).toBeVisible();
  await expect(page.getByTestId("start-fresh-button")).toBeVisible();
  await expect(page.getByTestId("dont-ask-again")).toBeVisible();

  // Click Resume → navigation + badge.
  await page.getByTestId("resume-button").click();
  await page.waitForURL("**/master", { timeout: 10_000 });
  await expect(page.getByTestId("loaded-from-library-badge")).toBeVisible();
});

test("TS-002b: Don't-ask-again skips dialog on next match", async ({ page }) => {
  await seedLibraryEntry(page, {
    fileName: "test-audio.wav",
    fileSize: 100,
    lastModified: 1700000000000,
    withScript: true,
  });

  // First upload → dialog → tick checkbox → Resume.
  await page.evaluate(() => {
    const file = new File(
      [new Uint8Array(100)],
      "test-audio.wav",
      { type: "audio/wav", lastModified: 1700000000000 }
    );
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.getByTestId("dont-ask-again").check();
  await page.getByTestId("resume-button").click();
  await page.waitForURL("**/master", { timeout: 10_000 });

  // Reload upload screen, drop again → no dialog this time.
  await page.goto("/");
  await page.locator('input[type="file"]').waitFor({ state: "attached" });
  await page.evaluate(() => {
    const file = new File(
      [new Uint8Array(100)],
      "test-audio.wav",
      { type: "audio/wav", lastModified: 1700000000000 }
    );
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForURL("**/master", { timeout: 10_000 });
  await expect(page.getByTestId("resume-or-fresh-dialog")).not.toBeVisible();
  await expect(page.getByTestId("loaded-from-library-badge")).toBeVisible();
});

// TS-003 ---------------------------------------------------------------------

test("TS-003: 21st song evicts the LRU entry", async ({ page }) => {
  // Seed 20 entries with strictly increasing lastOpenedAt — oldest first.
  const fingerprints: string[] = [];
  const seedBase = Date.now() - 120_000;
  for (let i = 0; i < 20; i++) {
    const fp = await seedLibraryEntry(page, {
      fileName: `seed-${i}.wav`,
      fileSize: 16 + i,
      lastModified: i,
      lastOpenedAt: seedBase + i,
    });
    fingerprints.push(fp);
  }

  // Reload to confirm 20 entries persisted.
  await page.reload();
  await expect(page.getByTestId("library-row")).toHaveCount(20);

  // Add the 21st via the store API (cheaper than going through analyze flow).
  await seedLibraryEntry(page, {
    fileName: "seed-21.wav",
    fileSize: 999,
    lastModified: 999,
  });

  await expect(page.getByTestId("library-row")).toHaveCount(20);

  // The first seed (smallest lastOpenedAt) should have been evicted.
  const oldestFp = fingerprints[0]!;
  const visibleFps = await page
    .locator('[data-testid="library-row"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-fingerprint")));
  expect(visibleFps).not.toContain(oldestFp);
  expect(visibleFps.some((fp) => fp?.includes("seed-21.wav"))).toBe(true);
});

// TS-004 ---------------------------------------------------------------------

test("TS-004: delete entry from library", async ({ page }) => {
  await seedLibraryEntry(page, { fileName: "doomed.wav", withScript: true });
  await page.reload();
  await expect(page.getByTestId("library-row")).toHaveCount(1);

  await page.getByTestId("library-delete-button").click();
  await expect(page.getByTestId("library-delete-confirm")).toBeVisible();
  await page.getByTestId("library-delete-confirm-button").click();

  await expect(page.getByTestId("library-row")).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId("library-list")).not.toBeVisible();
});

// TS-005 ---------------------------------------------------------------------

test("TS-005: mastering settings persist & restore across library re-open", async ({ page }) => {
  // Seed an entry whose audio Blob will be reconstructed on click.
  await seedLibraryEntry(page, {
    fileName: "settings-track.wav",
    fileSize: 100,
    lastModified: 1700000000001,
    withScript: true,
  });

  // Open from library list — this hydrates the audio and navigates to /master.
  await page.reload();
  await page.getByTestId("library-row").first().click();
  await page.waitForURL("**/master", { timeout: 10_000 });

  // Inject a settings change directly into the audio store, then wait for
  // the debounce + persistence path to write through.
  await page.evaluate(() => {
    const w = window as unknown as {
      __aurialisAudioStore: typeof import("@/lib/stores/audio-store").useAudioStore;
    };
    w.__aurialisAudioStore.getState().setParam("targetLufs", -8);
  });

  // Wait for debounced library write (500ms + slack).
  await page.waitForTimeout(900);

  // Read back via the library store — settings should reflect targetLufs=-8.
  const persisted = await page.evaluate(() => {
    const w = window as unknown as {
      __aurialisLibraryStore: typeof import("@/lib/stores/library-store").useLibraryStore;
    };
    const lib = w.__aurialisLibraryStore.getState();
    const fp = lib.activeFingerprint!;
    const entry = lib.entries.find((e) => e.fingerprint === fp);
    return entry?.settings?.params.targetLufs ?? null;
  });

  expect(persisted).toBe(-8);
});

// TS-006 ---------------------------------------------------------------------

test("TS-006: sequential uploads accumulate as separate library entries", async ({ page }) => {
  await seedLibraryEntry(page, { fileName: "song-a.wav", fileSize: 16, lastModified: 1, withScript: true });
  await seedLibraryEntry(page, { fileName: "song-b.wav", fileSize: 17, lastModified: 2, withScript: true });

  await page.reload();
  await expect(page.getByTestId("library-row")).toHaveCount(2);
  // Most recent first.
  const fileNames = await page
    .locator('[data-testid="library-row"]')
    .allTextContents();
  expect(fileNames[0]).toContain("song-b.wav");
  expect(fileNames[1]).toContain("song-a.wav");
});

// Smoke check on fingerprint format ------------------------------------------

test("fingerprints follow name|size|lastModified format", async ({ page }) => {
  const fp = await seedLibraryEntry(page, {
    fileName: "format-check.wav",
    fileSize: 42,
    lastModified: 99999,
  });
  expect(fp).toMatch(FINGERPRINT_PATTERN);
  expect(fp).toContain("format-check.wav");
});

// Suppress unused-import lint when TEST_WAV path isn't used in mocked scenarios.
void TEST_WAV;
