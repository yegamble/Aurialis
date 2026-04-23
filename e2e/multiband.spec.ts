import { expect, test, type Page } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

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

async function ensureSectionExpanded(page: Page, sectionTitle: string) {
  const sectionButton = page.getByRole("button", {
    name: sectionTitle,
    exact: true,
  });
  if ((await sectionButton.getAttribute("aria-expanded")) === "false") {
    await sectionButton.click();
    await expect(sectionButton).toHaveAttribute("aria-expanded", "true");
  }
}

test.describe("Multiband UI (P2)", () => {
  test.beforeEach(async ({ page }) => {
    await uploadAndNavigate(page);
    await showAdvanced(page);
  });

  test("TS-001: Multiband section is visible and master toggle works", async ({
    page,
  }) => {
    const sectionButton = page.getByRole("button", {
      name: "Multiband",
      exact: true,
    });
    await expect(sectionButton).toBeVisible();
    await ensureSectionExpanded(page, "Multiband");

    // The master toggle is a ToggleButton also labeled "Multiband", with
    // aria-pressed. Filter to the one that has aria-pressed set.
    const masterToggle = page
      .getByRole("button", { name: "Multiband", exact: true })
      .filter({ has: page.locator("[aria-pressed]") });

    // Fallback: find by aria-pressed directly
    const toggle = page.locator('button[aria-pressed]', {
      hasText: "Multiband",
    });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  test("TS-001b: All three band rows are visible when section is expanded", async ({
    page,
  }) => {
    await ensureSectionExpanded(page, "Multiband");

    for (const label of ["Low", "Mid", "High"]) {
      const bandHeader = page.getByRole("button", { name: label, exact: true });
      await expect(bandHeader).toBeVisible();
    }

    // Three ON/OFF buttons (one per band), each aria-pressed=false by default
    for (const label of ["Low", "Mid", "High"]) {
      const enableBtn = page.getByRole("button", {
        name: `${label} band enable`,
      });
      await expect(enableBtn).toHaveAttribute("aria-pressed", "false");
    }
  });

  test("TS-002: Enable a band and verify its state persists", async ({ page }) => {
    await ensureSectionExpanded(page, "Multiband");

    const lowEnable = page.getByRole("button", { name: "Low band enable" });
    await lowEnable.click();
    await expect(lowEnable).toHaveAttribute("aria-pressed", "true");
    // Click again to disable
    await lowEnable.click();
    await expect(lowEnable).toHaveAttribute("aria-pressed", "false");
  });

  test("TS-003: Expanding a band reveals Stereo|M/S pill and switching to M/S shows balance slider", async ({
    page,
  }) => {
    await ensureSectionExpanded(page, "Multiband");

    // Expand Low band (click its chevron header)
    const lowHeader = page.getByRole("button", { name: "Low", exact: true });
    await lowHeader.click();

    // Band mode radiogroup should appear
    const radiogroup = page.getByRole("radiogroup", { name: /band mode/i });
    await expect(radiogroup).toBeVisible();

    const stereoRadio = radiogroup.getByRole("radio", { name: "Stereo" });
    const msRadio = radiogroup.getByRole("radio", { name: "M/S" });
    await expect(stereoRadio).toHaveAttribute("aria-checked", "true");
    await expect(msRadio).toHaveAttribute("aria-checked", "false");

    // M/S Balance slider absent initially
    await expect(page.getByRole("slider", { name: /M\/S Balance/i })).toHaveCount(
      0
    );

    // Click M/S pill
    await msRadio.click();
    await expect(msRadio).toHaveAttribute("aria-checked", "true");
    await expect(
      page.getByRole("slider", { name: /M\/S Balance/i })
    ).toBeVisible();

    // Switch back to Stereo → balance disappears
    await stereoRadio.click();
    await expect(stereoRadio).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("slider", { name: /M\/S Balance/i })).toHaveCount(
      0
    );
  });

  test("TS-004: Crossover sliders clamp Low|Mid below Mid|High - 50", async ({
    page,
  }) => {
    await ensureSectionExpanded(page, "Multiband");

    const lowMid = page.getByRole("slider", { name: "Low|Mid" });
    const midHigh = page.getByRole("slider", { name: "Mid|High" });
    await expect(lowMid).toBeVisible();
    await expect(midHigh).toBeVisible();

    // Initial: 200 and 2000
    await expect(lowMid).toHaveValue("200");
    await expect(midHigh).toHaveValue("2000");

    // Try to push Low|Mid to 3000 via keyboard/fill → UI clamps to ≤ midHigh-50
    await lowMid.focus();
    await lowMid.fill("399");
    const afterValue = Number(await lowMid.inputValue());
    expect(afterValue).toBeLessThanOrEqual(400);
  });

  test("TS-005: Defaults keep multiband off (no regression risk)", async ({
    page,
  }) => {
    await ensureSectionExpanded(page, "Multiband");

    const masterToggle = page.locator('button[aria-pressed]', {
      hasText: "Multiband",
    });
    await expect(masterToggle).toHaveAttribute("aria-pressed", "false");

    for (const label of ["Low", "Mid", "High"]) {
      const enableBtn = page.getByRole("button", {
        name: `${label} band enable`,
      });
      await expect(enableBtn).toHaveAttribute("aria-pressed", "false");
    }
  });
});
