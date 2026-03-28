/**
 * Auto Master — maps AnalysisResult to AudioParams.
 * Runs as a pure function (no Web Audio API).
 */

import type { AudioParams } from "@/lib/stores/audio-store";
import { DEFAULT_PARAMS, type GenreName } from "./presets";
import type { AnalysisResult } from "./analysis";

export interface AutoMasterResult {
  /** Suggested genre based on dynamics and spectral content */
  genre: GenreName;
  /** Suggested processing intensity 0–100 */
  intensity: number;
  /** Complete AudioParams to apply to the mastering chain */
  params: AudioParams;
}

/**
 * Derive mastering parameters from audio analysis.
 *
 * Heuristics:
 * - LUFS > -12: already loud → gentle (intensity ~30)
 * - LUFS < -20: quiet → more processing (intensity ~70)
 * - Bass-heavy (bassRatio > 0.4): reduce eq80, boost presence
 * - Bright (highRatio > 0.4): reduce eq12k
 * - DR > 15 dB → classical / jazz; DR < 8 dB → pop / electronic
 */
export function computeAutoMasterParams(analysis: AnalysisResult): AutoMasterResult {
  // --- Intensity based on integrated loudness ---
  let intensity: number;
  if (analysis.integratedLufs > -12) {
    // Already loud — gentle processing
    intensity = 30;
  } else if (analysis.integratedLufs < -20) {
    // Quiet — more processing needed
    intensity = 70;
  } else {
    // Linear interpolation: -20 LUFS → 70, -12 LUFS → 30
    const t = (analysis.integratedLufs - (-20)) / ((-12) - (-20));
    intensity = Math.round(70 - t * 40);
  }
  intensity = Math.max(0, Math.min(100, intensity));

  // --- Genre from dynamic range and spectral content ---
  let genre: GenreName;
  if (analysis.dynamicRange > 15) {
    genre = analysis.bassRatio > 0.4 ? "jazz" : "classical";
  } else if (analysis.dynamicRange < 8) {
    genre = analysis.bassRatio > 0.4 ? "hiphop" : "pop";
  } else {
    genre = analysis.bassRatio > 0.4 ? "hiphop" : "pop";
  }

  // --- Build params from neutral defaults ---
  const params: AudioParams = { ...DEFAULT_PARAMS };

  // EQ adjustments based on spectral imbalance
  if (analysis.bassRatio > 0.4) {
    params.eq80 = -2;   // tighten up excessive bass
    params.eq4k = 1;    // restore presence
  }
  if (analysis.highRatio > 0.4) {
    params.eq12k = -2;  // tame harshness
  }

  // Compression scales with intensity
  const iFactor = intensity / 100;
  params.threshold = -18 - iFactor * 10;  // -18 dB (gentle) to -28 dB (heavy)
  params.ratio = 2 + iFactor * 2;          // 2:1 to 4:1
  params.makeup = Math.round(iFactor * 4); // 0–4 dB makeup gain
  params.targetLufs = -14;

  return { genre, intensity, params };
}
