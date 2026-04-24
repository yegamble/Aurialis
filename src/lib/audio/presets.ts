/**
 * Genre and platform presets for the mastering engine.
 * Genre presets define full AudioParams objects.
 * Platform presets define target LUFS and ceiling.
 * applyIntensity() linearly interpolates between neutral defaults and genre preset.
 */

import type {
  AudioParams,
  EqBandMode,
  EqBandType,
  MultibandMode,
  SaturationMode,
} from "@/types/mastering";

/** Neutral default parameters — flat EQ, gentle compression, unity gain */
export const DEFAULT_PARAMS: AudioParams = {
  inputGain: 0,
  threshold: -18,
  ratio: 2,
  attack: 30,
  release: 300,
  makeup: 0,
  sidechainHpfHz: 100,
  autoRelease: 0,
  eq80: 0,
  eq250: 0,
  eq1k: 0,
  eq4k: 0,
  eq12k: 0,

  // --- Parametric EQ (P3) — defaults reproduce pre-P3 5-band topology exactly ---
  parametricEqEnabled: 1,

  eqBand1Enabled: 1,
  eqBand1Freq: 80,
  eqBand1Q: 0.7071067811865476, // 1/√2 (Butterworth shelf slope)
  eqBand1Type: "lowShelf",
  eqBand1Mode: "stereo",
  eqBand1MsBalance: 0,

  eqBand2Enabled: 1,
  eqBand2Freq: 250,
  eqBand2Q: 1.0,
  eqBand2Type: "bell",
  eqBand2Mode: "stereo",
  eqBand2MsBalance: 0,

  eqBand3Enabled: 1,
  eqBand3Freq: 1000,
  eqBand3Q: 1.0,
  eqBand3Type: "bell",
  eqBand3Mode: "stereo",
  eqBand3MsBalance: 0,

  eqBand4Enabled: 1,
  eqBand4Freq: 4000,
  eqBand4Q: 1.0,
  eqBand4Type: "bell",
  eqBand4Mode: "stereo",
  eqBand4MsBalance: 0,

  eqBand5Enabled: 1,
  eqBand5Freq: 12000,
  eqBand5Q: 0.7071067811865476,
  eqBand5Type: "highShelf",
  eqBand5Mode: "stereo",
  eqBand5MsBalance: 0,

  satDrive: 0,
  satMode: "clean",
  stereoWidth: 100,
  bassMonoFreq: 200,
  midGain: 0,
  sideGain: 0,
  targetLufs: -14,
  ceiling: -1,
  limiterRelease: 100,

  // --- Multiband compressor (neutral/off defaults) ---
  multibandEnabled: 0,
  mbCrossLowMid: 200,
  mbCrossMidHigh: 2000,

  mbLowEnabled: 0,
  mbLowSolo: 0,
  mbLowThreshold: -18,
  mbLowRatio: 2,
  mbLowAttack: 20,
  mbLowRelease: 250,
  mbLowMakeup: 0,
  mbLowMode: "stereo",
  mbLowMsBalance: 0,

  mbMidEnabled: 0,
  mbMidSolo: 0,
  mbMidThreshold: -18,
  mbMidRatio: 2,
  mbMidAttack: 20,
  mbMidRelease: 250,
  mbMidMakeup: 0,
  mbMidMode: "stereo",
  mbMidMsBalance: 0,

  mbHighEnabled: 0,
  mbHighSolo: 0,
  mbHighThreshold: -18,
  mbHighRatio: 2,
  mbHighAttack: 20,
  mbHighRelease: 250,
  mbHighMakeup: 0,
  mbHighMode: "stereo",
  mbHighMsBalance: 0,
};

export type GenreName =
  | "pop"
  | "rock"
  | "hiphop"
  | "electronic"
  | "jazz"
  | "classical"
  | "rnb"
  | "podcast"
  | "lofi";

export type PlatformName =
  | "spotify"
  | "appleMusic"
  | "youtube"
  | "soundcloud"
  | "cd";

/** Genre preset: full AudioParams for each genre style */
export const GENRE_PRESETS: Record<GenreName, AudioParams> = {
  pop: {
    ...DEFAULT_PARAMS,
    threshold: -20,
    ratio: 3,
    attack: 15,
    release: 200,
    makeup: 3,
    sidechainHpfHz: 120,
    eq80: 1,
    eq250: -1,
    eq1k: 1,
    eq4k: 2,
    eq12k: 2,
    satDrive: 15,
    stereoWidth: 110,
    targetLufs: -14,
    ceiling: -1,
  },

  rock: {
    ...DEFAULT_PARAMS,
    threshold: -18,
    ratio: 4,
    attack: 10,
    release: 150,
    makeup: 4,
    sidechainHpfHz: 120,
    satMode: "tube",
    eq80: 3,
    eq250: -2,
    eq1k: 2,
    eq4k: 3,
    eq12k: 1,
    satDrive: 25,
    stereoWidth: 105,
    targetLufs: -12,
    ceiling: -0.5,
  },

  hiphop: {
    ...DEFAULT_PARAMS,
    threshold: -16,
    ratio: 4,
    attack: 5,
    release: 100,
    makeup: 5,
    sidechainHpfHz: 80,
    satMode: "tube",
    eq80: 4,
    eq250: 1,
    eq1k: -1,
    eq4k: 2,
    eq12k: 1,
    satDrive: 20,
    stereoWidth: 115,
    targetLufs: -13,
    ceiling: -0.5,
  },

  electronic: {
    ...DEFAULT_PARAMS,
    threshold: -14,
    ratio: 5,
    attack: 5,
    release: 80,
    makeup: 6,
    sidechainHpfHz: 80,
    satMode: "transformer",
    eq80: 3,
    eq250: -2,
    eq1k: 1,
    eq4k: 3,
    eq12k: 3,
    satDrive: 10,
    stereoWidth: 130,
    targetLufs: -11,
    ceiling: -0.3,
  },

  jazz: {
    ...DEFAULT_PARAMS,
    threshold: -22,
    ratio: 2,
    attack: 40,
    release: 400,
    makeup: 2,
    sidechainHpfHz: 60,
    eq80: 0,
    eq250: 1,
    eq1k: 0,
    eq4k: 1,
    eq12k: 1,
    satDrive: 5,
    stereoWidth: 100,
    targetLufs: -18,
    ceiling: -1,
  },

  classical: {
    ...DEFAULT_PARAMS,
    threshold: -24,
    ratio: 1.5,
    attack: 60,
    release: 500,
    makeup: 1,
    sidechainHpfHz: 60,
    eq80: -1,
    eq250: 0,
    eq1k: 0,
    eq4k: 1,
    eq12k: 1,
    satDrive: 0,
    stereoWidth: 100,
    targetLufs: -20,
    ceiling: -1,
  },

  rnb: {
    ...DEFAULT_PARAMS,
    threshold: -18,
    ratio: 3,
    attack: 20,
    release: 250,
    makeup: 3,
    sidechainHpfHz: 100,
    eq80: 2,
    eq250: 1,
    eq1k: 0,
    eq4k: 2,
    eq12k: 2,
    satDrive: 18,
    stereoWidth: 110,
    targetLufs: -14,
    ceiling: -1,
  },

  podcast: {
    ...DEFAULT_PARAMS,
    threshold: -20,
    ratio: 3,
    attack: 20,
    release: 200,
    makeup: 6,
    sidechainHpfHz: 120,
    eq80: -2,
    eq250: -1,
    eq1k: 1,
    eq4k: 2,
    eq12k: 0,
    satDrive: 0,
    stereoWidth: 100,
    targetLufs: -16,
    ceiling: -1,
  },

  lofi: {
    ...DEFAULT_PARAMS,
    threshold: -22,
    ratio: 2.5,
    attack: 40,
    release: 400,
    makeup: 2,
    sidechainHpfHz: 100,
    satMode: "tape",
    eq80: 1,
    eq250: 1.5,
    eq1k: 0,
    eq4k: -1.5,
    eq12k: -2,
    satDrive: 30,
    stereoWidth: 95,
    targetLufs: -16,
    ceiling: -1,
  },
};

/** Platform preset: only LUFS target and ceiling (other params unchanged) */
export type PlatformPreset = Pick<AudioParams, "targetLufs" | "ceiling">;

export const PLATFORM_PRESETS: Record<PlatformName, PlatformPreset> = {
  spotify: { targetLufs: -14, ceiling: -1 },
  appleMusic: { targetLufs: -16, ceiling: -1 },
  youtube: { targetLufs: -14, ceiling: -1 },
  soundcloud: { targetLufs: -14, ceiling: -1 },
  cd: { targetLufs: -9, ceiling: -0.1 },
};

/**
 * Linearly interpolate between DEFAULT_PARAMS and a genre preset at given intensity (0-100).
 * Numeric fields interpolate. Non-numeric fields (e.g. `satMode` enum) are
 * copied from the preset directly — intensity has no meaning for enums.
 */
export function applyIntensity(genre: GenreName, intensity: number): AudioParams {
  const t = Math.max(0, Math.min(100, intensity)) / 100;
  const preset = GENRE_PRESETS[genre];
  const result: AudioParams = { ...DEFAULT_PARAMS };

  type ParamValue = number | SaturationMode | MultibandMode | EqBandType | EqBandMode;
  for (const key of Object.keys(DEFAULT_PARAMS) as (keyof AudioParams)[]) {
    const defVal = DEFAULT_PARAMS[key];
    const targetVal = preset[key];
    if (typeof defVal === "number" && typeof targetVal === "number") {
      // Numeric interpolation
      (result as unknown as Record<string, ParamValue>)[key] =
        defVal + t * (targetVal - defVal);
    } else {
      // Non-numeric (enum/string): copy preset's value as-is
      (result as unknown as Record<string, ParamValue>)[key] = targetVal;
    }
  }

  return result;
}
