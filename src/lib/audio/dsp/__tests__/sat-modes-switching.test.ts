import { describe, expect, it } from "vitest";
import {
  applyCleanSaturation,
  applyTubeSaturation,
  applyTapeShaper,
  applyTransformerShaper,
  buildSatModeCoeffs,
} from "../sat-modes";
import { BiquadFilter } from "../biquad";
import { drivePctToFactor } from "../saturation";

const SR = 44100;

/**
 * Simulate the worklet's sample loop in pure JS at 1× rate (no oversampler) —
 * we're testing mode-switch continuity, which happens between input samples
 * regardless of oversampling. Biquad state must be preserved across the switch.
 */
function simulateWorklet(
  input: Float32Array,
  switchAt: number,
  modeBefore: "clean" | "tube" | "tape" | "transformer",
  modeAfter: "clean" | "tube" | "tape" | "transformer",
  driveFactor: number
): Float32Array {
  const coeffs = buildSatModeCoeffs(SR);
  const tapePre = new BiquadFilter(coeffs.tapeHf);
  const xfmrPre = new BiquadFilter(coeffs.xfmrMid);
  const norm = Math.tanh(driveFactor);
  const output = new Float32Array(input.length);

  for (let i = 0; i < input.length; i++) {
    const mode = i < switchAt ? modeBefore : modeAfter;
    let x = input[i];
    if (mode === "tape") x = tapePre.processSample(x);
    else if (mode === "transformer") x = xfmrPre.processSample(x);

    let y: number;
    if (mode === "clean") y = applyCleanSaturation(x, driveFactor, norm);
    else if (mode === "tube") y = applyTubeSaturation(x, driveFactor, norm);
    else if (mode === "tape") y = applyTapeShaper(x, driveFactor);
    else y = applyTransformerShaper(x, driveFactor);
    output[i] = y;
  }
  return output;
}

describe("Mode switching is click-free", () => {
  const N = 2048;
  const input = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    input[i] = 0.3 * Math.sin((2 * Math.PI * 1000 * i) / SR);
  }
  const df = drivePctToFactor(50);

  const modes = ["clean", "tube", "tape", "transformer"] as const;

  for (const before of modes) {
    for (const after of modes) {
      if (before === after) continue;
      it(`${before} → ${after}: consecutive-sample delta around switch point stays smooth`, () => {
        const switchAt = 1024;
        const out = simulateWorklet(input, switchAt, before, after, df);

        // Measure the max delta between consecutive samples in a 40-sample window around the switch
        // (allows for short transient from biquad settle if modes differ in pre-filter path)
        let maxWindowDelta = 0;
        for (let i = switchAt - 20; i < switchAt + 20; i++) {
          const delta = Math.abs(out[i + 1] - out[i]);
          if (delta > maxWindowDelta) maxWindowDelta = delta;
        }
        // Also compute "steady-state" max delta (far from the switch) for context
        let maxSteadyDelta = 0;
        for (let i = 100; i < 500; i++) {
          const delta = Math.abs(out[i + 1] - out[i]);
          if (delta > maxSteadyDelta) maxSteadyDelta = delta;
        }

        // The switch should not introduce a delta more than ~2× the steady-state max
        // (a continuous sine has some sample-to-sample variation — switching modes with
        // different pre-filters can cause a small step, but not a click)
        expect(maxWindowDelta).toBeLessThan(maxSteadyDelta * 2 + 0.02);
      });
    }
  }
});
