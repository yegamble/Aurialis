import { describe, expect, it } from "vitest";
import { computeLRA } from "../lufs";

describe("computeLRA", () => {
  it("returns { lra: 0, ready: false } for < 30 values", () => {
    const result = computeLRA([-20, -19, -18, -17, -16]);
    expect(result.ready).toBe(false);
    expect(result.lra).toBe(0);
  });

  it("steady signal (all values ≈ same): LRA ≤ 1", () => {
    const values: number[] = [];
    for (let i = 0; i < 50; i++) values.push(-18 + (Math.random() - 0.5) * 0.3);
    const result = computeLRA(values);
    expect(result.ready).toBe(true);
    expect(result.lra).toBeLessThan(1);
  });

  it("three-section synthetic (quiet → loud → quiet): LRA ≥ 4", () => {
    const values: number[] = [];
    for (let i = 0; i < 20; i++) values.push(-24);
    for (let i = 0; i < 20; i++) values.push(-14);
    for (let i = 0; i < 20; i++) values.push(-24);
    const result = computeLRA(values);
    expect(result.ready).toBe(true);
    expect(result.lra).toBeGreaterThanOrEqual(4);
  });

  it("highly dynamic classical-like signal: LRA ≥ 6 LU", () => {
    const values: number[] = [];
    for (let i = 0; i < 50; i++) {
      // Pseudo-random distribution between -28 and -10
      const spread = -28 + (i % 17) * 1.2 + Math.sin(i * 0.9) * 2;
      values.push(spread);
    }
    const result = computeLRA(values);
    expect(result.ready).toBe(true);
    expect(result.lra).toBeGreaterThanOrEqual(6);
  });

  it("all gated out (below -70): LRA 0 but ready=true", () => {
    const values: number[] = [];
    for (let i = 0; i < 50; i++) values.push(-80);
    const result = computeLRA(values);
    expect(result.ready).toBe(true);
    expect(result.lra).toBe(0);
  });

  it("LRA is non-negative", () => {
    for (let trial = 0; trial < 10; trial++) {
      const values: number[] = [];
      for (let i = 0; i < 40; i++) values.push(-20 + (Math.random() - 0.5) * 10);
      const result = computeLRA(values);
      expect(result.lra).toBeGreaterThanOrEqual(0);
    }
  });
});
