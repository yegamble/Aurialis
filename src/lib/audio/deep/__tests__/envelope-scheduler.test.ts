/**
 * Tests for the EnvelopeScheduler shared helper.
 *
 * The class lives at src/worklets/envelope-scheduler.js (consumed inside
 * AudioWorkletGlobalScope via build-time inlining, per S1). For unit testing
 * we re-export it for Node — see envelope-scheduler-node.ts which simply
 * re-exports the class evaluated under Node's module context.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { EnvelopeScheduler } from "../envelope-scheduler-node";

describe("EnvelopeScheduler", () => {
  let s: EnvelopeScheduler;

  beforeEach(() => {
    s = new EnvelopeScheduler();
  });

  describe("setEnvelope + getValueAt", () => {
    it("returns the fallback when no envelope is set", () => {
      expect(s.getValueAt("threshold", 1.0, -18)).toBe(-18);
    });

    it("returns the constant value for a single-point envelope", () => {
      // Internally we require ≥2 points; passing 1 point + the same point twice
      // is the supported pattern. Bare 1-point envelopes are silently rejected.
      s.setEnvelope("threshold", [
        [0, -24],
        [10, -24],
      ]);
      expect(s.getValueAt("threshold", 0, 0)).toBe(-24);
      expect(s.getValueAt("threshold", 5, 0)).toBe(-24);
      expect(s.getValueAt("threshold", 10, 0)).toBe(-24);
    });

    it("interpolates linearly between two points", () => {
      s.setEnvelope("threshold", [
        [0, -24],
        [10, -14],
      ]);
      expect(s.getValueAt("threshold", 0, 0)).toBe(-24);
      expect(s.getValueAt("threshold", 5, 0)).toBe(-19);
      expect(s.getValueAt("threshold", 10, 0)).toBe(-14);
    });

    it("clamps to first value before envelope start", () => {
      s.setEnvelope("threshold", [
        [1, -24],
        [10, -14],
      ]);
      expect(s.getValueAt("threshold", 0, 0)).toBe(-24);
      expect(s.getValueAt("threshold", -5, 0)).toBe(-24);
    });

    it("clamps to last value after envelope end", () => {
      s.setEnvelope("threshold", [
        [0, -24],
        [10, -14],
      ]);
      expect(s.getValueAt("threshold", 11, 0)).toBe(-14);
      expect(s.getValueAt("threshold", 1000, 0)).toBe(-14);
    });

    it("interpolates correctly with multiple segments", () => {
      s.setEnvelope("makeup", [
        [0, 0],
        [5, 5],
        [10, 0],
      ]);
      expect(s.getValueAt("makeup", 2.5, 0)).toBe(2.5);
      expect(s.getValueAt("makeup", 5, 0)).toBe(5);
      expect(s.getValueAt("makeup", 7.5, 0)).toBe(2.5);
    });

    it("rejects envelopes with fewer than 2 points (falls back)", () => {
      const ok = s.setEnvelope("threshold", [[0, -24]]);
      expect(ok).toBe(false);
      expect(s.getValueAt("threshold", 0, -18)).toBe(-18);
    });

    it("clearEnvelope removes the envelope and falls back", () => {
      s.setEnvelope("threshold", [
        [0, -24],
        [10, -14],
      ]);
      expect(s.getValueAt("threshold", 5, -18)).toBe(-19);
      s.clearEnvelope("threshold");
      expect(s.getValueAt("threshold", 5, -18)).toBe(-18);
    });

    it("isolates parameters from each other", () => {
      s.setEnvelope("threshold", [
        [0, -24],
        [10, -14],
      ]);
      expect(s.getValueAt("makeup", 5, 0)).toBe(0);
    });

    it("hasEnvelope reports active envelopes only", () => {
      expect(s.hasEnvelope("threshold")).toBe(false);
      s.setEnvelope("threshold", [
        [0, -24],
        [10, -14],
      ]);
      expect(s.hasEnvelope("threshold")).toBe(true);
      s.clearEnvelope("threshold");
      expect(s.hasEnvelope("threshold")).toBe(false);
    });
  });

  describe("smoother (per S2 — one-pole IIR)", () => {
    it("smoothed value approaches the target over time", () => {
      // 5 ms time constant at 48k → coefficient roughly 1 - exp(-1/(0.005 * 48000))
      const sr = 48_000;
      const a = s.smootherCoefficient(0.005, sr); // ≈ 0.0042
      let smoothed = 0;
      const target = 1.0;
      for (let i = 0; i < sr * 0.05; i++) {
        // 50 ms — 10× the time constant, should reach > 99%
        smoothed = a * target + (1 - a) * smoothed;
      }
      expect(smoothed).toBeGreaterThan(0.99);
      expect(smoothed).toBeLessThanOrEqual(1.0);
    });

    it("smoother coefficient is in (0, 1) for typical inputs", () => {
      const a = s.smootherCoefficient(0.005, 48_000);
      expect(a).toBeGreaterThan(0);
      expect(a).toBeLessThan(1);
    });

    it("smoother coefficient = 1 for tau ≤ 0 (instant snap)", () => {
      expect(s.smootherCoefficient(0, 48_000)).toBe(1);
      expect(s.smootherCoefficient(-1, 48_000)).toBe(1);
    });
  });
});
