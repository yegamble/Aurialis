import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChannelStrip } from "../ChannelStrip";
import { DEFAULT_CHANNEL_PARAMS } from "@/types/mixer";
import type { StemChannelParams, StemClassification } from "@/types/mixer";

const defaultProps = {
  stemId: "s1",
  name: "vocals.wav",
  color: "#FF6B6B",
  classification: "vocals" as StemClassification,
  params: { ...DEFAULT_CHANNEL_PARAMS },
  onParamChange: vi.fn(),
  onMuteToggle: vi.fn(),
  onSoloToggle: vi.fn(),
  isEffectivelyMuted: false,
};

describe("ChannelStrip", () => {
  it("renders stem name", () => {
    render(<ChannelStrip {...defaultProps} />);
    expect(screen.getByText("vocals.wav")).toBeInTheDocument();
  });

  it("renders classification badge", () => {
    render(<ChannelStrip {...defaultProps} />);
    expect(screen.getByText("vocals")).toBeInTheDocument();
  });

  it("renders volume slider", () => {
    render(<ChannelStrip {...defaultProps} />);
    expect(screen.getByLabelText(/volume/i)).toBeInTheDocument();
  });

  it("renders pan slider", () => {
    render(<ChannelStrip {...defaultProps} />);
    expect(screen.getByLabelText(/pan/i)).toBeInTheDocument();
  });

  it("renders mute button", () => {
    render(<ChannelStrip {...defaultProps} />);
    expect(screen.getByRole("button", { name: /mute/i })).toBeInTheDocument();
  });

  it("renders solo button", () => {
    render(<ChannelStrip {...defaultProps} />);
    expect(screen.getByRole("button", { name: /solo/i })).toBeInTheDocument();
  });

  it("calls onMuteToggle when mute button clicked", () => {
    const onMuteToggle = vi.fn();
    render(<ChannelStrip {...defaultProps} onMuteToggle={onMuteToggle} />);

    fireEvent.click(screen.getByRole("button", { name: /mute/i }));

    expect(onMuteToggle).toHaveBeenCalledWith("s1");
  });

  it("calls onSoloToggle when solo button clicked", () => {
    const onSoloToggle = vi.fn();
    render(<ChannelStrip {...defaultProps} onSoloToggle={onSoloToggle} />);

    fireEvent.click(screen.getByRole("button", { name: /solo/i }));

    expect(onSoloToggle).toHaveBeenCalledWith("s1");
  });

  it("shows mute button as active when muted", () => {
    render(
      <ChannelStrip
        {...defaultProps}
        params={{ ...DEFAULT_CHANNEL_PARAMS, mute: true }}
      />
    );

    const muteBtn = screen.getByRole("button", { name: /mute/i });
    expect(muteBtn).toHaveAttribute("aria-pressed", "true");
  });

  it("shows solo button as active when soloed", () => {
    render(
      <ChannelStrip
        {...defaultProps}
        params={{ ...DEFAULT_CHANNEL_PARAMS, solo: true }}
      />
    );

    const soloBtn = screen.getByRole("button", { name: /solo/i });
    expect(soloBtn).toHaveAttribute("aria-pressed", "true");
  });

  it("renders EQ section", () => {
    render(<ChannelStrip {...defaultProps} />);
    expect(screen.getByText(/eq/i)).toBeInTheDocument();
  });

  it("renders compressor section", () => {
    render(<ChannelStrip {...defaultProps} />);
    expect(screen.getByText(/compressor/i)).toBeInTheDocument();
  });

  it("renders saturation control", () => {
    render(<ChannelStrip {...defaultProps} />);
    expect(screen.getByLabelText(/drive/i)).toBeInTheDocument();
  });

  it("displays color indicator", () => {
    render(<ChannelStrip {...defaultProps} />);
    const indicator = screen.getByTestId("stem-color-indicator");
    expect(indicator).toBeInTheDocument();
  });
});
