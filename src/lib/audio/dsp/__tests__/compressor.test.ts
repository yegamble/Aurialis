import { describe, it, expect } from "vitest";
import {
  computeGainReduction,
  applyGainSmoothing,
  makeAttackReleaseCoeffs,
} from "../compressor";

describe("computeGainReduction", () => {
  it("returns 0 dB when signal is below threshold", () => {
    const gr = computeGainReduction(-30, { threshold: -20, ratio: 4, knee: 0 });
    expect(gr).toBeCloseTo(0, 3);
  });

  it("produces ~7.5 dB gain reduction at -10 dBFS with threshold=-20, ratio=4:1", () => {
    const gr = computeGainReduction(-10, {
      threshold: -20,
      ratio: 4,
      knee: 0,
    });
    expect(gr).toBeCloseTo(-7.5, 1);
  });

  it("produces ~0 dB gain reduction with ratio=1:1 (no compression)", () => {
    const gr = computeGainReduction(-10, {
      threshold: -20,
      ratio: 1,
      knee: 0,
    });
    expect(gr).toBeCloseTo(0, 3);
  });

  it("applies soft knee — partial GR at threshold center", () => {
    const knee = 6; // 6 dB knee
    const grAtThreshold = computeGainReduction(-20, {
      threshold: -20,
      ratio: 4,
      knee,
    });
    // At threshold with 6dB knee: GR = (1/4-1)*(3)^2/(2*6) = -0.75*9/12 = -0.5625 dB
    // Less reduction than hard-knee at same point (which would be 0)
    expect(grAtThreshold).toBeGreaterThan(-1);
    expect(grAtThreshold).toBeLessThan(0);
  });

  it("soft knee is continuous with hard knee at the top of the knee", () => {
    // At exactly threshold + halfKnee (top of knee), soft == hard
    const topOfKnee = -20 + 5; // threshold + halfKnee (knee=10)
    const grHard = computeGainReduction(topOfKnee, { threshold: -20, ratio: 4, knee: 0 });
    const grSoft = computeGainReduction(topOfKnee, { threshold: -20, ratio: 4, knee: 10 });
    expect(grSoft).toBeCloseTo(grHard, 3);
  });

  it("handles infinity ratio (limiting) correctly", () => {
    const gr = computeGainReduction(-10, {
      threshold: -20,
      ratio: Infinity,
      knee: 0,
    });
    // Output should be at threshold level
    expect(gr).toBeCloseTo(-10, 0); // -10 - (-20) = -10 dB reduction
  });
});

describe("makeAttackReleaseCoeffs", () => {
  it("returns coefficient approaching 1 for very long attack time", () => {
    const { attack } = makeAttackReleaseCoeffs(1, 1, 44100);
    // exp(-1 / (1 * 44100)) ≈ 0.9999773
    expect(attack).toBeGreaterThan(0.9999);
    expect(attack).toBeLessThan(1);
  });

  it("returns smaller coefficient for shorter attack time (faster response)", () => {
    const { attack: slowAttack } = makeAttackReleaseCoeffs(0.1, 1, 44100);
    const { attack: fastAttack } = makeAttackReleaseCoeffs(0.001, 1, 44100);
    // Shorter attack time → smaller coefficient → faster tracking
    expect(fastAttack).toBeLessThan(slowAttack);
    // Both should be less than 1 and greater than 0
    expect(fastAttack).toBeGreaterThan(0);
    expect(slowAttack).toBeLessThan(1);
  });

  it("attack and release coefficients are different when times differ", () => {
    const { attack, release } = makeAttackReleaseCoeffs(0.01, 0.25, 44100);
    expect(attack).not.toEqual(release);
    // Longer release time → higher coefficient (slower decay)
    expect(release).toBeGreaterThan(attack);
  });
});

describe("applyGainSmoothing", () => {
  it("smooths gain reduction over time using attack coefficient", () => {
    const attackCoeff = 0.9; // slow attack
    let envelope = 0;

    // Apply target of -6 dB repeatedly
    for (let i = 0; i < 10; i++) {
      envelope = applyGainSmoothing(envelope, -6, attackCoeff, attackCoeff);
    }

    // After 10 samples with coeff 0.9, should be between 0 and -6
    expect(envelope).toBeGreaterThan(-6);
    expect(envelope).toBeLessThan(0);
  });

  it("eventually reaches target gain reduction", () => {
    const attackCoeff = 0.01; // fast attack (low coefficient)
    let envelope = 0;

    // Apply target of -6 dB many times
    for (let i = 0; i < 1000; i++) {
      envelope = applyGainSmoothing(envelope, -6, attackCoeff, attackCoeff);
    }

    expect(envelope).toBeCloseTo(-6, 0);
  });
});
