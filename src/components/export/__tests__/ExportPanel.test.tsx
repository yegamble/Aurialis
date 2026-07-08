import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ExportPanel } from "../ExportPanel";

describe("ExportPanel", () => {
  it("defaults to WAV and labels the button 'Export WAV'", () => {
    render(<ExportPanel onExport={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "Export WAV" }),
    ).toBeInTheDocument();
    const group = screen.getByRole("group", { name: "Format" });
    expect(within(group).getByRole("button", { name: "WAV" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("switching to MP3 relabels the button and marks MP3 pressed", () => {
    render(<ExportPanel onExport={vi.fn()} />);
    const group = screen.getByRole("group", { name: "Format" });
    fireEvent.click(within(group).getByRole("button", { name: "MP3" }));
    expect(
      screen.getByRole("button", { name: "Export MP3" }),
    ).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: "MP3" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("passes the selected format to onExport", () => {
    const onExport = vi.fn();
    render(<ExportPanel onExport={onExport} />);
    const group = screen.getByRole("group", { name: "Format" });
    fireEvent.click(within(group).getByRole("button", { name: "MP3" }));
    fireEvent.click(screen.getByRole("button", { name: "Export MP3" }));
    expect(onExport).toHaveBeenCalledWith(
      expect.objectContaining({ format: "mp3" }),
    );
  });

  it("offers a 192 kHz sample-rate segment and passes it through", () => {
    const onExport = vi.fn();
    render(<ExportPanel onExport={onExport} />);
    const sr = screen.getByRole("group", { name: "Sample rate" });
    fireEvent.click(within(sr).getByRole("button", { name: "192 kHz" }));
    fireEvent.click(screen.getByRole("button", { name: "Export WAV" }));
    expect(onExport).toHaveBeenCalledWith(
      expect.objectContaining({ sampleRate: 192000 }),
    );
  });

  it("bit-depth is a segmented control passing a numeric depth", () => {
    const onExport = vi.fn();
    render(<ExportPanel onExport={onExport} />);
    const bd = screen.getByRole("group", { name: "Bit depth" });
    fireEvent.click(within(bd).getByRole("button", { name: "24-bit" }));
    fireEvent.click(screen.getByRole("button", { name: "Export WAV" }));
    expect(onExport).toHaveBeenCalledWith(
      expect.objectContaining({ bitDepth: 24 }),
    );
  });

  it("dither is a switch; on → tpdf, off → none", () => {
    const onExport = vi.fn();
    render(<ExportPanel onExport={onExport} />);
    const dither = screen.getByRole("switch", { name: "Dither" });
    // defaults on (TPDF)
    expect(dither).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: "Export WAV" }));
    expect(onExport).toHaveBeenLastCalledWith(
      expect.objectContaining({ dither: "tpdf" }),
    );
    fireEvent.click(dither); // turn off
    fireEvent.click(screen.getByRole("button", { name: "Export WAV" }));
    expect(onExport).toHaveBeenLastCalledWith(
      expect.objectContaining({ dither: "none" }),
    );
  });

  it("disables bit-depth and dither controls for MP3 (they don't apply)", () => {
    render(<ExportPanel onExport={vi.fn()} />);
    const format = screen.getByRole("group", { name: "Format" });
    fireEvent.click(within(format).getByRole("button", { name: "MP3" }));
    const bd = screen.getByRole("group", { name: "Bit depth" });
    within(bd)
      .getAllByRole("button")
      .forEach((b) => expect(b).toBeDisabled());
    expect(screen.getByRole("switch", { name: "Dither" })).toBeDisabled();
  });

  it("shows an indeterminate progress indicator only while exporting", () => {
    const { rerender } = render(
      <ExportPanel onExport={vi.fn()} isExporting={false} />,
    );
    expect(screen.queryByTestId("export-progress")).toBeNull();
    rerender(<ExportPanel onExport={vi.fn()} isExporting />);
    expect(screen.getByTestId("export-progress")).toBeInTheDocument();
    // Honest indeterminate bar — no fabricated percentage text.
    expect(screen.getByTestId("export-progress")).toHaveTextContent(/rendering/i);
  });

  it("passes WAV settings (format, sampleRate, bitDepth) by default", () => {
    const onExport = vi.fn();
    render(<ExportPanel onExport={onExport} />);
    fireEvent.click(screen.getByRole("button", { name: "Export WAV" }));
    expect(onExport).toHaveBeenCalledWith(
      expect.objectContaining({ format: "wav", sampleRate: 44100, bitDepth: 16 }),
    );
  });
});
