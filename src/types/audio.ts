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
