import { describe, it, expect } from "vitest";
import {
  applySaturation,
  drivePctToFactor,
  computeTHD,
} from "../saturation";

describe("drivePctToFactor", () => {
  it("maps 0% to factor 1 (unity, no saturation character)", () => {
    expect(drivePctToFactor(0)).toBeCloseTo(1, 3);
  });

  it("maps 100% to factor 10 (maximum drive)", () => {
    expect(drivePctToFactor(100)).toBeCloseTo(10, 3);
  });

  it("maps 50% to factor between 1 and 10", () => {
    const factor = drivePctToFactor(50);
    expect(factor).toBeGreaterThan(1);
    expect(factor).toBeLessThan(10);
  });
});

describe("applySaturation", () => {
  it("preserves sign and produces finite output", () => {
    const input = new Float32Array([0.5, -0.5, 0.3, -0.3]);
    const output = applySaturation(input, 1);
    for (let i = 0; i < input.length; i++) {
      expect(Math.sign(output[i])).toBe(Math.sign(input[i]));
      expect(isFinite(output[i])).toBe(true);
    }
  });

  it("maps full-scale input (1.0) to full-scale output (1.0) at any drive", () => {
    // Normalization guarantees tanh(d*1)/tanh(d) = 1 for any d
    for (const drive of [1, 2, 5, 10]) {
      const input = new Float32Array([1.0]);
      const output = applySaturation(input, drive);
      expect(output[0]).toBeCloseTo(1.0, 5);
    }
  });

  it("increases distortion at higher drive factors (output deviates more from input)", () => {
    // For a mid-range input, higher drive maps to output further from the input
    const input = new Float32Array([0.5]);
    const out1 = applySaturation(input, 1)[0];
    const out5 = applySaturation(input, 5)[0];
    const out10 = applySaturation(input, 10)[0];
    // All should be above 0.5 (soft clipping amplifies sub-unity signals)
    // Higher drive → output approaches 1.0 (harder saturation)
    expect(out10).toBeGreaterThan(out5);
    expect(out5).toBeGreaterThan(out1);
  });

  it("output is symmetric (odd-function waveshaper)", () => {
    const input = new Float32Array([0.5, -0.5]);
    const output = applySaturation(input, 5);
    // tanh is an odd function
    expect(output[0]).toBeCloseTo(-output[1], 5);
  });

  it("stays at or below 1.0 for full-scale input (≤ 1.0) at any drive", () => {
    const input = new Float32Array([1.0, -1.0, 0.8, -0.8]);
    for (const drive of [1, 5, 10]) {
      const output = applySaturation(input, drive);
      for (const sample of output) {
        expect(Math.abs(sample)).toBeLessThanOrEqual(1.0 + 1e-6);
      }
    }
  });
});

describe("computeTHD", () => {
  it("returns THD > 0 when drive is applied (harmonics generated)", () => {
    // Generate a 1kHz sine at 44100 Hz
    const sampleRate = 44100;
    const freq = 1000;
    const samples = 2048;
    const input = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      input[i] = 0.5 * Math.sin((2 * Math.PI * freq * i) / sampleRate);
    }

    const thd = computeTHD(input, applySaturation(input, 5), freq, sampleRate);
    expect(thd).toBeGreaterThan(0);
  });

  it("returns near-zero THD without saturation", () => {
    const sampleRate = 44100;
    const freq = 1000;
    const samples = 2048;
    const input = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      input[i] = 0.3 * Math.sin((2 * Math.PI * freq * i) / sampleRate);
    }

    // Drive factor = 1 produces very little harmonic distortion (tanh is near-linear for small signals)
    const thd = computeTHD(input, applySaturation(input, 1), freq, sampleRate);
    expect(thd).toBeLessThan(0.05); // < 5% THD at drive = 1
  });
});
