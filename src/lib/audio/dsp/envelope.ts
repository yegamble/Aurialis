/**
 * Envelope followers for compressor/limiter gain detection.
 */

/**
 * Compute RMS level of a signal buffer in linear scale.
 * @param buffer  Audio samples
 * @param offset  Start index (default 0)
 * @param length  Number of samples (default buffer.length)
 */
export function computeRmsLevel(
  buffer: Float32Array,
  offset = 0,
  length?: number
): number {
  const n = length ?? buffer.length - offset;
  if (n <= 0) return 0;
  let sumSq = 0;
  for (let i = offset; i < offset + n; i++) {
    sumSq += buffer[i] * buffer[i];
  }
  return Math.sqrt(sumSq / n);
}

/**
 * Compute peak (maximum absolute) level of a signal buffer in linear scale.
 */
export function computePeakLevel(
  buffer: Float32Array,
  offset = 0,
  length?: number
): number {
  const n = length ?? buffer.length - offset;
  let peak = 0;
  for (let i = offset; i < offset + n; i++) {
    const abs = Math.abs(buffer[i]);
    if (abs > peak) peak = abs;
  }
  return peak;
}

/**
 * One-pole exponential envelope follower (used inside the compressor worklet).
 * State is maintained externally (pass `currentLevel`, receive updated value).
 *
 * @param currentLevel  Current envelope state (linear)
 * @param inputLevel    New input level (linear, absolute value)
 * @param attackCoeff   Attack smoothing coefficient (0 = instant, close to 1 = slow)
 * @param releaseCoeff  Release smoothing coefficient
 */
export function followEnvelope(
  currentLevel: number,
  inputLevel: number,
  attackCoeff: number,
  releaseCoeff: number
): number {
  if (inputLevel > currentLevel) {
    return attackCoeff * currentLevel + (1 - attackCoeff) * inputLevel;
  } else {
    return releaseCoeff * currentLevel + (1 - releaseCoeff) * inputLevel;
  }
}
