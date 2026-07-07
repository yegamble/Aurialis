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

  it("disables bit-depth and dither selects for MP3 (they don't apply)", () => {
    render(<ExportPanel onExport={vi.fn()} />);
    const group = screen.getByRole("group", { name: "Format" });
    fireEvent.click(within(group).getByRole("button", { name: "MP3" }));
    expect(screen.getByLabelText("Bit Depth")).toBeDisabled();
    expect(screen.getByLabelText("Dither")).toBeDisabled();
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
