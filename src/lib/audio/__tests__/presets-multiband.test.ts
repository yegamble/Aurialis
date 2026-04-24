import { describe, it, expect } from "vitest";
import {
  GENRE_PRESETS,
  applyIntensity,
  DEFAULT_PARAMS,
} from "../presets";
import type { MultibandMode } from "@/types/mastering";

const BAND_PREFIXES = ["mbLow", "mbMid", "mbHigh"] as const;

describe("Multiband AudioParams defaults", () => {
  it("DEFAULT_PARAMS.multibandEnabled === 0", () => {
    expect(DEFAULT_PARAMS.multibandEnabled).toBe(0);
  });

  it("DEFAULT_PARAMS crossover defaults: 200 Hz / 2000 Hz", () => {
    expect(DEFAULT_PARAMS.mbCrossLowMid).toBe(200);
    expect(DEFAULT_PARAMS.mbCrossMidHigh).toBe(2000);
  });

  it.each(BAND_PREFIXES)(
    "DEFAULT_PARAMS[%s*] band defaults are neutral and disabled",
    (prefix) => {
      expect(DEFAULT_PARAMS[`${prefix}Enabled` as const]).toBe(0);
      expect(DEFAULT_PARAMS[`${prefix}Solo` as const]).toBe(0);
      expect(DEFAULT_PARAMS[`${prefix}Threshold` as const]).toBe(-18);
      expect(DEFAULT_PARAMS[`${prefix}Ratio` as const]).toBe(2);
      expect(DEFAULT_PARAMS[`${prefix}Attack` as const]).toBe(20);
      expect(DEFAULT_PARAMS[`${prefix}Release` as const]).toBe(250);
      expect(DEFAULT_PARAMS[`${prefix}Makeup` as const]).toBe(0);
      expect(DEFAULT_PARAMS[`${prefix}Mode` as const]).toBe<MultibandMode>(
        "stereo"
      );
      expect(DEFAULT_PARAMS[`${prefix}MsBalance` as const]).toBe(0);
    }
  );

  // Phase 4a (2026-04-23): genre presets now set multiband fields per the
  // per-genre inventory. See `presets-multiband-genre.test.ts` for the
  // authoritative mapping. Legacy invariants that still hold for all genres:
  it("every genre preset keeps MB Mode='stereo' and MsBalance=0 (Phase 4a leaves M/S for P5b)", () => {
    for (const [genre, params] of Object.entries(GENRE_PRESETS)) {
      for (const prefix of BAND_PREFIXES) {
        expect(
          params[`${prefix}Mode` as const],
          `${genre}.${prefix}Mode`
        ).toBe("stereo");
        expect(
          params[`${prefix}MsBalance` as const],
          `${genre}.${prefix}MsBalance`
        ).toBe(0);
      }
      expect(params.mbCrossLowMid, `${genre}.mbCrossLowMid`).toBe(200);
      expect(params.mbCrossMidHigh, `${genre}.mbCrossMidHigh`).toBe(2000);
    }
  });

  it("jazz preserves multiband defaults at any intensity (MB preserves dynamics)", () => {
    for (const intensity of [0, 25, 50, 75, 100]) {
      const result = applyIntensity("jazz", intensity);
      expect(result.multibandEnabled).toBe(0);
      for (const prefix of BAND_PREFIXES) {
        expect(result[`${prefix}Enabled` as const]).toBe(0);
        expect(result[`${prefix}Mode` as const]).toBe("stereo");
        expect(result[`${prefix}Threshold` as const]).toBe(-18);
      }
    }
  });

  it("applyIntensity copies Mode enum field like satMode (non-numeric)", () => {
    // When a preset explicitly sets a mode, applyIntensity copies it directly.
    // DEFAULT_PARAMS.mbLowMode === 'stereo', so every intensity returns 'stereo'.
    const result = applyIntensity("hiphop", 50);
    expect(result.mbLowMode).toBe("stereo");
    expect(result.mbMidMode).toBe("stereo");
    expect(result.mbHighMode).toBe("stereo");
  });
});
