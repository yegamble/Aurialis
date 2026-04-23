/**
 * True-peak (inter-sample peak) detection per ITU-R BS.1770-4 Annex 2.
 *
 * Rationale: sampled digital audio is reconstructed by the DAC into a continuous
 * bandlimited waveform. Between two sample points the waveform can rise above
 * the higher sample — these are inter-sample peaks (ISPs). A signal whose
 * sample peaks are all ≤ 0.99 can still clip a consumer DAC during playback
 * if its true waveform peak is 1.02. Streaming platforms enforce true-peak
 * limits (Spotify −1 dBTP, Apple Music −1 dBTP).
 *
 * Measurement: upsample 4× via the canonical `oversampling.ts` halfband FIR,
 * then take max(|·|) across the oversampled samples.
 */

import { upsample4x, Oversampler4x } from "./oversampling";

/**
 * Offline true-peak detection: upsample 4× and find max |sample|.
 * Returns dBTP (linear to dB, or -Infinity for silence).
 */
export function detectTruePeakDbTp(signal: Float32Array): number {
  const oversampled = upsample4x(signal);
  let peak = 0;
  for (let i = 0; i < oversampled.length; i++) {
    const abs = Math.abs(oversampled[i]);
    if (abs > peak) peak = abs;
  }
  if (peak <= 0) return -Infinity;
  return 20 * Math.log10(peak);
}

/**
 * Streaming true-peak detector. Per input sample, reports the max |sample|
 * across the 4 oversampled samples at the fast rate. State persists across
 * calls; caller is responsible for resetting when context restarts.
 */
export class TruePeakDetector {
  private os = new Oversampler4x();
  /** Running max-absolute value seen since last reset. */
  private _peak = 0;

  /**
   * Consume one input sample; return the max |·| across this sample's 4
   * oversampled representatives.
   */
  processSample(x: number): number {
    const up = this.os.upsample(x);
    let localPeak = 0;
    for (let i = 0; i < 4; i++) {
      const abs = Math.abs(up[i]);
      if (abs > localPeak) localPeak = abs;
    }
    if (localPeak > this._peak) this._peak = localPeak;
    return localPeak;
  }

  /** Running max linear peak since last reset. */
  get peak(): number {
    return this._peak;
  }

  /** Running max in dBTP (or -Infinity). */
  get peakDbTp(): number {
    if (this._peak <= 0) return -Infinity;
    return 20 * Math.log10(this._peak);
  }

  /** Reset state (oversampler + running peak). */
  reset(): void {
    this.os.reset();
    this._peak = 0;
  }
}
