/**
 * Sidechain high-pass filter — 2nd-order Butterworth (Q = 1/√2).
 *
 * Used in the compressor worklet to HPF the detector signal (not the audio
 * path) so bass content doesn't dominate gain reduction. A kick drum on every
 * downbeat would otherwise cause the whole mix to pump — every pro bus
 * compressor (SSL G-Series, API 2500, Fabfilter Pro-MB) sidechains at 60–150 Hz
 * for this reason.
 *
 * Reference implementation for tests and as a correctness check for the
 * worklet's inline DF-II transposed biquad. The worklet duplicates the
 * coefficient math inline (worklets can't import TS); this module is the
 * canonical source.
 */

import { highPassCoeffs, type BiquadCoeffs } from "./biquad";

/**
 * Compute Butterworth high-pass coefficients for the compressor's detector HPF.
 * Equivalent to `highPassCoeffs(freqHz, 1 / Math.sqrt(2), sampleRate)`.
 */
export function makeSidechainHpfCoeffs(
  freqHz: number,
  sampleRate: number
): BiquadCoeffs {
  return highPassCoeffs(freqHz, Math.SQRT1_2, sampleRate);
}

/** Streaming 2nd-order HPF for a single detector (mono) input channel. */
export class SidechainHpfState {
  private coeffs: BiquadCoeffs;
  private z1 = 0;
  private z2 = 0;

  constructor(freqHz: number, sampleRate: number) {
    this.coeffs = makeSidechainHpfCoeffs(freqHz, sampleRate);
  }

  /** Update cutoff; preserves internal state (smooth transition). */
  setFrequency(freqHz: number, sampleRate: number): void {
    this.coeffs = makeSidechainHpfCoeffs(freqHz, sampleRate);
  }

  /** Process one sample through the filter. */
  processSample(x: number): number {
    const { b0, b1, b2, a1, a2 } = this.coeffs;
    const y = b0 * x + this.z1;
    this.z1 = b1 * x - a1 * y + this.z2;
    this.z2 = b2 * x - a2 * y;
    return y;
  }

  /** Reset state to all-zero. */
  reset(): void {
    this.z1 = 0;
    this.z2 = 0;
  }
}

/**
 * Apply the sidechain HPF to a whole buffer. Offline convenience for tests.
 */
export function applySidechainHpfToBuffer(
  input: Float32Array,
  freqHz: number,
  sampleRate: number
): Float32Array {
  const out = new Float32Array(input.length);
  const state = new SidechainHpfState(freqHz, sampleRate);
  for (let i = 0; i < input.length; i++) out[i] = state.processSample(input[i]);
  return out;
}
