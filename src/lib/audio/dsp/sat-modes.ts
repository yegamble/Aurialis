/**
 * Saturation character modes — waveshapers for Clean / Tube / Tape / Transformer.
 *
 * Architecture:
 *   - Pre-filters (tape HF shelf, transformer mid peak) run at BASE sample rate
 *     BEFORE the 4× oversampler. Their biquad coefficients are designed for base
 *     sampleRate. Running them inside the 4× block would place them at 3 kHz
 *     instead of 12 kHz.
 *   - Waveshapers run at the 4× rate inside the oversampling block (same as P0).
 *   - Tube adds a post-waveshape DC-blocking HPF at 20 Hz to remove asymmetric-
 *     signal DC buildup that the static nominal trim can't handle.
 *
 * All formulas in this file are canonical — the worklet inlines them with
 * `// IN SYNC WITH` comments. Parity is verified through spectral/functional tests.
 */

import {
  highShelfCoeffs,
  highPassCoeffs,
  peakingCoeffs,
  type BiquadCoeffs,
} from "./biquad";

export const TUBE_BIAS = 0.1;
export const TAPE_HF_FREQ_HZ = 12000;
export const TAPE_HF_GAIN_DB = -3;
export const XFMR_MID_FREQ_HZ = 1500;
export const XFMR_MID_GAIN_DB = 2;
export const XFMR_MID_Q = 1.2;
export const TUBE_DC_HPF_HZ = 20;

/**
 * Clean tanh waveshaper — same as P0 saturation.
 * @param x           Input sample
 * @param driveFactor tanh drive (1 = minimal, 10 = heavy)
 * @param norm        Pre-computed `tanh(driveFactor)`
 */
export function applyCleanSaturation(
  x: number,
  driveFactor: number,
  norm: number
): number {
  return Math.tanh(driveFactor * x) / norm;
}

/**
 * Tube saturation — asymmetric tanh with a small DC bias → generates a
 * measurable 2nd-order harmonic (warmth). Nominal DC trim removes the
 * zero-input offset. For asymmetric signals, pair with a 20 Hz HPF downstream.
 */
export function applyTubeSaturation(
  x: number,
  driveFactor: number,
  norm: number
): number {
  const nominalDc = Math.tanh(TUBE_BIAS) / norm;
  return Math.tanh(driveFactor * x + TUBE_BIAS) / norm - nominalDc;
}

/**
 * Tape soft-knee waveshaper (p=1.5). Assumes HF shelf pre-filter already applied
 * at base rate. The `cbrt` / `p=3` approximation is NOT used — keep p=1.5 in both
 * TS and worklet. At drive=1, this curve is nearly linear; at higher drive it
 * compresses gently without the hard corner that cubic or tanh produce.
 */
export function applyTapeShaper(x: number, driveFactor: number): number {
  const t = driveFactor * x;
  const abs = Math.abs(t);
  // y = x / (1 + |drive·x|^1.5)^(1/1.5)
  const denom = Math.pow(1 + Math.pow(abs, 1.5), 1 / 1.5);
  return t / denom;
}

/**
 * Transformer piecewise soft-clip. Assumes mid emphasis biquad already applied
 * at base rate.
 *   |t| <= 1 → cubic soft-curve: t · (1 − t²/3)
 *   |t| > 1  → hard-limit at ±2/3 (the curve's asymptote)
 */
export function applyTransformerShaper(x: number, driveFactor: number): number {
  const t = driveFactor * x;
  const a = Math.abs(t);
  if (a <= 1) return t * (1 - (a * a) / 3);
  return Math.sign(t) * (2 / 3);
}

/** Pre-computed saturation-mode biquad coefficients at a given sample rate. */
export interface SatModeCoeffs {
  tapeHf: BiquadCoeffs;
  xfmrMid: BiquadCoeffs;
  tubeDcHpf: BiquadCoeffs;
}

/**
 * Build the three pre/post-filter biquad coefficient sets at `sampleRate`.
 * Caller stores these once and uses them until sampleRate changes.
 */
export function buildSatModeCoeffs(sampleRate: number): SatModeCoeffs {
  return {
    tapeHf: highShelfCoeffs(TAPE_HF_FREQ_HZ, TAPE_HF_GAIN_DB, 1.0, sampleRate),
    xfmrMid: peakingCoeffs(
      XFMR_MID_FREQ_HZ,
      XFMR_MID_GAIN_DB,
      XFMR_MID_Q,
      sampleRate
    ),
    // 20 Hz 2nd-order Butterworth HPF removes DC drift from asymmetric tube
    // saturation (e.g. unipolar kick content). Transparent above ~40 Hz.
    tubeDcHpf: highPassCoeffs(TUBE_DC_HPF_HZ, Math.SQRT1_2, sampleRate),
  };
}
