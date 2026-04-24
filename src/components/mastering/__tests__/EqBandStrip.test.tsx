/**
 * EqBandStrip component tests — verifies UI controls dispatch correct
 * onParamChange events and conditional MS Balance visibility.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EqBandStrip } from "../EqBandStrip";
import { DEFAULT_PARAMS } from "@/lib/audio/presets";
import type { AudioParams } from "@/types/mastering";

function renderStrip(
  bandIndex: 0 | 1 | 2 | 3 | 4,
  overrides: Partial<AudioParams> = {},
): {
  onParamChange: ReturnType<typeof vi.fn>;
} {
  const onParamChange = vi.fn();
  render(
    <EqBandStrip
      bandIndex={bandIndex}
      defaultOpen
      params={{ ...DEFAULT_PARAMS, ...overrides }}
      onParamChange={onParamChange}
    />,
  );
  return { onParamChange };
}

describe("EqBandStrip", () => {
  it("renders Band N header", () => {
    renderStrip(0);
    expect(screen.getByText(/Band 1/)).toBeInTheDocument();
  });

  it("Enable toggle dispatches eqBand{N}Enabled", () => {
    const { onParamChange } = renderStrip(2);
    const toggle = screen.getByTestId("eq-band-3-enable");
    fireEvent.click(toggle);
    expect(onParamChange).toHaveBeenCalledWith("eqBand3Enabled", 0);
  });

  it("Frequency slider dispatches eqBand{N}Freq", () => {
    const { onParamChange } = renderStrip(1);
    const slider = screen.getByTestId("eq-band-2-freq");
    fireEvent.change(slider, { target: { value: "1500" } });
    expect(onParamChange).toHaveBeenCalledWith("eqBand2Freq", 1500);
  });

  it("Q slider dispatches eqBand{N}Q", () => {
    const { onParamChange } = renderStrip(2);
    const slider = screen.getByTestId("eq-band-3-q");
    fireEvent.change(slider, { target: { value: "3.5" } });
    expect(onParamChange).toHaveBeenCalledWith("eqBand3Q", 3.5);
  });

  it("Gain slider dispatches legacy eq{band} key (backward compat)", () => {
    const { onParamChange } = renderStrip(0); // Band 1 → eq80
    const slider = screen.getByTestId("eq-band-1-gain");
    fireEvent.change(slider, { target: { value: "4.5" } });
    expect(onParamChange).toHaveBeenCalledWith("eq80", 4.5);
  });

  it("Type pills dispatch eqBand{N}Type", () => {
    const { onParamChange } = renderStrip(3);
    const pill = screen.getByTestId("eq-band-4-type-highPass");
    fireEvent.click(pill);
    expect(onParamChange).toHaveBeenCalledWith("eqBand4Type", "highPass");
  });

  it("Mode pills dispatch eqBand{N}Mode", () => {
    const { onParamChange } = renderStrip(2);
    const pill = screen.getByTestId("eq-band-3-mode-ms");
    fireEvent.click(pill);
    expect(onParamChange).toHaveBeenCalledWith("eqBand3Mode", "ms");
  });

  it("MS Balance slider is hidden by default (mode=stereo)", () => {
    renderStrip(2);
    expect(screen.queryByTestId("eq-band-3-msbalance")).toBeNull();
  });

  it("MS Balance slider is visible when mode=ms", () => {
    const { onParamChange } = renderStrip(2, { eqBand3Mode: "ms" });
    expect(screen.getByTestId("eq-band-3-msbalance")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("eq-band-3-msbalance"), {
      target: { value: "0.5" },
    });
    expect(onParamChange).toHaveBeenCalledWith("eqBand3MsBalance", 0.5);
  });

  it("Gain mapping: band index 0..4 → eq80/eq250/eq1k/eq4k/eq12k", () => {
    const expected = ["eq80", "eq250", "eq1k", "eq4k", "eq12k"];
    for (let i = 0; i < 5; i++) {
      const onParamChange = vi.fn();
      const { unmount } = render(
        <EqBandStrip
          bandIndex={i as 0 | 1 | 2 | 3 | 4}
          defaultOpen
          params={DEFAULT_PARAMS}
          onParamChange={onParamChange}
        />,
      );
      fireEvent.change(screen.getByTestId(`eq-band-${i + 1}-gain`), {
        target: { value: "2" },
      });
      expect(onParamChange).toHaveBeenCalledWith(expected[i], 2);
      unmount();
    }
  });
});
