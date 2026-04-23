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

async function showSimple(page: Page) {
  await page.getByTestId("mode-toggle-simple").click();
  await expect(page.getByTestId("mode-toggle-simple")).toHaveAttribute(
    "aria-pressed",
    "true"
  );
}

async function showAdvanced(page: Page) {
  await page.getByTestId("mode-toggle-advanced").click();
  await expect(page.getByTestId("mode-toggle-advanced")).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(page.getByText("Parametric EQ").first()).toBeVisible();
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

async function readSliderValue(page: Page, label: string) {
  if (label === "Drive") {
    await ensureSectionExpanded(page, "Saturation");
  }

  if (
    label === "Width" ||
    label === "Bass Mono Freq" ||
    label === "Mid Gain" ||
    label === "Side Gain"
  ) {
    await ensureSectionExpanded(page, "Stereo");
  }

  return Number(
    await page.getByRole("slider", { name: label, exact: true }).inputValue()
  );
}

function sliderTolerance(label: string) {
  if (label === "Sidechain HPF") {
    // Integer-step slider — tolerance can be essentially exact
    return 0.01;
  }
  if (
    label === "Release" ||
    label === "Drive" ||
    label === "Width" ||
    label === "Bass Mono Freq" ||
    label === "Limiter Release"
  ) {
    return 0.51;
  }

  return 0.051;
}

async function expectSliderApprox(page: Page, label: string, expected: number) {
  const actual = await readSliderValue(page, label);
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(sliderTolerance(label));
}

async function captureSliderValues(page: Page, labels: string[]) {
  const values: Record<string, number> = {};
  for (const label of labels) {
    values[label] = await readSliderValue(page, label);
  }
  return values;
}

const GENRE_EXPECTATIONS = [
  {
    button: "Pop",
    sliders: { Threshold: -19, Ratio: 2.5, "12 kHz": 1, Drive: 8 },
  },
  {
    button: "Hip-Hop",
    sliders: { Threshold: -17, Ratio: 3, "80 Hz": 2, Drive: 10 },
  },
  {
    button: "Rock",
    sliders: { Threshold: -18, Ratio: 3, "80 Hz": 1.5, Drive: 13 },
  },
  {
    button: "Electronic",
    sliders: { Threshold: -16, Ratio: 3.5, Width: 115, Ceiling: -0.6 },
  },
  {
    button: "Jazz",
    sliders: { Threshold: -20, Ratio: 2, "250 Hz": 0.5, Drive: 3 },
  },
  {
    button: "Classical",
    sliders: { Threshold: -21, Ratio: 1.75, "80 Hz": -0.5, "Target LUFS": -17 },
  },
  {
    button: "Lo-Fi",
    sliders: { Threshold: -20, Ratio: 2.25, "4 kHz": -0.75, Drive: 15 },
  },
  {
    button: "Podcast",
    sliders: { Threshold: -19, Ratio: 2.5, "80 Hz": -1, "Target LUFS": -15 },
  },
];

const QUICK_TOGGLE_EXPECTATIONS = [
  {
    button: "Clean Up",
    deltas: {
      Threshold: -5,
      Ratio: 1,
      Attack: -15,
      Release: -100,
      Makeup: 1,
    },
  },
  {
    button: "Warm",
    deltas: { "250 Hz": 2, Drive: 15 },
  },
  {
    button: "Bright",
    deltas: { "4 kHz": 1.5, "12 kHz": 2.5 },
  },
  {
    button: "Wide",
    deltas: { Width: 50 },
  },
  {
    button: "Loud",
    deltas: { Makeup: 3, Ceiling: 0.5 },
  },
];

const ADVANCED_TOGGLE_EXPECTATIONS = [
  {
    button: "De-Harsh",
    deltas: { "1 kHz": -1.5, "4 kHz": -3 },
  },
  {
    button: "Glue Comp",
    deltas: {
      Threshold: -5,
      Ratio: 1.5,
      Attack: 20,
      Release: 100,
      Makeup: 1.5,
    },
  },
];

const TONE_PRESET_EXPECTATIONS = [
  {
    button: "Add Air",
    deltas: { "4 kHz": 1.5, "12 kHz": 3 },
  },
  {
    button: "Tape Warmth",
    deltas: { "250 Hz": 2, Drive: 15 },
  },
  {
    button: "Cut Mud",
    deltas: { "80 Hz": -1, "250 Hz": -3 },
  },
];

const OUTPUT_PRESET_EXPECTATIONS = [
  { button: "Spotify", expected: { "Target LUFS": -14, Ceiling: -1 } },
  { button: "Apple Music", expected: { "Target LUFS": -16, Ceiling: -1 } },
  { button: "YouTube", expected: { "Target LUFS": -14, Ceiling: -1 } },
  { button: "SoundCloud", expected: { "Target LUFS": -14, Ceiling: -1 } },
  { button: "CD", expected: { "Target LUFS": -9, Ceiling: -0.1 } },
];

const EXPORT_FORMAT_EXPECTATIONS = [
  {
    button: "Streaming",
    sampleRate: "44.1 kHz",
    bitDepth: "16-bit",
  },
  {
    button: "CD Quality",
    sampleRate: "44.1 kHz",
    bitDepth: "16-bit",
  },
  {
    button: "Hi-Res",
    sampleRate: "96 kHz",
    bitDepth: "24-bit",
  },
];

const SECTION_EXPECTATIONS = [
  { title: "Input", childRole: "slider", childName: "Input Gain", startsOpen: true },
  { title: "Dynamics", childRole: "slider", childName: "Threshold", startsOpen: true },
  { title: "Tone", childRole: "button", childName: "Add Air", startsOpen: true },
  { title: "Parametric EQ", childRole: "slider", childName: "80 Hz", startsOpen: true },
  { title: "Saturation", childRole: "slider", childName: "Drive", startsOpen: false },
  { title: "Stereo", childRole: "slider", childName: "Width", startsOpen: false },
  { title: "Output", childRole: "slider", childName: "Target LUFS", startsOpen: true },
] as const;

test.describe("Upload flow", () => {
  test("upload button is visible and opens a file chooser", async ({ page }) => {
    await page.goto("/");

    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: /upload audio file/i }).click();
    const chooser = await chooserPromise;
    expect(chooser.isMultiple()).toBe(false);

    await expect(page.getByText("Aurialis")).toBeVisible();
  });

  test("uploading a WAV file navigates to mastering and shows file info", async ({
    page,
  }) => {
    await uploadAndNavigate(page);
    await expect(page.getByRole("button", { name: /play/i })).toBeVisible();
    await expect(page.getByText("test-audio.wav")).toBeVisible();
  });
});

test.describe("Navigation and transport buttons", () => {
  test.beforeEach(async ({ page }) => {
    await uploadAndNavigate(page);
  });

  test("mode buttons toggle panels and back button returns to upload", async ({
    page,
  }) => {
    await expect(page.getByTestId("mode-toggle-simple")).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    await showAdvanced(page);
    await showSimple(page);

    await page.getByRole("button", { name: /back to upload/i }).click();
    await page.waitForURL("**/");
    await expect(
      page.getByRole("button", { name: /upload audio file/i })
    ).toBeVisible();
  });

  test("play, pause-state, A/B, and stop buttons all respond", async ({
    page,
  }) => {
    const playButton = page.getByRole("button", { name: /play/i });
    await expect(playButton).not.toBeDisabled({ timeout: 15000 });

    await playButton.click();
    await expect(page.getByRole("button", { name: /pause/i })).toBeVisible();

    const abToggle = page.getByTestId("ab-toggle");
    await expect(abToggle).toHaveAttribute("aria-pressed", "false");
    await abToggle.click();
    await expect(abToggle).toHaveAttribute("aria-pressed", "true");
    await abToggle.click();
    await expect(abToggle).toHaveAttribute("aria-pressed", "false");

    await page.waitForTimeout(1200);
    await page
      .getByRole("button", { name: /stop and return to beginning/i })
      .click();
    await expect(page.getByRole("button", { name: /play/i })).toBeVisible();
    await expect(page.getByText(/^0:00 \/ /)).toBeVisible();
  });
});

test.describe("Simple mode buttons sync with advanced knobs", () => {
  test.beforeEach(async ({ page }) => {
    await uploadAndNavigate(page);
  });

  test("every genre button updates the advanced controls", async ({ page }) => {
    for (const { button, sliders } of GENRE_EXPECTATIONS) {
      await showSimple(page);
      const genreButton = page.getByRole("button", { name: button, exact: true });
      await genreButton.click();
      await expect(genreButton).toHaveAttribute("aria-pressed", "true");

      await showAdvanced(page);
      for (const [label, expected] of Object.entries(sliders)) {
        await expectSliderApprox(page, label, expected);
      }
    }
  });

  test("every quick toggle changes its linked advanced sliders and then reverts", async ({
    page,
  }) => {
    const labels = Array.from(
      new Set(
        QUICK_TOGGLE_EXPECTATIONS.flatMap(({ deltas }) => Object.keys(deltas))
      )
    );

    await showAdvanced(page);
    const baseline = await captureSliderValues(page, labels);

    for (const { button, deltas } of QUICK_TOGGLE_EXPECTATIONS) {
      await showSimple(page);
      const toggleButton = page.getByRole("button", { name: button, exact: true });
      await toggleButton.click();
      await expect(toggleButton).toHaveAttribute("aria-pressed", "true");

      await showAdvanced(page);
      for (const [label, delta] of Object.entries(deltas)) {
        expect(await readSliderValue(page, label)).toBeCloseTo(
          baseline[label] + delta,
          4
        );
      }

      await showSimple(page);
      await toggleButton.click();
      await expect(toggleButton).toHaveAttribute("aria-pressed", "false");

      await showAdvanced(page);
      for (const label of Object.keys(deltas)) {
        expect(await readSliderValue(page, label)).toBeCloseTo(
          baseline[label],
          4
        );
      }
    }
  });

  test("auto master changes mastering params and clears all simple toggles", async ({
    page,
  }) => {
    await showAdvanced(page);
    const thresholdBefore = await readSliderValue(page, "Threshold");

    await showSimple(page);
    await page.getByRole("button", { name: "Warm", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Warm", exact: true })
    ).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: /auto master/i }).click();

    for (const toggleName of ["Clean Up", "Warm", "Bright", "Wide", "Loud"]) {
      await expect(
        page.getByRole("button", { name: toggleName, exact: true })
      ).toHaveAttribute("aria-pressed", "false");
    }

    await showAdvanced(page);
    expect(await readSliderValue(page, "Threshold")).not.toBe(thresholdBefore);
  });
});

test.describe("Advanced mode buttons", () => {
  test.beforeEach(async ({ page }) => {
    await uploadAndNavigate(page);
    await showAdvanced(page);
  });

  test("TS-001: Sidechain HPF slider is present in Advanced mode and updates value", async ({
    page,
  }) => {
    // Ensure Dynamics section is expanded (it is by default, but be defensive)
    await ensureSectionExpanded(page, "Dynamics");

    const slider = page.getByRole("slider", {
      name: "Sidechain HPF",
      exact: true,
    });
    await expect(slider).toBeVisible();

    // Default value is 100 Hz (from DEFAULT_PARAMS.sidechainHpfHz)
    await expectSliderApprox(page, "Sidechain HPF", 100);

    // Drag/set to 150 Hz via native input.value + change event
    await slider.fill("150");
    await expectSliderApprox(page, "Sidechain HPF", 150);
  });

  test("every collapsible section button opens and closes its panel", async ({
    page,
  }) => {
    for (const section of SECTION_EXPECTATIONS) {
      const sectionButton = page.getByRole("button", {
        name: section.title,
        exact: true,
      });
      const child =
        section.childRole === "button"
          ? page.getByRole("button", { name: section.childName, exact: true })
          : page.getByRole("slider", { name: section.childName });

      await expect(sectionButton).toHaveAttribute(
        "aria-expanded",
        section.startsOpen ? "true" : "false"
      );

      if (section.startsOpen) {
        await expect(child).toBeVisible();
        await sectionButton.click();
        await expect(sectionButton).toHaveAttribute("aria-expanded", "false");
        await expect(child).toHaveCount(0);
      } else {
        await expect(child).toHaveCount(0);
      }

      await sectionButton.click();
      await expect(sectionButton).toHaveAttribute("aria-expanded", "true");
      await expect(child).toBeVisible();
    }
  });

  test("dynamics buttons update and restore their linked controls", async ({
    page,
  }) => {
    const labels = Array.from(
      new Set(
        ADVANCED_TOGGLE_EXPECTATIONS.flatMap(({ deltas }) => Object.keys(deltas))
      )
    );
    const baseline = await captureSliderValues(page, labels);

    for (const { button, deltas } of ADVANCED_TOGGLE_EXPECTATIONS) {
      const toggleButton = page.getByRole("button", { name: button, exact: true });
      await toggleButton.click();
      await expect(toggleButton).toHaveAttribute("aria-pressed", "true");

      for (const [label, delta] of Object.entries(deltas)) {
        expect(await readSliderValue(page, label)).toBeCloseTo(
          baseline[label] + delta,
          4
        );
      }

      await toggleButton.click();
      await expect(toggleButton).toHaveAttribute("aria-pressed", "false");
      for (const label of Object.keys(deltas)) {
        expect(await readSliderValue(page, label)).toBeCloseTo(
          baseline[label],
          4
        );
      }
    }
  });

  test("tone preset buttons change tone controls and keep active state honest", async ({
    page,
  }) => {
    const labels = Array.from(
      new Set(
        TONE_PRESET_EXPECTATIONS.flatMap(({ deltas }) => Object.keys(deltas))
      )
    );
    const baseline = await captureSliderValues(page, labels);

    for (const { button, deltas } of TONE_PRESET_EXPECTATIONS) {
      const presetButton = page.getByRole("button", { name: button, exact: true });
      await presetButton.click();
      await expect(presetButton).toHaveAttribute("aria-pressed", "true");

      for (const [label, delta] of Object.entries(deltas)) {
        expect(await readSliderValue(page, label)).toBeCloseTo(
          baseline[label] + delta,
          4
        );
      }

      for (const other of TONE_PRESET_EXPECTATIONS) {
        if (other.button === button) continue;
        await expect(
          page.getByRole("button", { name: other.button, exact: true })
        ).toHaveAttribute("aria-pressed", "false");
      }

      await presetButton.click();
      await expect(presetButton).toHaveAttribute("aria-pressed", "false");
      for (const label of Object.keys(deltas)) {
        expect(await readSliderValue(page, label)).toBeCloseTo(
          baseline[label],
          4
        );
      }
    }
  });

  test("output preset buttons set the limiter targets and highlight the chosen button", async ({
    page,
  }) => {
    for (const { button, expected } of OUTPUT_PRESET_EXPECTATIONS) {
      const presetButton = page.getByRole("button", { name: button, exact: true });
      await presetButton.click();
      await expect(presetButton).toHaveAttribute("aria-pressed", "true");

      for (const [label, value] of Object.entries(expected)) {
        expect(await readSliderValue(page, label)).toBeCloseTo(value, 4);
      }

      for (const other of OUTPUT_PRESET_EXPECTATIONS) {
        if (other.button === button) continue;
        const otherButton = page.getByRole("button", {
          name: other.button,
          exact: true,
        });
        const shouldStayActive =
          expected["Target LUFS"] === other.expected["Target LUFS"] &&
          expected.Ceiling === other.expected.Ceiling &&
          other.button === button;
        if (!shouldStayActive) {
          await expect(otherButton).toHaveAttribute("aria-pressed", "false");
        }
      }
    }
  });
});

test.describe("Export buttons", () => {
  test.beforeEach(async ({ page }) => {
    await uploadAndNavigate(page);
  });

  test("export format buttons update the export settings UI", async ({ page }) => {
    for (const format of EXPORT_FORMAT_EXPECTATIONS) {
      const formatButton = page.getByRole("button", {
        name: format.button,
        exact: true,
      });
      await formatButton.click();
      await expect(formatButton).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByLabel("Sample Rate")).toHaveValue(format.sampleRate);
      await expect(page.getByLabel("Bit Depth")).toHaveValue(format.bitDepth);
    }
  });

  test("export wav button is visible and triggers a download", async ({
    page,
  }) => {
    test.setTimeout(60000);
    const exportButton = page.getByRole("button", { name: /export wav/i });
    await expect(exportButton).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await exportButton.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.wav$/i);
  });
});
