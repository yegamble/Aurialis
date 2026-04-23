/**
 * Saturation DSP — tanh waveshaping with drive control.
 * output = tanh(drive * input) / tanh(drive), normalized for unity gain at low levels.
 *
 * `applyOversampledSaturation` is the Grammy-grade 4×-oversampled variant:
 * upsample via halfband FIR → tanh waveshape at 4× rate → decimate via halfband.
 * This moves aliasing products out of the audible range (down to ~-100 dB).
 *
 * `applySaturation` is the naive 1× variant kept for reference / comparison tests.
 */

import { Oversampler4x } from "./oversampling";

/**
 * Map drive percentage (0-100%) to drive factor (1-10).
 */
export function drivePctToFactor(pct: number): number {
  // Linear mapping: 0% → 1, 100% → 10
  return 1 + (pct / 100) * 9;
}

/**
 * Apply tanh saturation waveshaping to a buffer.
 * Normalized so that unity gain at very low levels (no amplitude boost).
 *
 * @param input        Input samples
 * @param driveFactor  Drive factor (1 = minimal, 10 = heavy saturation)
 */
export function applySaturation(
  input: Float32Array,
  driveFactor: number
): Float32Array {
  const output = new Float32Array(input.length);

  // Prevent division by zero at drive = 0 (shouldn't happen with drivePctToFactor)
  if (driveFactor <= 0) {
    for (let i = 0; i < input.length; i++) output[i] = input[i];
    return output;
  }

  // tanh(drive) as normalization denominator
  const norm = Math.tanh(driveFactor);

  for (let i = 0; i < input.length; i++) {
    output[i] = Math.tanh(driveFactor * input[i]) / norm;
  }

  return output;
}

/**
 * 4×-oversampled tanh saturation. Processes each input sample by upsampling
 * to 4× via cascaded halfband FIR, applying `tanh(drive·x)/tanh(drive)` at the
 * oversampled rate, then decimating back to the original rate.
 *
 * For long buffers, aliasing energy is ~≥40 dB lower than `applySaturation` at
 * heavy drive settings, with HF preservation flat to ~18 kHz at 44.1 kHz.
 *
 * Note: the 47-tap halfband FIR has ~18 samples of total (up + down) group
 * delay at the input rate. Consumers that care about alignment should handle
 * this externally or skip the warmup region.
 */
export function applyOversampledSaturation(
  input: Float32Array,
  driveFactor: number
): Float32Array {
  const output = new Float32Array(input.length);

  if (driveFactor <= 0) {
    for (let i = 0; i < input.length; i++) output[i] = input[i];
    return output;
  }

  const norm = Math.tanh(driveFactor);
  const os = new Oversampler4x();

  for (let i = 0; i < input.length; i++) {
    const up = os.upsample(input[i]);
    // tanh waveshaping at 4× rate
    const s0 = Math.tanh(driveFactor * up[0]) / norm;
    const s1 = Math.tanh(driveFactor * up[1]) / norm;
    const s2 = Math.tanh(driveFactor * up[2]) / norm;
    const s3 = Math.tanh(driveFactor * up[3]) / norm;
    output[i] = os.downsample(s0, s1, s2, s3);
  }

  return output;
}

/**
 * Compute Total Harmonic Distortion (THD) ratio.
 * Compares RMS energy at harmonic frequencies vs fundamental.
 *
 * @param input      Original input signal (Float32Array)
 * @param output     Processed output signal (Float32Array)
 * @param fundamental  Fundamental frequency in Hz
 * @param sampleRate   Sample rate in Hz
 * @returns THD ratio (0 = no distortion, > 0 = harmonics present)
 */
export function computeTHD(
  input: Float32Array,
  output: Float32Array,
  fundamental: number,
  sampleRate: number
): number {
  const N = Math.min(input.length, output.length);

  // Compute DFT magnitude at fundamental and harmonics
  const getFundamentalBin = (freq: number) =>
    Math.round((freq * N) / sampleRate);

  // Compute magnitudes via DFT for specific frequency bins
  const getMagnitude = (signal: Float32Array, freq: number): number => {
    const bin = getFundamentalBin(freq);
    let re = 0;
    let im = 0;
    for (let n = 0; n < N; n++) {
      const angle = (2 * Math.PI * bin * n) / N;
      re += signal[n] * Math.cos(angle);
      im -= signal[n] * Math.sin(angle);
    }
    return Math.sqrt(re * re + im * im) / N;
  };

  const fundamentalMag = getMagnitude(input, fundamental);
  if (fundamentalMag < 1e-10) return 0;

  // Sum harmonic energy (2nd through 5th harmonics)
  let harmonicSumSq = 0;
  for (let h = 2; h <= 5; h++) {
    const hFreq = fundamental * h;
    if (hFreq >= sampleRate / 2) break;
    const hMag = getMagnitude(output, hFreq);
    harmonicSumSq += hMag * hMag;
  }

  return Math.sqrt(harmonicSumSq) / fundamentalMag;
}
