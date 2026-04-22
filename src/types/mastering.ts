/** Shared domain types for the mastering engine and UI controls. */

export interface AudioParams {
  inputGain: number;
  threshold: number;
  ratio: number;
  attack: number;
  release: number;
  makeup: number;
  /**
   * Sidechain high-pass filter cutoff in Hz applied to the compressor's detector
   * signal (not the audio path). Prevents bass content from dominating gain
   * reduction. Range 20–300 Hz. Default 100 Hz.
   */
  sidechainHpfHz: number;
  eq80: number;
  eq250: number;
  eq1k: number;
  eq4k: number;
  eq12k: number;
  satDrive: number;
  stereoWidth: number;
  bassMonoFreq: number;
  midGain: number;
  sideGain: number;
  targetLufs: number;
  ceiling: number;
  limiterRelease: number;
}

export type ToggleName =
  | "cleanup"
  | "warm"
  | "bright"
  | "wide"
  | "loud"
  | "deharsh"
  | "glueComp";

// Re-exports for convenient single-import access
export type { GenreName, PlatformName } from "@/lib/audio/presets";
export type { TonePresetName, OutputPresetName } from "@/lib/audio/ui-presets";
