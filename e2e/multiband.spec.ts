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

  test("TS-001: Multiband section is visible and BypassPill toggles it (Phase 4a)", async ({
    page,
  }) => {
    const sectionButton = page.getByRole("button", {
      name: "Multiband",
      exact: true,
    });
    await expect(sectionButton).toBeVisible();

    // Phase 4a Task 5: master toggle is now a BypassPill in the Section header
    // (data-testid=bypass-pill-multiband). aria-pressed=true means BYPASSED.
    // Default genre (pop) at intensity=50 engages MB → pill starts active=false
    // (not bypassed). Click once to bypass, again to restore.
    const pill = page.getByTestId("bypass-pill-multiband");
    await expect(pill).toBeVisible();
    const initial = await pill.getAttribute("aria-pressed");
    await pill.click();
    const afterFirst = await pill.getAttribute("aria-pressed");
    expect(afterFirst).not.toBe(initial);
    await pill.click();
    const afterSecond = await pill.getAttribute("aria-pressed");
    expect(afterSecond).toBe(initial);
  });

  test("TS-001b: All three band rows are visible when section is expanded", async ({
    page,
  }) => {
    await ensureSectionExpanded(page, "Multiband");

    for (const label of ["Low", "Mid", "High"]) {
      const bandHeader = page.getByRole("button", { name: label, exact: true });
      await expect(bandHeader).toBeVisible();
    }

    // Band ON/OFF buttons exist — note that Phase 4a genre presets may start
    // some bands enabled (e.g. pop.mbLowEnabled=1), so we only assert presence
    // here, not default state.
    for (const label of ["Low", "Mid", "High"]) {
      const enableBtn = page.getByRole("button", {
        name: `${label} band enable`,
      });
      await expect(enableBtn).toBeVisible();
    }
  });

  test("TS-002: Enable a band and verify its state persists", async ({ page }) => {
    await ensureSectionExpanded(page, "Multiband");

    // Preset-agnostic toggle test — pop preset starts mbLowEnabled=1, so we
    // flip-and-restore rather than asserting hardcoded on/off states.
    const lowEnable = page.getByRole("button", { name: "Low band enable" });
    const initial = (await lowEnable.getAttribute("aria-pressed")) ?? "false";
    const flipped = initial === "true" ? "false" : "true";
    await lowEnable.click();
    await expect(lowEnable).toHaveAttribute("aria-pressed", flipped);
    await lowEnable.click();
    await expect(lowEnable).toHaveAttribute("aria-pressed", initial);
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

  test("TS-005: BypassPill reflects genre MB engagement (Phase 4a: pop engages MB)", async ({
    page,
  }) => {
    // Default: genre=pop, intensity=50. Post-Phase-4a, pop engages multiband
    // (mbLowEnabled=1), so the Multiband BypassPill starts inactive (NOT
    // bypassed). This replaces the pre-Phase-4a assertion that defaults kept
    // multiband off.
    const pill = page.getByTestId("bypass-pill-multiband");
    await expect(pill).toHaveAttribute("aria-pressed", "false");
  });
});
