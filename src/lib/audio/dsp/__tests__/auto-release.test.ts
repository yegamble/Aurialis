import { describe, expect, it } from "vitest";
import {
  processAutoReleaseSample,
  createAutoReleaseState,
  computeSlowReleaseSeconds,
  type AutoReleaseState,
} from "../auto-release";

const SR = 44100;

function makeCoeffs(attackSec: number, releaseSec: number, slowSec: number) {
  return {
    attackCoeff: Math.exp(-1 / (attackSec * SR)),
    releaseCoeff: Math.exp(-1 / (releaseSec * SR)),
    slowCoeff: Math.exp(-1 / (slowSec * SR)),
  };
}

describe("computeSlowReleaseSeconds", () => {
  it("is 5× the user release when under 2 s", () => {
    expect(computeSlowReleaseSeconds(0.1)).toBe(0.5);
    expect(computeSlowReleaseSeconds(0.2)).toBe(1.0);
  });
  it("caps at 2 s", () => {
    expect(computeSlowReleaseSeconds(0.5)).toBe(2);
    expect(computeSlowReleaseSeconds(10)).toBe(2);
  });
});

describe("processAutoReleaseSample — manual mode (autoRelease=0)", () => {
  it("matches P0 single-envelope behavior on a varied signal (sample-exact)", () => {
    // Reference: classic single-envelope attack/release (copy of P0 compressor math)
    const { attackCoeff, releaseCoeff, slowCoeff } = makeCoeffs(0.02, 0.25, 1.25);
    const N = SR * 2; // 2 seconds
    // Keep everything in Float64 for a true bit-exact comparison
    const input: number[] = new Array(N);
    let acc = 0;
    for (let i = 0; i < N; i++) {
      const r = Math.sin(i * 0.13) + 0.5 * Math.sin(i * 0.027) + 0.3 * Math.sin(i * 0.003);
      acc = 0.97 * acc + 0.03 * r;
      input[i] = Math.abs(acc);
    }

    // P0 reference (Float64)
    let p0Env = 0;
    const p0: number[] = new Array(N);
    for (let i = 0; i < N; i++) {
      if (input[i] > p0Env) {
        p0Env = attackCoeff * p0Env + (1 - attackCoeff) * input[i];
      } else {
        p0Env = releaseCoeff * p0Env + (1 - releaseCoeff) * input[i];
      }
      p0[i] = p0Env;
    }

    // P1 with autoRelease=0 (Float64)
    const state = createAutoReleaseState();
    let maxDiff = 0;
    for (let i = 0; i < N; i++) {
      const y = processAutoReleaseSample(
        input[i],
        state,
        attackCoeff,
        releaseCoeff,
        slowCoeff,
        0
      );
      const diff = Math.abs(y - p0[i]);
      if (diff > maxDiff) maxDiff = diff;
    }

    // Bit-exact: both paths use the same arithmetic in Float64, so max diff
    // should be exactly 0 (identical code paths). Tolerance leaves headroom
    // for any future micro-optimization that might reorder MAC ops.
    expect(maxDiff).toBeLessThan(1e-12);
  });

  it("silent input produces zero envelope with no NaN", () => {
    const { attackCoeff, releaseCoeff, slowCoeff } = makeCoeffs(0.02, 0.25, 1.25);
    const state = createAutoReleaseState();
    for (let i = 0; i < 1000; i++) {
      const y = processAutoReleaseSample(0, state, attackCoeff, releaseCoeff, slowCoeff, 0);
      expect(Number.isFinite(y)).toBe(true);
      expect(y).toBe(0);
    }
  });
});

describe("processAutoReleaseSample — auto-release mode (autoRelease=1)", () => {
  const { attackCoeff, releaseCoeff, slowCoeff } = makeCoeffs(0.02, 0.1, 0.5);

  it("on attack, both envelopes track the signal", () => {
    const state = createAutoReleaseState();
    // Feed a step input — run for 500 ms (25× attack time constant of 20 ms)
    const N = Math.round(0.5 * SR);
    for (let i = 0; i < N; i++) {
      processAutoReleaseSample(0.8, state, attackCoeff, releaseCoeff, slowCoeff, 1);
    }
    expect(state.envelope).toBeCloseTo(0.8, 2);
    expect(state.envSlow).toBeCloseTo(0.8, 2);
  });

  it("on release, returns the SLOWER (higher-held) envelope — yields hold behavior", () => {
    const state = createAutoReleaseState();
    // Build up both envelopes with a loud signal
    for (let i = 0; i < 2000; i++) {
      processAutoReleaseSample(0.8, state, attackCoeff, releaseCoeff, slowCoeff, 1);
    }
    // Drop signal to 0 and run for 50 ms (release phase)
    const releaseSamples = Math.round(0.05 * SR);
    let lastOut = 0;
    for (let i = 0; i < releaseSamples; i++) {
      lastOut = processAutoReleaseSample(0, state, attackCoeff, releaseCoeff, slowCoeff, 1);
    }
    // In auto mode, the slow envelope hasn't decayed as much → output tracks slow
    expect(state.envSlow).toBeGreaterThan(state.envelope);
    // The returned value should match env_slow (the higher one)
    expect(lastOut).toBe(state.envSlow);
  });

  it("auto mode holds envelope higher than manual mode after same release duration", () => {
    const stateAuto = createAutoReleaseState();
    const stateManual = createAutoReleaseState();
    // Ramp both up
    for (let i = 0; i < 2000; i++) {
      processAutoReleaseSample(0.8, stateAuto, attackCoeff, releaseCoeff, slowCoeff, 1);
      processAutoReleaseSample(0.8, stateManual, attackCoeff, releaseCoeff, slowCoeff, 0);
    }
    // Same starting envelope
    expect(stateAuto.envelope).toBeCloseTo(stateManual.envelope, 6);

    // Release for 30 ms
    const releaseSamples = Math.round(0.03 * SR);
    let autoOut = 0;
    let manualOut = 0;
    for (let i = 0; i < releaseSamples; i++) {
      autoOut = processAutoReleaseSample(0, stateAuto, attackCoeff, releaseCoeff, slowCoeff, 1);
      manualOut = processAutoReleaseSample(0, stateManual, attackCoeff, releaseCoeff, slowCoeff, 0);
    }
    // Auto mode holds higher (hold behavior)
    expect(autoOut).toBeGreaterThan(manualOut);
  });
});

describe("GR variance reduction on dense signal (pumping test)", () => {
  it("auto-release produces lower variance in effective envelope on dense content", () => {
    const { attackCoeff, releaseCoeff, slowCoeff } = makeCoeffs(0.01, 0.1, 0.5);
    const N = SR * 1; // 1 second
    // Dense signal: 60 Hz kick pulses every 200 ms + 1 kHz drone
    const input = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const t = i / SR;
      const phase = (t * 5) - Math.floor(t * 5); // 5 Hz pulse rate
      const kickEnv = Math.exp(-phase * 8);
      const kick = 0.7 * kickEnv * Math.sin(2 * Math.PI * 60 * t);
      const drone = 0.15 * Math.sin(2 * Math.PI * 1000 * t);
      input[i] = Math.abs(kick + drone);
    }

    function measure(autoRelease: number): number[] {
      const state = createAutoReleaseState();
      const envs: number[] = [];
      for (let i = 0; i < N; i++) {
        envs.push(
          processAutoReleaseSample(input[i], state, attackCoeff, releaseCoeff, slowCoeff, autoRelease)
        );
      }
      return envs;
    }

    function variance(xs: number[]): number {
      // Skip transient
      const arr = xs.slice(2000);
      const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
      return arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length;
    }

    const manualEnv = measure(0);
    const autoEnv = measure(1);
    const varManual = variance(manualEnv);
    const varAuto = variance(autoEnv);
    // Auto should reduce variance by ≥30%
    expect(varAuto).toBeLessThan(varManual * 0.7);
  });
});

describe("Transient preservation — auto mode doesn't over-compress isolated transients", () => {
  it("peak envelope on isolated transient is within 2 dB of manual mode", () => {
    const { attackCoeff, releaseCoeff, slowCoeff } = makeCoeffs(0.01, 0.1, 0.5);
    const N = SR * 1;
    // Short burst at start, then silence
    const input = new Float32Array(N);
    const burstLen = Math.round(0.01 * SR); // 10 ms burst
    for (let i = 0; i < burstLen; i++) {
      input[i] = Math.abs(0.9 * Math.sin((2 * Math.PI * 440 * i) / SR));
    }

    function peakEnv(autoRelease: number): number {
      const state = createAutoReleaseState();
      let peak = 0;
      for (let i = 0; i < N; i++) {
        const y = processAutoReleaseSample(
          input[i],
          state,
          attackCoeff,
          releaseCoeff,
          slowCoeff,
          autoRelease
        );
        if (y > peak) peak = y;
      }
      return peak;
    }

    const peakManual = peakEnv(0);
    const peakAuto = peakEnv(1);
    // Peak in auto mode should be within 2 dB of manual (mostly identical —
    // both envelopes track the same attack)
    const diffDb = 20 * Math.log10(peakAuto / peakManual);
    expect(Math.abs(diffDb)).toBeLessThan(2);
  });
});
