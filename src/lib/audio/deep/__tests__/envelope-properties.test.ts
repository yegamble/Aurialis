/**
 * Property-style tests for envelope interpolation invariants (T18).
 *
 * We don't pull in `fast-check` because the surface here is small and
 * deterministic random sampling with `Math.seedrandom`-style PRNG keeps
 * the test reproducible without an extra devDependency. Property checks:
 *
 *  - Monotone-input invariant: if envelope values are monotonically
 *    increasing along time, `getValueAt` is monotone non-decreasing in t.
 *  - Endpoint-clamp invariant: `getValueAt(t)` clamps to first/last value
 *    outside the envelope.
 *  - Boundary-value invariant: `getValueAt(envelope[i].time) ≈ envelope[i].value`.
 *  - Idempotence: setting the same envelope twice yields identical lookups.
 */

import { describe, it, expect } from "vitest";
import { EnvelopeScheduler } from "../envelope-scheduler-node";

/** Deterministic PRNG (mulberry32) so tests don't flake. */
function makePrng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomMonotonicEnvelope(
  rand: () => number,
  numPoints: number,
): Array<[number, number]> {
  const env: Array<[number, number]> = [];
  let t = rand() * 0.1;
  let v = rand() * 10 - 5;
  for (let i = 0; i < numPoints; i++) {
    env.push([t, v]);
    t += 0.05 + rand() * 0.5;
    v += rand() * 2; // strictly non-decreasing values
  }
  return env;
}

describe("EnvelopeScheduler — property invariants (T18)", () => {
  it("is monotone non-decreasing for monotone-non-decreasing envelopes", () => {
    const rand = makePrng(0x12345678);
    for (let trial = 0; trial < 30; trial++) {
      const env = randomMonotonicEnvelope(rand, 5 + Math.floor(rand() * 8));
      const scheduler = new EnvelopeScheduler();
      scheduler.setEnvelope("p", env);
      const tStart = env[0]![0] - 1;
      const tEnd = env[env.length - 1]![0] + 1;
      let prevValue = -Infinity;
      for (let t = tStart; t <= tEnd; t += 0.05) {
        const v = scheduler.getValueAt("p", t, 0);
        // Non-decreasing tolerance — small FP drift is OK.
        expect(v).toBeGreaterThanOrEqual(prevValue - 1e-9);
        prevValue = v;
      }
    }
  });

  it("clamps to first/last value outside the envelope range", () => {
    const rand = makePrng(0xdeadbeef);
    const scheduler = new EnvelopeScheduler();
    for (let trial = 0; trial < 20; trial++) {
      const env = randomMonotonicEnvelope(rand, 4);
      scheduler.setEnvelope("p", env);
      const first = env[0]!;
      const last = env[env.length - 1]!;
      expect(scheduler.getValueAt("p", first[0] - 100, 0)).toBe(first[1]);
      expect(scheduler.getValueAt("p", last[0] + 100, 0)).toBe(last[1]);
    }
  });

  it("returns the exact envelope value at each control-point timestamp", () => {
    const rand = makePrng(0xcafef00d);
    const scheduler = new EnvelopeScheduler();
    for (let trial = 0; trial < 30; trial++) {
      const env = randomMonotonicEnvelope(rand, 6);
      scheduler.setEnvelope("p", env);
      for (const [t, v] of env) {
        expect(scheduler.getValueAt("p", t, 0)).toBeCloseTo(v, 9);
      }
    }
  });

  it("setting the same envelope twice produces identical lookups", () => {
    const rand = makePrng(0xbaadf00d);
    const env = randomMonotonicEnvelope(rand, 8);
    const a = new EnvelopeScheduler();
    const b = new EnvelopeScheduler();
    a.setEnvelope("p", env);
    b.setEnvelope("p", env);
    b.setEnvelope("p", env); // second call idempotent
    for (let t = 0; t < 5; t += 0.07) {
      expect(a.getValueAt("p", t, 0)).toBe(b.getValueAt("p", t, 0));
    }
  });
});
