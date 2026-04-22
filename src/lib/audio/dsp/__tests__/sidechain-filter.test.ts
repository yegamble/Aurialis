import { describe, expect, it } from "vitest";
import {
  makeSidechainHpfCoeffs,
  SidechainHpfState,
  applySidechainHpfToBuffer,
} from "../sidechain-filter";

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

function rms(signal: Float32Array, start = 0, end = signal.length): number {
  let s = 0;
  const n = end - start;
  for (let i = start; i < end; i++) s += signal[i] * signal[i];
  return Math.sqrt(s / n);
}

describe("makeSidechainHpfCoeffs", () => {
  it("returns biquad coefficients", () => {
    const c = makeSidechainHpfCoeffs(100, SR);
    expect(c.b0).toBeDefined();
    expect(c.b1).toBeDefined();
    expect(c.b2).toBeDefined();
    expect(c.a1).toBeDefined();
    expect(c.a2).toBeDefined();
  });

  it("HPF sum of b coefficients ≈ 0 (DC blocker)", () => {
    const c = makeSidechainHpfCoeffs(100, SR);
    // For an HPF, gain at DC should be 0: b0 + b1 + b2 ≈ 0
    expect(Math.abs(c.b0 + c.b1 + c.b2)).toBeLessThan(1e-6);
  });
});

describe("SidechainHpfState attenuation", () => {
  it("attenuates 50 Hz by ≥10 dB when HPF = 100 Hz (2nd-order Butterworth: ~-12 dB at 1 octave)", () => {
    const hpf = 100;
    const signal = generateSine(50, SR, 0.2);
    const filtered = applySidechainHpfToBuffer(signal, hpf, SR);
    // Skip transient
    const skip = 500;
    const inRms = rms(signal, skip);
    const outRms = rms(filtered, skip);
    const attenDb = 20 * Math.log10(outRms / inRms);
    expect(attenDb).toBeLessThan(-10);
  });

  it("attenuates 25 Hz by ≥20 dB when HPF = 100 Hz (2 octaves below → ~-24 dB)", () => {
    const hpf = 100;
    const signal = generateSine(25, SR, 0.3);
    const filtered = applySidechainHpfToBuffer(signal, hpf, SR);
    const skip = 500;
    const inRms = rms(signal, skip);
    const outRms = rms(filtered, skip);
    const attenDb = 20 * Math.log10(outRms / inRms);
    expect(attenDb).toBeLessThan(-20);
  });

  it("at cutoff (100 Hz input, HPF = 100 Hz) attenuation is ~-3 dB", () => {
    const hpf = 100;
    const signal = generateSine(100, SR, 0.2);
    const filtered = applySidechainHpfToBuffer(signal, hpf, SR);
    const skip = 500;
    const inRms = rms(signal, skip);
    const outRms = rms(filtered, skip);
    const attenDb = 20 * Math.log10(outRms / inRms);
    expect(attenDb).toBeGreaterThan(-4.5);
    expect(attenDb).toBeLessThan(-1.5);
  });

  it("passes 1 kHz within 0.5 dB when HPF = 100 Hz (deep passband)", () => {
    const hpf = 100;
    const signal = generateSine(1000, SR, 0.2);
    const filtered = applySidechainHpfToBuffer(signal, hpf, SR);
    const skip = 500;
    const inRms = rms(signal, skip);
    const outRms = rms(filtered, skip);
    const diffDb = 20 * Math.log10(outRms / inRms);
    expect(Math.abs(diffDb)).toBeLessThan(0.5);
  });

  it("HPF = 20 Hz is near-transparent on 100 Hz input (within 1 dB)", () => {
    // At slider minimum, the HPF should not meaningfully attenuate audio-range content
    const hpf = 20;
    const signal = generateSine(100, SR, 0.2);
    const filtered = applySidechainHpfToBuffer(signal, hpf, SR);
    const skip = 500;
    const inRms = rms(signal, skip);
    const outRms = rms(filtered, skip);
    const diffDb = 20 * Math.log10(outRms / inRms);
    expect(Math.abs(diffDb)).toBeLessThan(1.0);
  });

  it("processSample produces finite output for all standard inputs", () => {
    const state = new SidechainHpfState(100, SR);
    for (let i = 0; i < 1000; i++) {
      const x = Math.random() * 2 - 1;
      const y = state.processSample(x);
      expect(Number.isFinite(y)).toBe(true);
    }
  });

  it("reset returns state to zero", () => {
    const state = new SidechainHpfState(100, SR);
    // Drive the filter hard
    for (let i = 0; i < 100; i++) state.processSample(Math.sin(i * 0.1));
    state.reset();
    // After reset, a zero input should produce zero output
    for (let i = 0; i < 10; i++) {
      expect(state.processSample(0)).toBe(0);
    }
  });
});

describe("Sample-rate-agnostic behavior", () => {
  it.each([44100, 48000, 96000])(
    "at %d Hz: HPF 100 attenuates 50 Hz by ≥10 dB (2nd-order rolloff)",
    (sr) => {
      const signal = generateSine(50, sr, 0.2);
      const filtered = applySidechainHpfToBuffer(signal, 100, sr);
      const skip = Math.round(0.01 * sr);
      const inRms = rms(signal, skip);
      const outRms = rms(filtered, skip);
      const attenDb = 20 * Math.log10(outRms / inRms);
      expect(attenDb).toBeLessThan(-10);
    }
  );

  it.each([44100, 48000, 96000])(
    "at %d Hz: HPF 100 passes 1 kHz within 0.5 dB",
    (sr) => {
      const signal = generateSine(1000, sr, 0.2);
      const filtered = applySidechainHpfToBuffer(signal, 100, sr);
      const skip = Math.round(0.01 * sr);
      const inRms = rms(signal, skip);
      const outRms = rms(filtered, skip);
      const diffDb = 20 * Math.log10(outRms / inRms);
      expect(Math.abs(diffDb)).toBeLessThan(0.5);
    }
  );
});
