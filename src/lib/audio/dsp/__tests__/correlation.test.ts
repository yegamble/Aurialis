import { describe, expect, it } from "vitest";
import { RunningCorrelation } from "../correlation";

const SR = 44100;

function runSamples(
  rc: RunningCorrelation,
  l: Float32Array,
  r: Float32Array
): void {
  const n = Math.min(l.length, r.length);
  for (let i = 0; i < n; i++) rc.processSample(l[i], r[i]);
}

function sine(freq: number, N: number, amp = 0.5, phase = 0): Float32Array {
  const out = new Float32Array(N);
  const w = (2 * Math.PI * freq) / SR;
  for (let n = 0; n < N; n++) out[n] = amp * Math.sin(w * n + phase);
  return out;
}

describe("RunningCorrelation", () => {
  it("mono (L === R): correlation converges to +1", () => {
    const rc = new RunningCorrelation(SR);
    const l = sine(1000, SR, 0.5);
    runSamples(rc, l, l);
    expect(rc.correlation).toBeGreaterThan(0.99);
    expect(rc.correlation).toBeLessThanOrEqual(1.0);
  });

  it("anti-phase (L === -R): correlation converges to -1", () => {
    const rc = new RunningCorrelation(SR);
    const l = sine(1000, SR, 0.5);
    const r = new Float32Array(l.length);
    for (let i = 0; i < l.length; i++) r[i] = -l[i];
    runSamples(rc, l, r);
    expect(rc.correlation).toBeLessThan(-0.99);
    expect(rc.correlation).toBeGreaterThanOrEqual(-1.0);
  });

  it("silence: correlation guarded at 0 (no NaN)", () => {
    const rc = new RunningCorrelation(SR);
    const l = new Float32Array(1024);
    const r = new Float32Array(1024);
    runSamples(rc, l, r);
    expect(rc.correlation).toBe(0);
    expect(Number.isFinite(rc.correlation)).toBe(true);
  });

  it("uncorrelated random noise: correlation converges near 0", () => {
    const rc = new RunningCorrelation(SR);
    const N = SR; // 1 second
    const l = new Float32Array(N);
    const r = new Float32Array(N);
    // Two independent LCG-style PRNGs for reproducibility
    let sL = 12345;
    let sR = 67890;
    for (let i = 0; i < N; i++) {
      sL = (1103515245 * sL + 12345) & 0x7fffffff;
      sR = (1103515245 * sR + 54321) & 0x7fffffff;
      l[i] = ((sL / 0x7fffffff) * 2 - 1) * 0.5;
      r[i] = ((sR / 0x7fffffff) * 2 - 1) * 0.5;
    }
    runSamples(rc, l, r);
    expect(Math.abs(rc.correlation)).toBeLessThan(0.2);
  });

  it("peak-hold returns the most-negative value in the recent window", () => {
    const rc = new RunningCorrelation(SR, 0.1, 0.5);
    const N = 4410; // 100 ms

    // First: commit many in-phase blocks (correlation ~+1)
    const inPhase = sine(1000, N, 0.5);
    for (let block = 0; block < 3; block++) {
      runSamples(rc, inPhase, inPhase);
      rc.commitPeak();
    }

    // Then: one anti-phase block
    const antiR = new Float32Array(N);
    for (let i = 0; i < N; i++) antiR[i] = -inPhase[i];
    runSamples(rc, inPhase, antiR);
    const peakMinAfterAnti = rc.commitPeak();

    // Peak should reflect the anti-phase burst (allowing some EWMA smoothing lag
    // since the correlation takes ~100 ms to fully swing to -1)
    expect(peakMinAfterAnti).toBeLessThan(-0.2);

    // Then: many in-phase blocks to recover
    for (let block = 0; block < 2; block++) {
      runSamples(rc, inPhase, inPhase);
      rc.commitPeak();
    }
    // The anti-phase value should still be in the hold window (500 ms buffer)
    // Current correlation has recovered but peak-hold keeps the worst visible
    expect(rc.correlation).toBeGreaterThan(0.5);
  });

  it("reset() zeros state", () => {
    const rc = new RunningCorrelation(SR);
    const l = sine(1000, 1024, 0.5);
    runSamples(rc, l, l);
    expect(rc.correlation).toBeGreaterThan(0.9);
    rc.reset();
    expect(rc.correlation).toBe(0);
  });
});
