import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ExportView } from "../ExportView";

const baseProps = {
  onExport: vi.fn(),
  isExporting: false,
  lufs: -8.7,
  truePeak: -1.0,
  lra: 6.2,
  lraReady: true,
  dynamicRange: 11.3,
  durationSec: 218,
};

describe("ExportView", () => {
  it("renders the export controls (ExportPanel) and the audio summary", () => {
    render(<ExportView {...baseProps} />);
    // ExportPanel's export button is present.
    expect(screen.getByRole("button", { name: /Export WAV/i })).toBeInTheDocument();
    const summary = screen.getByTestId("export-view");
    expect(within(summary).getByText("Audio summary")).toBeInTheDocument();
  });

  it("shows the mastered loudness/peak/range numbers", () => {
    render(<ExportView {...baseProps} />);
    const view = screen.getByTestId("export-view");
    expect(within(view).getByText("-8.7")).toBeInTheDocument(); // LUFS-I
    expect(within(view).getByText("-1.0 dBTP")).toBeInTheDocument();
    expect(within(view).getByText("6.2 LU")).toBeInTheDocument();
    expect(within(view).getByText("11.3")).toBeInTheDocument(); // DR
    expect(within(view).getByText("3:38")).toBeInTheDocument(); // duration
  });

  it("renders em-dash placeholders for unavailable metrics", () => {
    render(
      <ExportView
        {...baseProps}
        lufs={-Infinity}
        lraReady={false}
        dynamicRange={NaN}
      />,
    );
    const view = screen.getByTestId("export-view");
    // LUFS-I, LRA, and DR all unavailable → at least 3 em-dashes.
    expect(within(view).getAllByText("—").length).toBeGreaterThanOrEqual(3);
  });
});
