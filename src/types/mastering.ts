/** Shared domain types for the mastering engine and UI controls. */

/** Saturation character mode. */
export type SaturationMode = "clean" | "tube" | "tape" | "transformer";

/**
 * Per-band mode for the multiband compressor.
 * `stereo` = L/R linked, `ms` = Mid/Side encoded with optional `msBalance` bias.
 */
export type MultibandMode = "stereo" | "ms";

/**
 * Parametric-EQ per-band filter shape.
 * - `bell`      = peaking (boost/cut around center freq)
 * - `lowShelf`  = Bristow-Johnson low-shelf (tilt below corner)
 * - `highShelf` = high-shelf (tilt above corner)
 * - `highPass`  = 2nd-order Butterworth HPF (gain ignored; attenuate below freq)
 * - `lowPass`   = 2nd-order Butterworth LPF (gain ignored; attenuate above freq)
 */
export type EqBandType = "bell" | "lowShelf" | "highShelf" | "highPass" | "lowPass";

/**
 * Parametric-EQ per-band stereo mode.
 * - `stereo` = L/R linked (band processes both channels identically).
 * - `ms`     = Mid/Side encoded. `msBalance` ∈ [-1,+1] weights band gain between
 *              M and S: weight_M = msBalance>=0 ? 1 : (1+msBalance);
 *                       weight_S = msBalance<=0 ? 1 : (1-msBalance).
 *              +1 → Mid only; 0 → both channels get full gain (≈ stereo mode);
 *              -1 → Side only.
 */
export type EqBandMode = "stereo" | "ms";

export interface AudioParams {
  inputGain: number;
  /**
   * Per-stage master-enable flags (Phase 4a Task 4). 1 = stage active, 0 =
   * stage in true bypass (bit-exact passthrough). These supplement — not
   * replace — the global A/B toggle (`engine.setBypass`), which continues to
   * rewire the entire chain boundary. Per-stage state persists across global
   * A/B toggles because the two bypass paths are independent.
   *
   * Note: no persistence layer currently serializes `AudioParams` (verified
   * 2026-04-23 via grep). If one is ever added, missing `*Enabled` fields
   * must be defaulted to 1 at load time.
   */
  compressorEnabled: number;
  saturationEnabled: number;
  stereoWidthEnabled: number;
  limiterEnabled: number;

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
  /**
   * Legacy names preserved for backward compatibility with `ui-presets.ts`
   * tone/toggle offsets. Semantically these are "Band N gain in dB" —
   * the frequency is no longer locked to the original value.
   * eq80  = Band 1 gain (default band 1 freq 80 Hz  lowShelf)
   * eq250 = Band 2 gain (default band 2 freq 250 Hz bell)
   * eq1k  = Band 3 gain (default band 3 freq 1 kHz bell)
   * eq4k  = Band 4 gain (default band 4 freq 4 kHz bell)
   * eq12k = Band 5 gain (default band 5 freq 12 kHz highShelf)
   */
  eq80: number;
  eq250: number;
  eq1k: number;
  eq4k: number;
  eq12k: number;

  /**
   * Parametric EQ master enable (0/1). When 0, the EQ stage is in true bypass
   * (bit-exact passthrough).
   */
  parametricEqEnabled: number;

  // --- Parametric EQ Band 1 (defaults: 80 Hz low-shelf) ---
  eqBand1Enabled: number;
  eqBand1Freq: number;
  eqBand1Q: number;
  eqBand1Type: EqBandType;
  eqBand1Mode: EqBandMode;
  eqBand1MsBalance: number;

  // --- Parametric EQ Band 2 (defaults: 250 Hz bell) ---
  eqBand2Enabled: number;
  eqBand2Freq: number;
  eqBand2Q: number;
  eqBand2Type: EqBandType;
  eqBand2Mode: EqBandMode;
  eqBand2MsBalance: number;

  // --- Parametric EQ Band 3 (defaults: 1 kHz bell) ---
  eqBand3Enabled: number;
  eqBand3Freq: number;
  eqBand3Q: number;
  eqBand3Type: EqBandType;
  eqBand3Mode: EqBandMode;
  eqBand3MsBalance: number;

  // --- Parametric EQ Band 4 (defaults: 4 kHz bell) ---
  eqBand4Enabled: number;
  eqBand4Freq: number;
  eqBand4Q: number;
  eqBand4Type: EqBandType;
  eqBand4Mode: EqBandMode;
  eqBand4MsBalance: number;

  // --- Parametric EQ Band 5 (defaults: 12 kHz high-shelf) ---
  eqBand5Enabled: number;
  eqBand5Freq: number;
  eqBand5Q: number;
  eqBand5Type: EqBandType;
  eqBand5Mode: EqBandMode;
  eqBand5MsBalance: number;

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

  /**
   * Multiband compressor master enable (0/1). When 0, the multiband node is in
   * bypass and its output is bit-equal to its input.
   */
  multibandEnabled: number;
  /** Low|Mid crossover frequency (Hz). Default 200. Range 80–400. */
  mbCrossLowMid: number;
  /** Mid|High crossover frequency (Hz). Default 2000. Range 800–4000. */
  mbCrossMidHigh: number;

  // --- Low band ---
  mbLowEnabled: number;
  mbLowSolo: number;
  mbLowThreshold: number;
  mbLowRatio: number;
  mbLowAttack: number;
  mbLowRelease: number;
  mbLowMakeup: number;
  mbLowMode: MultibandMode;
  /** -1..+1. In M/S mode, biases threshold: +1 softer on M, harder on S. */
  mbLowMsBalance: number;

  // --- Mid band ---
  mbMidEnabled: number;
  mbMidSolo: number;
  mbMidThreshold: number;
  mbMidRatio: number;
  mbMidAttack: number;
  mbMidRelease: number;
  mbMidMakeup: number;
  mbMidMode: MultibandMode;
  mbMidMsBalance: number;

  // --- High band ---
  mbHighEnabled: number;
  mbHighSolo: number;
  mbHighThreshold: number;
  mbHighRatio: number;
  mbHighAttack: number;
  mbHighRelease: number;
  mbHighMakeup: number;
  mbHighMode: MultibandMode;
  mbHighMsBalance: number;
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
