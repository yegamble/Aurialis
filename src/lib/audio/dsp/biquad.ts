/**
 * Biquad filter — Direct Form II Transposed (numerically stable).
 * Used for EQ, K-weighting, and anti-alias LP filter.
 */

export interface BiquadCoeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number; // normalized (divided by a0)
  a2: number;
}

export class BiquadFilter {
  private z1 = 0;
  private z2 = 0;

  constructor(public coeffs: BiquadCoeffs) {}

  processSample(x: number): number {
    const { b0, b1, b2, a1, a2 } = this.coeffs;
    const y = b0 * x + this.z1;
    this.z1 = b1 * x - a1 * y + this.z2;
    this.z2 = b2 * x - a2 * y;
    return y;
  }

  process(input: Float32Array): Float32Array {
    const output = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) {
      output[i] = this.processSample(input[i]);
    }
    return output;
  }

  reset(): void {
    this.z1 = 0;
    this.z2 = 0;
  }
}

/**
 * High-shelf filter coefficients (Audio EQ Cookbook by R. Bristow-Johnson).
 * Used for K-weighting pre-filter stage.
 *
 * @param fc     Center/transition frequency in Hz
 * @param dBGain Shelf gain in dB (positive = boost high freqs)
 * @param S      Shelf slope (1.0 = Butterworth slope)
 * @param fs     Sample rate in Hz
 */
export function highShelfCoeffs(
  fc: number,
  dBGain: number,
  S: number,
  fs: number
): BiquadCoeffs {
  const A = Math.pow(10, dBGain / 40);
  const omega = (2 * Math.PI * fc) / fs;
  const sinO = Math.sin(omega);
  const cosO = Math.cos(omega);
  const alpha =
    (sinO / 2) * Math.sqrt((A + 1 / A) * (1 / S - 1) + 2);
  const sqrtA2 = 2 * Math.sqrt(A) * alpha;

  const Ap1 = A + 1;
  const Am1 = A - 1;

  const a0 = Ap1 - Am1 * cosO + sqrtA2;
  const b0 = (A * (Ap1 + Am1 * cosO + sqrtA2)) / a0;
  const b1 = (-2 * A * (Am1 + Ap1 * cosO)) / a0;
  const b2 = (A * (Ap1 + Am1 * cosO - sqrtA2)) / a0;
  const a1 = (2 * (Am1 - Ap1 * cosO)) / a0;
  const a2 = (Ap1 - Am1 * cosO - sqrtA2) / a0;

  return { b0, b1, b2, a1, a2 };
}

/**
 * 2nd-order Butterworth high-pass filter coefficients.
 * Used for K-weighting RLB stage.
 *
 * @param fc Center frequency in Hz
 * @param Q  Quality factor (0.7071 for Butterworth = 1/sqrt(2))
 * @param fs Sample rate in Hz
 */
export function highPassCoeffs(fc: number, Q: number, fs: number): BiquadCoeffs {
  const omega = (2 * Math.PI * fc) / fs;
  const sinO = Math.sin(omega);
  const cosO = Math.cos(omega);
  const alpha = sinO / (2 * Q);

  const a0 = 1 + alpha;
  const b0 = (1 + cosO) / 2 / a0;
  const b1 = (-(1 + cosO)) / a0;
  const b2 = (1 + cosO) / 2 / a0;
  const a1 = (-2 * cosO) / a0;
  const a2 = (1 - alpha) / a0;

  return { b0, b1, b2, a1, a2 };
}

/**
 * Peaking EQ filter coefficients.
 *
 * @param fc     Center frequency in Hz
 * @param dBGain Boost/cut in dB
 * @param Q      Quality factor (bandwidth)
 * @param fs     Sample rate in Hz
 */
export function peakingCoeffs(
  fc: number,
  dBGain: number,
  Q: number,
  fs: number
): BiquadCoeffs {
  const A = Math.pow(10, dBGain / 40);
  const omega = (2 * Math.PI * fc) / fs;
  const sinO = Math.sin(omega);
  const cosO = Math.cos(omega);
  const alpha = sinO / (2 * Q);

  const a0 = 1 + alpha / A;
  const b0 = (1 + alpha * A) / a0;
  const b1 = (-2 * cosO) / a0;
  const b2 = (1 - alpha * A) / a0;
  const a1 = (-2 * cosO) / a0;
  const a2 = (1 - alpha / A) / a0;

  return { b0, b1, b2, a1, a2 };
}

/**
 * Low-shelf filter coefficients.
 *
 * @param fc     Center/transition frequency in Hz
 * @param dBGain Shelf gain in dB
 * @param S      Shelf slope (1.0 = Butterworth slope)
 * @param fs     Sample rate in Hz
 */
export function lowShelfCoeffs(
  fc: number,
  dBGain: number,
  S: number,
  fs: number
): BiquadCoeffs {
  const A = Math.pow(10, dBGain / 40);
  const omega = (2 * Math.PI * fc) / fs;
  const sinO = Math.sin(omega);
  const cosO = Math.cos(omega);
  const alpha =
    (sinO / 2) * Math.sqrt((A + 1 / A) * (1 / S - 1) + 2);
  const sqrtA2 = 2 * Math.sqrt(A) * alpha;

  const Ap1 = A + 1;
  const Am1 = A - 1;

  const a0 = Ap1 + Am1 * cosO + sqrtA2;
  const b0 = (A * (Ap1 - Am1 * cosO + sqrtA2)) / a0;
  const b1 = (2 * A * (Am1 - Ap1 * cosO)) / a0;
  const b2 = (A * (Ap1 - Am1 * cosO - sqrtA2)) / a0;
  const a1 = (-2 * (Am1 + Ap1 * cosO)) / a0;
  const a2 = (Ap1 + Am1 * cosO - sqrtA2) / a0;

  return { b0, b1, b2, a1, a2 };
}
