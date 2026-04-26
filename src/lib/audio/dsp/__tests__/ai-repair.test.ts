import { describe, it, expect } from "vitest";
import {
  applyAiRepair,
  applyAiRepairExciter,
  applyAiRepairWidener,
  makeAiRepairState,
  AI_REPAIR_BPF_CENTER_HZ,
} from "../ai-repair";

const SR = 44100;

function sine(amplitude: number, freq: number, len: number, sr = SR): Float32Array {
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / sr);
  }
  return out;
}

/** L/R cross-correlation in [-1, +1]. 1.0 = identical (mono). */
function correlation(l: Float32Array, r: Float32Array): number {
  const n = Math.min(l.length, r.length);
  let sumLR = 0;
  let sumLL = 0;
  let sumRR = 0;
  for (let i = 0; i < n; i++) {
    sumLR += l[i]! * r[i]!;
    sumLL += l[i]! * l[i]!;
    sumRR += r[i]! * r[i]!;
  }
  const denom = Math.sqrt(sumLL * sumRR);
  if (denom <= 0) return 0;
  return sumLR / denom;
}

describe("applyAiRepairWidener", () => {
  it("amount=0 leaves output bit-identical to input", () => {
    const l = sine(0.5, 1000, 1024);
    const r = sine(0.5, 1000, 1024);
    const lOrig = new Float32Array(l);
    const rOrig = new Float32Array(r);
    const state = makeAiRepairState(SR);
    applyAiRepairWidener(l, r, 0, state);
    let maxDeltaL = 0;
    let maxDeltaR = 0;
    for (let i = 0; i < l.length; i++) {
      const dL = Math.abs(l[i]! - lOrig[i]!);
      const dR = Math.abs(r[i]! - rOrig[i]!);
      if (dL > maxDeltaL) maxDeltaL = dL;
      if (dR > maxDeltaR) maxDeltaR = dR;
    }
    expect(maxDeltaL).toBe(0);
    expect(maxDeltaR).toBe(0);
  });

  it("decorrelates a near-mono stereo signal in the target band at amount=50", () => {
    // Near-mono signal with a small in-band side component (representing
    // an AI-generated narrow guitar at 2.5 kHz).
    const len = SR; // 1 second
    const guitarHz = AI_REPAIR_BPF_CENTER_HZ;
    const carrier = sine(0.3, guitarHz, len);
    const tinyOffset = sine(0.005, guitarHz, len);
    const inL = new Float32Array(carrier);
    const inR = new Float32Array(len);
    for (let i = 0; i < len; i++) inR[i] = carrier[i]! - tinyOffset[i]!;
    const corrBefore = correlation(inL, inR);

    const outL = new Float32Array(inL);
    const outR = new Float32Array(inR);
    const state = makeAiRepairState(SR);
    applyAiRepairWidener(outL, outR, 50, state);

    const corrAfter = correlation(outL, outR);
    // Widener should reduce L/R correlation in the target band.
    expect(corrAfter).toBeLessThan(corrBefore);
  });

  it("monotonically increases side amplitude with amount", () => {
    const len = SR / 2;
    const inL = sine(0.4, AI_REPAIR_BPF_CENTER_HZ, len);
    const inR = new Float32Array(len);
    // Slightly out of phase R so there's some side energy to amplify.
    for (let i = 0; i < len; i++) inR[i] = inL[i]! * 0.95;

    const sideRms = (l: Float32Array, r: Float32Array) => {
      let sum = 0;
      for (let i = 0; i < l.length; i++) {
        const s = (l[i]! - r[i]!) * 0.5;
        sum += s * s;
      }
      return Math.sqrt(sum / l.length);
    };

    const a25L = new Float32Array(inL); const a25R = new Float32Array(inR);
    applyAiRepairWidener(a25L, a25R, 25, makeAiRepairState(SR));
    const a50L = new Float32Array(inL); const a50R = new Float32Array(inR);
    applyAiRepairWidener(a50L, a50R, 50, makeAiRepairState(SR));
    const a100L = new Float32Array(inL); const a100R = new Float32Array(inR);
    applyAiRepairWidener(a100L, a100R, 100, makeAiRepairState(SR));

    const r25 = sideRms(a25L, a25R);
    const r50 = sideRms(a50L, a50R);
    const r100 = sideRms(a100L, a100R);
    expect(r50).toBeGreaterThan(r25);
    expect(r100).toBeGreaterThan(r50);
  });

  describe("applyAiRepairExciter (T11)", () => {
    it("amount=0 leaves output bit-identical (bypass guarantee)", () => {
      const l = sine(0.4, 2500, 1024);
      const r = sine(0.4, 2500, 1024);
      const lOrig = new Float32Array(l);
      const rOrig = new Float32Array(r);
      applyAiRepairExciter(l, r, 0, makeAiRepairState(SR));
      for (let i = 0; i < l.length; i++) {
        expect(l[i]).toBe(lOrig[i]);
        expect(r[i]).toBe(rOrig[i]);
      }
    });

    it("output RMS grows monotonically with amount on a 2.5 kHz sine", () => {
      const len = SR / 2;
      const inL = sine(0.3, AI_REPAIR_BPF_CENTER_HZ, len);
      const inR = sine(0.3, AI_REPAIR_BPF_CENTER_HZ, len);

      const rmsOf = (a: Float32Array) => {
        let sum = 0;
        for (let i = 0; i < a.length; i++) sum += a[i]! * a[i]!;
        return Math.sqrt(sum / a.length);
      };

      const baseRms = rmsOf(inL);

      const a25L = new Float32Array(inL); const a25R = new Float32Array(inR);
      applyAiRepairExciter(a25L, a25R, 25, makeAiRepairState(SR));
      const a50L = new Float32Array(inL); const a50R = new Float32Array(inR);
      applyAiRepairExciter(a50L, a50R, 50, makeAiRepairState(SR));
      const a100L = new Float32Array(inL); const a100R = new Float32Array(inR);
      applyAiRepairExciter(a100L, a100R, 100, makeAiRepairState(SR));

      const r25 = rmsOf(a25L);
      const r50 = rmsOf(a50L);
      const r100 = rmsOf(a100L);
      // Exciter adds harmonic energy → output RMS > input RMS, growing with amount.
      expect(r25).toBeGreaterThan(baseRms);
      expect(r50).toBeGreaterThan(r25);
      expect(r100).toBeGreaterThan(r50);
    });

    it("introduces harmonics at 2× and 3× the input frequency", () => {
      // Feed a clean 2.5 kHz sine; tanh on a sine generates 3rd, 5th, 7th
      // harmonics (odd-order). Measure spectral energy at 7.5 kHz (3rd
      // harmonic of 2.5 kHz) and assert it grows from baseline (≈0).
      const len = SR; // 1 sec for clean FFT-bin alignment
      const inL = sine(0.4, AI_REPAIR_BPF_CENTER_HZ, len);
      const inR = sine(0.4, AI_REPAIR_BPF_CENTER_HZ, len);

      const ditheredL = new Float32Array(inL); const ditheredR = new Float32Array(inR);
      applyAiRepairExciter(ditheredL, ditheredR, 100, makeAiRepairState(SR));

      // Cheap 7.5 kHz energy probe — Goertzel-like single-frequency DFT.
      const targetHz = 7500;
      const omega = (2 * Math.PI * targetHz) / SR;
      const cosO = Math.cos(omega);
      const sinO = Math.sin(omega);
      let q1 = 0, q2 = 0, q1Ref = 0, q2Ref = 0;
      for (let i = 0; i < len; i++) {
        const q0 = ditheredL[i]! + 2 * cosO * q1 - q2;
        q2 = q1; q1 = q0;
        const qR = inL[i]! + 2 * cosO * q1Ref - q2Ref;
        q2Ref = q1Ref; q1Ref = qR;
      }
      const realOut = q1 - q2 * cosO;
      const imagOut = q2 * sinO;
      const realRef = q1Ref - q2Ref * cosO;
      const imagRef = q2Ref * sinO;
      const energyOut = Math.sqrt(realOut * realOut + imagOut * imagOut);
      const energyRef = Math.sqrt(realRef * realRef + imagRef * imagRef);
      expect(energyOut).toBeGreaterThan(energyRef * 5);
    });
  });

  describe("applyAiRepair (combined widener + exciter, T11)", () => {
    it("amount=0 leaves output bit-identical (combined bypass)", () => {
      const l = sine(0.5, 1000, 1024);
      const r = sine(0.5, 1000, 1024);
      const lOrig = new Float32Array(l);
      const rOrig = new Float32Array(r);
      applyAiRepair(l, r, 0, makeAiRepairState(SR));
      for (let i = 0; i < l.length; i++) {
        expect(l[i]).toBe(lOrig[i]);
        expect(r[i]).toBe(rOrig[i]);
      }
    });

    it("at amount=50 changes the output (combined effect is non-trivial)", () => {
      const len = 4096;
      const inL = sine(0.3, AI_REPAIR_BPF_CENTER_HZ, len);
      const inR = new Float32Array(len);
      for (let i = 0; i < len; i++) inR[i] = inL[i]! * 0.97;

      const outL = new Float32Array(inL); const outR = new Float32Array(inR);
      applyAiRepair(outL, outR, 50, makeAiRepairState(SR));

      let maxDelta = 0;
      for (let i = 0; i < len; i++) {
        const d = Math.abs(outL[i]! - inL[i]!) + Math.abs(outR[i]! - inR[i]!);
        if (d > maxDelta) maxDelta = d;
      }
      expect(maxDelta).toBeGreaterThan(0.001);
    });
  });

  it("clamps amount to [0, 100]", () => {
    const inL = sine(0.3, 2500, 1024);
    const inR = sine(0.3, 2500, 1024);
    for (let i = 0; i < inR.length; i++) inR[i] = inR[i]! * 0.95;

    const overL = new Float32Array(inL); const overR = new Float32Array(inR);
    applyAiRepairWidener(overL, overR, 200, makeAiRepairState(SR));
    const at100L = new Float32Array(inL); const at100R = new Float32Array(inR);
    applyAiRepairWidener(at100L, at100R, 100, makeAiRepairState(SR));

    let maxDelta = 0;
    for (let i = 0; i < overL.length; i++) {
      const d = Math.abs(overL[i]! - at100L[i]!);
      if (d > maxDelta) maxDelta = d;
    }
    expect(maxDelta).toBeLessThan(1e-6);
  });
});
