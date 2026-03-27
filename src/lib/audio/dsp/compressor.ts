/**
 * Compressor DSP — pure functions for gain computation and smoothing.
 * These functions are used both in unit tests and inlined into the worklet.
 */

export interface CompressorParams {
  threshold: number; // dBFS, e.g. -20
  ratio: number;     // compression ratio, e.g. 4 (for 4:1). Use Infinity for limiting.
  knee: number;      // soft knee width in dB, 0 = hard knee
}

/**
 * Compute gain reduction in dB for a given input level.
 *
 * @param inputDb  Input signal level in dBFS
 * @param params   Compressor parameters
 * @returns        Gain reduction in dB (0 or negative)
 */
export function computeGainReduction(
  inputDb: number,
  params: CompressorParams
): number {
  const { threshold, ratio, knee } = params;
  const halfKnee = knee / 2;
  const overshoot = inputDb - threshold;

  if (knee > 0 && overshoot >= -halfKnee && overshoot <= halfKnee) {
    // Soft knee: quadratic interpolation (Giannoulis et al.)
    // GR = (1/ratio - 1) * (overshoot + halfKnee)^2 / (2 * knee)
    const x = overshoot + halfKnee; // 0 at bottom of knee, knee at top
    const r = ratio === Infinity ? 1e10 : ratio;
    return (1 / r - 1) * (x * x) / (2 * knee);
  }

  if (overshoot <= -halfKnee) {
    // Below threshold (or below knee): no compression
    return 0;
  }

  // Above knee: full compression
  if (ratio === Infinity) {
    return -overshoot; // Hard limiting: clamp to threshold
  }
  // gain_reduction = (overshoot) * (1/ratio - 1)
  return overshoot * (1 / ratio - 1);
}

/**
 * Compute exponential attack/release smoothing coefficients.
 * coeff = exp(-1 / (time_seconds * sampleRate))
 *
 * @param attackSecs   Attack time in seconds
 * @param releaseSecs  Release time in seconds
 * @param sampleRate   Sample rate in Hz
 */
export function makeAttackReleaseCoeffs(
  attackSecs: number,
  releaseSecs: number,
  sampleRate: number
): { attack: number; release: number } {
  return {
    attack: Math.exp(-1 / (attackSecs * sampleRate)),
    release: Math.exp(-1 / (releaseSecs * sampleRate)),
  };
}

/**
 * Apply one-pole smoothing to the gain reduction envelope.
 * Uses attack coefficient when gain is decreasing (more reduction),
 * release coefficient when gain is recovering.
 *
 * @param currentGr  Current gain reduction in dB (≤ 0)
 * @param targetGr   Target gain reduction in dB (≤ 0)
 * @param attackCoeff   Attack coefficient (0 = instant, 1 = no change)
 * @param releaseCoeff  Release coefficient
 */
export function applyGainSmoothing(
  currentGr: number,
  targetGr: number,
  attackCoeff: number,
  releaseCoeff: number
): number {
  if (targetGr < currentGr) {
    // More gain reduction needed: attack
    return attackCoeff * currentGr + (1 - attackCoeff) * targetGr;
  } else {
    // Gain recovering: release
    return releaseCoeff * currentGr + (1 - releaseCoeff) * targetGr;
  }
}
