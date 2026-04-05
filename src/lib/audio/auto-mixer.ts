/**
 * Auto-Mixer — generates professional per-stem + master bus processing presets
 * from analyzed stems. The "Grammy-level producer" engine.
 */

import type {
  AnalyzedStem,
  StemChannelParams,
  StemClassification,
} from "@/types/mixer";
import { DEFAULT_CHANNEL_PARAMS } from "@/types/mixer";
import { DEFAULT_PARAMS } from "@/lib/audio/presets";
import type { AudioParams } from "@/types/mastering";

export interface AutoMixResult {
  stemParams: Record<string, StemChannelParams>;
  masterParams: AudioParams;
}

// --- Gain staging ---

const TARGET_RMS = -18; // Target RMS in dBFS

/** Role-based gain offsets (relative to target RMS). */
const ROLE_OFFSETS: Partial<Record<StemClassification, number>> = {
  vocals: 2,
  drums: 1,
  bass: 0,
  guitar: -1,
  keys: -2,
  synth: -2,
  strings: -3,
  fx: -6,
  other: -2,
};

// --- Pan placement ---

interface PanState {
  leftCount: number;
  rightCount: number;
}

function getPan(
  classification: StemClassification,
  index: number,
  state: PanState
): number {
  // Center-panned instruments
  if (
    classification === "vocals" ||
    classification === "bass" ||
    classification === "drums"
  ) {
    return 0;
  }

  // Alternate left/right for other instruments
  const spread =
    classification === "strings" || classification === "synth" ? 0.7 : 0.5;

  if (state.leftCount <= state.rightCount) {
    state.leftCount++;
    return -spread;
  }
  state.rightCount++;
  return spread;
}

// --- Per-stem EQ presets ---

type EQ5 = [number, number, number, number, number];

const STEM_EQ: Partial<Record<StemClassification, EQ5>> = {
  vocals: [0, -1.5, 0.5, 1.5, 1],  // Cut mud, gentle presence, air
  drums: [0.5, 0, -0.5, 1, 0.5],   // Slight sub, presence, air
  bass: [1, 0.5, -1.5, 0, 0],      // Boost lows, cut mids
  guitar: [0, -2, 0.5, 1, 0],      // Cut mud, gentle presence
  keys: [0, 0, 0, 0.5, 0.5],       // Gentle brightness
  synth: [0, 0, 0, 0.5, 1],        // Brightness, air
  strings: [0, 0, 0.5, 0.5, 1],    // Gentle presence, air
  fx: [0, 0, 0, 0, 0],             // Flat
  other: [0, 0, 0, 0, 0],          // Flat
};

// --- Per-stem compression presets ---

interface CompPreset {
  threshold: number;
  ratio: number;
  attack: number;  // ms
  release: number; // ms
  makeup: number;
}

const STEM_COMP: Partial<Record<StemClassification, CompPreset>> = {
  vocals: { threshold: -20, ratio: 2.5, attack: 15, release: 200, makeup: 0 },
  drums: { threshold: -18, ratio: 3, attack: 5, release: 80, makeup: 0 },
  bass: { threshold: -20, ratio: 2.5, attack: 30, release: 200, makeup: 0 },
  guitar: { threshold: -22, ratio: 2, attack: 20, release: 250, makeup: 0 },
  keys: { threshold: -24, ratio: 2, attack: 25, release: 300, makeup: 0 },
  synth: { threshold: -24, ratio: 2, attack: 20, release: 250, makeup: 0 },
  strings: { threshold: -26, ratio: 1.5, attack: 40, release: 400, makeup: 0 },
  fx: { threshold: -30, ratio: 1.5, attack: 30, release: 300, makeup: 0 },
  other: { threshold: -24, ratio: 2, attack: 20, release: 250, makeup: 0 },
};

// --- Per-stem saturation ---

const STEM_SATURATION: Partial<Record<StemClassification, number>> = {
  vocals: 12,   // Subtle warmth
  drums: 0,     // Preserve transients
  bass: 15,     // Harmonic warmth
  guitar: 10,   // Mild drive
  keys: 5,      // Very subtle
  synth: 8,     // Subtle character
  strings: 0,   // Clean
  fx: 0,        // Clean
  other: 0,     // Clean
};

// --- Main auto-mix function ---

export function generateAutoMix(stems: AnalyzedStem[]): AutoMixResult {
  const stemParams: Record<string, StemChannelParams> = {};
  const panState: PanState = { leftCount: 0, rightCount: 0 };

  // Sum attenuation: when mixing N stems, reduce each to prevent clipping.
  // Equal-power summing rule: attenuate by 10*log10(N) dB.
  // Additional -3 dB headroom for EQ boosts and compression makeup.
  const sumAttenuation =
    stems.length > 1
      ? -(10 * Math.log10(stems.length)) - 3
      : 0;

  for (let i = 0; i < stems.length; i++) {
    const stem = stems[i];
    const cls = stem.classification;

    // Gain staging: normalize to target RMS + role offset + sum attenuation
    const gainAdjust = TARGET_RMS - stem.features.rmsEnergy;
    const roleOffset = ROLE_OFFSETS[cls] ?? 0;
    const volume = gainAdjust + roleOffset + sumAttenuation;

    // Pan placement
    const pan = getPan(cls, i, panState);

    // EQ
    const eq = STEM_EQ[cls] ?? [0, 0, 0, 0, 0];

    // Compression
    const comp = STEM_COMP[cls] ?? STEM_COMP.other!;

    // Saturation
    const satDrive = STEM_SATURATION[cls] ?? 0;

    stemParams[stem.stemId] = {
      ...DEFAULT_CHANNEL_PARAMS,
      volume,
      pan,
      mute: false,
      solo: false,
      eq: [...eq] as [number, number, number, number, number],
      compThreshold: comp.threshold,
      compRatio: comp.ratio,
      compAttack: comp.attack,
      compRelease: comp.release,
      compMakeup: comp.makeup,
      satDrive,
    };
  }

  // Master bus params — use sensible defaults for a mixed track
  const masterParams: AudioParams = {
    ...DEFAULT_PARAMS,
    threshold: -18,
    ratio: 2,
    attack: 30,
    release: 300,
    makeup: 2,
    eq80: 0,
    eq250: -0.5,
    eq1k: 0,
    eq4k: 1,
    eq12k: 1,
    satDrive: 5,
    stereoWidth: 105,
    targetLufs: -14,
    ceiling: -1,
    limiterRelease: 100,
  };

  return { stemParams, masterParams };
}
