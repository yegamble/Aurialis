/**
 * Running stereo correlation coefficient per EBU R128 guidance.
 *
 * Correlation = E[L·R] / √(E[L²] · E[R²]), range [−1, +1].
 *   +1 = identical (mono)
 *    0 = uncorrelated (wide stereo)
 *   −1 = inverted (anti-phase → cancels in mono fold-down)
 *
 * Implementation: EWMA one-pole smoothing with τ ≈ 100 ms. Also tracks the
 * worst-case (most-negative) value in the last 500 ms for UI peak-hold.
 */

export class RunningCorrelation {
  private avgLR = 0;
  private avgLL = 0;
  private avgRR = 0;
  private coeff: number;
  private peakMinBuf: Float32Array;
  private peakMinPos = 0;

  constructor(sampleRate: number, tauSeconds = 0.1, peakHoldSeconds = 0.5) {
    this.coeff = Math.exp(-1 / (tauSeconds * sampleRate));
    // Peak-hold ring buffer: one entry per sample in the hold window.
    // Size ~22050 at 44.1k × 500 ms. To save memory, downsample by storing
    // one value per 10 samples (2205 entries) — plenty for 500 ms visibility.
    this.peakMinBuf = new Float32Array(Math.round(peakHoldSeconds * sampleRate / 10) + 1).fill(1);
  }

  /** Process one stereo sample pair. Updates internal state. */
  processSample(l: number, r: number): void {
    const c = this.coeff;
    this.avgLR = c * this.avgLR + (1 - c) * (l * r);
    this.avgLL = c * this.avgLL + (1 - c) * (l * l);
    this.avgRR = c * this.avgRR + (1 - c) * (r * r);
  }

  /** Compute the current smoothed correlation value, guarded against div-by-zero. */
  get correlation(): number {
    const denom = Math.sqrt(this.avgLL * this.avgRR);
    if (denom < 1e-10) return 0;
    const c = this.avgLR / denom;
    return Math.max(-1, Math.min(1, c));
  }

  /**
   * Commit the current correlation value to the peak-hold ring (call once per
   * metering block, e.g. 100 ms). Returns the worst (most-negative) value in
   * the hold window.
   */
  commitPeak(): number {
    const current = this.correlation;
    this.peakMinBuf[this.peakMinPos] = current;
    this.peakMinPos = (this.peakMinPos + 1) % this.peakMinBuf.length;
    let min = 1;
    for (let i = 0; i < this.peakMinBuf.length; i++) {
      if (this.peakMinBuf[i] < min) min = this.peakMinBuf[i];
    }
    return min;
  }

  /** Reset state (used on context restart). */
  reset(): void {
    this.avgLR = 0;
    this.avgLL = 0;
    this.avgRR = 0;
    this.peakMinBuf.fill(1);
    this.peakMinPos = 0;
  }
}
