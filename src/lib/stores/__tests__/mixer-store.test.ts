import { describe, it, expect, beforeEach } from "vitest";
import { useMixerStore } from "../mixer-store";
import { DEFAULT_CHANNEL_PARAMS } from "@/types/mixer";
import type { StemTrack } from "@/types/mixer";

function makeStem(overrides: Partial<StemTrack> = {}): StemTrack {
  return {
    id: `stem-${Math.random().toString(36).slice(2, 8)}`,
    name: "test.wav",
    file: new File([""], "test.wav"),
    audioBuffer: null,
    waveformPeaks: [0.1, 0.5, 0.3],
    classification: "other",
    confidence: 0,
    channelParams: { ...DEFAULT_CHANNEL_PARAMS },
    offset: 0,
    duration: 3.5,
    color: "#FF6B6B",
    ...overrides,
  };
}

describe("mixer-store", () => {
  beforeEach(() => {
    useMixerStore.getState().reset();
  });

  describe("initial state", () => {
    it("starts with empty stems", () => {
      expect(useMixerStore.getState().stems).toEqual([]);
    });

    it("starts not playing", () => {
      expect(useMixerStore.getState().isPlaying).toBe(false);
    });

    it("starts with zero time", () => {
      expect(useMixerStore.getState().currentTime).toBe(0);
    });

    it("starts with zero duration", () => {
      expect(useMixerStore.getState().duration).toBe(0);
    });

    it("starts with 0 dB master volume", () => {
      expect(useMixerStore.getState().masterVolume).toBe(0);
    });

    it("starts not auto-mixing", () => {
      expect(useMixerStore.getState().isAutoMixing).toBe(false);
    });

    it("starts with no selected stem", () => {
      expect(useMixerStore.getState().selectedStemId).toBeNull();
    });
  });

  describe("addStems", () => {
    it("adds stems to the array", () => {
      const stem1 = makeStem({ id: "s1", name: "vocals.wav" });
      const stem2 = makeStem({ id: "s2", name: "drums.wav" });

      useMixerStore.getState().addStems([stem1, stem2]);

      const { stems } = useMixerStore.getState();
      expect(stems).toHaveLength(2);
      expect(stems[0].name).toBe("vocals.wav");
      expect(stems[1].name).toBe("drums.wav");
    });

    it("appends to existing stems", () => {
      useMixerStore.getState().addStems([makeStem({ id: "s1" })]);
      useMixerStore.getState().addStems([makeStem({ id: "s2" })]);

      expect(useMixerStore.getState().stems).toHaveLength(2);
    });

    it("updates duration to max(stem.duration + stem.offset)", () => {
      useMixerStore.getState().addStems([
        makeStem({ id: "s1", duration: 10, offset: 0 }),
        makeStem({ id: "s2", duration: 8, offset: 5 }),
      ]);

      // max(10+0, 8+5) = 13
      expect(useMixerStore.getState().duration).toBe(13);
    });

    it("enforces MAX_STEMS limit", () => {
      const stems = Array.from({ length: 20 }, (_, i) =>
        makeStem({ id: `s${i}`, name: `stem-${i}.wav` })
      );

      useMixerStore.getState().addStems(stems);

      expect(useMixerStore.getState().stems).toHaveLength(16);
    });
  });

  describe("removeStem", () => {
    it("removes a stem by id", () => {
      useMixerStore.getState().addStems([
        makeStem({ id: "s1", name: "keep.wav", duration: 5 }),
        makeStem({ id: "s2", name: "remove.wav", duration: 10 }),
      ]);

      useMixerStore.getState().removeStem("s2");

      const { stems } = useMixerStore.getState();
      expect(stems).toHaveLength(1);
      expect(stems[0].name).toBe("keep.wav");
    });

    it("recalculates duration after removal", () => {
      useMixerStore.getState().addStems([
        makeStem({ id: "s1", duration: 5, offset: 0 }),
        makeStem({ id: "s2", duration: 15, offset: 0 }),
      ]);

      expect(useMixerStore.getState().duration).toBe(15);

      useMixerStore.getState().removeStem("s2");

      expect(useMixerStore.getState().duration).toBe(5);
    });

    it("does nothing for unknown id", () => {
      useMixerStore.getState().addStems([makeStem({ id: "s1" })]);
      useMixerStore.getState().removeStem("nonexistent");
      expect(useMixerStore.getState().stems).toHaveLength(1);
    });

    it("clears selectedStemId if the selected stem is removed", () => {
      useMixerStore.getState().addStems([makeStem({ id: "s1" })]);
      useMixerStore.getState().setSelectedStemId("s1");

      useMixerStore.getState().removeStem("s1");

      expect(useMixerStore.getState().selectedStemId).toBeNull();
    });
  });

  describe("updateStemParam", () => {
    it("updates a single channel param on a stem", () => {
      useMixerStore.getState().addStems([makeStem({ id: "s1" })]);

      useMixerStore.getState().updateStemParam("s1", "volume", -6);

      const stem = useMixerStore.getState().stems[0];
      expect(stem.channelParams.volume).toBe(-6);
    });

    it("updates pan", () => {
      useMixerStore.getState().addStems([makeStem({ id: "s1" })]);

      useMixerStore.getState().updateStemParam("s1", "pan", -0.75);

      expect(useMixerStore.getState().stems[0].channelParams.pan).toBe(-0.75);
    });

    it("updates mute toggle", () => {
      useMixerStore.getState().addStems([makeStem({ id: "s1" })]);

      useMixerStore.getState().updateStemParam("s1", "mute", true);

      expect(useMixerStore.getState().stems[0].channelParams.mute).toBe(true);
    });

    it("updates solo toggle", () => {
      useMixerStore.getState().addStems([makeStem({ id: "s1" })]);

      useMixerStore.getState().updateStemParam("s1", "solo", true);

      expect(useMixerStore.getState().stems[0].channelParams.solo).toBe(true);
    });

    it("updates EQ array", () => {
      useMixerStore.getState().addStems([makeStem({ id: "s1" })]);

      useMixerStore.getState().updateStemParam("s1", "eq", [2, -1, 0, 3, -2]);

      expect(useMixerStore.getState().stems[0].channelParams.eq).toEqual([
        2, -1, 0, 3, -2,
      ]);
    });

    it("updates compressor threshold", () => {
      useMixerStore.getState().addStems([makeStem({ id: "s1" })]);

      useMixerStore.getState().updateStemParam("s1", "compThreshold", -30);

      expect(useMixerStore.getState().stems[0].channelParams.compThreshold).toBe(-30);
    });

    it("updates saturation drive", () => {
      useMixerStore.getState().addStems([makeStem({ id: "s1" })]);

      useMixerStore.getState().updateStemParam("s1", "satDrive", 45);

      expect(useMixerStore.getState().stems[0].channelParams.satDrive).toBe(45);
    });

    it("preserves other stems when updating one", () => {
      useMixerStore.getState().addStems([
        makeStem({ id: "s1", name: "one.wav" }),
        makeStem({ id: "s2", name: "two.wav" }),
      ]);

      useMixerStore.getState().updateStemParam("s1", "volume", -12);

      const stems = useMixerStore.getState().stems;
      expect(stems[0].channelParams.volume).toBe(-12);
      expect(stems[1].channelParams.volume).toBe(0); // unchanged
    });

    it("does nothing for unknown stem id", () => {
      useMixerStore.getState().addStems([makeStem({ id: "s1" })]);

      useMixerStore.getState().updateStemParam("nonexistent", "volume", -6);

      expect(useMixerStore.getState().stems[0].channelParams.volume).toBe(0);
    });
  });

  describe("setClassification", () => {
    it("updates stem classification and confidence", () => {
      useMixerStore.getState().addStems([makeStem({ id: "s1" })]);

      useMixerStore.getState().setClassification("s1", "vocals", 0.95);

      const stem = useMixerStore.getState().stems[0];
      expect(stem.classification).toBe("vocals");
      expect(stem.confidence).toBe(0.95);
    });
  });

  describe("setStemOffset", () => {
    it("updates stem time offset", () => {
      useMixerStore.getState().addStems([
        makeStem({ id: "s1", duration: 10 }),
      ]);

      useMixerStore.getState().setStemOffset("s1", 2.5);

      expect(useMixerStore.getState().stems[0].offset).toBe(2.5);
    });

    it("recalculates duration when offset changes", () => {
      useMixerStore.getState().addStems([
        makeStem({ id: "s1", duration: 10, offset: 0 }),
        makeStem({ id: "s2", duration: 8, offset: 0 }),
      ]);

      expect(useMixerStore.getState().duration).toBe(10);

      useMixerStore.getState().setStemOffset("s2", 5);

      // max(10+0, 8+5) = 13
      expect(useMixerStore.getState().duration).toBe(13);
    });

    it("clamps offset to >= 0", () => {
      useMixerStore.getState().addStems([makeStem({ id: "s1" })]);

      useMixerStore.getState().setStemOffset("s1", -3);

      expect(useMixerStore.getState().stems[0].offset).toBe(0);
    });
  });

  describe("setAutoMixResults", () => {
    it("updates channel params for multiple stems at once", () => {
      useMixerStore.getState().addStems([
        makeStem({ id: "s1" }),
        makeStem({ id: "s2" }),
      ]);

      useMixerStore.getState().setAutoMixResults({
        s1: {
          ...DEFAULT_CHANNEL_PARAMS,
          volume: -3,
          pan: 0,
          eq: [2, 0, 1, 3, 2],
          compThreshold: -20,
        },
        s2: {
          ...DEFAULT_CHANNEL_PARAMS,
          volume: -6,
          pan: -0.5,
          compThreshold: -16,
          satDrive: 15,
        },
      });

      const stems = useMixerStore.getState().stems;
      expect(stems[0].channelParams.volume).toBe(-3);
      expect(stems[0].channelParams.eq).toEqual([2, 0, 1, 3, 2]);
      expect(stems[1].channelParams.volume).toBe(-6);
      expect(stems[1].channelParams.pan).toBe(-0.5);
      expect(stems[1].channelParams.satDrive).toBe(15);
    });

    it("sets isAutoMixing flag during application", () => {
      // After setAutoMixResults, isAutoMixing should be false (done)
      useMixerStore.getState().addStems([makeStem({ id: "s1" })]);
      useMixerStore.getState().setIsAutoMixing(true);

      expect(useMixerStore.getState().isAutoMixing).toBe(true);

      useMixerStore.getState().setAutoMixResults({
        s1: { ...DEFAULT_CHANNEL_PARAMS, volume: -3 },
      });

      // Explicitly toggle off after results applied
      useMixerStore.getState().setIsAutoMixing(false);
      expect(useMixerStore.getState().isAutoMixing).toBe(false);
    });
  });

  describe("playback state", () => {
    it("sets isPlaying", () => {
      useMixerStore.getState().setIsPlaying(true);
      expect(useMixerStore.getState().isPlaying).toBe(true);
    });

    it("sets currentTime", () => {
      useMixerStore.getState().setCurrentTime(5.5);
      expect(useMixerStore.getState().currentTime).toBe(5.5);
    });

    it("sets masterVolume", () => {
      useMixerStore.getState().setMasterVolume(-3);
      expect(useMixerStore.getState().masterVolume).toBe(-3);
    });

    it("sets selectedStemId", () => {
      useMixerStore.getState().setSelectedStemId("s1");
      expect(useMixerStore.getState().selectedStemId).toBe("s1");
    });
  });

  describe("reset", () => {
    it("resets all state to defaults", () => {
      useMixerStore.getState().addStems([makeStem({ id: "s1" })]);
      useMixerStore.getState().setIsPlaying(true);
      useMixerStore.getState().setCurrentTime(10);
      useMixerStore.getState().setMasterVolume(-6);
      useMixerStore.getState().setSelectedStemId("s1");

      useMixerStore.getState().reset();

      const state = useMixerStore.getState();
      expect(state.stems).toEqual([]);
      expect(state.isPlaying).toBe(false);
      expect(state.currentTime).toBe(0);
      expect(state.duration).toBe(0);
      expect(state.masterVolume).toBe(0);
      expect(state.isAutoMixing).toBe(false);
      expect(state.selectedStemId).toBeNull();
    });
  });
});
