import { describe, expect, it } from "vitest";
import {
  processAutoReleaseSample,
  createAutoReleaseState,
} from "../auto-release";

/**
 * Integration-scale coverage for the auto-release compressor (dsp-grammy-p1
 * Task 1). Drives ~10 s of deterministic pink noise through the same
 * `processAutoReleaseSample` DSP the compressor worklet uses, and asserts:
 *   1. with autoRelease = 0 it is bit-equivalent to the frozen P0
 *      single-envelope compressor (≤1e-9 per sample), and
 *   2. integration-level pumping + transient behavior is sane.
 *
 * Complements `auto-release.test.ts` (2 s synthetic) with the long pink-noise
 * input + frozen-P0 reference the plan's Verify command names.
 */

const SR = 44100;

function makeCoeffs(attackSec: number, releaseSec: number, slowSec: number) {
  return {
    attackCoeff: Math.exp(-1 / (attackSec * SR)),
    releaseCoeff: Math.exp(-1 / (releaseSec * SR)),
    slowCoeff: Math.exp(-1 / (slowSec * SR)),
  };
}

/** Deterministic pink noise (seeded LCG white → Paul Kellet pink filter). */
function pinkNoise(n: number, seed: number): Float32Array {
  let s = seed >>> 0;
  const white = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 0xffffffff) * 2 - 1;
  };
  const out = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < n; i++) {
    const w = white();
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    out[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
  }
  return out;
}

/** Frozen P0 reference: classic single-envelope attack/release on |x|.
 *  Kept in Float64 (number[]) so the comparison isn't blunted by Float32. */
function p0Envelope(
  rectified: Float32Array,
  attackCoeff: number,
  releaseCoeff: number,
): number[] {
  const out: number[] = new Array(rectified.length);
  let env = 0;
  for (let i = 0; i < rectified.length; i++) {
    const x = rectified[i]!;
    if (x > env) env = attackCoeff * env + (1 - attackCoeff) * x;
    else env = releaseCoeff * env + (1 - releaseCoeff) * x;
    out[i] = env;
  }
  return out;
}

/** Dense pulsing content (5 Hz kick + 1 kHz drone) — pumping shows on transients. */
function pulsingContent(n: number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const phase = t * 5 - Math.floor(t * 5);
    const kick = 0.7 * Math.exp(-phase * 8) * Math.sin(2 * Math.PI * 60 * t);
    const drone = 0.15 * Math.sin(2 * Math.PI * 1000 * t);
    out[i] = Math.abs(kick + drone);
  }
  return out;
}

describe("compressor auto-release — 10 s pink-noise integration", () => {
  const { attackCoeff, releaseCoeff, slowCoeff } = makeCoeffs(0.02, 0.25, 1.25);
  const N = SR * 10; // 10 seconds
  const rectified = (() => {
    const pink = pinkNoise(N, 0x1234abcd);
    const r = new Float32Array(N);
    for (let i = 0; i < N; i++) r[i] = Math.abs(pink[i]!);
    return r;
  })();

  it("autoRelease=0 is bit-equivalent to the frozen P0 compressor (≤1e-9 per sample)", () => {
    const ref = p0Envelope(rectified, attackCoeff, releaseCoeff);
    const state = createAutoReleaseState();
    let maxDiff = 0;
    for (let i = 0; i < N; i++) {
      const y = processAutoReleaseSample(
        rectified[i]!,
        state,
        attackCoeff,
        releaseCoeff,
        slowCoeff,
        0,
      );
      const d = Math.abs(y - ref[i]!);
      if (d > maxDiff) maxDiff = d;
    }
    expect(maxDiff).toBeLessThanOrEqual(1e-9);
  });

  it("autoRelease=1 reduces envelope variance vs manual on dense pulsing content (pumping)", () => {
    // Pumping reduction is a property of transient/pulsing material — auto-release
    // holds the envelope through inter-pulse gaps. (Stationary noise shows none.)
    const pulses = pulsingContent(N);
    const fastCoeffs = makeCoeffs(0.01, 0.1, 0.5);
    const run = (auto: number): number => {
      const state = createAutoReleaseState();
      const envs: number[] = [];
      for (let i = 0; i < N; i++) {
        envs.push(
          processAutoReleaseSample(pulses[i]!, state, fastCoeffs.attackCoeff, fastCoeffs.releaseCoeff, fastCoeffs.slowCoeff, auto),
        );
      }
      const tail = envs.slice(SR); // skip 1 s warmup
      const mean = tail.reduce((a, b) => a + b, 0) / tail.length;
      return tail.reduce((a, b) => a + (b - mean) ** 2, 0) / tail.length;
    };
    expect(run(1)).toBeLessThan(run(0));
  });

  it("isolated transient: auto-mode peak envelope is within 2 dB of manual (no over-compression)", () => {
    const burst = new Float32Array(N);
    const burstLen = Math.round(0.01 * SR);
    for (let i = 0; i < burstLen; i++) {
      burst[i] = Math.abs(0.9 * Math.sin((2 * Math.PI * 440 * i) / SR));
    }
    const peak = (auto: number): number => {
      const state = createAutoReleaseState();
      let p = 0;
      for (let i = 0; i < N; i++) {
        const y = processAutoReleaseSample(burst[i]!, state, attackCoeff, releaseCoeff, slowCoeff, auto);
        if (y > p) p = y;
      }
      return p;
    };
    expect(Math.abs(20 * Math.log10(peak(1) / peak(0)))).toBeLessThan(2);
  });
});
