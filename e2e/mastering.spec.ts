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

const EQ_FREQ_LABEL_TO_BAND: Record<string, 1 | 2 | 3 | 4 | 5> = {
  "80 Hz": 1,
  "250 Hz": 2,
  "1 kHz": 3,
  "4 kHz": 4,
  "12 kHz": 5,
};

/** Returns the advanced-panel locator (the Parametric EQ lives only here). */
function advancedPanel(page: Page) {
  return page.locator('[data-testid="advanced-panel"], [data-panel="advanced"]').first();
}

async function ensureBandOpen(page: Page, bandNum: 1 | 2 | 3 | 4 | 5) {
  // The UI mounts AdvancedMastering for both simple and advanced modes so
  // their state stays in sync; scope to the visible panel to avoid strict-
  // mode ambiguity.
  const toggle = page.getByTestId(`eq-band-${bandNum}-toggle`).first();
  if ((await toggle.getAttribute("aria-expanded")) === "false") {
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
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

  // Parametric EQ (P3) — legacy "80 Hz"/"250 Hz"/... labels map to
  // `eq-band-{N}-gain` sliders inside the new band strips.
  const bandNum = EQ_FREQ_LABEL_TO_BAND[label];
  if (bandNum !== undefined) {
    await ensureSectionExpanded(page, "Parametric EQ");
    await ensureBandOpen(page, bandNum);
    return Number(
      await page.getByTestId(`eq-band-${bandNum}-gain`).first().inputValue(),
    );
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
  // Phase 4a split the former "Dynamics" Section into "Compressor" (sliders) +
  // "Dynamics Toggles" (toggle buttons). Threshold lives in Compressor.
  { title: "Compressor", childRole: "slider", childName: "Threshold", startsOpen: true },
  { title: "Tone", childRole: "button", childName: "Add Air", startsOpen: true },
  // Parametric EQ section expands to 5 band strips; Band 1 opens by default
  // exposing its Frequency slider as the first slider-typed child.
  { title: "Parametric EQ", childRole: "slider", childName: "Frequency", startsOpen: true },
  { title: "Saturation", childRole: "slider", childName: "Drive", startsOpen: false },
  { title: "Stereo", childRole: "slider", childName: "Width", startsOpen: false },
  // Phase 4a split the former "Output" Section into "Limiter" + "Output Target".
  // Target LUFS lives in Output Target.
  { title: "Output Target", childRole: "slider", childName: "Target LUFS", startsOpen: true },
] as const;

test.describe("Upload flow", () => {
  test("upload button is visible and opens a file chooser", async ({ page }) => {
    await page.goto("/");

    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: /upload audio file/i }).click();
    const chooser = await chooserPromise;
    expect(chooser.isMultiple()).toBe(true);

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

  test("P1-TS-003: LRA and Corr readouts are visible on the transport bar", async ({
    page,
  }) => {
    // Initial state: LRA/Corr labels visible with placeholders or values
    const lraReadout = page.getByText(/^LRA:/);
    const corrReadout = page.getByText(/^Corr:/);
    await expect(lraReadout).toBeVisible();
    await expect(corrReadout).toBeVisible();

    // LRA should show `---` before playback (lraReady=false)
    await expect(lraReadout).toContainText(/LRA:\s*(---|\d)/);
    // Corr shows `+1.00` default (identical mono channels at rest)
    await expect(corrReadout).toContainText(/Corr:\s*[+-][01]\.\d{2}/);
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

  test("P1-TS-001: Auto Release toggle appears and toggles state", async ({
    page,
  }) => {
    await ensureSectionExpanded(page, "Dynamics Toggles");
    const toggle = page.getByRole("button", { name: "Auto Release", exact: true });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  test("P1-TS-002: SatMode pill selector has 4 modes with single-selection invariant", async ({
    page,
  }) => {
    const satSection = page.getByRole("button", { name: "Saturation", exact: true });
    if ((await satSection.getAttribute("aria-expanded")) === "false") {
      await satSection.click();
      await expect(satSection).toHaveAttribute("aria-expanded", "true");
    }
    const group = page.getByRole("radiogroup", { name: "Saturation mode" });
    await expect(group).toBeVisible();

    const labels = ["Clean", "Tube", "Tape", "Transformer"];
    for (const label of labels) {
      const pill = group.getByRole("radio", { name: label, exact: true });
      await expect(pill).toBeVisible();
    }

    // Click Tube → only Tube is checked
    await group.getByRole("radio", { name: "Tube", exact: true }).click();
    for (const label of labels) {
      const pill = group.getByRole("radio", { name: label, exact: true });
      await expect(pill).toHaveAttribute(
        "aria-checked",
        label === "Tube" ? "true" : "false"
      );
    }

    // Switch to Tape
    await group.getByRole("radio", { name: "Tape", exact: true }).click();
    await expect(
      group.getByRole("radio", { name: "Tape", exact: true })
    ).toHaveAttribute("aria-checked", "true");
    await expect(
      group.getByRole("radio", { name: "Tube", exact: true })
    ).toHaveAttribute("aria-checked", "false");
  });

  test("TS-001: Sidechain HPF slider is present in Advanced mode and updates value", async ({
    page,
  }) => {
    // Sidechain HPF is inside the Compressor section (Phase 4a split).
    await ensureSectionExpanded(page, "Compressor");

    const slider = page.getByRole("slider", {
      name: "Sidechain HPF",
      exact: true,
    });
    await expect(slider).toBeVisible();

    // Master page applies applyIntensity("pop", 50) on mount, which interpolates
    // sidechainHpfHz to 110 (DEFAULT_PARAMS is 100 but pop@100 is 120 → midpoint 110).
    await expectSliderApprox(page, "Sidechain HPF", 110);

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

test.describe("Parametric EQ (P3)", () => {
  test.beforeEach(async ({ page }) => {
    await uploadAndNavigate(page);
    await showAdvanced(page);
    await ensureSectionExpanded(page, "Parametric EQ");
  });

  test("TS-001: Band 2 frequency sweep updates the UI value", async ({
    page,
  }) => {
    await ensureBandOpen(page, 2);
    const freq = page.getByTestId("eq-band-2-freq").first();
    await expect(freq).toBeVisible();
    // Default: 250 Hz
    expect(Number(await freq.inputValue())).toBeCloseTo(250, 0);
    // Sweep to 2 kHz
    await freq.fill("2000");
    expect(Number(await freq.inputValue())).toBeCloseTo(2000, 0);
  });

  test("TS-002: Band 3 type switches to High-Pass via pill", async ({ page }) => {
    await ensureBandOpen(page, 3);
    const bellPill = page.getByTestId("eq-band-3-type-bell").first();
    const hpPill = page.getByTestId("eq-band-3-type-highPass").first();
    await expect(bellPill).toHaveAttribute("aria-checked", "true");
    await hpPill.click();
    await expect(hpPill).toHaveAttribute("aria-checked", "true");
    await expect(bellPill).toHaveAttribute("aria-checked", "false");
  });

  test("TS-003: Band 4 M/S mode reveals MS Balance slider", async ({ page }) => {
    await ensureBandOpen(page, 4);
    // By default the mode is stereo → balance slider is absent.
    await expect(page.getByTestId("eq-band-4-msbalance")).toHaveCount(0);

    await page.getByTestId("eq-band-4-mode-ms").first().click();
    const balance = page.getByTestId("eq-band-4-msbalance").first();
    await expect(balance).toBeVisible();
    await balance.fill("1");
    expect(Number(await balance.inputValue())).toBeCloseTo(1, 2);

    // Switch back to stereo → balance slider hidden again.
    await page.getByTestId("eq-band-4-mode-stereo").first().click();
    await expect(page.getByTestId("eq-band-4-msbalance")).toHaveCount(0);
  });

  test("TS-004: per-band enable toggle flips ON/OFF", async ({ page }) => {
    const toggle = page.getByTestId("eq-band-1-enable").first();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
  });

  test("TS-005: section-level Bypass toggle flips EQ master enable", async ({
    page,
  }) => {
    // Phase 4a renamed the section-level bypass from `eq-master-bypass` to
    // `bypass-pill-eq` (unified BypassPill pattern across all stages).
    const bypass = page.getByTestId("bypass-pill-eq").first();
    // Default: parametricEqEnabled=1 → aria-pressed="false" (label "Bypass").
    await expect(bypass).toHaveAttribute("aria-pressed", "false");
    await bypass.click();
    await expect(bypass).toHaveAttribute("aria-pressed", "true");
    await expect(bypass).toHaveText(/Bypassed/);
    await bypass.click();
    await expect(bypass).toHaveAttribute("aria-pressed", "false");
  });

  test("Gain slider on Band 1 maps to legacy eq80 input value", async ({
    page,
  }) => {
    const gain = page.getByTestId("eq-band-1-gain").first();
    await expect(gain).toBeVisible();
    await gain.fill("3");
    expect(Number(await gain.inputValue())).toBeCloseTo(3, 2);
    // The "80 Hz" legacy label (used by GENRE_EXPECTATIONS) resolves to the
    // same slider via readSliderValue.
    expect(await readSliderValue(page, "80 Hz")).toBeCloseTo(3, 2);
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

/**
 * Verbose progress (harness) — Mastering Auto-master.
 * Verifies the inline progress indicator shows during analysis and that
 * the harness emits ordered `[analysis:mastering-auto:<phase>]` lines.
 */
test.describe("Verbose progress (harness) — Mastering Auto-master", () => {
  test("emits ordered phase console.info lines on Auto-master click", async ({
    page,
  }) => {
    test.setTimeout(90000);
    const lines: string[] = [];
    page.on("console", (msg) => {
      // Capture all console types — Next.js sometimes routes info as log/debug.
      lines.push(msg.text());
    });

    await uploadAndNavigate(page);
    await showSimple(page);

    // Wait for the audio engine to load the buffer before clicking
    // Auto-master — otherwise handleAutoMaster early-returns on null buffer.
    await page.waitForFunction(
      () => {
        const labels = document.querySelectorAll("button");
        return Array.from(labels).some((b) => /auto master/i.test(b.textContent ?? ""));
      },
      { timeout: 10_000 }
    );

    const autoBtn = page
      .getByRole("button", { name: /auto.?master/i })
      .first();
    await autoBtn.waitFor({ state: "visible" });
    // Give the audio buffer a moment to finish decoding.
    await page.waitForTimeout(2000);
    await autoBtn.click();

    // Wait until the final 'done' line appears, with a generous timeout for
    // longer audio files. Polls every 250ms.
    await page.waitForFunction(
      (capturedLines: string[]) =>
        capturedLines.some((l) => l.includes("[analysis:mastering-auto:done]")),
      lines,
      { timeout: 30_000, polling: 250 }
    ).catch(() => {
      // Fall through — we'll assert below with a better error message.
    });

    const harness = lines.filter((l) =>
      l.includes("[analysis:mastering-auto:")
    );
    const stagesInOrder = ["loudness", "peak", "dynamic-range", "spectral-balance", "done"];
    let lastIdx = -1;
    for (const stage of stagesInOrder) {
      const idx = harness.findIndex(
        (l, i) => i > lastIdx && l.includes(`[analysis:mastering-auto:${stage}]`)
      );
      expect(
        idx,
        `expected ordered stage [${stage}] to appear after previous stages. Captured: ${JSON.stringify(harness.slice(0, 10))}`
      ).toBeGreaterThan(lastIdx);
      lastIdx = idx;
    }
  });
});
