import { expect, test, type Page } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STEMS_DIR = path.join(__dirname, "fixtures", "stems");
const STEMS_ZIP = path.join(__dirname, "fixtures", "stems.zip");
const MIXED_TRACK = path.join(__dirname, "fixtures", "stems", "vocals.wav"); // single file for separation test

const STEM_FILES = [
  path.join(STEMS_DIR, "bass.wav"),
  path.join(STEMS_DIR, "vocals.wav"),
  path.join(STEMS_DIR, "drums.wav"),
  path.join(STEMS_DIR, "guitar.wav"),
];

// Check if backend is available before running separation tests
let backendAvailable = false;

test.beforeAll(async () => {
  try {
    const response = await fetch("http://localhost:8000/health");
    backendAvailable = response.ok;
  } catch {
    backendAvailable = false;
  }
});

async function navigateToMix(page: Page) {
  await page.goto("/mix");
  await page.getByTestId("stem-upload-zone").waitFor({
    state: "visible",
    timeout: 15000,
  });
}

// TS-004: Multi-File Upload Bypass (no separation needed)
test.describe("TS-004: Multi-File Upload Bypass", () => {
  test("multi-file upload goes directly to mixer", async ({ page }) => {
    await navigateToMix(page);

    await page.locator('input[type="file"]').setInputFiles(STEM_FILES);
    await page.waitForSelector('[data-testid="stem-timeline"]', {
      timeout: 30000,
    });

    // Verify no separation progress shown — stems load directly
    const timeline = page.getByTestId("stem-timeline");
    await expect(timeline.getByText("bass.wav")).toBeVisible();
    await expect(timeline.getByText("vocals.wav")).toBeVisible();
    await expect(page.getByText(/4 stems loaded/i)).toBeVisible();
  });

  test("ZIP upload goes directly to mixer", async ({ page }) => {
    await navigateToMix(page);

    await page.locator('input[type="file"]').setInputFiles(STEMS_ZIP);
    await page.waitForSelector('[data-testid="stem-timeline"]', {
      timeout: 30000,
    });

    const timeline = page.getByTestId("stem-timeline");
    await expect(timeline.getByText("bass.wav")).toBeVisible();
    await expect(page.getByText(/4 stems loaded/i)).toBeVisible();
  });
});

// TS-001: Single File → Separation → Mixer (requires Docker backend)
test.describe("TS-001: Single File Separation", () => {
  test.skip(!backendAvailable, "Separation backend not available — run docker compose up");

  test("single file upload shows model selection", async ({ page }) => {
    await navigateToMix(page);

    await page.locator('input[type="file"]').setInputFiles(MIXED_TRACK);

    // Model selection should appear
    await expect(page.getByText(/4 Stems/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/6 Stems/i)).toBeVisible();
  });

  test("selecting model starts separation with progress", async ({ page }) => {
    await navigateToMix(page);

    await page.locator('input[type="file"]').setInputFiles(MIXED_TRACK);
    await expect(page.getByText(/4 Stems/i)).toBeVisible({ timeout: 10000 });

    // Select 4 stems
    await page.getByText(/4 Stems/i).click();

    // Should show separation progress
    await expect(page.getByText(/separating/i)).toBeVisible({ timeout: 10000 });

    // Wait for completion (Demucs can take 20-60s on GPU, longer on CPU)
    await page.waitForSelector('[data-testid="stem-timeline"]', {
      timeout: 300000, // 5 min max for CPU
    });

    // Stems should appear
    const timeline = page.getByTestId("stem-timeline");
    await expect(timeline.getByText("vocals.wav")).toBeVisible();
    await expect(timeline.getByText("drums.wav")).toBeVisible();
  });

  test("skip separation loads as single track", async ({ page }) => {
    await navigateToMix(page);

    await page.locator('input[type="file"]').setInputFiles(MIXED_TRACK);
    await expect(page.getByText(/skip separation/i)).toBeVisible({ timeout: 10000 });

    await page.getByText(/skip separation/i).click();

    // Should load as single stem in mixer
    await page.waitForSelector('[data-testid="stem-timeline"]', {
      timeout: 30000,
    });
  });
});

// TS-005: Backend Health (requires Docker)
test.describe("TS-005: Backend Health", () => {
  test.skip(!backendAvailable, "Separation backend not available");

  test("backend health endpoint returns ok", async ({ request }) => {
    const response = await request.get("http://localhost:8000/health");
    expect(response.ok()).toBe(true);

    const data = await response.json();
    expect(data.status).toBe("ok");
    expect(data.models).toContain("htdemucs");
  });
});

// Smart Repair toggle
test.describe("Smart Repair UI", () => {
  test("Smart Repair toggle visible when stems loaded", async ({ page }) => {
    await navigateToMix(page);

    await page.locator('input[type="file"]').setInputFiles(STEM_FILES);
    await page.waitForSelector('[data-testid="stem-timeline"]', {
      timeout: 30000,
    });

    await expect(
      page.getByRole("button", { name: /smart repair/i })
    ).toBeVisible();
  });
});

// Backend unavailable warning
test.describe("Backend Warning", () => {
  test("shows warning when backend not available", async ({ page }) => {
    // This test is relevant when backend is down
    if (backendAvailable) {
      test.skip();
      return;
    }

    await navigateToMix(page);

    await expect(
      page.getByText(/separation backend not available/i)
    ).toBeVisible({ timeout: 10000 });
  });
});
