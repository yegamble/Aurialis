import { describe, it, expect } from "vitest";
import { GENRE_PRESETS, DEFAULT_PARAMS } from "../presets";
import type { GenreName } from "../presets";

/**
 * Per-genre multiband inventory (Phase 4a, plan 2026-04-23-dsp-p4-triage.md Task 1).
 *
 * This is the source of truth for genre-tuned multiband engagement. Any change
 * to GENRE_PRESETS multiband fields must update this table or be rejected.
 *
 * "default" values referenced here come from DEFAULT_PARAMS:
 *   threshold=-18, ratio=2, attack=20, release=250, makeup=0
 */

interface BandTune {
  enabled: 0 | 1;
  threshold?: number;
  ratio?: number;
  attack?: number;
  release?: number;
  makeup?: number;
}

interface GenreTune {
  multibandEnabled: 0 | 1;
  low: BandTune;
  mid: BandTune;
  high: BandTune;
  crossLowMid: number;
  crossMidHigh: number;
}

const INVENTORY: Record<GenreName, GenreTune> = {
  pop: {
    multibandEnabled: 1,
    low: { enabled: 1, threshold: -20, ratio: 2.5, attack: 15, release: 200, makeup: 1.0 },
    mid: { enabled: 0 },
    high: { enabled: 0 },
    crossLowMid: 200,
    crossMidHigh: 2000,
  },
  rock: {
    multibandEnabled: 1,
    low: { enabled: 1, threshold: -18, ratio: 3.0, attack: 10, release: 150, makeup: 1.0 },
    mid: { enabled: 1, threshold: -16, ratio: 2.5, attack: 15, release: 180, makeup: 0.5 },
    high: { enabled: 0 },
    crossLowMid: 200,
    crossMidHigh: 2000,
  },
  hiphop: {
    multibandEnabled: 1,
    low: { enabled: 1, threshold: -22, ratio: 3.0, attack: 10, release: 150, makeup: 1.5 },
    mid: { enabled: 0 },
    high: { enabled: 0 },
    crossLowMid: 200,
    crossMidHigh: 2000,
  },
  electronic: {
    multibandEnabled: 1,
    low: { enabled: 0 },
    mid: { enabled: 0 },
    high: { enabled: 1, threshold: -14, ratio: 3.5, attack: 5, release: 100, makeup: 0.5 },
    crossLowMid: 200,
    crossMidHigh: 2000,
  },
  jazz: {
    multibandEnabled: 0,
    low: { enabled: 0 },
    mid: { enabled: 0 },
    high: { enabled: 0 },
    crossLowMid: 200,
    crossMidHigh: 2000,
  },
  classical: {
    multibandEnabled: 0,
    low: { enabled: 0 },
    mid: { enabled: 0 },
    high: { enabled: 0 },
    crossLowMid: 200,
    crossMidHigh: 2000,
  },
  rnb: {
    multibandEnabled: 1,
    low: { enabled: 1, threshold: -20, ratio: 2.5, attack: 20, release: 220, makeup: 1.0 },
    mid: { enabled: 0 },
    high: { enabled: 0 },
    crossLowMid: 200,
    crossMidHigh: 2000,
  },
  podcast: {
    multibandEnabled: 1,
    low: { enabled: 0 },
    mid: { enabled: 1, threshold: -20, ratio: 3.0, attack: 15, release: 180, makeup: 2.0 },
    high: { enabled: 0 },
    crossLowMid: 200,
    crossMidHigh: 2000,
  },
  lofi: {
    multibandEnabled: 0,
    low: { enabled: 0 },
    mid: { enabled: 0 },
    high: { enabled: 0 },
    crossLowMid: 200,
    crossMidHigh: 2000,
  },
};

describe("Genre multiband inventory (Phase 4a Task 1)", () => {
  const genres = Object.keys(INVENTORY) as GenreName[];

  it.each(genres)("genre '%s' multibandEnabled matches inventory", (genre) => {
    const expected = INVENTORY[genre];
    expect(GENRE_PRESETS[genre].multibandEnabled).toBe(expected.multibandEnabled);
  });

  it.each(genres)("genre '%s' crossovers match inventory", (genre) => {
    const expected = INVENTORY[genre];
    expect(GENRE_PRESETS[genre].mbCrossLowMid).toBe(expected.crossLowMid);
    expect(GENRE_PRESETS[genre].mbCrossMidHigh).toBe(expected.crossMidHigh);
  });

  for (const bandKey of ["low", "mid", "high"] as const) {
    const prefix = `mb${bandKey.charAt(0).toUpperCase()}${bandKey.slice(1)}` as
      | "mbLow"
      | "mbMid"
      | "mbHigh";

    it.each(genres)(
      `genre '%s' ${prefix}Enabled matches inventory`,
      (genre) => {
        const expected = INVENTORY[genre][bandKey];
        expect(GENRE_PRESETS[genre][`${prefix}Enabled` as const]).toBe(
          expected.enabled
        );
      }
    );

    it.each(genres)(
      `genre '%s' ${prefix} per-band params match inventory (disabled → default, enabled → inventory values)`,
      (genre) => {
        const expected = INVENTORY[genre][bandKey];
        const p = GENRE_PRESETS[genre];
        if (expected.enabled === 0) {
          // Disabled bands inherit DEFAULT_PARAMS per-band values
          expect(p[`${prefix}Threshold` as const]).toBe(
            DEFAULT_PARAMS[`${prefix}Threshold` as const]
          );
          expect(p[`${prefix}Ratio` as const]).toBe(
            DEFAULT_PARAMS[`${prefix}Ratio` as const]
          );
          expect(p[`${prefix}Attack` as const]).toBe(
            DEFAULT_PARAMS[`${prefix}Attack` as const]
          );
          expect(p[`${prefix}Release` as const]).toBe(
            DEFAULT_PARAMS[`${prefix}Release` as const]
          );
          expect(p[`${prefix}Makeup` as const]).toBe(
            DEFAULT_PARAMS[`${prefix}Makeup` as const]
          );
        } else {
          expect(p[`${prefix}Threshold` as const]).toBe(expected.threshold);
          expect(p[`${prefix}Ratio` as const]).toBe(expected.ratio);
          expect(p[`${prefix}Attack` as const]).toBe(expected.attack);
          expect(p[`${prefix}Release` as const]).toBe(expected.release);
          expect(p[`${prefix}Makeup` as const]).toBe(expected.makeup);
        }
      }
    );
  }

  it("exactly 6 genres engage multiband; 3 preserve dynamics", () => {
    const engaging = genres.filter(
      (g) => GENRE_PRESETS[g].multibandEnabled === 1
    );
    const preserving = genres.filter(
      (g) => GENRE_PRESETS[g].multibandEnabled === 0
    );
    expect(engaging.sort()).toEqual(
      ["electronic", "hiphop", "pop", "podcast", "rnb", "rock"].sort()
    );
    expect(preserving.sort()).toEqual(["classical", "jazz", "lofi"].sort());
  });
});
