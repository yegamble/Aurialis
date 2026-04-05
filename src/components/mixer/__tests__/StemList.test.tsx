import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { StemList } from "../StemList";
import { DEFAULT_CHANNEL_PARAMS, STEM_COLORS } from "@/types/mixer";
import type { StemTrack } from "@/types/mixer";

function makeStem(overrides: Partial<StemTrack> = {}): StemTrack {
  return {
    id: `stem-${Math.random().toString(36).slice(2, 8)}`,
    name: "test.wav",
    file: new File([""], "test.wav"),
    audioBuffer: null,
    waveformPeaks: [],
    classification: "other",
    confidence: 0,
    channelParams: { ...DEFAULT_CHANNEL_PARAMS },
    offset: 0,
    duration: 3,
    color: STEM_COLORS[0],
    ...overrides,
  };
}

describe("StemList", () => {
  it("renders a ChannelStrip for each stem", () => {
    const stems = [
      makeStem({ id: "s1", name: "vocals.wav" }),
      makeStem({ id: "s2", name: "drums.wav" }),
      makeStem({ id: "s3", name: "bass.wav" }),
    ];

    render(
      <StemList
        stems={stems}
        onParamChange={vi.fn()}
        onMuteToggle={vi.fn()}
        onSoloToggle={vi.fn()}
        isEffectivelyMuted={vi.fn().mockReturnValue(false)}
      />
    );

    expect(screen.getByText("vocals.wav")).toBeInTheDocument();
    expect(screen.getByText("drums.wav")).toBeInTheDocument();
    expect(screen.getByText("bass.wav")).toBeInTheDocument();
  });

  it("renders empty state when no stems", () => {
    render(
      <StemList
        stems={[]}
        onParamChange={vi.fn()}
        onMuteToggle={vi.fn()}
        onSoloToggle={vi.fn()}
        isEffectivelyMuted={vi.fn().mockReturnValue(false)}
      />
    );

    expect(screen.getByText(/no stems/i)).toBeInTheDocument();
  });

  it("has horizontal scroll container", () => {
    const stems = [
      makeStem({ id: "s1" }),
      makeStem({ id: "s2" }),
    ];

    render(
      <StemList
        stems={stems}
        onParamChange={vi.fn()}
        onMuteToggle={vi.fn()}
        onSoloToggle={vi.fn()}
        isEffectivelyMuted={vi.fn().mockReturnValue(false)}
      />
    );

    const container = screen.getByTestId("stem-list-container");
    expect(container).toBeInTheDocument();
  });
});
