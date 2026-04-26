/**
 * Protocol-parity test — T7b.
 *
 * Closes the dual-protocol bug surface flagged in plan review: worklet-based
 * processors evaluate envelopes per-block via `EnvelopeScheduler.getValueAt`,
 * while stereo-width drives a native AudioParam via
 * `linearRampToValueAtTime`. The two must agree on the *value* an envelope
 * point yields at any block boundary, otherwise stereo-width visibly drifts
 * away from the rest of the chain on long ramps.
 *
 * Strategy: simulate AudioParam scheduling in Node (no WebAudio mock can do
 * this faithfully — the simulator is intentionally a clean-room replay of
 * the spec semantics) and compare values against `EnvelopeScheduler` at every
 * 128-sample block boundary in a 5-second window.
 *
 * The tolerance is the value-equivalent of ±1 sample of timing drift at 48 k
 * for the steepest segment in the test envelope.
 */

import { describe, it, expect } from "vitest";
import { EnvelopeScheduler } from "../envelope-scheduler-node";

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 128;

type Point = readonly [number, number];

/**
 * Replays AudioParam scheduling semantics:
 *  - `setValueAtTime(value, time)`        — instantaneous step at `time`
 *  - `linearRampToValueAtTime(end, time)` — linear ramp from the previous
 *    scheduled point's value to `end` over [prev.time, time]
 *
 * Returns a `valueAt(t)` reader that mirrors what the param would output.
 */
function simulateAudioParam(points: readonly Point[]): (t: number) => number {
  if (points.length === 0) return () => 0;
  const sorted = [...points];
  return (t: number) => {
    if (t <= sorted[0][0]) return sorted[0][1];
    const last = sorted[sorted.length - 1];
    if (t >= last[0]) return last[1];
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1];
      const b = sorted[i];
      if (t < b[0]) {
        const span = b[0] - a[0];
        if (span <= 0) return b[1];
        const u = (t - a[0]) / span;
        return a[1] + u * (b[1] - a[1]);
      }
    }
    return last[1];
  };
}

/** Worst-case value drift from a ±1-sample timing error along the envelope. */
function valueToleranceFor(points: readonly Point[]): number {
  const sampleDur = 1 / SAMPLE_RATE;
  let maxSlope = 0;
  for (let i = 1; i < points.length; i++) {
    const span = points[i][0] - points[i - 1][0];
    if (span <= 0) continue;
    const slope = Math.abs((points[i][1] - points[i - 1][1]) / span);
    if (slope > maxSlope) maxSlope = slope;
  }
  // ±1 sample of timing → that fraction of the steepest slope, in value units.
  // Plus a tiny FP epsilon to accommodate IEEE-754 rounding in linear interp.
  return maxSlope * sampleDur + 1e-9;
}

describe("protocol parity — worklet getValueAt vs simulated AudioParam ramps", () => {
  const scheduler = new EnvelopeScheduler();

  it("matches at every block boundary across a 5 s ramp envelope", () => {
    const points: Point[] = [
      [0, -10],
      [1, 0],
      [3, -5],
      [5, 5],
    ];
    scheduler.setEnvelope("p", points);
    const ref = simulateAudioParam(points);
    const tol = valueToleranceFor(points);

    const blockDurSec = BLOCK_SIZE / SAMPLE_RATE;
    let maxDelta = 0;
    for (let block = 0; block < Math.floor(5 / blockDurSec); block++) {
      const t = block * blockDurSec;
      const actual = scheduler.getValueAt("p", t, 0);
      const expected = ref(t);
      const delta = Math.abs(actual - expected);
      if (delta > maxDelta) maxDelta = delta;
      expect(delta).toBeLessThanOrEqual(tol);
    }
    // Sanity: actual deltas should be ~0 (both paths are pure linear interp).
    expect(maxDelta).toBeLessThanOrEqual(tol);
  });

  it("clamps to first/last value at the edges (matching AudioParam semantics)", () => {
    const points: Point[] = [
      [1, 0],
      [2, 10],
    ];
    scheduler.setEnvelope("edge", points);
    const ref = simulateAudioParam(points);
    expect(scheduler.getValueAt("edge", 0, 0)).toBeCloseTo(ref(0));
    expect(scheduler.getValueAt("edge", 5, 0)).toBeCloseTo(ref(5));
  });

  it("agrees on a flat (single-segment) envelope to within FP epsilon", () => {
    const points: Point[] = [
      [0, 3],
      [10, 3],
    ];
    scheduler.setEnvelope("flat", points);
    const ref = simulateAudioParam(points);
    for (let t = 0; t < 10; t += 0.1) {
      expect(scheduler.getValueAt("flat", t, 0)).toBeCloseTo(ref(t), 9);
    }
  });
});
