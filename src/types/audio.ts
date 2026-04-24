export interface AudioFileMetadata {
  name: string;
  type: string;
  size: number;
  sampleRate: number;
  channels: number;
  duration: number;
  bitDepth: number | null;
}

export interface AudioEngineState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  isLoaded: boolean;
}

export interface MeteringData {
  leftLevel: number;
  rightLevel: number;
  lufs: number;
  shortTermLufs: number;
  integratedLufs: number;
  truePeak: number;
  dynamicRange: number;
  /** EBU R128 Loudness Range (LU). 0 while `lraReady` is false. */
  lra: number;
  /** True once the short-term buffer has 3 s of data. UI shows `---` while false. */
  lraReady: boolean;
  /** Stereo correlation in [-1, +1]. +1 = mono, 0 = uncorrelated, -1 = anti-phase. */
  correlation: number;
  /** Worst-case correlation in the last ~500 ms (for UI peak-hold colouring). */
  correlationPeakMin: number;
  /**
   * Per-band multiband compressor gain reduction (dB, ≤ 0). 0 when the band is
   * disabled or the multiband stage is bypassed. Updated alongside the other
   * metering fields at the MeteringNode's native rate (~10-20 Hz) — the engine
   * latches the latest value from MultibandCompressorNode.onGainReduction.
   */
  multibandGR: {
    low: number;
    mid: number;
    high: number;
  };
}

export interface VisualizationData {
  waveform: Float32Array;
  spectrum: Float32Array;
  metering: MeteringData;
}

export type AudioEngineEventType =
  | "statechange"
  | "timeupdate"
  | "loaded"
  | "ended"
  | "error"
  | "metering"
  | "paramchange";

export interface AudioEngineEvent {
  type: AudioEngineEventType;
  data?: unknown;
}

export const SUPPORTED_FORMATS = [
  "audio/wav",
  "audio/x-wav",
  "audio/mpeg",
  "audio/mp3",
  "audio/flac",
  "audio/ogg",
  "audio/aac",
  "audio/mp4",
  "audio/x-m4a",
] as const;

export const SUPPORTED_EXTENSIONS = [
  ".wav",
  ".mp3",
  ".flac",
  ".ogg",
  ".aac",
  ".m4a",
] as const;

export const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB
export const WARN_FILE_SIZE = 50 * 1024 * 1024; // 50MB
