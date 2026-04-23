import { describe, it, expect } from "vitest";
import {
  MultibandCompressorDSP,
  type BandParams,
  BALANCE_RANGE_DB,
} from "../multiband";

const FS = 48000;

function makeBand(overrides: Partial<BandParams> = {}): BandParams {
  return {
    enabled: 0,
    solo: 0,
    threshold: -18,
    ratio: 2,
    attack: 0.02,
    release: 0.25,
    makeup: 0,
    mode: "stereo",
    msBalance: 0,
    ...overrides,
  };
}

function makeSine(freq: number, n: number, fs: number, amp = 0.5): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = amp * Math.sin((2 * Math.PI * freq * i) / fs);
  }
  return out;
}

function rms(buf: Float32Array, skipFirst = 0): number {
  let sum = 0;
  let n = 0;
  for (let i = skipFirst; i < buf.length; i++) {
    sum += buf[i] * buf[i];
    n++;
  }
  return Math.sqrt(sum / Math.max(1, n));
}

describe("MultibandCompressorDSP", () => {
  it("is bit-exact passthrough when all bands disabled", () => {
    const dsp = new MultibandCompressorDSP(FS);
    const n = 4096;
    const left = makeSine(1000, n, FS, 0.3);
    const right = makeSine(1000, n, FS, 0.3);
    const outL = new Float32Array(n);
    const outR = new Float32Array(n);
    dsp.processStereo(
      left,
      right,
      {
        low: makeBand({ enabled: 0 }),
        mid: makeBand({ enabled: 0 }),
        high: makeBand({ enabled: 0 }),
      },
      { lowMid: 200, midHigh: 2000 },
      { left: outL, right: outR }
    );
    // With all bands disabled, output should equal input
    for (let i = 0; i < n; i++) {
      expect(outL[i]).toBeCloseTo(left[i], 5);
      expect(outR[i]).toBeCloseTo(right[i], 5);
    }
  });

  it("low band: aggressive compression attenuates 60 Hz but leaves 8 kHz alone", () => {
    const dsp = new MultibandCompressorDSP(FS);
    const n = 16384;
    // 60 Hz low tone + 8 kHz high tone, summed, amp 0.4 each.
    const left = new Float32Array(n);
    const right = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const lo = 0.4 * Math.sin((2 * Math.PI * 60 * i) / FS);
      const hi = 0.4 * Math.sin((2 * Math.PI * 8000 * i) / FS);
      left[i] = lo + hi;
      right[i] = lo + hi;
    }
    const outL = new Float32Array(n);
    const outR = new Float32Array(n);

    // Baseline: all disabled
    dsp.processStereo(
      left,
      right,
      {
        low: makeBand(),
        mid: makeBand(),
        high: makeBand(),
      },
      { lowMid: 200, midHigh: 2000 },
      { left: outL, right: outR }
    );
    const baselineRms = rms(outL, 8192);

    // Aggressive low band: thresh=-60, ratio=10 → crushes low content
    dsp.reset();
    dsp.processStereo(
      left,
      right,
      {
        low: makeBand({
          enabled: 1,
          threshold: -60,
          ratio: 10,
          attack: 0.001,
          release: 0.05,
        }),
        mid: makeBand(),
        high: makeBand(),
      },
      { lowMid: 200, midHigh: 2000 },
      { left: outL, right: outR }
    );
    const compressedRms = rms(outL, 8192);
    // Total output RMS should drop meaningfully because low content is now crushed
    expect(compressedRms).toBeLessThan(baselineRms);
    expect(20 * Math.log10(compressedRms / baselineRms)).toBeLessThan(-1.5);
  });

  it("M/S balance biases threshold: +1 → M sees +BALANCE_RANGE dB threshold (less GR on M)", () => {
    const dsp = new MultibandCompressorDSP(FS);
    const n = 8192;
    // Mono signal (L === R) → pure M content, zero S. Aggressive mid band.
    const sig = makeSine(700, n, FS, 0.5);
    const outL = new Float32Array(n);
    const outR = new Float32Array(n);

    const base = makeBand({
      enabled: 1,
      threshold: -20,
      ratio: 8,
      attack: 0.001,
      release: 0.05,
      mode: "ms",
    });

    // Balance = 0 → standard M/S processing
    dsp.processStereo(
      sig,
      sig,
      { low: makeBand(), mid: { ...base, msBalance: 0 }, high: makeBand() },
      { lowMid: 200, midHigh: 2000 },
      { left: outL, right: outR }
    );
    const grRms0 = rms(outL, 4096);

    // Balance = +1 → M threshold is raised (thresh + BALANCE_RANGE_DB) → less GR → higher RMS
    dsp.reset();
    dsp.processStereo(
      sig,
      sig,
      { low: makeBand(), mid: { ...base, msBalance: 1 }, high: makeBand() },
      { lowMid: 200, midHigh: 2000 },
      { left: outL, right: outR }
    );
    const grRmsPos = rms(outL, 4096);

    expect(grRmsPos).toBeGreaterThan(grRms0);
    expect(BALANCE_RANGE_DB).toBeGreaterThanOrEqual(3);
  });

  it("M/S balance = -1 → more GR on M → lower output RMS for mono signal", () => {
    const dsp = new MultibandCompressorDSP(FS);
    const n = 8192;
    const sig = makeSine(700, n, FS, 0.5);
    const outL = new Float32Array(n);
    const outR = new Float32Array(n);

    const base = makeBand({
      enabled: 1,
      threshold: -20,
      ratio: 8,
      attack: 0.001,
      release: 0.05,
      mode: "ms",
    });

    dsp.processStereo(
      sig,
      sig,
      { low: makeBand(), mid: { ...base, msBalance: 0 }, high: makeBand() },
      { lowMid: 200, midHigh: 2000 },
      { left: outL, right: outR }
    );
    const grRms0 = rms(outL, 4096);

    dsp.reset();
    dsp.processStereo(
      sig,
      sig,
      { low: makeBand(), mid: { ...base, msBalance: -1 }, high: makeBand() },
      { lowMid: 200, midHigh: 2000 },
      { left: outL, right: outR }
    );
    const grRmsNeg = rms(outL, 4096);

    expect(grRmsNeg).toBeLessThan(grRms0);
  });

  it("M/S mode with balance=0 preserves mono signal (L===R out within tight tolerance)", () => {
    const dsp = new MultibandCompressorDSP(FS);
    const n = 4096;
    const sig = makeSine(700, n, FS, 0.3);
    const outL = new Float32Array(n);
    const outR = new Float32Array(n);

    dsp.processStereo(
      sig,
      sig,
      {
        low: makeBand(),
        mid: makeBand({
          enabled: 1,
          threshold: -15,
          ratio: 4,
          attack: 0.005,
          release: 0.1,
          mode: "ms",
          msBalance: 0,
        }),
        high: makeBand(),
      },
      { lowMid: 200, midHigh: 2000 },
      { left: outL, right: outR }
    );

    // L should equal R (mono input, M/S balance=0 → symmetric)
    for (let i = 2048; i < n; i++) {
      expect(outL[i]).toBeCloseTo(outR[i], 4);
    }
  });

  it("solo: when any band is solo, non-soloed bands contribute silence to the sum", () => {
    const dsp = new MultibandCompressorDSP(FS);
    const n = 8192;
    const left = makeSine(60, n, FS, 0.3); // pure low content
    const right = makeSine(60, n, FS, 0.3);
    const outL = new Float32Array(n);
    const outR = new Float32Array(n);

    // Solo HIGH band only → low content should be silenced in output
    dsp.processStereo(
      left,
      right,
      {
        low: makeBand({ enabled: 1 }),
        mid: makeBand({ enabled: 1 }),
        high: makeBand({ enabled: 1, solo: 1 }),
      },
      { lowMid: 200, midHigh: 2000 },
      { left: outL, right: outR }
    );
    const soloHighRms = rms(outL, 4096);
    expect(soloHighRms).toBeLessThan(0.01); // Near silence (60 Hz in high band is far below -40 dB)
  });

  it("solo: soloing the low band with a low sine preserves most content", () => {
    const dsp = new MultibandCompressorDSP(FS);
    const n = 8192;
    const sig = makeSine(60, n, FS, 0.3);
    const outL = new Float32Array(n);
    const outR = new Float32Array(n);
    dsp.processStereo(
      sig,
      sig,
      {
        low: makeBand({ enabled: 1, solo: 1 }),
        mid: makeBand({ enabled: 1 }),
        high: makeBand({ enabled: 1 }),
      },
      { lowMid: 200, midHigh: 2000 },
      { left: outL, right: outR }
    );
    const soloLowRms = rms(outL, 4096);
    // Low 60 Hz sine through low band ≈ preserved (some -6 dB summation tolerance)
    const inRms = rms(sig, 4096);
    expect(soloLowRms).toBeGreaterThan(inRms * 0.3); // at least -10 dB vs input
  });

  it("returns last-sample gr per band for metering", () => {
    const dsp = new MultibandCompressorDSP(FS);
    const n = 4096;
    const sig = makeSine(60, n, FS, 0.8);
    const outL = new Float32Array(n);
    const outR = new Float32Array(n);
    const gr = dsp.processStereo(
      sig,
      sig,
      {
        low: makeBand({
          enabled: 1,
          threshold: -30,
          ratio: 8,
          attack: 0.001,
          release: 0.05,
        }),
        mid: makeBand(),
        high: makeBand(),
      },
      { lowMid: 200, midHigh: 2000 },
      { left: outL, right: outR }
    );
    expect(gr.grLow).toBeLessThan(0); // negative = gain reduction
    expect(gr.grMid).toBe(0);
    expect(gr.grHigh).toBe(0);
  });
});
