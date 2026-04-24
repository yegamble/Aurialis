import type { AudioParams } from "@/lib/stores/audio-store";
import { PLATFORM_PRESETS, type PlatformName } from "./presets";

export const SIMPLE_TOGGLE_OFFSETS = {
  cleanup: { threshold: -5, ratio: 1.0, attack: -15, release: -100, makeup: 1.0 },
  warm: { eq250: 2.0, satDrive: 15 },
  bright: { eq4k: 1.5, eq12k: 2.5 },
  wide: { stereoWidth: 50 },
  loud: { makeup: 3.0, ceiling: 0.5 },
  deharsh: { eq4k: -3.0, eq1k: -1.5 },
  glueComp: { threshold: -5, ratio: 1.5, attack: 20, release: 100, makeup: 1.5 },
} satisfies Record<string, Partial<AudioParams>>;

export const TONE_PRESET_OFFSETS = {
  "Add Air": { eq4k: 1.5, eq12k: 3.0 },
  "Tape Warmth": { eq250: 2.0, satDrive: 15 },
  "Cut Mud": { eq80: -1.0, eq250: -3.0 },
} as const satisfies Record<string, Partial<AudioParams>>;

export const OUTPUT_PRESET_PLATFORM_MAP = {
  Spotify: "spotify",
  "Apple Music": "appleMusic",
  YouTube: "youtube",
  SoundCloud: "soundcloud",
  CD: "cd",
} as const satisfies Record<string, PlatformName>;

export type TonePresetName = keyof typeof TONE_PRESET_OFFSETS;
export type OutputPresetName = keyof typeof OUTPUT_PRESET_PLATFORM_MAP;

const PARAM_LIMITS: Partial<Record<keyof AudioParams, readonly [number, number]>> = {
  inputGain: [-24, 24],
  threshold: [-40, 0],
  ratio: [1, 20],
  attack: [0.1, 100],
  release: [10, 1000],
  makeup: [-12, 12],
  eq80: [-12, 12],
  eq250: [-12, 12],
  eq1k: [-12, 12],
  eq4k: [-12, 12],
  eq12k: [-12, 12],
  // --- Parametric EQ per-band sweep limits (P3) ---
  eqBand1Freq: [20, 20000],
  eqBand2Freq: [20, 20000],
  eqBand3Freq: [20, 20000],
  eqBand4Freq: [20, 20000],
  eqBand5Freq: [20, 20000],
  eqBand1Q: [0.1, 10],
  eqBand2Q: [0.1, 10],
  eqBand3Q: [0.1, 10],
  eqBand4Q: [0.1, 10],
  eqBand5Q: [0.1, 10],
  eqBand1MsBalance: [-1, 1],
  eqBand2MsBalance: [-1, 1],
  eqBand3MsBalance: [-1, 1],
  eqBand4MsBalance: [-1, 1],
  eqBand5MsBalance: [-1, 1],
  satDrive: [0, 100],
  stereoWidth: [0, 200],
  bassMonoFreq: [50, 500],
  midGain: [-12, 12],
  sideGain: [-12, 12],
  targetLufs: [-24, -6],
  ceiling: [-6, 0],
  limiterRelease: [10, 500],
};

function clampParam(key: keyof AudioParams, value: number): number {
  const limits = PARAM_LIMITS[key];
  if (!limits) return value;
  const [min, max] = limits;
  return Math.max(min, Math.min(max, value));
}

export function applyParamOffsets(
  base: AudioParams,
  offsets: Partial<AudioParams>,
  direction: 1 | -1 = 1
): AudioParams {
  const result = { ...base };

  for (const [rawKey, rawDelta] of Object.entries(offsets)) {
    const key = rawKey as keyof AudioParams;
    const delta = rawDelta as number | undefined;
    if (typeof delta !== "number") continue;
    const currentValue = result[key] as number;
    const next = clampParam(key, currentValue + delta * direction);
    // AudioParams is mixed numeric/string; this helper only touches numeric fields.
    (result as unknown as Record<string, number>)[key] = next;
  }

  return result;
}

export function applySimpleToggles(
  base: AudioParams,
  activeToggles: Record<string, boolean>
): AudioParams {
  let result = { ...base };

  for (const [toggleKey, isActive] of Object.entries(activeToggles)) {
    if (!isActive) continue;
    const offsets =
      SIMPLE_TOGGLE_OFFSETS[toggleKey as keyof typeof SIMPLE_TOGGLE_OFFSETS];
    if (!offsets) continue;
    result = applyParamOffsets(result, offsets);
  }

  return result;
}

export function applyTonePreset(
  base: AudioParams,
  previousPreset: TonePresetName | null,
  nextPreset: TonePresetName | null
): AudioParams {
  const withoutPreviousPreset = previousPreset
    ? applyParamOffsets(base, TONE_PRESET_OFFSETS[previousPreset], -1)
    : { ...base };

  return nextPreset
    ? applyParamOffsets(withoutPreviousPreset, TONE_PRESET_OFFSETS[nextPreset])
    : withoutPreviousPreset;
}

export function matchesOutputPreset(
  params: Pick<AudioParams, "targetLufs" | "ceiling">,
  preset: OutputPresetName
): boolean {
  const platform = OUTPUT_PRESET_PLATFORM_MAP[preset];
  const expected = PLATFORM_PRESETS[platform];
  return (
    Math.abs(params.targetLufs - expected.targetLufs) < 1e-9 &&
    Math.abs(params.ceiling - expected.ceiling) < 1e-9
  );
}
