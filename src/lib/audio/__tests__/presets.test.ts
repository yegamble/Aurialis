import { describe, it, expect } from "vitest";
import {
  GENRE_PRESETS,
  PLATFORM_PRESETS,
  applyIntensity,
  DEFAULT_PARAMS,
  type GenreName,
  type PlatformName,
} from "../presets";

describe("Genre Presets", () => {
  it("should define 9 genres", () => {
    const genres = Object.keys(GENRE_PRESETS);
    expect(genres).toHaveLength(9);
  });

  it("should include all expected genre names", () => {
    const expected: GenreName[] = [
      "pop",
      "rock",
      "hiphop",
      "electronic",
      "jazz",
      "classical",
      "rnb",
      "podcast",
    ];
    for (const genre of expected) {
      expect(GENRE_PRESETS[genre]).toBeDefined();
    }
  });

  it("should have all required AudioParams fields for each genre", () => {
    const requiredFields = [
      "threshold",
      "ratio",
      "attack",
      "release",
      "makeup",
      "eq80",
      "eq250",
      "eq1k",
      "eq4k",
      "eq12k",
      "satDrive",
      "stereoWidth",
      "ceiling",
      "targetLufs",
    ];
    for (const [genre, params] of Object.entries(GENRE_PRESETS)) {
      for (const field of requiredFields) {
        expect(
          params[field as keyof typeof params],
          `${genre}.${field} should be defined`
        ).toBeDefined();
      }
    }
  });

  it("should have valid param ranges for all genres", () => {
    for (const [genre, params] of Object.entries(GENRE_PRESETS)) {
      expect(params.threshold, `${genre}.threshold`).toBeGreaterThanOrEqual(-60);
      expect(params.threshold, `${genre}.threshold`).toBeLessThanOrEqual(0);
      expect(params.ratio, `${genre}.ratio`).toBeGreaterThanOrEqual(1);
      expect(params.ratio, `${genre}.ratio`).toBeLessThanOrEqual(20);
      expect(params.satDrive, `${genre}.satDrive`).toBeGreaterThanOrEqual(0);
      expect(params.satDrive, `${genre}.satDrive`).toBeLessThanOrEqual(100);
      expect(params.stereoWidth, `${genre}.stereoWidth`).toBeGreaterThanOrEqual(0);
      expect(params.stereoWidth, `${genre}.stereoWidth`).toBeLessThanOrEqual(200);
    }
  });
});

describe("Platform Presets", () => {
  it("should define 5 platforms", () => {
    const platforms = Object.keys(PLATFORM_PRESETS);
    expect(platforms).toHaveLength(5);
  });

  it("should include all expected platform names", () => {
    const expected: PlatformName[] = [
      "spotify",
      "appleMusic",
      "youtube",
      "soundcloud",
      "cd",
    ];
    for (const platform of expected) {
      expect(PLATFORM_PRESETS[platform]).toBeDefined();
    }
  });

  it("Spotify should target -14 LUFS with -1 dBTP ceiling", () => {
    expect(PLATFORM_PRESETS.spotify.targetLufs).toBe(-14);
    expect(PLATFORM_PRESETS.spotify.ceiling).toBe(-1);
  });

  it("Apple Music should target -16 LUFS with -1 dBTP ceiling", () => {
    expect(PLATFORM_PRESETS.appleMusic.targetLufs).toBe(-16);
    expect(PLATFORM_PRESETS.appleMusic.ceiling).toBe(-1);
  });

  it("YouTube should target -14 LUFS with -1 dBTP ceiling", () => {
    expect(PLATFORM_PRESETS.youtube.targetLufs).toBe(-14);
    expect(PLATFORM_PRESETS.youtube.ceiling).toBe(-1);
  });

  it("SoundCloud should target -14 LUFS with -1 dBTP ceiling", () => {
    expect(PLATFORM_PRESETS.soundcloud.targetLufs).toBe(-14);
    expect(PLATFORM_PRESETS.soundcloud.ceiling).toBe(-1);
  });

  it("CD should target -9 LUFS with -0.1 dBTP ceiling", () => {
    expect(PLATFORM_PRESETS.cd.targetLufs).toBe(-9);
    expect(PLATFORM_PRESETS.cd.ceiling).toBe(-0.1);
  });
});

describe("applyIntensity", () => {
  it("at intensity 0 returns DEFAULT_PARAMS", () => {
    const result = applyIntensity("pop", 0);
    expect(result.threshold).toBeCloseTo(DEFAULT_PARAMS.threshold, 5);
    expect(result.ratio).toBeCloseTo(DEFAULT_PARAMS.ratio, 5);
    expect(result.satDrive).toBeCloseTo(DEFAULT_PARAMS.satDrive, 5);
  });

  it("at intensity 100 returns genre preset values", () => {
    const result = applyIntensity("pop", 100);
    expect(result.threshold).toBeCloseTo(GENRE_PRESETS.pop.threshold, 5);
    expect(result.ratio).toBeCloseTo(GENRE_PRESETS.pop.ratio, 5);
    expect(result.satDrive).toBeCloseTo(GENRE_PRESETS.pop.satDrive, 5);
  });

  it("at intensity 50 interpolates halfway between default and genre", () => {
    const result = applyIntensity("rock", 50);
    const expectedThreshold =
      (DEFAULT_PARAMS.threshold + GENRE_PRESETS.rock.threshold) / 2;
    expect(result.threshold).toBeCloseTo(expectedThreshold, 3);
  });

  it("clamps intensity to [0, 100]", () => {
    const below = applyIntensity("pop", -10);
    const above = applyIntensity("pop", 110);
    const zero = applyIntensity("pop", 0);
    const hundred = applyIntensity("pop", 100);
    expect(below.threshold).toBeCloseTo(zero.threshold, 5);
    expect(above.threshold).toBeCloseTo(hundred.threshold, 5);
  });
});
