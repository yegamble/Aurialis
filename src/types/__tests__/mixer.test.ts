import { describe, it, expect } from "vitest";
import type {
  StemTrack,
  StemClassification,
  StemChannelParams,
  StemFeatures,
  AnalyzedStem,
} from "../mixer";
import {
  STEM_CLASSIFICATIONS,
  MAX_STEMS,
  DEFAULT_CHANNEL_PARAMS,
  STEM_COLORS,
} from "../mixer";

describe("mixer types", () => {
  describe("constants", () => {
    it("exports MAX_STEMS as 16", () => {
      expect(MAX_STEMS).toBe(16);
    });

    it("exports all stem classification values", () => {
      expect(STEM_CLASSIFICATIONS).toEqual([
        "vocals",
        "drums",
        "bass",
        "guitar",
        "keys",
        "synth",
        "strings",
        "fx",
        "other",
      ]);
    });

    it("exports 8 stem colors that cycle", () => {
      expect(STEM_COLORS).toHaveLength(8);
      STEM_COLORS.forEach((color) => {
        expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
      });
    });
  });

  describe("DEFAULT_CHANNEL_PARAMS", () => {
    it("has neutral volume (0 dB)", () => {
      expect(DEFAULT_CHANNEL_PARAMS.volume).toBe(0);
    });

    it("has centered pan", () => {
      expect(DEFAULT_CHANNEL_PARAMS.pan).toBe(0);
    });

    it("has mute and solo off", () => {
      expect(DEFAULT_CHANNEL_PARAMS.mute).toBe(false);
      expect(DEFAULT_CHANNEL_PARAMS.solo).toBe(false);
    });

    it("has flat 5-band EQ", () => {
      expect(DEFAULT_CHANNEL_PARAMS.eq).toEqual([0, 0, 0, 0, 0]);
    });

    it("has gentle compressor defaults", () => {
      expect(DEFAULT_CHANNEL_PARAMS.compThreshold).toBe(-24);
      expect(DEFAULT_CHANNEL_PARAMS.compRatio).toBe(2);
      expect(DEFAULT_CHANNEL_PARAMS.compAttack).toBe(20);
      expect(DEFAULT_CHANNEL_PARAMS.compRelease).toBe(250);
      expect(DEFAULT_CHANNEL_PARAMS.compMakeup).toBe(0);
    });

    it("has saturation off by default", () => {
      expect(DEFAULT_CHANNEL_PARAMS.satDrive).toBe(0);
    });
  });

  describe("type shape validation (compile-time + runtime)", () => {
    it("StemTrack has all required fields", () => {
      const track: StemTrack = {
        id: "stem-1",
        name: "vocals.wav",
        file: new File([""], "vocals.wav"),
        audioBuffer: null,
        waveformPeaks: [],
        classification: "vocals",
        confidence: 0.85,
        channelParams: { ...DEFAULT_CHANNEL_PARAMS },
        offset: 0,
        duration: 0,
        color: "#FF6B6B",
      };

      expect(track.id).toBe("stem-1");
      expect(track.name).toBe("vocals.wav");
      expect(track.classification).toBe("vocals");
      expect(track.offset).toBe(0);
    });

    it("StemChannelParams has all control fields", () => {
      const params: StemChannelParams = { ...DEFAULT_CHANNEL_PARAMS };
      expect(params).toHaveProperty("volume");
      expect(params).toHaveProperty("pan");
      expect(params).toHaveProperty("mute");
      expect(params).toHaveProperty("solo");
      expect(params).toHaveProperty("eq");
      expect(params).toHaveProperty("compThreshold");
      expect(params).toHaveProperty("compRatio");
      expect(params).toHaveProperty("compAttack");
      expect(params).toHaveProperty("compRelease");
      expect(params).toHaveProperty("compMakeup");
      expect(params).toHaveProperty("satDrive");
    });

    it("StemFeatures has all analysis fields", () => {
      const features: StemFeatures = {
        spectralCentroid: 1500,
        spectralRolloff: 8000,
        transientDensity: 0.3,
        rmsEnergy: -18,
        crestFactor: 12,
        bandEnergy: { sub: 0.1, low: 0.2, mid: 0.4, high: 0.2, air: 0.1 },
        zeroCrossingRate: 0.05,
      };

      expect(features.spectralCentroid).toBe(1500);
      expect(features.bandEnergy.sub).toBe(0.1);
    });

    it("AnalyzedStem combines StemTrack with features", () => {
      const analyzed: AnalyzedStem = {
        stemId: "stem-1",
        classification: "vocals",
        confidence: 0.92,
        features: {
          spectralCentroid: 2000,
          spectralRolloff: 6000,
          transientDensity: 0.15,
          rmsEnergy: -20,
          crestFactor: 10,
          bandEnergy: { sub: 0.05, low: 0.15, mid: 0.5, high: 0.2, air: 0.1 },
          zeroCrossingRate: 0.08,
        },
      };

      expect(analyzed.stemId).toBe("stem-1");
      expect(analyzed.confidence).toBe(0.92);
    });

    it("StemClassification accepts all valid values", () => {
      const validValues: StemClassification[] = [
        "vocals", "drums", "bass", "guitar",
        "keys", "synth", "strings", "fx", "other",
      ];

      validValues.forEach((v) => {
        expect(STEM_CLASSIFICATIONS).toContain(v);
      });
    });
  });
});
