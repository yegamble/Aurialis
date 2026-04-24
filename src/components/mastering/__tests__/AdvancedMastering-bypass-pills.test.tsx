import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AdvancedMastering } from "../AdvancedMastering";
import { DEFAULT_PARAMS } from "@/lib/audio/presets";
import type { AudioParams } from "@/types/mastering";

/**
 * Phase 4a Task 5: every stage Section has a BypassPill in its header wired to
 * the corresponding `*Enabled` field. Six pills total: EQ, Compressor,
 * Multiband, Saturation, Stereo Width, Limiter.
 */

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

const PILLS: Array<{
  testId: string;
  enableKey: keyof AudioParams;
  defaultEnabled: number;
}> = [
  { testId: "bypass-pill-eq", enableKey: "parametricEqEnabled", defaultEnabled: 1 },
  { testId: "bypass-pill-compressor", enableKey: "compressorEnabled", defaultEnabled: 1 },
  { testId: "bypass-pill-multiband", enableKey: "multibandEnabled", defaultEnabled: 0 },
  { testId: "bypass-pill-saturation", enableKey: "saturationEnabled", defaultEnabled: 1 },
  { testId: "bypass-pill-stereo-width", enableKey: "stereoWidthEnabled", defaultEnabled: 1 },
  { testId: "bypass-pill-limiter", enableKey: "limiterEnabled", defaultEnabled: 1 },
];

describe("AdvancedMastering — per-stage BypassPills (Phase 4a Task 5)", () => {
  it("renders all 6 stage bypass pills", () => {
    renderPanel();
    for (const p of PILLS) {
      expect(screen.getByTestId(p.testId), `pill ${p.testId}`).toBeInTheDocument();
    }
  });

  it.each(PILLS)(
    "pill $testId reflects default $enableKey state (bypassed=$defaultEnabled===0)",
    ({ testId, defaultEnabled }) => {
      renderPanel();
      const pill = screen.getByTestId(testId);
      // aria-pressed=true when the STAGE IS BYPASSED, i.e. enabled===0
      expect(pill.getAttribute("aria-pressed")).toBe(
        defaultEnabled === 0 ? "true" : "false"
      );
    }
  );

  it.each(PILLS)(
    "clicking pill $testId toggles $enableKey via onParamChange",
    ({ testId, enableKey, defaultEnabled }) => {
      const { onParamChange } = renderPanel();
      fireEvent.click(screen.getByTestId(testId));
      expect(onParamChange).toHaveBeenCalledWith(
        enableKey,
        defaultEnabled > 0 ? 0 : 1
      );
    }
  );

  it("clicking a pill does not expand/collapse the Section (stopPropagation)", () => {
    renderPanel();
    // Compressor Section is open by default; clicking its pill must not toggle open state.
    const pill = screen.getByTestId("bypass-pill-compressor");
    // Sanity: the pill is visible, meaning its Section header is rendered.
    expect(pill).toBeInTheDocument();
    fireEvent.click(pill);
    // After click, the Section is still open (sliders still rendered). If the
    // pill click had bubbled to the header button, the Section would collapse.
    expect(screen.getByLabelText(/Threshold/i)).toBeInTheDocument();
  });

  it("restructured Sections: Compressor and Dynamics Toggles both exist (split from former Dynamics)", () => {
    renderPanel();
    expect(screen.getAllByText(/^Compressor$/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/^Dynamics Toggles$/i)).toBeInTheDocument();
  });

  it("restructured Sections: Limiter and Output Target both exist (split from former Output)", () => {
    renderPanel();
    expect(screen.getAllByText(/^Limiter$/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/^Output Target$/i)).toBeInTheDocument();
  });
});
