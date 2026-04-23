/** Shared domain types for the mastering engine and UI controls. */

/** Saturation character mode. */
export type SaturationMode = "clean" | "tube" | "tape" | "transformer";

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
  /**
   * Auto-release mode flag (0 = manual, 1 = dual-stage parallel envelope).
   * When enabled, the compressor's release picks the slower of a fast/slow
   * envelope pair → holds GR longer on dense content, reducing pumping.
   * Trade-off: slightly delayed compression of subsequent transients.
   */
  autoRelease: number;
  eq80: number;
  eq250: number;
  eq1k: number;
  eq4k: number;
  eq12k: number;
  satDrive: number;
  /**
   * Saturation character mode. Clean = symmetric tanh (P0 default).
   * Tube/Tape/Transformer each impart distinct harmonic character.
   */
  satMode: SaturationMode;
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
