import { expect, test, type Page, type Route } from "@playwright/test";
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

/**
 * Verbose progress (harness) — hermetic via `page.route`. No live backend
 * required.
 */
test.describe("Verbose progress (harness) — Smart Split", () => {
  const SS_JOB = "ss-job-1";

  test("failed-at-stage label shows on backend error mid-flight", async ({
    page,
  }) => {
    // Fake the health check so the page enters "backend available" mode and
    // single-file uploads trigger separation instead of direct loading.
    await page.route("**/health", (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, gpu: false, models: ["htdemucs"] }),
      })
    );
    await page.route("**/separate", (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ job_id: SS_JOB, status: "queued" }),
      })
    );
    let pollCount = 0;
    await page.route(`**/jobs/${SS_JOB}/status`, (route: Route) => {
      pollCount++;
      if (pollCount === 1) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            job_id: SS_JOB,
            status: "processing",
            progress: 50,
            model: "htdemucs",
            stems: [],
            error: null,
          }),
        });
      }
      return route.fulfill({
        status: 410,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Backend gone" }),
      });
    });

    await navigateToMix(page);
    // Trigger single-file separation flow.
    await page.locator('input[type="file"]').setInputFiles(MIXED_TRACK);
    // The model select dialog appears for single files when backend available.
    // Buttons are labeled "4 Stems" / "6 Stems" (see src/app/mix/page.tsx:644).
    const fourStems = page.getByRole("button", { name: /4 Stems/i });
    await fourStems.waitFor({ state: "visible", timeout: 10_000 });
    await fourStems.click();

    // SeparationProgressCard renders error UI with failed-at headline.
    await expect(page.getByTestId("separation-progress-error")).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      page.getByTestId("separation-progress-error-message")
    ).toContainText(/Failed at:/i);
  });
});
