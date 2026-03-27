/**
 * Saturation DSP — tanh waveshaping with drive control.
 * output = tanh(drive * input) / tanh(drive), normalized for unity gain at low levels.
 */

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
