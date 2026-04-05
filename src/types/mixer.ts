/** Types and constants for the stem mixer feature. */

export const MAX_STEMS = 16;

export const STEM_CLASSIFICATIONS = [
  "vocals",
  "drums",
  "bass",
  "guitar",
  "keys",
  "synth",
  "strings",
  "fx",
  "other",
] as const;

export type StemClassification = (typeof STEM_CLASSIFICATIONS)[number];

/** 8 distinct colors for stem lanes, cycling when > 8 stems. */
export const STEM_COLORS = [
  "#FF6B6B", // red
  "#4ECDC4", // teal
  "#FFE66D", // yellow
  "#A78BFA", // purple
  "#F97316", // orange
  "#22D3EE", // cyan
  "#34D399", // green
  "#F472B6", // pink
] as const;

/** Per-stem processing parameters (channel strip). */
export interface StemChannelParams {
  /** Volume in dB (-60 to +12) */
  volume: number;
  /** Pan position (-1 left, 0 center, +1 right) */
  pan: number;
  /** Mute toggle */
  mute: boolean;
  /** Solo toggle */
  solo: boolean;
  /** 5-band EQ gains in dB [80Hz, 250Hz, 1kHz, 4kHz, 12kHz] */
  eq: [number, number, number, number, number];
  /** Compressor threshold in dB */
  compThreshold: number;
  /** Compressor ratio (1:1 to 20:1) */
  compRatio: number;
  /** Compressor attack in ms */
  compAttack: number;
  /** Compressor release in ms */
  compRelease: number;
  /** Compressor makeup gain in dB */
  compMakeup: number;
  /** Saturation drive (0-100%) */
  satDrive: number;
}

export const DEFAULT_CHANNEL_PARAMS: StemChannelParams = {
  volume: 0,
  pan: 0,
  mute: false,
  solo: false,
  eq: [0, 0, 0, 0, 0],
  compThreshold: -24,
  compRatio: 2,
  compAttack: 20,
  compRelease: 250,
  compMakeup: 0,
  satDrive: 0,
};

/** A single stem track in the mixer. */
export interface StemTrack {
  id: string;
  name: string;
  file: File;
  audioBuffer: AudioBuffer | null;
  waveformPeaks: number[];
  classification: StemClassification;
  confidence: number;
  channelParams: StemChannelParams;
  /** Time offset in seconds (delay before this stem starts) */
  offset: number;
  /** Duration of the audio buffer in seconds */
  duration: number;
  /** Display color (from STEM_COLORS) */
  color: string;
}

/** Frequency band energy distribution from stem analysis. */
export interface BandEnergy {
  /** Sub bass: 20-60Hz */
  sub: number;
  /** Low: 60-300Hz */
  low: number;
  /** Mid: 300-2kHz */
  mid: number;
  /** High: 2k-8kHz */
  high: number;
  /** Air: 8k-20kHz */
  air: number;
}

/** Audio features extracted from stem analysis. */
export interface StemFeatures {
  /** Weighted average frequency in Hz */
  spectralCentroid: number;
  /** Frequency below which 85% of energy exists */
  spectralRolloff: number;
  /** Ratio of transient frames to total frames (0-1) */
  transientDensity: number;
  /** RMS energy in dBFS */
  rmsEnergy: number;
  /** Peak-to-RMS ratio in dB */
  crestFactor: number;
  /** Energy distribution across frequency bands */
  bandEnergy: BandEnergy;
  /** Rate of sign changes per sample (0-1) */
  zeroCrossingRate: number;
}

/** Result of analyzing a stem for auto-mix. */
export interface AnalyzedStem {
  stemId: string;
  classification: StemClassification;
  confidence: number;
  features: StemFeatures;
}
