import { describe, it, expect } from "vitest";
import {
  LR4Lowpass,
  LR4Highpass,
  ThreeWaySplitter,
} from "../crossover";

const FS = 48000;

/** Steady-state RMS of a sine through a filter (drops first 2048 samples for warm-up). */
function filterRms(
  process: (x: number) => number,
  freq: number,
  durationSamples: number,
  fs: number
): number {
  const warmup = 2048;
  let sumSq = 0;
  let n = 0;
  for (let i = 0; i < warmup + durationSamples; i++) {
    const x = Math.sin((2 * Math.PI * freq * i) / fs);
    const y = process(x);
    if (i >= warmup) {
      sumSq += y * y;
      n++;
    }
  }
  return Math.sqrt(sumSq / n);
}

function amplitudeDb(amp: number): number {
  // Input sine has peak=1, RMS = 1/√2. Filter gain in dB relative to input.
  const inputRms = Math.SQRT1_2;
  return 20 * Math.log10(amp / inputRms);
}

describe("LR4Lowpass", () => {
  it("passes DC at unity gain", () => {
    const lp = new LR4Lowpass(1000, FS);
    // Run a small number of samples of DC input
    let y = 0;
    for (let i = 0; i < 4096; i++) y = lp.processSample(1.0);
    expect(y).toBeCloseTo(1.0, 4);
  });

  it("attenuates Nyquist to near zero", () => {
    const lp = new LR4Lowpass(1000, FS);
    // Alternating ±1 = Nyquist
    let y = 0;
    for (let i = 0; i < 4096; i++) {
      y = lp.processSample(i % 2 === 0 ? 1 : -1);
    }
    expect(Math.abs(y)).toBeLessThan(1e-6);
  });

  it("is -6 dB at cutoff frequency (LR4 signature)", () => {
    const fc = 1000;
    const lp = new LR4Lowpass(fc, FS);
    const rms = filterRms((x) => lp.processSample(x), fc, 4096, FS);
    const gainDb = amplitudeDb(rms);
    // LR4 = two cascaded Butterworth² → -6 dB at fc (exactly -3 dB per stage × 2)
    expect(gainDb).toBeGreaterThan(-6.2);
    expect(gainDb).toBeLessThan(-5.8);
  });
});

describe("LR4Highpass", () => {
  it("blocks DC (gain near zero)", () => {
    const hp = new LR4Highpass(1000, FS);
    let y = 0;
    for (let i = 0; i < 4096; i++) y = hp.processSample(1.0);
    expect(Math.abs(y)).toBeLessThan(1e-4);
  });

  it("is -6 dB at cutoff frequency (LR4 signature)", () => {
    const fc = 1000;
    const hp = new LR4Highpass(fc, FS);
    const rms = filterRms((x) => hp.processSample(x), fc, 4096, FS);
    const gainDb = amplitudeDb(rms);
    expect(gainDb).toBeGreaterThan(-6.2);
    expect(gainDb).toBeLessThan(-5.8);
  });
});

describe("ThreeWaySplitter", () => {
  const FC1 = 200;
  const FC2 = 2000;

  it("isolates low band: 60 Hz sine → low much stronger than mid or high", () => {
    const splitter = new ThreeWaySplitter(FC1, FC2, FS);
    let lSum = 0,
      mSum = 0,
      hSum = 0,
      count = 0;
    const warmup = 4096;
    for (let i = 0; i < warmup + 4096; i++) {
      const x = Math.sin((2 * Math.PI * 60 * i) / FS);
      const { low, mid, high } = splitter.process(x);
      if (i >= warmup) {
        lSum += low * low;
        mSum += mid * mid;
        hSum += high * high;
        count++;
      }
    }
    const lRms = Math.sqrt(lSum / count);
    const mRms = Math.sqrt(mSum / count);
    const hRms = Math.sqrt(hSum / count);
    // Low should dominate; mid and high each at least 20 dB below low at 60 Hz
    expect(20 * Math.log10(lRms / (mRms + 1e-12))).toBeGreaterThan(20);
    expect(20 * Math.log10(lRms / (hRms + 1e-12))).toBeGreaterThan(40);
  });

  it("isolates mid band: 700 Hz sine → mid dominant over low and high", () => {
    const splitter = new ThreeWaySplitter(FC1, FC2, FS);
    let lSum = 0,
      mSum = 0,
      hSum = 0,
      count = 0;
    const warmup = 4096;
    for (let i = 0; i < warmup + 4096; i++) {
      const x = Math.sin((2 * Math.PI * 700 * i) / FS);
      const { low, mid, high } = splitter.process(x);
      if (i >= warmup) {
        lSum += low * low;
        mSum += mid * mid;
        hSum += high * high;
        count++;
      }
    }
    const lRms = Math.sqrt(lSum / count);
    const mRms = Math.sqrt(mSum / count);
    const hRms = Math.sqrt(hSum / count);
    // Mid should dominate at 700 Hz (well between 200 and 2000 Hz crossovers)
    expect(20 * Math.log10(mRms / (lRms + 1e-12))).toBeGreaterThan(15);
    expect(20 * Math.log10(mRms / (hRms + 1e-12))).toBeGreaterThan(15);
  });

  it("isolates high band: 8 kHz sine → high dominant", () => {
    const splitter = new ThreeWaySplitter(FC1, FC2, FS);
    let lSum = 0,
      mSum = 0,
      hSum = 0,
      count = 0;
    const warmup = 4096;
    for (let i = 0; i < warmup + 4096; i++) {
      const x = Math.sin((2 * Math.PI * 8000 * i) / FS);
      const { low, mid, high } = splitter.process(x);
      if (i >= warmup) {
        lSum += low * low;
        mSum += mid * mid;
        hSum += high * high;
        count++;
      }
    }
    const lRms = Math.sqrt(lSum / count);
    const mRms = Math.sqrt(mSum / count);
    const hRms = Math.sqrt(hSum / count);
    expect(20 * Math.log10(hRms / (mRms + 1e-12))).toBeGreaterThan(20);
    expect(20 * Math.log10(hRms / (lRms + 1e-12))).toBeGreaterThan(40);
  });

  it("sums to magnitude-flat (all-pass) across a frequency sweep", () => {
    // Verify that low + mid + high preserves input magnitude (LR4 summation = all-pass).
    const splitter = new ThreeWaySplitter(FC1, FC2, FS);
    const freqs = [50, 100, 200, 500, 1000, 2000, 4000, 8000, 15000];
    for (const f of freqs) {
      splitter.reset();
      let inSumSq = 0;
      let outSumSq = 0;
      let count = 0;
      const warmup = 8192;
      for (let i = 0; i < warmup + 8192; i++) {
        const x = Math.sin((2 * Math.PI * f * i) / FS);
        const { low, mid, high } = splitter.process(x);
        const sum = low + mid + high;
        if (i >= warmup) {
          inSumSq += x * x;
          outSumSq += sum * sum;
          count++;
        }
      }
      const inRms = Math.sqrt(inSumSq / count);
      const outRms = Math.sqrt(outSumSq / count);
      const gainDb = 20 * Math.log10(outRms / inRms);
      expect(
        Math.abs(gainDb),
        `summation magnitude @ ${f} Hz should be flat (got ${gainDb.toFixed(3)} dB)`
      ).toBeLessThan(0.3);
    }
  });

  it("sum is -6 dB at neither crossover (flat magnitude, all-pass phase)", () => {
    const splitter = new ThreeWaySplitter(FC1, FC2, FS);
    let inSumSq = 0,
      outSumSq = 0,
      count = 0;
    const warmup = 8192;
    for (let i = 0; i < warmup + 8192; i++) {
      const x = Math.sin((2 * Math.PI * FC1 * i) / FS);
      const { low, mid, high } = splitter.process(x);
      if (i >= warmup) {
        inSumSq += x * x;
        outSumSq += (low + mid + high) ** 2;
        count++;
      }
    }
    const gainDb = 20 * Math.log10(Math.sqrt(outSumSq / inSumSq));
    // Flat summation should be within 0.3 dB of input magnitude even at fc
    expect(Math.abs(gainDb)).toBeLessThan(0.3);
  });

  it("reset() zeroes biquad state so fresh run produces identical output", () => {
    const splitter = new ThreeWaySplitter(FC1, FC2, FS);
    for (let i = 0; i < 1000; i++) splitter.process(Math.random());
    splitter.reset();
    // Now process a known impulse and sample first output
    const firstImpulseLow = splitter.process(1.0).low;
    const fresh = new ThreeWaySplitter(FC1, FC2, FS);
    const freshImpulseLow = fresh.process(1.0).low;
    expect(firstImpulseLow).toBeCloseTo(freshImpulseLow, 10);
  });

  it("setCrossovers updates filter cutoffs without NaN/Inf", () => {
    const splitter = new ThreeWaySplitter(FC1, FC2, FS);
    for (let i = 0; i < 100; i++) splitter.process(Math.random() - 0.5);
    splitter.setCrossovers(150, 3500);
    for (let i = 0; i < 4096; i++) {
      const { low, mid, high } = splitter.process(Math.random() - 0.5);
      expect(Number.isFinite(low)).toBe(true);
      expect(Number.isFinite(mid)).toBe(true);
      expect(Number.isFinite(high)).toBe(true);
    }
  });
});
