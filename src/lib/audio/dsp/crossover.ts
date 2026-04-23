/**
 * Linkwitz-Riley 4th-order crossover.
 *
 * LR4 = two cascaded 2nd-order Butterworth filters (Q = 1/√2) at identical fc.
 * Each LR4 filter rolls off at -24 dB/oct and passes -6 dB (amplitude 0.5) at fc.
 *
 * The magnitude of `LP(fc, x) + HP(fc, x)` is flat for all frequencies and the
 * phase response is an all-pass — this is the "summation-flat" property that
 * makes LR4 the industry-standard multiband crossover.
 *
 * For 3-way splitting the low band must be phase-compensated by passing it
 * through an all-pass equivalent at the second crossover point so all three
 * bands share the same phase response and sum magnitude-flat. See
 * `ThreeWaySplitter` below.
 */

import {
  BiquadFilter,
  highPassCoeffs,
  lowPassCoeffs,
} from "./biquad";

const BUTTERWORTH_Q = Math.SQRT1_2;

/** Two cascaded Butterworth lowpass biquads at the same fc = LR4 lowpass. */
export class LR4Lowpass {
  private s1: BiquadFilter;
  private s2: BiquadFilter;

  constructor(fc: number, fs: number) {
    const coeffs = lowPassCoeffs(fc, BUTTERWORTH_Q, fs);
    this.s1 = new BiquadFilter({ ...coeffs });
    this.s2 = new BiquadFilter({ ...coeffs });
  }

  processSample(x: number): number {
    return this.s2.processSample(this.s1.processSample(x));
  }

  reset(): void {
    this.s1.reset();
    this.s2.reset();
  }

  setCutoff(fc: number, fs: number): void {
    const coeffs = lowPassCoeffs(fc, BUTTERWORTH_Q, fs);
    this.s1.coeffs = { ...coeffs };
    this.s2.coeffs = { ...coeffs };
  }
}

/** Two cascaded Butterworth highpass biquads at the same fc = LR4 highpass. */
export class LR4Highpass {
  private s1: BiquadFilter;
  private s2: BiquadFilter;

  constructor(fc: number, fs: number) {
    const coeffs = highPassCoeffs(fc, BUTTERWORTH_Q, fs);
    this.s1 = new BiquadFilter({ ...coeffs });
    this.s2 = new BiquadFilter({ ...coeffs });
  }

  processSample(x: number): number {
    return this.s2.processSample(this.s1.processSample(x));
  }

  reset(): void {
    this.s1.reset();
    this.s2.reset();
  }

  setCutoff(fc: number, fs: number): void {
    const coeffs = highPassCoeffs(fc, BUTTERWORTH_Q, fs);
    this.s1.coeffs = { ...coeffs };
    this.s2.coeffs = { ...coeffs };
  }
}

/**
 * Three-way LR4 crossover with phase-compensated summation.
 *
 * Topology:
 *   lowRaw = LP(fcLowMid, x)
 *   hpOnce = HP(fcLowMid, x)
 *   mid    = LP(fcMidHigh, hpOnce)
 *   high   = HP(fcMidHigh, hpOnce)
 *   low    = LP(fcMidHigh, lowRaw) + HP(fcMidHigh, lowRaw)   // all-pass at fcMidHigh
 *
 * The all-pass equivalent on the low path gives it the same phase response as
 * mid+high, so low+mid+high has flat magnitude (and an all-pass phase response
 * equal to AP(fcLowMid) * AP(fcMidHigh)).
 */
export class ThreeWaySplitter {
  private fcLowMid: number;
  private fcMidHigh: number;
  private readonly fs: number;

  private lpLowMid: LR4Lowpass;
  private hpLowMid: LR4Highpass;
  private lpMidHigh: LR4Lowpass;
  private hpMidHigh: LR4Highpass;
  // All-pass compensation for the low path (state-independent duplicates).
  private lpMidHighAp: LR4Lowpass;
  private hpMidHighAp: LR4Highpass;

  constructor(fcLowMid: number, fcMidHigh: number, fs: number) {
    this.fcLowMid = fcLowMid;
    this.fcMidHigh = fcMidHigh;
    this.fs = fs;
    this.lpLowMid = new LR4Lowpass(fcLowMid, fs);
    this.hpLowMid = new LR4Highpass(fcLowMid, fs);
    this.lpMidHigh = new LR4Lowpass(fcMidHigh, fs);
    this.hpMidHigh = new LR4Highpass(fcMidHigh, fs);
    this.lpMidHighAp = new LR4Lowpass(fcMidHigh, fs);
    this.hpMidHighAp = new LR4Highpass(fcMidHigh, fs);
  }

  process(x: number): { low: number; mid: number; high: number } {
    const lowRaw = this.lpLowMid.processSample(x);
    const hpOnce = this.hpLowMid.processSample(x);
    const mid = this.lpMidHigh.processSample(hpOnce);
    const high = this.hpMidHigh.processSample(hpOnce);
    const low =
      this.lpMidHighAp.processSample(lowRaw) +
      this.hpMidHighAp.processSample(lowRaw);
    return { low, mid, high };
  }

  reset(): void {
    this.lpLowMid.reset();
    this.hpLowMid.reset();
    this.lpMidHigh.reset();
    this.hpMidHigh.reset();
    this.lpMidHighAp.reset();
    this.hpMidHighAp.reset();
  }

  setCrossovers(fcLowMid: number, fcMidHigh: number): void {
    this.fcLowMid = fcLowMid;
    this.fcMidHigh = fcMidHigh;
    this.lpLowMid.setCutoff(fcLowMid, this.fs);
    this.hpLowMid.setCutoff(fcLowMid, this.fs);
    this.lpMidHigh.setCutoff(fcMidHigh, this.fs);
    this.hpMidHigh.setCutoff(fcMidHigh, this.fs);
    this.lpMidHighAp.setCutoff(fcMidHigh, this.fs);
    this.hpMidHighAp.setCutoff(fcMidHigh, this.fs);
  }

  get crossovers(): { lowMid: number; midHigh: number } {
    return { lowMid: this.fcLowMid, midHigh: this.fcMidHigh };
  }
}
