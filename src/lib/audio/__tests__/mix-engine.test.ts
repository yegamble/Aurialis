import { describe, it, expect, vi, beforeEach } from "vitest";
import { MixEngine } from "../mix-engine";
import type { StemTrack } from "@/types/mixer";
import { DEFAULT_CHANNEL_PARAMS } from "@/types/mixer";

function makeMockBuffer(duration = 3, sampleRate = 44100): AudioBuffer {
  const length = Math.floor(duration * sampleRate);
  return {
    duration,
    sampleRate,
    numberOfChannels: 2,
    length,
    getChannelData: vi.fn().mockReturnValue(new Float32Array(length)),
    copyFromChannel: vi.fn(),
    copyToChannel: vi.fn(),
  } as unknown as AudioBuffer;
}

function makeStem(overrides: Partial<StemTrack> = {}): StemTrack {
  return {
    id: `stem-${Math.random().toString(36).slice(2, 8)}`,
    name: "test.wav",
    file: new File([""], "test.wav"),
    audioBuffer: makeMockBuffer(),
    waveformPeaks: [0.5],
    classification: "other",
    confidence: 0,
    channelParams: { ...DEFAULT_CHANNEL_PARAMS },
    offset: 0,
    duration: 3,
    color: "#FF6B6B",
    ...overrides,
  };
}

describe("MixEngine", () => {
  let engine: MixEngine;

  beforeEach(() => {
    engine = new MixEngine();
  });

  afterEach(async () => {
    await engine.dispose();
  });

  describe("initialization", () => {
    it("creates without error", () => {
      expect(engine).toBeDefined();
    });

    it("starts not playing", () => {
      expect(engine.isPlaying).toBe(false);
    });

    it("starts with zero duration", () => {
      expect(engine.duration).toBe(0);
    });

    it("initializes audio context on init()", async () => {
      await engine.init();
      expect(engine.isInitialized).toBe(true);
    });

    it("is idempotent (calling init twice is safe)", async () => {
      await engine.init();
      await engine.init();
      expect(engine.isInitialized).toBe(true);
    });
  });

  describe("stem management", () => {
    it("adds a stem", async () => {
      await engine.init();
      const stem = makeStem({ id: "s1" });

      engine.addStem(stem);

      expect(engine.stemCount).toBe(1);
    });

    it("adds multiple stems", async () => {
      await engine.init();

      engine.addStem(makeStem({ id: "s1" }));
      engine.addStem(makeStem({ id: "s2" }));
      engine.addStem(makeStem({ id: "s3" }));

      expect(engine.stemCount).toBe(3);
    });

    it("removes a stem by id", async () => {
      await engine.init();
      engine.addStem(makeStem({ id: "s1" }));
      engine.addStem(makeStem({ id: "s2" }));

      engine.removeStem("s1");

      expect(engine.stemCount).toBe(1);
    });

    it("updates duration based on longest stem + offset", async () => {
      await engine.init();
      engine.addStem(makeStem({ id: "s1", duration: 5, offset: 0 }));
      engine.addStem(makeStem({ id: "s2", duration: 3, offset: 4 }));

      // max(5+0, 3+4) = 7
      expect(engine.duration).toBe(7);
    });

    it("recalculates duration after stem removal", async () => {
      await engine.init();
      engine.addStem(makeStem({ id: "s1", duration: 5 }));
      engine.addStem(makeStem({ id: "s2", duration: 10 }));

      expect(engine.duration).toBe(10);

      engine.removeStem("s2");

      expect(engine.duration).toBe(5);
    });
  });

  describe("playback", () => {
    it("play sets isPlaying to true", async () => {
      await engine.init();
      engine.addStem(makeStem({ id: "s1" }));

      await engine.play();

      expect(engine.isPlaying).toBe(true);
    });

    it("pause sets isPlaying to false", async () => {
      await engine.init();
      engine.addStem(makeStem({ id: "s1" }));
      await engine.play();

      engine.pause();

      expect(engine.isPlaying).toBe(false);
    });

    it("stop resets to beginning", async () => {
      await engine.init();
      engine.addStem(makeStem({ id: "s1" }));
      await engine.play();

      engine.stop();

      expect(engine.isPlaying).toBe(false);
      expect(engine.getCurrentTime()).toBe(0);
    });

    it("seek updates current time", async () => {
      await engine.init();
      engine.addStem(makeStem({ id: "s1", duration: 10 }));

      engine.seek(5);

      expect(engine.getCurrentTime()).toBe(5);
    });

    it("seek clamps to duration", async () => {
      await engine.init();
      engine.addStem(makeStem({ id: "s1", duration: 10 }));

      engine.seek(15);

      expect(engine.getCurrentTime()).toBe(10);
    });

    it("seek clamps to 0", async () => {
      await engine.init();
      engine.addStem(makeStem({ id: "s1" }));

      engine.seek(-5);

      expect(engine.getCurrentTime()).toBe(0);
    });

    it("does nothing when playing with no stems", async () => {
      await engine.init();

      await engine.play();

      expect(engine.isPlaying).toBe(false);
    });
  });

  describe("channel strip parameters", () => {
    it("updates volume on a stem", async () => {
      await engine.init();
      const stem = makeStem({ id: "s1" });
      engine.addStem(stem);

      engine.updateStemVolume("s1", -6);

      // No throw = success; volume applied to gain node
    });

    it("updates pan on a stem", async () => {
      await engine.init();
      engine.addStem(makeStem({ id: "s1" }));

      engine.updateStemPan("s1", -0.75);

      // No throw = success
    });

    it("updates EQ on a stem", async () => {
      await engine.init();
      engine.addStem(makeStem({ id: "s1" }));

      engine.updateStemEQ("s1", 0, 3); // boost 80Hz by 3dB

      // No throw = success
    });

    it("updates compressor on a stem", async () => {
      await engine.init();
      engine.addStem(makeStem({ id: "s1" }));

      engine.updateStemCompressor("s1", {
        threshold: -20,
        ratio: 4,
        attack: 10,
        release: 100,
      });
    });

    it("updates saturation drive on a stem", async () => {
      await engine.init();
      engine.addStem(makeStem({ id: "s1" }));

      engine.updateStemSaturation("s1", 30);
    });

    it("ignores updates for unknown stem id", async () => {
      await engine.init();
      engine.addStem(makeStem({ id: "s1" }));

      // Should not throw
      engine.updateStemVolume("nonexistent", -6);
      engine.updateStemPan("nonexistent", 0.5);
    });
  });

  describe("mute and solo", () => {
    it("mute silences a stem", async () => {
      await engine.init();
      engine.addStem(makeStem({ id: "s1" }));
      engine.addStem(makeStem({ id: "s2" }));

      engine.setMute("s1", true);

      // s1 should be muted (gain = 0), s2 should be audible
      expect(engine.isMuted("s1")).toBe(true);
      expect(engine.isMuted("s2")).toBe(false);
    });

    it("unmute restores a stem", async () => {
      await engine.init();
      engine.addStem(makeStem({ id: "s1" }));

      engine.setMute("s1", true);
      engine.setMute("s1", false);

      expect(engine.isMuted("s1")).toBe(false);
    });

    it("solo mutes all other stems", async () => {
      await engine.init();
      engine.addStem(makeStem({ id: "s1" }));
      engine.addStem(makeStem({ id: "s2" }));
      engine.addStem(makeStem({ id: "s3" }));

      engine.setSolo("s1", true);

      expect(engine.isSoloed("s1")).toBe(true);
      expect(engine.isEffectivelyMuted("s2")).toBe(true);
      expect(engine.isEffectivelyMuted("s3")).toBe(true);
      expect(engine.isEffectivelyMuted("s1")).toBe(false);
    });

    it("multiple solos allow multiple stems to be heard", async () => {
      await engine.init();
      engine.addStem(makeStem({ id: "s1" }));
      engine.addStem(makeStem({ id: "s2" }));
      engine.addStem(makeStem({ id: "s3" }));

      engine.setSolo("s1", true);
      engine.setSolo("s2", true);

      expect(engine.isEffectivelyMuted("s1")).toBe(false);
      expect(engine.isEffectivelyMuted("s2")).toBe(false);
      expect(engine.isEffectivelyMuted("s3")).toBe(true);
    });

    it("unsolo restores normal state when no solos remain", async () => {
      await engine.init();
      engine.addStem(makeStem({ id: "s1" }));
      engine.addStem(makeStem({ id: "s2" }));

      engine.setSolo("s1", true);
      engine.setSolo("s1", false);

      expect(engine.isEffectivelyMuted("s1")).toBe(false);
      expect(engine.isEffectivelyMuted("s2")).toBe(false);
    });
  });

  describe("time offset", () => {
    it("sets stem offset", async () => {
      await engine.init();
      engine.addStem(makeStem({ id: "s1", duration: 5 }));

      engine.setStemOffset("s1", 2.5);

      expect(engine.getStemOffset("s1")).toBe(2.5);
    });

    it("updates total duration when offset changes", async () => {
      await engine.init();
      engine.addStem(makeStem({ id: "s1", duration: 5 }));
      engine.addStem(makeStem({ id: "s2", duration: 5 }));

      engine.setStemOffset("s2", 3);

      // max(5+0, 5+3) = 8
      expect(engine.duration).toBe(8);
    });

    it("clamps offset to >= 0", async () => {
      await engine.init();
      engine.addStem(makeStem({ id: "s1" }));

      engine.setStemOffset("s1", -2);

      expect(engine.getStemOffset("s1")).toBe(0);
    });
  });

  describe("master volume", () => {
    it("sets master volume in dB", async () => {
      await engine.init();

      engine.setMasterVolume(-3);

      // No throw = success
    });
  });

  describe("summing bus output", () => {
    it("exposes output node for external connection", async () => {
      await engine.init();

      expect(engine.output).toBeDefined();
    });
  });

  describe("event system", () => {
    it("emits statechange on play", async () => {
      await engine.init();
      engine.addStem(makeStem({ id: "s1" }));
      const handler = vi.fn();
      engine.on("statechange", handler);

      await engine.play();

      expect(handler).toHaveBeenCalledWith({ isPlaying: true });
    });

    it("emits statechange on pause", async () => {
      await engine.init();
      engine.addStem(makeStem({ id: "s1" }));
      await engine.play();
      const handler = vi.fn();
      engine.on("statechange", handler);

      engine.pause();

      expect(handler).toHaveBeenCalledWith({ isPlaying: false });
    });

    it("emits statechange on stop", async () => {
      await engine.init();
      engine.addStem(makeStem({ id: "s1" }));
      await engine.play();
      const handler = vi.fn();
      engine.on("statechange", handler);

      engine.stop();

      expect(handler).toHaveBeenCalledWith({ isPlaying: false });
    });

    it("removes event listeners with off()", async () => {
      await engine.init();
      engine.addStem(makeStem({ id: "s1" }));
      const handler = vi.fn();
      engine.on("statechange", handler);
      engine.off("statechange", handler);

      await engine.play();

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("dispose", () => {
    it("cleans up all resources", async () => {
      await engine.init();
      engine.addStem(makeStem({ id: "s1" }));
      engine.addStem(makeStem({ id: "s2" }));

      await engine.dispose();

      expect(engine.isDisposed).toBe(true);
      expect(engine.stemCount).toBe(0);
    });

    it("is safe to call dispose multiple times", async () => {
      await engine.init();

      await engine.dispose();
      await engine.dispose();

      expect(engine.isDisposed).toBe(true);
    });

    it("stops playback on dispose", async () => {
      await engine.init();
      engine.addStem(makeStem({ id: "s1" }));
      await engine.play();

      await engine.dispose();

      expect(engine.isPlaying).toBe(false);
    });
  });

  describe("apply all channel params at once", () => {
    it("applyChannelParams sets all params for a stem", async () => {
      await engine.init();
      engine.addStem(makeStem({ id: "s1" }));

      engine.applyChannelParams("s1", {
        ...DEFAULT_CHANNEL_PARAMS,
        volume: -6,
        pan: 0.5,
        eq: [2, -1, 0, 3, 1],
        compThreshold: -20,
        compRatio: 4,
        satDrive: 25,
      });

      // Should not throw, all params applied
    });
  });
});
