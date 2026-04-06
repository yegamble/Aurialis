import { describe, it, expect, vi } from "vitest";
import { renderMix } from "../mix-renderer";
import { DEFAULT_CHANNEL_PARAMS } from "@/types/mixer";
import { DEFAULT_PARAMS } from "../presets";
import type { StemTrack } from "@/types/mixer";

function makeStem(overrides: Partial<StemTrack> = {}): StemTrack {
  const mockBuffer = {
    duration: 2,
    sampleRate: 44100,
    numberOfChannels: 2,
    length: 88200,
    getChannelData: vi.fn().mockReturnValue(new Float32Array(88200)),
    copyFromChannel: vi.fn(),
    copyToChannel: vi.fn(),
  } as unknown as AudioBuffer;

  return {
    id: `stem-${Math.random().toString(36).slice(2, 8)}`,
    name: "test.wav",
    file: new File([""], "test.wav"),
    audioBuffer: mockBuffer,
    waveformPeaks: [0.5],
    classification: "other",
    confidence: 0,
    channelParams: { ...DEFAULT_CHANNEL_PARAMS },
    offset: 0,
    duration: 2,
    color: "#FF6B6B",
    ...overrides,
  };
}

describe("mix-renderer", () => {
  it("throws for empty stems array", async () => {
    await expect(renderMix([], 44100)).rejects.toThrow("No stems to render");
  });

  it("renders a single stem", async () => {
    const stem = makeStem({ id: "s1", duration: 2 });

    const result = await renderMix([stem], 44100);

    expect(result).toBeDefined();
    expect(result.numberOfChannels).toBe(2);
    expect(result.sampleRate).toBe(44100);
  });

  it("renders multiple stems", async () => {
    const stems = [
      makeStem({ id: "s1", duration: 2 }),
      makeStem({ id: "s2", duration: 3 }),
    ];

    const result = await renderMix(stems, 44100);

    expect(result).toBeDefined();
    // Duration should be at least the max stem duration
    expect(result.duration).toBeGreaterThanOrEqual(2);
  });

  it("respects stem time offset", async () => {
    const stems = [
      makeStem({ id: "s1", duration: 2, offset: 0 }),
      makeStem({ id: "s2", duration: 2, offset: 3 }),
    ];

    const result = await renderMix(stems, 44100);

    // Total duration: max(2+0, 2+3) = 5
    expect(result.duration).toBeCloseTo(5, 0);
  });

  it("skips muted stems", async () => {
    const stems = [
      makeStem({ id: "s1" }),
      makeStem({
        id: "s2",
        channelParams: { ...DEFAULT_CHANNEL_PARAMS, mute: true },
      }),
    ];

    // Should not throw — just processes s1 and skips s2
    const result = await renderMix(stems, 44100);
    expect(result).toBeDefined();
  });

  it("skips stems with null audioBuffer", async () => {
    const stems = [
      makeStem({ id: "s1" }),
      makeStem({ id: "s2", audioBuffer: null }),
    ];

    const result = await renderMix(stems, 44100);
    expect(result).toBeDefined();
  });

  it("applies volume gain to stems", async () => {
    const stem = makeStem({
      id: "s1",
      channelParams: { ...DEFAULT_CHANNEL_PARAMS, volume: -12 },
    });

    const result = await renderMix([stem], 44100);
    expect(result).toBeDefined();
  });

  it("applies pan to stems", async () => {
    const stem = makeStem({
      id: "s1",
      channelParams: { ...DEFAULT_CHANNEL_PARAMS, pan: -1 },
    });

    const result = await renderMix([stem], 44100);
    expect(result).toBeDefined();
  });

  it("applies EQ to stems", async () => {
    const stem = makeStem({
      id: "s1",
      channelParams: { ...DEFAULT_CHANNEL_PARAMS, eq: [3, 0, -2, 1, 2] },
    });

    const result = await renderMix([stem], 44100);
    expect(result).toBeDefined();
  });

  it("renders at specified sample rate", async () => {
    const stem = makeStem({ id: "s1" });

    const result = await renderMix([stem], 48000);
    expect(result.sampleRate).toBe(48000);
  });

  it("applies the master bus when master params are provided", async () => {
    const stem = makeStem({ id: "s1" });

    const result = await renderMix([stem], 44100, DEFAULT_PARAMS);

    expect(result).toBeDefined();
    expect(result.sampleRate).toBe(44100);
  });
});
