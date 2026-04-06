import { describe, it, expect } from "vitest";
import { generateAutoMix } from "../auto-mixer";
import type { AnalyzedStem } from "@/types/mixer";
import type { AudioParams } from "@/types/mastering";

function makeAnalyzedStem(
  id: string,
  classification: AnalyzedStem["classification"],
  rmsEnergy = -18
): AnalyzedStem {
  return {
    stemId: id,
    classification,
    confidence: 0.9,
    features: {
      spectralCentroid: 1500,
      spectralRolloff: 8000,
      transientDensity: 0.2,
      rmsEnergy,
      crestFactor: 10,
      bandEnergy: { sub: 0.1, low: 0.2, mid: 0.4, high: 0.2, air: 0.1 },
      zeroCrossingRate: 0.05,
    },
  };
}

describe("auto-mixer", () => {
  describe("generateAutoMix", () => {
    it("returns per-stem params and master params", () => {
      const stems = [
        makeAnalyzedStem("s1", "vocals"),
        makeAnalyzedStem("s2", "drums"),
        makeAnalyzedStem("s3", "bass"),
      ];

      const result = generateAutoMix(stems);

      expect(result.stemParams).toBeDefined();
      expect(result.stemParams.s1).toBeDefined();
      expect(result.stemParams.s2).toBeDefined();
      expect(result.stemParams.s3).toBeDefined();
      expect(result.masterParams).toBeDefined();
    });

    it("places vocals at center pan", () => {
      const stems = [
        makeAnalyzedStem("s1", "vocals"),
        makeAnalyzedStem("s2", "guitar"),
      ];

      const result = generateAutoMix(stems);

      expect(result.stemParams.s1.pan).toBe(0);
    });

    it("places bass at center pan", () => {
      const stems = [
        makeAnalyzedStem("s1", "bass"),
        makeAnalyzedStem("s2", "guitar"),
      ];

      const result = generateAutoMix(stems);

      expect(result.stemParams.s1.pan).toBe(0);
    });

    it("spreads guitars left/right", () => {
      const stems = [
        makeAnalyzedStem("s1", "guitar"),
        makeAnalyzedStem("s2", "guitar"),
      ];

      const result = generateAutoMix(stems);

      // First guitar should go one direction, second the opposite
      expect(Math.abs(result.stemParams.s1.pan)).toBeGreaterThan(0.2);
      expect(result.stemParams.s1.pan).not.toBe(result.stemParams.s2.pan);
    });

    it("normalizes gain staging to target RMS", () => {
      const stems = [
        makeAnalyzedStem("s1", "vocals", -12), // hot
        makeAnalyzedStem("s2", "bass", -24),   // quiet
      ];

      const result = generateAutoMix(stems);

      // Quiet stem should get more gain than hot stem
      expect(result.stemParams.s2.volume).toBeGreaterThan(
        result.stemParams.s1.volume
      );
    });

    it("applies per-stem EQ appropriate to stem type", () => {
      const stems = [
        makeAnalyzedStem("s1", "vocals"),
        makeAnalyzedStem("s2", "bass"),
      ];

      const result = generateAutoMix(stems);

      // Vocals should have presence boost (4kHz range = index 3)
      expect(result.stemParams.s1.eq[3]).toBeGreaterThan(0);

      // Bass should have sub/low boost
      expect(result.stemParams.s2.eq[0]).toBeGreaterThanOrEqual(0);
    });

    it("applies faster compression to drums than strings", () => {
      const stems = [
        makeAnalyzedStem("s1", "drums"),
        makeAnalyzedStem("s2", "strings"),
      ];

      const result = generateAutoMix(stems);

      expect(result.stemParams.s1.compAttack).toBeLessThan(
        result.stemParams.s2.compAttack
      );
    });

    it("applies no saturation to drums (preserve transients)", () => {
      const stems = [makeAnalyzedStem("s1", "drums")];

      const result = generateAutoMix(stems);

      expect(result.stemParams.s1.satDrive).toBe(0);
    });

    it("applies subtle saturation to vocals", () => {
      const stems = [makeAnalyzedStem("s1", "vocals")];

      const result = generateAutoMix(stems);

      expect(result.stemParams.s1.satDrive).toBeGreaterThan(0);
      expect(result.stemParams.s1.satDrive).toBeLessThan(30);
    });

    it("returns valid AudioParams for master bus", () => {
      const stems = [
        makeAnalyzedStem("s1", "vocals"),
        makeAnalyzedStem("s2", "drums"),
        makeAnalyzedStem("s3", "bass"),
      ];

      const result = generateAutoMix(stems);
      const m = result.masterParams;

      // Verify it looks like valid AudioParams
      expect(m.targetLufs).toBeLessThan(0);
      expect(m.ceiling).toBeLessThan(0);
      expect(m.ratio).toBeGreaterThanOrEqual(1);
      expect(m.threshold).toBeLessThan(0);
    });

    it("applies sum attenuation to prevent clipping with many stems", () => {
      const stems = [
        makeAnalyzedStem("s1", "vocals", -18),
        makeAnalyzedStem("s2", "drums", -18),
        makeAnalyzedStem("s3", "bass", -18),
        makeAnalyzedStem("s4", "guitar", -18),
      ];

      const result = generateAutoMix(stems);

      // With 4 stems at -18 dBFS each, sum attenuation = -10*log10(4) - 3 ≈ -9 dB
      // So each stem volume should be around -9 + role_offset (not 0)
      for (const [, params] of Object.entries(result.stemParams)) {
        expect(params.volume).toBeLessThan(0);
      }
    });

    it("no sum attenuation for single stem", () => {
      const stems = [makeAnalyzedStem("s1", "vocals", -18)];

      const result = generateAutoMix(stems);

      // Single stem: gainAdjust = -18 - (-18) = 0, roleOffset = +2, no sum attenuation
      expect(result.stemParams.s1.volume).toBe(2);
    });

    it("clamps extreme boosts for sparse or silence-padded stems", () => {
      const stems = [makeAnalyzedStem("s1", "keys", -70)];

      const result = generateAutoMix(stems);

      expect(result.stemParams.s1.volume).toBeLessThanOrEqual(8);
    });

    it("handles single stem", () => {
      const stems = [makeAnalyzedStem("s1", "vocals")];

      const result = generateAutoMix(stems);

      expect(result.stemParams.s1).toBeDefined();
      expect(result.masterParams).toBeDefined();
    });

    it("sets mute=false and solo=false for all stems", () => {
      const stems = [
        makeAnalyzedStem("s1", "vocals"),
        makeAnalyzedStem("s2", "drums"),
      ];

      const result = generateAutoMix(stems);

      expect(result.stemParams.s1.mute).toBe(false);
      expect(result.stemParams.s1.solo).toBe(false);
      expect(result.stemParams.s2.mute).toBe(false);
      expect(result.stemParams.s2.solo).toBe(false);
    });
  });
});
