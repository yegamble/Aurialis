import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MasterToolbar } from "../MasterToolbar";

describe("MasterToolbar", () => {
  const baseProps = {
    fileName: "test-track.wav",
    durationLabel: "3:38",
    sampleRateLabel: "44.1 kHz",
    channelLabel: "Stereo",
    mode: "simple" as const,
    onModeChange: vi.fn(),
    onBack: vi.fn(),
  };

  it("renders the file name and meta line", () => {
    render(<MasterToolbar {...baseProps} />);
    expect(screen.getByText("test-track.wav")).toBeInTheDocument();
    expect(screen.getByText(/3:38/)).toBeInTheDocument();
    expect(screen.getByText(/44\.1 kHz/)).toBeInTheDocument();
    expect(screen.getByText(/Stereo/)).toBeInTheDocument();
  });

  it("renders the three mode toggles with stable testids", () => {
    render(<MasterToolbar {...baseProps} />);
    expect(screen.getByTestId("mode-toggle-simple")).toBeInTheDocument();
    expect(screen.getByTestId("mode-toggle-advanced")).toBeInTheDocument();
    expect(screen.getByTestId("mode-toggle-deep")).toBeInTheDocument();
  });

  it("aria-pressed reflects the active mode", () => {
    const { rerender } = render(<MasterToolbar {...baseProps} mode="simple" />);
    expect(screen.getByTestId("mode-toggle-simple")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("mode-toggle-advanced")).toHaveAttribute("aria-pressed", "false");

    rerender(<MasterToolbar {...baseProps} mode="deep" />);
    expect(screen.getByTestId("mode-toggle-deep")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("mode-toggle-simple")).toHaveAttribute("aria-pressed", "false");
  });

  it.each([
    ["simple", "mode-toggle-simple"],
    ["advanced", "mode-toggle-advanced"],
    ["deep", "mode-toggle-deep"],
  ] as const)("fires onModeChange('%s') when %s is clicked", (modeId, testId) => {
    const onModeChange = vi.fn();
    render(<MasterToolbar {...baseProps} onModeChange={onModeChange} />);
    fireEvent.click(screen.getByTestId(testId));
    expect(onModeChange).toHaveBeenCalledWith(modeId);
  });

  it("invokes onBack when the back button is clicked", () => {
    const onBack = vi.fn();
    render(<MasterToolbar {...baseProps} onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("renders optional trailing slot children", () => {
    render(
      <MasterToolbar {...baseProps}>
        <span data-testid="trailing-slot">badge</span>
      </MasterToolbar>,
    );
    expect(screen.getByTestId("trailing-slot")).toBeInTheDocument();
  });
});
