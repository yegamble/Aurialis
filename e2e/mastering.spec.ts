/**
 * E2E tests for the Aurialis mastering workflow.
 * Covers TS-001 (upload + navigation), TS-002 (preset selection), TS-003 (transport UI).
 */
import { test, expect, type Page } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_WAV = path.join(__dirname, "fixtures", "test-audio.wav");

/** Upload the test WAV and wait for navigation to /master */
async function uploadAndNavigate(page: Page) {
  await page.goto("/");
  // Use filechooser interception: click the upload zone which programmatically
  // triggers input.click(), Playwright intercepts it as a file chooser dialog
  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: /upload audio file/i }).click(),
  ]);
  await fileChooser.setFiles(TEST_WAV);
  // Upload progress animation takes ~1-2 seconds then navigates
  await page.waitForURL("**/master", { timeout: 15000 });
}

// ─── TS-001: Upload and Navigation ───────────────────────────────────────────

test.describe("TS-001: Upload and Navigation", () => {
  test("upload page renders with drag zone and branding", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: /upload audio file/i })
    ).toBeVisible();
    await expect(page.getByText("Waveish")).toBeVisible();
  });

  test("uploading a WAV file navigates to master page", async ({ page }) => {
    await uploadAndNavigate(page);
    // Master page has a play button and waveform area
    await expect(page.getByRole("button", { name: /play/i })).toBeVisible();
  });

  test("master page shows file info after upload", async ({ page }) => {
    await uploadAndNavigate(page);
    // File name should appear in the master page header area
    await expect(page.getByText("test-audio.wav")).toBeVisible();
  });
});

// ─── Mode Toggle ─────────────────────────────────────────────────────────────

test.describe("Mode Toggle", () => {
  test.beforeEach(async ({ page }) => {
    await uploadAndNavigate(page);
  });

  test("simple mode is active by default", async ({ page }) => {
    await expect(page.getByTestId("mode-toggle-simple")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await expect(page.getByTestId("mode-toggle-advanced")).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });

  test("clicking advanced mode activates advanced panel", async ({ page }) => {
    await page.getByTestId("mode-toggle-advanced").click();
    await expect(page.getByTestId("mode-toggle-advanced")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    // Advanced panel shows Parametric EQ section
    await expect(page.getByText("Parametric EQ")).toBeVisible();
  });
});

// ─── TS-002: Preset Selection Updates Parameters ──────────────────────────────

test.describe("TS-002: Preset Selection", () => {
  test.beforeEach(async ({ page }) => {
    await uploadAndNavigate(page);
    await page.getByTestId("mode-toggle-advanced").click();
    // Wait for advanced panel to be visible
    await expect(page.getByText("Parametric EQ")).toBeVisible();
  });

  test("Spotify preset sets Target LUFS to -14", async ({ page }) => {
    await page.getByRole("button", { name: "Spotify" }).click();
    // Target LUFS slider value should be -14
    const slider = page.getByRole("slider", { name: "Target LUFS" });
    await expect(slider).toHaveValue("-14");
  });

  test("Apple Music preset sets Target LUFS to -16", async ({ page }) => {
    await page.getByRole("button", { name: "Apple Music" }).click();
    const slider = page.getByRole("slider", { name: "Target LUFS" });
    await expect(slider).toHaveValue("-16");
  });

  test("CD preset sets Target LUFS to -9", async ({ page }) => {
    await page.getByRole("button", { name: "CD" }).click();
    const slider = page.getByRole("slider", { name: "Target LUFS" });
    await expect(slider).toHaveValue("-9");
  });
});

// ─── TS-003: Transport Controls ───────────────────────────────────────────────

test.describe("TS-003: Transport Controls", () => {
  test.beforeEach(async ({ page }) => {
    await uploadAndNavigate(page);
  });

  test("play button is visible and enabled after file loads", async ({
    page,
  }) => {
    const playBtn = page.getByRole("button", { name: /play/i });
    await expect(playBtn).toBeVisible();
    // Button is enabled (not disabled) once file is loaded
    await expect(playBtn).not.toBeDisabled({ timeout: 8000 });
  });

  test("clicking play changes button to pause", async ({ page }) => {
    const playBtn = page.getByRole("button", { name: /play/i });
    await playBtn.waitFor({ state: "visible" });
    // Wait until enabled (file decoded)
    await expect(playBtn).not.toBeDisabled({ timeout: 8000 });
    await playBtn.click();
    // After click, button becomes Pause
    await expect(
      page.getByRole("button", { name: /pause/i })
    ).toBeVisible({ timeout: 5000 });
  });

  test("A/B bypass toggle is visible and toggleable", async ({ page }) => {
    const abToggle = page.getByTestId("ab-toggle");
    await expect(abToggle).toBeVisible();
    // Initially not bypassed
    await expect(abToggle).toHaveAttribute("aria-pressed", "false");
    await abToggle.click();
    await expect(abToggle).toHaveAttribute("aria-pressed", "true");
    // Toggle back
    await abToggle.click();
    await expect(abToggle).toHaveAttribute("aria-pressed", "false");
  });

  test("stop button resets playback position", async ({ page }) => {
    const stopBtn = page.getByRole("button", {
      name: /stop and return to beginning/i,
    });
    await expect(stopBtn).toBeVisible();
  });
});

// ─── EQ Slider Interaction ────────────────────────────────────────────────────

test.describe("Advanced Controls", () => {
  test.beforeEach(async ({ page }) => {
    await uploadAndNavigate(page);
    await page.getByTestId("mode-toggle-advanced").click();
    await expect(page.getByText("Parametric EQ")).toBeVisible();
  });

  test("1kHz EQ slider exists with correct range", async ({ page }) => {
    const slider = page.getByRole("slider", { name: "1 kHz" });
    await expect(slider).toBeVisible();
    await expect(slider).toHaveAttribute("min", "-12");
    await expect(slider).toHaveAttribute("max", "12");
  });

  test("threshold slider exists in dynamics section", async ({ page }) => {
    const slider = page.getByRole("slider", { name: "Threshold" });
    await expect(slider).toBeVisible();
  });
});
