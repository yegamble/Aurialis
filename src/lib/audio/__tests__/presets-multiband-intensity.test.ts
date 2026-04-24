import { describe, it, expect } from "vitest";
import { GENRE_PRESETS, DEFAULT_PARAMS, applyIntensity } from "../presets";
import type { GenreName } from "../presets";
import type { AudioParams } from "@/types/mastering";

/**
 * Task 2: applyIntensity() snaps `*Enabled` fields to {0, 1} instead of
 * linearly interpolating them. This prevents partial engagement at mid
 * intensities (e.g. 0.5 on a binary flag) and keeps per-stage master flags
 * safe for future presets.
 *
 * Non-enable numeric fields (threshold, ratio, makeup, attack, release) MUST
 * still interpolate linearly.
 */

const MB_ENGAGING: GenreName[] = [
  "pop",
  "rock",
  "hiphop",
  "electronic",
  "rnb",
  "podcast",
];
const MB_PRESERVING: GenreName[] = ["jazz", "classical", "lofi"];

function enabledKeys(): (keyof AudioParams)[] {
  return (Object.keys(DEFAULT_PARAMS) as (keyof AudioParams)[]).filter((k) =>
    typeof k === "string" && k.endsWith("Enabled")
  );
}

describe("applyIntensity snaps *Enabled fields (Phase 4a Task 2)", () => {
  describe("multibandEnabled behaves as a binary flag", () => {
    it.each(MB_ENGAGING)(
      "'%s' at intensity=0 has multibandEnabled=0 (stays default)",
      (genre) => {
        expect(applyIntensity(genre, 0).multibandEnabled).toBe(0);
      }
    );

    it.each(MB_ENGAGING)(
      "'%s' at intensity=1 snaps multibandEnabled=1 (no partial 0.01)",
      (genre) => {
        expect(applyIntensity(genre, 1).multibandEnabled).toBe(1);
      }
    );

    it.each(MB_ENGAGING)(
      "'%s' at intensity=50 has multibandEnabled=1 (snapped, not 0.5)",
      (genre) => {
        expect(applyIntensity(genre, 50).multibandEnabled).toBe(1);
      }
    );

    it.each(MB_ENGAGING)(
      "'%s' at intensity=100 has multibandEnabled=1",
      (genre) => {
        expect(applyIntensity(genre, 100).multibandEnabled).toBe(1);
      }
    );

    it.each(MB_PRESERVING)(
      "'%s' at any intensity keeps multibandEnabled=0",
      (genre) => {
        for (const t of [0, 1, 25, 50, 75, 100]) {
          expect(applyIntensity(genre, t).multibandEnabled).toBe(0);
        }
      }
    );
  });

  describe("per-band *Enabled flags snap per inventory", () => {
    const engagedBands: Record<GenreName, ("mbLow" | "mbMid" | "mbHigh")[]> = {
      pop: ["mbLow"],
      rock: ["mbLow", "mbMid"],
      hiphop: ["mbLow"],
      electronic: ["mbHigh"],
      rnb: ["mbLow"],
      podcast: ["mbMid"],
      jazz: [],
      classical: [],
      lofi: [],
    };

    it.each(MB_ENGAGING)(
      "'%s' at intensity=50 has correct per-band snapping",
      (genre) => {
        const p = applyIntensity(genre, 50);
        const expected = engagedBands[genre];
        for (const prefix of ["mbLow", "mbMid", "mbHigh"] as const) {
          const value = p[`${prefix}Enabled` as const];
          if (expected.includes(prefix)) {
            expect(value, `${genre}.${prefix}Enabled at t=50`).toBe(1);
          } else {
            expect(value, `${genre}.${prefix}Enabled at t=50`).toBe(0);
          }
        }
      }
    );
  });

  describe("snap rule applies to every key ending in 'Enabled'", () => {
    it("all *Enabled keys return {0,1} values at t=50 for every genre", () => {
      for (const genre of [...MB_ENGAGING, ...MB_PRESERVING]) {
        const p = applyIntensity(genre, 50);
        for (const key of enabledKeys()) {
          const value = p[key];
          expect(
            [0, 1],
            `${genre}.${String(key)} at t=50 should be 0 or 1, got ${value}`
          ).toContain(value);
        }
      }
    });
  });

  describe("non-enable numeric fields continue to interpolate linearly", () => {
    it("hiphop threshold at t=50 is midway between default and preset", () => {
      // DEFAULT.threshold=-18, GENRE.hiphop.threshold=-16 → midway = -17
      expect(applyIntensity("hiphop", 50).threshold).toBeCloseTo(-17, 5);
    });

    it("hiphop mbLowThreshold at t=50 is midway between default and preset", () => {
      // DEFAULT.mbLowThreshold=-18, GENRE.hiphop.mbLowThreshold=-22 → midway = -20
      expect(applyIntensity("hiphop", 50).mbLowThreshold).toBeCloseTo(-20, 5);
    });

    it("pop mbLowMakeup at t=25 is quarter-way between default (0) and preset (1.0)", () => {
      expect(applyIntensity("pop", 25).mbLowMakeup).toBeCloseTo(0.25, 5);
    });

    it("electronic mbHighRatio at t=100 equals preset value (3.5)", () => {
      expect(applyIntensity("electronic", 100).mbHighRatio).toBeCloseTo(3.5, 5);
    });
  });

  describe("Enum fields still copy verbatim (existing behavior)", () => {
    it("mbLowMode is always the preset's value regardless of intensity", () => {
      expect(applyIntensity("hiphop", 0).mbLowMode).toBe("stereo");
      expect(applyIntensity("hiphop", 50).mbLowMode).toBe("stereo");
      expect(applyIntensity("hiphop", 100).mbLowMode).toBe("stereo");
    });
  });

  describe("Enable snap does not break existing t=0 and t=100 contract", () => {
    it("at t=0, result equals DEFAULT_PARAMS enables (all zeros for MB fields)", () => {
      for (const genre of [...MB_ENGAGING, ...MB_PRESERVING]) {
        const p = applyIntensity(genre, 0);
        expect(p.multibandEnabled).toBe(DEFAULT_PARAMS.multibandEnabled);
        expect(p.mbLowEnabled).toBe(DEFAULT_PARAMS.mbLowEnabled);
        expect(p.mbMidEnabled).toBe(DEFAULT_PARAMS.mbMidEnabled);
        expect(p.mbHighEnabled).toBe(DEFAULT_PARAMS.mbHighEnabled);
      }
    });

    it("at t=100, result matches the genre preset enables", () => {
      for (const genre of [...MB_ENGAGING, ...MB_PRESERVING]) {
        const p = applyIntensity(genre, 100);
        expect(p.multibandEnabled).toBe(GENRE_PRESETS[genre].multibandEnabled);
        expect(p.mbLowEnabled).toBe(GENRE_PRESETS[genre].mbLowEnabled);
        expect(p.mbMidEnabled).toBe(GENRE_PRESETS[genre].mbMidEnabled);
        expect(p.mbHighEnabled).toBe(GENRE_PRESETS[genre].mbHighEnabled);
      }
    });
  });
});
