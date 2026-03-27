import { describe, it, expect } from "vitest";
import { computeRmsLevel, computePeakLevel, followEnvelope } from "../envelope";

describe("computeRmsLevel", () => {
  it("returns 0 for silence", () => {
    expect(computeRmsLevel(new Float32Array(100))).toBe(0);
  });

  it("returns correct RMS for DC signal", () => {
    const buf = new Float32Array(100).fill(0.5);
    expect(computeRmsLevel(buf)).toBeCloseTo(0.5, 5);
  });

  it("returns 1/sqrt(2) for unit sine wave", () => {
    const N = 4096;
    const buf = new Float32Array(N);
    for (let i = 0; i < N; i++) buf[i] = Math.sin((2 * Math.PI * i) / 64);
    // RMS of sine = amplitude / sqrt(2)
    expect(computeRmsLevel(buf)).toBeCloseTo(1 / Math.sqrt(2), 2);
  });

  it("respects offset and length parameters", () => {
    const buf = new Float32Array([0, 0, 0, 0.5, 0.5, 0.5]);
    expect(computeRmsLevel(buf, 3, 3)).toBeCloseTo(0.5, 5);
  });
});

describe("computePeakLevel", () => {
  it("returns 0 for silence", () => {
    expect(computePeakLevel(new Float32Array(100))).toBe(0);
  });

  it("returns max absolute value", () => {
    const buf = new Float32Array([0.1, -0.8, 0.3, 0.6]);
    expect(computePeakLevel(buf)).toBeCloseTo(0.8, 5);
  });
});

describe("followEnvelope", () => {
  it("attacks when input exceeds current level", () => {
    const result = followEnvelope(0, 1.0, 0.9, 0.999);
    // Moving towards 1.0 with attack
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(1.0);
  });

  it("releases when input is below current level", () => {
    const result = followEnvelope(1.0, 0, 0.9, 0.999);
    // Moving towards 0 with release
    expect(result).toBeLessThan(1.0);
    expect(result).toBeGreaterThan(0);
  });
});
