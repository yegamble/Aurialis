/**
 * Integration-style test for the compressor's sidechain HPF detector path.
 *
 * Because the worklet JS cannot be loaded in Node tests, this file reproduces
 * the worklet's inline process-loop logic in pure JS (matching line-for-line
 * the compressor-processor.js detector path) and verifies that:
 *
 *   (a) the inline biquad coefficient math matches the canonical TS reference
 *       in `src/lib/audio/dsp/biquad.ts` exactly
 *   (b) a bass-heavy signal (60 Hz + 1 kHz) driven through the detector with
 *       HPF=100 produces a gain-reduction envelope whose variance is at least
 *       10× smaller than with HPF=20 — proving the HPF actually prevents the
 *       mix from pumping on bass content.
 *   (c) mono input (single-channel buffer) produces finite detector output.
 */

import { describe, expect, it } from "vitest";
import { makeSidechainHpfCoeffs } from "../dsp/sidechain-filter";
import { highPassCoeffs } from "../dsp/biquad";

const SR = 44100;

/** Runs the exact detector-path computation from compressor-processor.js. */
function runDetector(
  leftChan: Float32Array,
  rightChan: Float32Array | null,
  hpfHz: number,
  attackSec = 0.02,
  releaseSec = 0.25
): { envelope: Float32Array; gr: Float32Array } {
  // Inline the same biquad-coefficient formula used in the worklet
  const Q = Math.SQRT1_2;
  const omega = (2 * Math.PI * hpfHz) / SR;
  const sinO = Math.sin(omega);
  const cosO = Math.cos(omega);
  const alpha = sinO / (2 * Q);
  const a0 = 1 + alpha;
  const b0 = (1 + cosO) / 2 / a0;
  const b1 = -(1 + cosO) / a0;
  const b2 = (1 + cosO) / 2 / a0;
  const a1_ = (-2 * cosO) / a0;
  const a2_ = (1 - alpha) / a0;

  const attackCoeff = Math.exp(-1 / (attackSec * SR));
  const releaseCoeff = Math.exp(-1 / (releaseSec * SR));

  // Fixed threshold/ratio/knee for the test — mirror the default compressor settings
  const threshold = -18;
  const ratio = 4;
  const knee = 6;
  const halfKnee = knee / 2;

  const N = leftChan.length;
  const envelope = new Float32Array(N);
  const gr = new Float32Array(N);
  let env = 0;
  let z1 = 0;
  let z2 = 0;

  for (let i = 0; i < N; i++) {
    const l = leftChan[i];
    const r = rightChan ? rightChan[i] : l; // mono guard
    const mid = (l + r) * 0.5;

    // DF-II transposed biquad
    const y = b0 * mid + z1;
    z1 = b1 * mid - a1_ * y + z2;
    z2 = b2 * mid - a2_ * y;
    const level = Math.abs(y);

    if (level > env) {
      env = attackCoeff * env + (1 - attackCoeff) * level;
    } else {
      env = releaseCoeff * env + (1 - releaseCoeff) * level;
    }
    envelope[i] = env;

    // Gain reduction computation (knee, ratio)
    const inputDb = env > 0 ? 20 * Math.log10(env) : -120;
    const overshoot = inputDb - threshold;
    let gainReduction: number;
    if (knee > 0 && overshoot >= -halfKnee && overshoot <= halfKnee) {
      const x = overshoot + halfKnee;
      gainReduction = ((1 / ratio - 1) * (x * x)) / (2 * knee);
    } else if (overshoot <= -halfKnee) {
      gainReduction = 0;
    } else {
      gainReduction = overshoot * (1 / ratio - 1);
    }
    gr[i] = gainReduction;
  }

  return { envelope, gr };
}

function variance(samples: Float32Array, skip: number): number {
  let sum = 0;
  const n = samples.length - skip;
  for (let i = skip; i < samples.length; i++) sum += samples[i];
  const mean = sum / n;
  let sq = 0;
  for (let i = skip; i < samples.length; i++) {
    const d = samples[i] - mean;
    sq += d * d;
  }
  return sq / n;
}

describe("Worklet biquad parity with TS canonical", () => {
  it("inline worklet HPF coefficients match makeSidechainHpfCoeffs() within 1e-12", () => {
    // Compute coeffs the way the worklet does (inline)
    for (const fc of [50, 100, 150, 200, 300]) {
      const canonical = makeSidechainHpfCoeffs(fc, SR);
      const alsoCanonical = highPassCoeffs(fc, Math.SQRT1_2, SR);

      // makeSidechainHpfCoeffs is a wrapper — it must match highPassCoeffs with Q=1/√2
      expect(Math.abs(canonical.b0 - alsoCanonical.b0)).toBeLessThan(1e-12);
      expect(Math.abs(canonical.b1 - alsoCanonical.b1)).toBeLessThan(1e-12);
      expect(Math.abs(canonical.b2 - alsoCanonical.b2)).toBeLessThan(1e-12);
      expect(Math.abs(canonical.a1 - alsoCanonical.a1)).toBeLessThan(1e-12);
      expect(Math.abs(canonical.a2 - alsoCanonical.a2)).toBeLessThan(1e-12);

      // Now compute the SAME formula inline (as in compressor-processor.js)
      const Q = Math.SQRT1_2;
      const omega = (2 * Math.PI * fc) / SR;
      const sinO = Math.sin(omega);
      const cosO = Math.cos(omega);
      const alpha = sinO / (2 * Q);
      const a0 = 1 + alpha;
      const inline = {
        b0: (1 + cosO) / 2 / a0,
        b1: -(1 + cosO) / a0,
        b2: (1 + cosO) / 2 / a0,
        a1: (-2 * cosO) / a0,
        a2: (1 - alpha) / a0,
      };

      expect(Math.abs(canonical.b0 - inline.b0)).toBeLessThan(1e-12);
      expect(Math.abs(canonical.b1 - inline.b1)).toBeLessThan(1e-12);
      expect(Math.abs(canonical.b2 - inline.b2)).toBeLessThan(1e-12);
      expect(Math.abs(canonical.a1 - inline.a1)).toBeLessThan(1e-12);
      expect(Math.abs(canonical.a2 - inline.a2)).toBeLessThan(1e-12);
    }
  });
});

describe("Bass pumping reduction with sidechain HPF", () => {
  it("GR envelope variance is ≥10× smaller with HPF=100 Hz vs HPF=20 Hz on bass-heavy content", () => {
    const N = Math.round(1.5 * SR); // 1.5 seconds
    const L = new Float32Array(N);
    const R = new Float32Array(N);

    // Bass-heavy signal: pulsing 60 Hz kick + steady 1 kHz vocal-range content
    // The 60 Hz content is shaped as amplitude-modulated to mimic kick drum hits
    for (let i = 0; i < N; i++) {
      const t = i / SR;
      // Kick envelope: repeats at 2 Hz (120 BPM), sharp attack, exponential decay
      const phase = t * 2 - Math.floor(t * 2);
      const kickEnv = Math.exp(-phase * 8);
      const kick = 0.6 * kickEnv * Math.sin(2 * Math.PI * 60 * t);
      const vocal = 0.15 * Math.sin(2 * Math.PI * 1000 * t);
      L[i] = kick + vocal;
      R[i] = kick + vocal;
    }

    const resLow = runDetector(L, R, 20);
    const resHigh = runDetector(L, R, 100);

    // Skip the filter transient (first 1000 samples)
    const varLow = variance(resLow.gr, 1000);
    const varHigh = variance(resHigh.gr, 1000);

    // With HPF=20, bass dominates the detector → GR swings with every kick
    // With HPF=100, bass is filtered out → GR envelope is nearly flat (vocal-driven)
    expect(varLow).toBeGreaterThan(0); // sanity — the low-HPF case MUST vary
    expect(varLow).toBeGreaterThan(varHigh * 10);
  });
});

describe("Mono input handling", () => {
  it("mono input produces finite detector envelope (no NaN)", () => {
    const N = Math.round(0.2 * SR);
    const L = new Float32Array(N);
    for (let i = 0; i < N; i++) L[i] = Math.sin((2 * Math.PI * 440 * i) / SR);

    const { envelope, gr } = runDetector(L, null, 100);
    for (let i = 0; i < N; i++) {
      expect(Number.isFinite(envelope[i])).toBe(true);
      expect(Number.isFinite(gr[i])).toBe(true);
    }
  });
});
