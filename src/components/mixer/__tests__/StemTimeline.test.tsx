import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StemTimeline } from "../StemTimeline";
import type { StemTrack } from "@/types/mixer";
import { DEFAULT_CHANNEL_PARAMS, STEM_COLORS } from "@/types/mixer";

function makeStem(overrides: Partial<StemTrack> = {}): StemTrack {
  return {
    id: `stem-${Math.random().toString(36).slice(2, 8)}`,
    name: "test.wav",
    file: new File([""], "test.wav"),
    audioBuffer: null,
    waveformPeaks: Array.from({ length: 50 }, () => Math.random()),
    classification: "other",
    confidence: 0,
    channelParams: { ...DEFAULT_CHANNEL_PARAMS },
    offset: 0,
    duration: 5,
    color: STEM_COLORS[0],
    ...overrides,
  };
}

describe("StemTimeline", () => {
  it("renders a lane for each stem", () => {
    const stems = [
      makeStem({ id: "s1", name: "vocals.wav" }),
      makeStem({ id: "s2", name: "drums.wav" }),
    ];

    render(
      <StemTimeline
        stems={stems}
        currentTime={0}
        duration={10}
        onSeek={vi.fn()}
        onOffsetChange={vi.fn()}
      />
    );

    expect(screen.getByText("vocals.wav")).toBeInTheDocument();
    expect(screen.getByText("drums.wav")).toBeInTheDocument();
  });

  it("renders empty state when no stems", () => {
    render(
      <StemTimeline
        stems={[]}
        currentTime={0}
        duration={0}
        onSeek={vi.fn()}
        onOffsetChange={vi.fn()}
      />
    );

    expect(screen.getByTestId("stem-timeline")).toBeInTheDocument();
  });

  it("renders time markers", () => {
    render(
      <StemTimeline
        stems={[makeStem({ duration: 60 })]}
        currentTime={0}
        duration={60}
        onSeek={vi.fn()}
        onOffsetChange={vi.fn()}
      />
    );

    expect(screen.getByText("0:00")).toBeInTheDocument();
  });

  it("calls onSeek when timeline clicked", () => {
    const onSeek = vi.fn();
    render(
      <StemTimeline
        stems={[makeStem({ duration: 10 })]}
        currentTime={0}
        duration={10}
        onSeek={onSeek}
        onOffsetChange={vi.fn()}
      />
    );

    const timeline = screen.getByTestId("stem-timeline");
    fireEvent.click(timeline, { clientX: 100 });

    expect(onSeek).toHaveBeenCalled();
  });

  it("renders canvas for each lane", () => {
    const stems = [
      makeStem({ id: "s1" }),
      makeStem({ id: "s2" }),
    ];

    render(
      <StemTimeline
        stems={stems}
        currentTime={0}
        duration={10}
        onSeek={vi.fn()}
        onOffsetChange={vi.fn()}
      />
    );

    const canvases = document.querySelectorAll("canvas");
    expect(canvases.length).toBeGreaterThanOrEqual(2);
  });

  it("has data-testid stem-timeline", () => {
    render(
      <StemTimeline
        stems={[]}
        currentTime={0}
        duration={0}
        onSeek={vi.fn()}
        onOffsetChange={vi.fn()}
      />
    );

    expect(screen.getByTestId("stem-timeline")).toBeInTheDocument();
  });
});
