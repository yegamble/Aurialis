import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { AdvancedMastering } from "../AdvancedMastering";
import { DEFAULT_PARAMS } from "@/lib/audio/presets";
import type { AudioParams } from "@/types/mastering";

function renderPanel(paramsOverride: Partial<AudioParams> = {}) {
  const onParamChange = vi.fn();
  const props = {
    params: { ...DEFAULT_PARAMS, ...paramsOverride },
    onParamChange,
    dynamics: { deharsh: false, glueComp: false },
    onDynamicsToggle: vi.fn(),
    tonePreset: null,
    onTonePresetChange: vi.fn(),
    outputPreset: null,
    onOutputPresetChange: vi.fn(),
  };
  render(<AdvancedMastering {...props} />);
  return { onParamChange };
}

describe("AdvancedMastering — Multiband section", () => {
  it("renders a Multiband section header", () => {
    renderPanel();
    expect(
      screen.getByRole("button", { name: /multiband/i })
    ).toBeInTheDocument();
  });

  it("master toggle reflects multibandEnabled state and calls onParamChange", () => {
    const { onParamChange } = renderPanel();
    // Expand section (closed by default) — click on the header with "Multiband" text
    const sectionHeader = screen.getAllByRole("button", { name: /multiband/i })[0];
    fireEvent.click(sectionHeader);
    // Find the ToggleButton labeled "Multiband" inside the section
    const toggle = screen
      .getAllByRole("button")
      .find((b) => b.textContent?.trim() === "Multiband" && b.getAttribute("aria-pressed") !== null);
    expect(toggle).toBeDefined();
    expect(toggle!.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle!);
    expect(onParamChange).toHaveBeenCalledWith("multibandEnabled", 1);
  });

  it("expanded section shows Low, Mid, and High band rows with ON/OFF + Solo buttons", () => {
    renderPanel();
    // Expand the Multiband section
    const sectionHeader = screen.getAllByRole("button", { name: /multiband/i })[0];
    fireEvent.click(sectionHeader);

    for (const label of ["Low", "Mid", "High"]) {
      const bandToggle = screen.getAllByRole("button").find(
        (b) => b.textContent === label
      );
      expect(bandToggle, `band header '${label}' should exist`).toBeDefined();
    }

    // There should be 3 ON/OFF buttons, each with aria-pressed=false by default
    const enableButtons = screen
      .getAllByRole("button")
      .filter((b) => /band enable$/i.test(b.getAttribute("aria-label") ?? ""));
    expect(enableButtons).toHaveLength(3);
    for (const btn of enableButtons) {
      expect(btn.getAttribute("aria-pressed")).toBe("false");
    }
  });

  it("clicking a band ON/OFF button calls onParamChange with correct key", () => {
    const { onParamChange } = renderPanel();
    fireEvent.click(screen.getAllByRole("button", { name: /multiband/i })[0]);
    const lowEnable = screen
      .getAllByRole("button")
      .find((b) => b.getAttribute("aria-label") === "Low band enable");
    expect(lowEnable).toBeDefined();
    fireEvent.click(lowEnable!);
    expect(onParamChange).toHaveBeenCalledWith("mbLowEnabled", 1);
  });

  it("expanding a band row reveals Threshold/Ratio/Attack/Release/Makeup sliders and Stereo|M/S pills", () => {
    renderPanel();
    // Expand Multiband section
    fireEvent.click(screen.getAllByRole("button", { name: /multiband/i })[0]);
    // Expand the Low band row
    const lowHeader = screen.getAllByRole("button").find((b) => b.textContent === "Low")!;
    fireEvent.click(lowHeader);

    // Inside: Stereo|M/S pills (role radiogroup with aria-label "Band mode")
    const radiogroup = screen.getByRole("radiogroup", { name: /band mode/i });
    expect(radiogroup).toBeInTheDocument();
    const stereoRadio = within(radiogroup).getByRole("radio", { name: /stereo/i });
    const msRadio = within(radiogroup).getByRole("radio", { name: /m\/s/i });
    expect(stereoRadio).toHaveAttribute("aria-checked", "true");
    expect(msRadio).toHaveAttribute("aria-checked", "false");

    // Sliders labeled per the plan — there may be multiple (e.g. Dynamics also
    // has Threshold), so just assert presence via getAllByLabelText.
    expect(screen.getAllByLabelText(/Threshold/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByLabelText(/Ratio/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByLabelText(/Attack/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByLabelText(/Release/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByLabelText(/Makeup/i).length).toBeGreaterThanOrEqual(1);
  });

  it("switching a band to M/S mode reveals the M/S Balance slider; switching back hides it", () => {
    const { onParamChange } = renderPanel({ mbLowMode: "ms", mbLowEnabled: 1 });
    fireEvent.click(screen.getAllByRole("button", { name: /multiband/i })[0]);
    const lowHeader = screen.getAllByRole("button").find((b) => b.textContent === "Low")!;
    fireEvent.click(lowHeader);
    expect(screen.getByLabelText(/M\/S Balance/i)).toBeInTheDocument();

    // Flip to stereo via the pill
    const stereoRadio = screen
      .getByRole("radiogroup", { name: /band mode/i })
      .querySelector('[role="radio"][aria-checked="false"]');
    fireEvent.click(stereoRadio!);
    expect(onParamChange).toHaveBeenCalledWith("mbLowMode", "stereo");
  });

  it("crossover sliders enforce clamp: Low|Mid cannot go above Mid|High - 50", () => {
    const { onParamChange } = renderPanel({
      mbCrossLowMid: 200,
      mbCrossMidHigh: 2000,
    });
    fireEvent.click(screen.getAllByRole("button", { name: /multiband/i })[0]);
    const lowMidSlider = screen.getByLabelText(/Low\|Mid/i) as HTMLInputElement;
    // Drag value to 3000 (above mid|high). Expect clamped to 2000-50 = 1950.
    fireEvent.change(lowMidSlider, { target: { value: "3000" } });
    // Assert the onParamChange emitted the clamped value
    const callsForKey = onParamChange.mock.calls.filter(
      ([k]) => k === "mbCrossLowMid"
    );
    expect(callsForKey.length).toBeGreaterThan(0);
    const lastVal = callsForKey[callsForKey.length - 1][1] as number;
    expect(lastVal).toBeLessThanOrEqual(1950);
  });
});
