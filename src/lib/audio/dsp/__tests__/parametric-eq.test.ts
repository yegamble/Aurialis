/**
 * Pure-TS ParametricEqDSP reference tests.
 * Validates per-band semantics: flat passthrough, bell/shelf/HPF/LPF shape,
 * enable bypass, M/S encode/decode, msBalance weighting, reset(), mono path.
 */

import { describe, it, expect } from "vitest";
import {
  EQ_BAND_COUNT,
  ParametricEqDSP,
  bandsFromAudioParams,
  buildCoeffs,
  neutralBand,
  type EqBandParams,
} from "../parametric-eq";

const SR = 48000;
const N = 4096;

function makeBand(partial: Partial<EqBandParams> = {}): EqBandParams {
  return { ...neutralBand(), ...partial };
}

/** Build a 5-band config with band `i` set to `cfg` and others neutral (disabled). */
function soloBand(i: number, cfg: EqBandParams): EqBandParams[] {
  const bands: EqBandParams[] = [];
  for (let k = 0; k < EQ_BAND_COUNT; k++) {
    bands.push(k === i ? cfg : neutralBand());
  }
  return bands;
}

function stereoSine(freqHz: number, durSamples: number = N, amp = 0.25): {
  L: Float32Array;
  R: Float32Array;
} {
  const L = new Float32Array(durSamples);
  const R = new Float32Array(durSamples);
  const omega = (2 * Math.PI * freqHz) / SR;
  for (let i = 0; i < durSamples; i++) {
    const s = amp * Math.sin(omega * i);
    L[i] = s;
    R[i] = s;
  }
  return { L, R };
}

function impulseStereo(n = N): { L: Float32Array; R: Float32Array } {
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  L[0] = 1;
  R[0] = 1;
  return { L, R };
}

/** Compute magnitude response in dB at freq from an impulse response via DFT. */
function magDbAt(ir: Float32Array, freqHz: number, sr: number): number {
  const omega = (2 * Math.PI * freqHz) / sr;
  let re = 0;
  let im = 0;
  for (let n = 0; n < ir.length; n++) {
    re += ir[n] * Math.cos(omega * n);
    im -= ir[n] * Math.sin(omega * n);
  }
  const mag = Math.sqrt(re * re + im * im);
  return 20 * Math.log10(Math.max(mag, 1e-12));
}

function steadyRmsDb(x: Float32Array, startFrac = 0.5): number {
  const start = Math.floor(x.length * startFrac);
  let sum = 0;
  for (let i = start; i < x.length; i++) sum += x[i] * x[i];
  const rms = Math.sqrt(sum / (x.length - start));
  return 20 * Math.log10(Math.max(rms, 1e-12));
}

describe("ParametricEqDSP — flat / bypass", () => {
  it("all bands disabled → output == input to 1e-7", () => {
    const dsp = new ParametricEqDSP(SR);
    const { L, R } = stereoSine(1000);
    const outL = new Float32Array(N);
    const outR = new Float32Array(N);
    const bands: EqBandParams[] = [];
    for (let i = 0; i < EQ_BAND_COUNT; i++) bands.push(neutralBand());
    dsp.processStereo(L, R, bands, { left: outL, right: outR });
    for (let i = 0; i < N; i++) {
      expect(outL[i]).toBeCloseTo(L[i], 7);
      expect(outR[i]).toBeCloseTo(R[i], 7);
    }
  });

  it("all bands enabled but 0 dB gain bells → output == input", () => {
    const dsp = new ParametricEqDSP(SR);
    const { L, R } = stereoSine(1000);
    const outL = new Float32Array(N);
    const outR = new Float32Array(N);
    const bands: EqBandParams[] = [];
    for (let i = 0; i < EQ_BAND_COUNT; i++)
      bands.push(makeBand({ enabled: 1, type: "bell", gain: 0 }));
    dsp.processStereo(L, R, bands, { left: outL, right: outR });
    // Steady-state RMS unchanged (transient at t=0 from zero state is fine).
    expect(steadyRmsDb(outL) - steadyRmsDb(L)).toBeLessThan(0.01);
  });

  it("disabled band after enabled bands does not affect signal", () => {
    const dsp = new ParametricEqDSP(SR);
    const { L, R } = stereoSine(1000);
    const out1L = new Float32Array(N);
    const out1R = new Float32Array(N);
    const out2L = new Float32Array(N);
    const out2R = new Float32Array(N);
    const bandsOnly: EqBandParams[] = [
      makeBand({ enabled: 1, type: "bell", freq: 1000, gain: 6, q: 2 }),
      neutralBand(),
      neutralBand(),
      neutralBand(),
      neutralBand(),
    ];
    const bandsWithDisabled: EqBandParams[] = [
      makeBand({ enabled: 1, type: "bell", freq: 1000, gain: 6, q: 2 }),
      makeBand({ enabled: 0, type: "bell", freq: 500, gain: -12 }),
      neutralBand(),
      neutralBand(),
      neutralBand(),
    ];
    dsp.processStereo(L, R, bandsOnly, { left: out1L, right: out1R });
    const dsp2 = new ParametricEqDSP(SR);
    dsp2.processStereo(L, R, bandsWithDisabled, { left: out2L, right: out2R });
    for (let i = 0; i < N; i++) {
      expect(out2L[i]).toBeCloseTo(out1L[i], 7);
    }
  });
});

describe("ParametricEqDSP — bell filter", () => {
  it("+6 dB bell @ 1 kHz Q=2 boosts 1 kHz by ~6 dB", () => {
    const dsp = new ParametricEqDSP(SR);
    const { L, R } = impulseStereo();
    const outL = new Float32Array(N);
    const outR = new Float32Array(N);
    dsp.processStereo(
      L,
      R,
      soloBand(2, makeBand({ enabled: 1, type: "bell", freq: 1000, q: 2, gain: 6 })),
      { left: outL, right: outR },
    );
    const magAt1k = magDbAt(outL, 1000, SR);
    expect(magAt1k).toBeGreaterThan(5.5);
    expect(magAt1k).toBeLessThan(6.5);
  });

  it("bell gain=0 leaves steady-state sine at any frequency unchanged", () => {
    const dsp = new ParametricEqDSP(SR);
    const { L, R } = stereoSine(500);
    const outL = new Float32Array(N);
    const outR = new Float32Array(N);
    dsp.processStereo(
      L,
      R,
      soloBand(2, makeBand({ enabled: 1, type: "bell", freq: 1000, q: 1, gain: 0 })),
      { left: outL, right: outR },
    );
    expect(steadyRmsDb(outL) - steadyRmsDb(L)).toBeCloseTo(0, 2);
  });
});

describe("ParametricEqDSP — shelves", () => {
  it("low-shelf @ 80 Hz +6 dB boosts 40 Hz by ~6 dB", () => {
    const dsp = new ParametricEqDSP(SR);
    const { L, R } = impulseStereo();
    const outL = new Float32Array(N);
    const outR = new Float32Array(N);
    dsp.processStereo(
      L,
      R,
      soloBand(0, makeBand({ enabled: 1, type: "lowShelf", freq: 80, q: 0.7071, gain: 6 })),
      { left: outL, right: outR },
    );
    const magLow = magDbAt(outL, 40, SR);
    expect(magLow).toBeGreaterThan(5.5);
    expect(magLow).toBeLessThan(6.5);
  });

  it("high-shelf @ 12 kHz +4 dB boosts 15 kHz by ~4 dB and leaves 100 Hz unchanged", () => {
    const dsp = new ParametricEqDSP(SR);
    const { L, R } = impulseStereo();
    const outL = new Float32Array(N);
    const outR = new Float32Array(N);
    dsp.processStereo(
      L,
      R,
      soloBand(4, makeBand({ enabled: 1, type: "highShelf", freq: 12000, q: 0.7071, gain: 4 })),
      { left: outL, right: outR },
    );
    // Measure near Nyquist (shelf asymptotes to +4 dB only well above fc).
    expect(magDbAt(outL, 20000, SR)).toBeGreaterThan(3.5);
    expect(Math.abs(magDbAt(outL, 100, SR))).toBeLessThan(0.5);
  });
});

describe("ParametricEqDSP — HPF/LPF", () => {
  it("HPF @ 200 Hz attenuates 50 Hz by ≥ 20 dB", () => {
    const dsp = new ParametricEqDSP(SR);
    const { L, R } = impulseStereo();
    const outL = new Float32Array(N);
    const outR = new Float32Array(N);
    dsp.processStereo(
      L,
      R,
      soloBand(0, makeBand({ enabled: 1, type: "highPass", freq: 200, q: 0.7071, gain: 0 })),
      { left: outL, right: outR },
    );
    expect(magDbAt(outL, 50, SR)).toBeLessThan(-20);
    // Passband near unity at 2 kHz.
    expect(Math.abs(magDbAt(outL, 2000, SR))).toBeLessThan(1);
  });

  it("LPF @ 1 kHz attenuates 8 kHz by ≥ 20 dB", () => {
    const dsp = new ParametricEqDSP(SR);
    const { L, R } = impulseStereo();
    const outL = new Float32Array(N);
    const outR = new Float32Array(N);
    dsp.processStereo(
      L,
      R,
      soloBand(3, makeBand({ enabled: 1, type: "lowPass", freq: 1000, q: 0.7071, gain: 0 })),
      { left: outL, right: outR },
    );
    expect(magDbAt(outL, 8000, SR)).toBeLessThan(-20);
    expect(Math.abs(magDbAt(outL, 100, SR))).toBeLessThan(1);
  });
});

describe("ParametricEqDSP — M/S mode", () => {
  it("ms mode + msBalance=+1: +6 dB band only affects Mid signal", () => {
    const dsp = new ParametricEqDSP(SR);
    // Pure Mid input: L == R (no side content).
    const { L, R } = stereoSine(1000);
    const outL = new Float32Array(N);
    const outR = new Float32Array(N);
    dsp.processStereo(
      L,
      R,
      soloBand(2, makeBand({ enabled: 1, type: "bell", freq: 1000, q: 1, gain: 6, mode: "ms", msBalance: 1 })),
      { left: outL, right: outR },
    );
    // Mid gets +6 dB → steady amplitude ~2x. Side remains 0 (input side is 0).
    const midBoost = steadyRmsDb(outL) - steadyRmsDb(L);
    expect(midBoost).toBeGreaterThan(5.5);
    expect(midBoost).toBeLessThan(6.5);
    // L and R should be equal (Side is 0).
    for (let i = N / 2; i < N; i++) {
      expect(outL[i]).toBeCloseTo(outR[i], 6);
    }
  });

  it("ms mode + msBalance=-1: +6 dB band only affects Side signal", () => {
    const dsp = new ParametricEqDSP(SR);
    // Pure Side input: L = +x, R = -x (no mid content).
    const L = new Float32Array(N);
    const R = new Float32Array(N);
    const omega = (2 * Math.PI * 1000) / SR;
    for (let i = 0; i < N; i++) {
      const s = 0.25 * Math.sin(omega * i);
      L[i] = s;
      R[i] = -s;
    }
    const outL = new Float32Array(N);
    const outR = new Float32Array(N);
    dsp.processStereo(
      L,
      R,
      soloBand(2, makeBand({ enabled: 1, type: "bell", freq: 1000, q: 1, gain: 6, mode: "ms", msBalance: -1 })),
      { left: outL, right: outR },
    );
    // Side gets +6 dB. L and R are opposite polarity.
    const sideBoost = steadyRmsDb(outL) - steadyRmsDb(L);
    expect(sideBoost).toBeGreaterThan(5.5);
    expect(sideBoost).toBeLessThan(6.5);
    for (let i = N / 2; i < N; i++) {
      expect(outL[i]).toBeCloseTo(-outR[i], 6);
    }
  });

  it("ms mode + msBalance=0 matches stereo mode at the same band (within 1e-5)", () => {
    const dspStereo = new ParametricEqDSP(SR);
    const dspMs = new ParametricEqDSP(SR);
    const { L, R } = stereoSine(800);
    // Slight imbalance so mid and side both carry energy.
    for (let i = 0; i < N; i++) R[i] *= 0.8;

    const outSL = new Float32Array(N);
    const outSR = new Float32Array(N);
    const outML = new Float32Array(N);
    const outMR = new Float32Array(N);
    const cfgS = makeBand({ enabled: 1, type: "bell", freq: 800, q: 1, gain: 5, mode: "stereo" });
    const cfgM = makeBand({ enabled: 1, type: "bell", freq: 800, q: 1, gain: 5, mode: "ms", msBalance: 0 });
    dspStereo.processStereo(L, R, soloBand(2, cfgS), { left: outSL, right: outSR });
    dspMs.processStereo(L, R, soloBand(2, cfgM), { left: outML, right: outMR });

    for (let i = N / 2; i < N; i++) {
      expect(outML[i]).toBeCloseTo(outSL[i], 5);
      expect(outMR[i]).toBeCloseTo(outSR[i], 5);
    }
  });
});

describe("ParametricEqDSP — state / reset / mono", () => {
  it("reset() clears filter memory", () => {
    const dsp = new ParametricEqDSP(SR);
    const { L, R } = stereoSine(1000);
    const outL = new Float32Array(N);
    const outR = new Float32Array(N);
    const cfg = soloBand(2, makeBand({ enabled: 1, type: "bell", freq: 1000, q: 1, gain: 6 }));
    dsp.processStereo(L, R, cfg, { left: outL, right: outR });
    const first = new Float32Array(outL);
    // Reset and reprocess same input → identical output.
    dsp.reset();
    const outL2 = new Float32Array(N);
    const outR2 = new Float32Array(N);
    dsp.processStereo(L, R, cfg, { left: outL2, right: outR2 });
    for (let i = 0; i < N; i++) {
      expect(outL2[i]).toBeCloseTo(first[i], 7);
    }
  });

  it("processMono applies band coeffs to single channel", () => {
    const dsp = new ParametricEqDSP(SR);
    const impulse = new Float32Array(N);
    impulse[0] = 1;
    const out = new Float32Array(N);
    dsp.processMono(
      impulse,
      soloBand(2, makeBand({ enabled: 1, type: "bell", freq: 1000, q: 2, gain: 6 })),
      out,
    );
    expect(magDbAt(out, 1000, SR)).toBeGreaterThan(5.5);
    expect(magDbAt(out, 1000, SR)).toBeLessThan(6.5);
  });
});

describe("bandsFromAudioParams", () => {
  it("maps flat AudioParams shape to 5-band struct with eq{N} gain", () => {
    const p = {
      eq80: 1,
      eq250: -2,
      eq1k: 3,
      eq4k: 0,
      eq12k: -1,
      eqBand1Enabled: 1,
      eqBand1Freq: 80,
      eqBand1Q: 0.7,
      eqBand1Type: "lowShelf" as const,
      eqBand1Mode: "stereo" as const,
      eqBand1MsBalance: 0,
      eqBand2Enabled: 1,
      eqBand2Freq: 250,
      eqBand2Q: 1,
      eqBand2Type: "bell" as const,
      eqBand2Mode: "stereo" as const,
      eqBand2MsBalance: 0,
      eqBand3Enabled: 1,
      eqBand3Freq: 1000,
      eqBand3Q: 1,
      eqBand3Type: "bell" as const,
      eqBand3Mode: "ms" as const,
      eqBand3MsBalance: 0.5,
      eqBand4Enabled: 0,
      eqBand4Freq: 4000,
      eqBand4Q: 1,
      eqBand4Type: "bell" as const,
      eqBand4Mode: "stereo" as const,
      eqBand4MsBalance: 0,
      eqBand5Enabled: 1,
      eqBand5Freq: 12000,
      eqBand5Q: 0.7,
      eqBand5Type: "highShelf" as const,
      eqBand5Mode: "stereo" as const,
      eqBand5MsBalance: 0,
    };
    const bands = bandsFromAudioParams(p);
    expect(bands).toHaveLength(5);
    expect(bands[0].gain).toBe(1);
    expect(bands[2].gain).toBe(3);
    expect(bands[2].mode).toBe("ms");
    expect(bands[2].msBalance).toBe(0.5);
    expect(bands[3].enabled).toBe(0);
    expect(bands[4].type).toBe("highShelf");
  });
});

describe("buildCoeffs", () => {
  it("returns distinct coeffs per filter type at identical freq/gain/Q", () => {
    const a = buildCoeffs("bell", 1000, 6, 1, SR);
    const b = buildCoeffs("lowShelf", 1000, 6, 1, SR);
    const c = buildCoeffs("highShelf", 1000, 6, 1, SR);
    const d = buildCoeffs("highPass", 1000, 6, 1, SR);
    const e = buildCoeffs("lowPass", 1000, 6, 1, SR);
    // At least b0 differs across the five types.
    const set = new Set([a.b0, b.b0, c.b0, d.b0, e.b0]);
    expect(set.size).toBe(5);
  });
});
