import { describe, expect, it } from "vitest";
import {
  applySaturation,
  applyOversampledSaturation,
  drivePctToFactor,
} from "../saturation";

const SR = 44100;

function generateSine(
  freq: number,
  sampleRate: number,
  durSec: number,
  amplitude = 1
): Float32Array {
  const N = Math.round(durSec * sampleRate);
  const out = new Float32Array(N);
  const w = (2 * Math.PI * freq) / sampleRate;
  for (let n = 0; n < N; n++) out[n] = amplitude * Math.sin(w * n);
  return out;
}

/** Simple DFT magnitude (one-sided) at a specific frequency bin. */
function dftMag(signal: Float32Array, freq: number, sr: number): number {
  const N = signal.length;
  const w = (2 * Math.PI * freq) / sr;
  let re = 0;
  let im = 0;
  for (let n = 0; n < N; n++) {
    re += signal[n] * Math.cos(w * n);
    im += signal[n] * Math.sin(w * n);
  }
  return Math.sqrt(re * re + im * im) * (2 / N);
}

/** Sum magnitude across 0-upperHz range, sampling at step Hz intervals. */
function energyInBand(
  signal: Float32Array,
  lowerHz: number,
  upperHz: number,
  stepHz: number,
  sr: number
): number {
  let sumSq = 0;
  for (let f = lowerHz; f <= upperHz; f += stepHz) {
    const m = dftMag(signal, f, sr);
    sumSq += m * m;
  }
  return Math.sqrt(sumSq);
}

describe("applyOversampledSaturation vs applySaturation aliasing", () => {
  it("7 kHz sine at drive=100%: oversampled output has ≥30 dB less aliasing in the audible band than naive", () => {
    // tanh of a 7 kHz sine at drive=10 produces odd harmonics at 21k, 35k, 49k, …
    // Naive (1×): 35k folds to 9.1k, 49k folds to 4.9k, 63k folds to 18.9k, …
    //   → heavy audible aliasing in 2–20 kHz band
    // Oversampled (4×): 21k, 35k, 49k, 63k all fit below 88.2k Nyquist;
    //   decimation filter (halfband transition band ~19–23 kHz) strongly
    //   attenuates everything ≥22k → only 21k survives in the output.
    const freq = 7000;
    const input = generateSine(freq, SR, 0.3, 0.6);
    const driveFactor = drivePctToFactor(100);

    const outNaive = applySaturation(input, driveFactor);
    const outOs = applyOversampledSaturation(input, driveFactor);

    const skip = 200;
    // Measure in the alias band 2-20 kHz, EXCLUDING the 21 kHz 3rd harmonic
    // and 7 kHz fundamental. Naive folds will land here; oversampled should be near-silent.
    // Exclude the 7 kHz ±500 Hz band (fundamental) and 21 kHz band (3rd harmonic).
    const aliasBand = [
      { lo: 500, hi: 6400 },
      { lo: 7600, hi: 13500 },
      { lo: 14500, hi: 19500 },
    ];
    let aliasNaive = 0;
    let aliasOs = 0;
    for (const { lo, hi } of aliasBand) {
      const a = energyInBand(outNaive.subarray(skip), lo, hi, 200, SR);
      const b = energyInBand(outOs.subarray(skip), lo, hi, 200, SR);
      aliasNaive += a * a;
      aliasOs += b * b;
    }
    const reductionDb =
      10 * Math.log10(aliasNaive / Math.max(aliasOs, 1e-20));
    expect(reductionDb).toBeGreaterThan(30);
  });

  it("HF preservation: 15 kHz input at drive=100% preserved within 1 dB (vs expected tanh attenuation)", () => {
    // 15 kHz at 44.1k — still in the passband of the 47-tap halfband (cutoff ~19.4k).
    // The fundamental survives; amplitude is attenuated by tanh compression (not filter).
    const freq = 15000;
    const amp = 0.3;
    const input = generateSine(freq, SR, 0.2, amp);
    const driveFactor = drivePctToFactor(100);
    const output = applyOversampledSaturation(input, driveFactor);

    const skip = 200;
    const outMag = dftMag(output.subarray(skip), freq, SR);

    // Expected amplitude after tanh compression of a single-tone input
    const expectedAmp = Math.tanh(driveFactor * amp) / Math.tanh(driveFactor);

    // Output magnitude should match expected tanh compression within 2 dB.
    // (47-tap halfband starts rolling off near 19 kHz; 15 kHz is close to the
    // transition shoulder, so a fraction of a dB comes from the filter itself.)
    expect(Math.abs(20 * Math.log10(outMag / expectedAmp))).toBeLessThan(2.0);
  });

  it("zero-drive bypass: output matches input exactly", () => {
    const input = generateSine(1000, SR, 0.1, 0.3);
    const output = applyOversampledSaturation(input, 0);
    for (let i = 0; i < input.length; i++) {
      expect(output[i]).toBeCloseTo(input[i], 10);
    }
  });
});

describe("applyOversampledSaturation at 48k", () => {
  it("7.5 kHz sine: oversampled output has ≥25 dB less in-band aliasing than naive", () => {
    // 8 kHz at 48k is a bad test frequency: odd harmonics ALL fold to 8k or 24k.
    // 7.5 kHz produces scattered aliases in-band (10.5k, 4.5k, 19.5k, 13.5k, ...).
    const sr = 48000;
    const freq = 7500;
    const input = generateSine(freq, sr, 0.2, 0.6);
    const driveFactor = drivePctToFactor(100);
    const outNaive = applySaturation(input, driveFactor);
    const outOs = applyOversampledSaturation(input, driveFactor);
    const skip = 200;
    const aliasBand = [
      { lo: 500, hi: 6900 },
      { lo: 8100, hi: 21500 }, // exclude 22.5 kHz 3rd harmonic region
    ];
    let aliasNaive = 0;
    let aliasOs = 0;
    for (const { lo, hi } of aliasBand) {
      const a = energyInBand(outNaive.subarray(skip), lo, hi, 200, sr);
      const b = energyInBand(outOs.subarray(skip), lo, hi, 200, sr);
      aliasNaive += a * a;
      aliasOs += b * b;
    }
    const reductionDb =
      10 * Math.log10(aliasNaive / Math.max(aliasOs, 1e-20));
    expect(reductionDb).toBeGreaterThan(25);
  });
});
