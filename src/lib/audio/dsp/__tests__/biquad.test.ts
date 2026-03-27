import { describe, it, expect } from "vitest";
import {
  BiquadFilter,
  highShelfCoeffs,
  highPassCoeffs,
  peakingCoeffs,
  lowShelfCoeffs,
} from "../biquad";

describe("BiquadFilter.processSample", () => {
  it("passes DC signal through unity filter unchanged", () => {
    const filter = new BiquadFilter({
      b0: 1,
      b1: 0,
      b2: 0,
      a1: 0,
      a2: 0,
    });
    expect(filter.processSample(0.5)).toBeCloseTo(0.5, 5);
    expect(filter.processSample(1.0)).toBeCloseTo(1.0, 5);
  });

  it("reset clears internal state", () => {
    const coeffs = highPassCoeffs(100, 0.7071, 44100);
    const filter = new BiquadFilter(coeffs);
    filter.processSample(1.0);
    filter.reset();
    // After reset, processing silence should give near zero
    expect(filter.processSample(0)).toBeCloseTo(0, 10);
  });
});

describe("highShelfCoeffs", () => {
  it("boosts high-frequency signal with positive gain", () => {
    const fs = 48000;
    const coeffs = highShelfCoeffs(1500, 4.0, 1.0, fs);
    const filter = new BiquadFilter(coeffs);

    // High-frequency sine (10kHz) should be boosted
    const highFreqAmp = measureAmplitude(filter, 10000, fs);
    filter.reset();

    // Low-frequency sine (100 Hz) should be near unity
    const lowFreqAmp = measureAmplitude(filter, 100, fs);

    expect(highFreqAmp).toBeGreaterThan(lowFreqAmp);
    // High shelf should boost by ~4 dB = factor 1.585
    expect(highFreqAmp / lowFreqAmp).toBeGreaterThan(1.4);
  });
});

describe("highPassCoeffs", () => {
  it("attenuates low-frequency signal", () => {
    const fs = 48000;
    const coeffs = highPassCoeffs(38.135, 0.7071, fs);
    const filter = new BiquadFilter(coeffs);

    // Very low freq (5 Hz) should be attenuated
    const lowFreqAmp = measureAmplitude(filter, 5, fs);
    filter.reset();

    // Mid freq (1000 Hz) should pass through nearly unchanged
    const midFreqAmp = measureAmplitude(filter, 1000, fs);

    expect(midFreqAmp).toBeGreaterThan(lowFreqAmp * 5);
  });
});

describe("peakingCoeffs", () => {
  it("boosts signal at center frequency with positive gain", () => {
    const fs = 44100;
    const fc = 1000;
    const coeffs = peakingCoeffs(fc, 6.0, 1.0, fs);
    const filter = new BiquadFilter(coeffs);

    const boostedAmp = measureAmplitude(filter, fc, fs);
    filter.reset();

    const unboostedCoeffs = peakingCoeffs(fc, 0, 1.0, fs);
    const flatFilter = new BiquadFilter(unboostedCoeffs);
    const flatAmp = measureAmplitude(flatFilter, fc, fs);

    // With +6dB boost, amplitude should be about 2x
    expect(boostedAmp / flatAmp).toBeCloseTo(2.0, 0);
  });
});

describe("lowShelfCoeffs", () => {
  it("boosts low-frequency signal with positive gain", () => {
    const fs = 44100;
    const coeffs = lowShelfCoeffs(80, 4.0, 1.0, fs);
    const filter = new BiquadFilter(coeffs);

    // Very low freq boosted
    const lowAmp = measureAmplitude(filter, 30, fs);
    filter.reset();

    // High freq near unity
    const highAmp = measureAmplitude(filter, 8000, fs);

    expect(lowAmp).toBeGreaterThan(highAmp);
  });
});

/** Helper: measure RMS amplitude of filter response at frequency. */
function measureAmplitude(
  filter: BiquadFilter,
  freq: number,
  fs: number
): number {
  const N = 4096;
  // Warm up filter with a few cycles first
  for (let i = 0; i < 512; i++) {
    filter.processSample(Math.sin((2 * Math.PI * freq * i) / fs));
  }
  let sumSq = 0;
  for (let i = 0; i < N; i++) {
    const out = filter.processSample(
      Math.sin((2 * Math.PI * freq * (i + 512)) / fs)
    );
    sumSq += out * out;
  }
  return Math.sqrt(sumSq / N);
}
