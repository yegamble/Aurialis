import { describe, it, expect } from "vitest";
import {
  computeIntegratedLufs,
  computeMomentaryLufs,
  getKWeightingCoeffs,
} from "../lufs";
import { BiquadFilter } from "../biquad";

describe("getKWeightingCoeffs", () => {
  it("returns valid biquad coefficients for 48000 Hz", () => {
    const coeffs = getKWeightingCoeffs(48000);
    expect(coeffs.preFilter).toBeDefined();
    expect(coeffs.rlbFilter).toBeDefined();
    expect(coeffs.preFilter.b0).toBeDefined();
    expect(coeffs.preFilter.b1).toBeDefined();
    expect(coeffs.preFilter.b2).toBeDefined();
    expect(coeffs.preFilter.a1).toBeDefined();
    expect(coeffs.preFilter.a2).toBeDefined();
  });

  it("returns different coefficients for different sample rates", () => {
    const coeffs48k = getKWeightingCoeffs(48000);
    const coeffs44k = getKWeightingCoeffs(44100);
    expect(coeffs48k.preFilter.b0).not.toBeCloseTo(coeffs44k.preFilter.b0, 5);
  });
});

describe("computeMomentaryLufs", () => {
  it("measures silence as -Infinity LUFS", () => {
    const silence = new Float32Array(19200); // 400ms at 48kHz
    const lufs = computeMomentaryLufs(silence, silence, 48000);
    expect(lufs).toBe(-Infinity);
  });

  it("measures non-silent signal as finite LUFS", () => {
    const sampleRate = 48000;
    const samples = Math.round(0.4 * sampleRate); // 400ms
    const left = new Float32Array(samples);
    const right = new Float32Array(samples);
    const freq = 1000;
    for (let i = 0; i < samples; i++) {
      const s = 0.1 * Math.sin((2 * Math.PI * freq * i) / sampleRate);
      left[i] = s;
      right[i] = s;
    }
    const lufs = computeMomentaryLufs(left, right, sampleRate);
    expect(isFinite(lufs)).toBe(true);
  });
});

describe("computeIntegratedLufs", () => {
  it("measures -23 dBFS 1kHz sine as approximately -23 LUFS (±0.5)", () => {
    const sampleRate = 48000;
    // Use 3 seconds for integrated measurement
    const durationSecs = 3;
    const samples = durationSecs * sampleRate;
    const freq = 1000;

    // -23 dBFS amplitude = 10^(-23/20) ≈ 0.07079
    const amp = Math.pow(10, -23 / 20);
    const left = new Float32Array(samples);
    const right = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      const s = amp * Math.sin((2 * Math.PI * freq * i) / sampleRate);
      left[i] = s;
      right[i] = s;
    }

    const lufs = computeIntegratedLufs(left, right, sampleRate);
    expect(lufs).toBeGreaterThan(-23.5);
    expect(lufs).toBeLessThan(-22.5);
  });

  it("louder signal measures higher LUFS than quieter signal", () => {
    const sampleRate = 48000;
    const samples = 3 * sampleRate;
    const freq = 1000;

    const ampLow = Math.pow(10, -30 / 20);
    const ampHigh = Math.pow(10, -14 / 20);

    const leftLow = new Float32Array(samples);
    const rightLow = new Float32Array(samples);
    const leftHigh = new Float32Array(samples);
    const rightHigh = new Float32Array(samples);

    for (let i = 0; i < samples; i++) {
      const s = Math.sin((2 * Math.PI * freq * i) / sampleRate);
      leftLow[i] = ampLow * s;
      rightLow[i] = ampLow * s;
      leftHigh[i] = ampHigh * s;
      rightHigh[i] = ampHigh * s;
    }

    const lufsLow = computeIntegratedLufs(leftLow, rightLow, sampleRate);
    const lufsHigh = computeIntegratedLufs(leftHigh, rightHigh, sampleRate);
    expect(lufsHigh).toBeGreaterThan(lufsLow);
  });
});
