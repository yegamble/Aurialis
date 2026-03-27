/**
 * LUFS loudness measurement — ITU-R BS.1770-4 compliant.
 *
 * Algorithm:
 * 1. Apply K-weighting (pre-filter + RLB filter)
 * 2. Square and sum channels: z[i] = (L[i]^2 + R[i]^2) / 2
 * 3. Compute 400ms block mean-square values (momentary)
 * 4. Gate at -70 LUFS (absolute gate) and -10 LU relative gate (integrated)
 * 5. Integrated LUFS = -0.691 + 10*log10(mean of gated blocks)
 */

import { BiquadFilter, BiquadCoeffs, highShelfCoeffs, highPassCoeffs } from "./biquad";

export interface KWeightingCoeffs {
  preFilter: BiquadCoeffs;
  rlbFilter: BiquadCoeffs;
}

/**
 * Compute K-weighting biquad filter coefficients for a given sample rate.
 * Pre-filter: high shelf +4dB at ~1500 Hz
 * RLB filter: 2nd-order Butterworth HPF at ~38 Hz
 */
export function getKWeightingCoeffs(sampleRate: number): KWeightingCoeffs {
  // Pre-filter: high shelf +4 dB, fc ≈ 1500 Hz, S=1
  // (Exact parameters from EBU R128 implementation notes)
  const preFilter = highShelfCoeffs(1500, 4.0, 1.0, sampleRate);

  // RLB weighting filter: 2nd-order Butterworth HPF, fc ≈ 38.135 Hz
  const rlbFilter = highPassCoeffs(38.135, 0.7071, sampleRate);

  return { preFilter, rlbFilter };
}

/**
 * Compute momentary loudness (400ms integration window) in LUFS.
 * Returns -Infinity for silence.
 *
 * @param leftChannel   Left channel samples (at least 400ms of audio)
 * @param rightChannel  Right channel samples
 * @param sampleRate    Sample rate in Hz
 */
export function computeMomentaryLufs(
  leftChannel: Float32Array,
  rightChannel: Float32Array,
  sampleRate: number
): number {
  const coeffs = getKWeightingCoeffs(sampleRate);
  return computeBlockLoudness(leftChannel, rightChannel, coeffs);
}

/**
 * Compute integrated loudness over an entire signal (with gating).
 * Returns -Infinity for silence.
 *
 * @param leftChannel   Left channel samples
 * @param rightChannel  Right channel samples
 * @param sampleRate    Sample rate in Hz
 */
export function computeIntegratedLufs(
  leftChannel: Float32Array,
  rightChannel: Float32Array,
  sampleRate: number
): number {
  const coeffs = getKWeightingCoeffs(sampleRate);
  const blockSize = Math.round(0.4 * sampleRate); // 400ms blocks
  const hopSize = Math.round(0.1 * sampleRate);   // 100ms hop (75% overlap)

  const totalSamples = Math.min(leftChannel.length, rightChannel.length);
  const blockLoudnesses: number[] = [];

  for (let start = 0; start + blockSize <= totalSamples; start += hopSize) {
    const leftBlock = leftChannel.slice(start, start + blockSize);
    const rightBlock = rightChannel.slice(start, start + blockSize);
    const lk = computeBlockLoudness(leftBlock, rightBlock, coeffs);
    if (isFinite(lk)) {
      blockLoudnesses.push(lk);
    }
  }

  if (blockLoudnesses.length === 0) return -Infinity;

  // Absolute gate: discard blocks below -70 LUFS
  const absoluteGate = -70;
  const gated1 = blockLoudnesses.filter((l) => l >= absoluteGate);
  if (gated1.length === 0) return -Infinity;

  // Compute relative gate threshold: mean of gated1 blocks - 10 LU
  const meanPower1 = gated1.reduce((sum, l) => sum + Math.pow(10, l / 10), 0) / gated1.length;
  const relativePower = Math.pow(10, (10 * Math.log10(meanPower1) - 10) / 10);
  const relativeGate = 10 * Math.log10(relativePower);

  // Relative gate: discard blocks below relative gate
  const gated2 = gated1.filter((l) => l >= relativeGate);
  if (gated2.length === 0) return -Infinity;

  // Final integrated loudness
  const meanPower2 =
    gated2.reduce((sum, l) => sum + Math.pow(10, l / 10), 0) / gated2.length;

  return 10 * Math.log10(meanPower2);
}

/**
 * Compute mean-square loudness (in LUFS) for a block of stereo audio
 * after K-weighting.
 */
function computeBlockLoudness(
  left: Float32Array,
  right: Float32Array,
  coeffs: KWeightingCoeffs
): number {
  // Apply K-weighting to each channel
  const leftFiltered = applyKWeighting(left, coeffs);
  const rightFiltered = applyKWeighting(right, coeffs);

  // Mean square (sum of channels / num_channels, per ITU-R BS.1770)
  const N = Math.min(leftFiltered.length, rightFiltered.length);
  let sumSq = 0;
  for (let i = 0; i < N; i++) {
    sumSq += leftFiltered[i] * leftFiltered[i] + rightFiltered[i] * rightFiltered[i];
  }

  // Per ITU-R BS.1770: L_K = -0.691 + 10*log10(sum_i G_i * <z_i>)
  // For stereo G_L=G_R=1: sum = <z_L> + <z_R> = (sumL^2 + sumR^2) / N
  const meanSquare = sumSq / N;
  if (meanSquare <= 0) return -Infinity;

  // LUFS = -0.691 + 10 * log10(meanSquare)
  return -0.691 + 10 * Math.log10(meanSquare);
}

/** Apply the two K-weighting filter stages to a signal. */
function applyKWeighting(
  signal: Float32Array,
  coeffs: KWeightingCoeffs
): Float32Array {
  const preFilter = new BiquadFilter(coeffs.preFilter);
  const rlbFilter = new BiquadFilter(coeffs.rlbFilter);
  const afterPre = preFilter.process(signal);
  return rlbFilter.process(afterPre);
}
