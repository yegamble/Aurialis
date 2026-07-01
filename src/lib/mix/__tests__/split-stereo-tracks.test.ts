import { describe, it, expect } from "vitest";
import { buildStereoSubTracks } from "../split-stereo-tracks";
import { DEFAULT_CHANNEL_PARAMS, type StemTrack } from "@/types/mixer";
import type { StereoSplitResult } from "@/lib/audio/stereo-split";

// A parent stem with non-default fields so we can assert what is preserved.
const parent: StemTrack = {
  id: "stem-42",
  name: "other.wav",
  audioBuffer: null,
  waveformPeaks: [],
  classification: "other",
  confidence: 0.6,
  channelParams: { ...DEFAULT_CHANNEL_PARAMS, volume: -3 },
  offset: 1.5,
  duration: 10,
  color: "#abcdef",
};

const split: StereoSplitResult = {
  left: Float32Array.of(1, 2, 3),
  right: Float32Array.of(4, 5, 6),
  hasPannedContent: true,
};

// Fake buffer factory: echoes the samples back so we can assert L→left, R→right.
function fakeMakeBuffer(data: Float32Array): AudioBuffer {
  return { length: data.length, duration: data.length, _data: data } as unknown as AudioBuffer;
}
const fakePeaks = (buffer: AudioBuffer) => [buffer.length];

describe("buildStereoSubTracks", () => {
  it("produces exactly two hard-panned sub-stems", () => {
    const tracks = buildStereoSubTracks(parent, split, fakeMakeBuffer, fakePeaks, 100);
    expect(tracks).toHaveLength(2);
    expect(tracks[0].channelParams.pan).toBe(-1); // L hard-left
    expect(tracks[1].channelParams.pan).toBe(1); // R hard-right
  });

  it("routes the split's left channel to the L stem and right to the R stem", () => {
    const tracks = buildStereoSubTracks(parent, split, fakeMakeBuffer, fakePeaks, 100);
    expect((tracks[0].audioBuffer as unknown as { _data: Float32Array })._data).toBe(split.left);
    expect((tracks[1].audioBuffer as unknown as { _data: Float32Array })._data).toBe(split.right);
  });

  it("names sub-stems from the parent base name without the .wav suffix", () => {
    const tracks = buildStereoSubTracks(parent, split, fakeMakeBuffer, fakePeaks, 100);
    expect(tracks[0].name).toBe("other → L.wav");
    expect(tracks[1].name).toBe("other → R.wav");
  });

  it("preserves the parent's classification, confidence and offset", () => {
    const tracks = buildStereoSubTracks(parent, split, fakeMakeBuffer, fakePeaks, 100);
    for (const t of tracks) {
      expect(t.classification).toBe("other");
      expect(t.confidence).toBe(0.6);
      expect(t.offset).toBe(1.5);
    }
  });

  it("gives unique ids derived from parent id + side + seed", () => {
    const tracks = buildStereoSubTracks(parent, split, fakeMakeBuffer, fakePeaks, 777);
    expect(tracks[0].id).toBe("stem-42-lr-L-777");
    expect(tracks[1].id).toBe("stem-42-lr-R-777");
    expect(tracks[0].id).not.toBe(tracks[1].id);
  });

  it("resets channel params to defaults apart from pan (no inherited volume)", () => {
    const tracks = buildStereoSubTracks(parent, split, fakeMakeBuffer, fakePeaks, 100);
    expect(tracks[0].channelParams.volume).toBe(DEFAULT_CHANNEL_PARAMS.volume);
  });
});
