import { describe, it, expect } from "vitest";
import { DEFAULT_PARAMS } from "../presets";
import { applyMultiband } from "../renderer";
import {
  MultibandCompressorDSP,
  type BandParams,
} from "../dsp/multiband";

/**
 * These tests exercise the renderer's multiband bypass logic at the API
 * level. The renderer's own `renderOffline` uses OfflineAudioContext (mocked
 * in tests). Here we verify the behavior of the underlying multiband DSP
 * via direct invocation with the same parameter shape the renderer uses.
 */

function makeNoise(n: number, seed = 1): Float32Array {
  const out = new Float32Array(n);
  let s = seed;
  for (let i = 0; i < n; i++) {
    // Simple LCG noise (deterministic)
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    out[i] = ((s / 0x7fffffff) * 2 - 1) * 0.3;
  }
  return out;
}

describe("renderer-multiband — offline parity behavior", () => {
  it("with multibandEnabled=0, processStereo is bit-exact passthrough", () => {
    const fs = 48000;
    const dsp = new MultibandCompressorDSP(fs);
    const n = 4096;
    const left = makeNoise(n, 1);
    const right = makeNoise(n, 2);
    const outL = new Float32Array(n);
    const outR = new Float32Array(n);

    const toBand = (): BandParams => ({
      enabled: 0,
      solo: 0,
      threshold: -18,
      ratio: 2,
      attack: 0.02,
      release: 0.25,
      makeup: 0,
      mode: "stereo",
      msBalance: 0,
    });

    dsp.processStereo(
      left,
      right,
      { low: toBand(), mid: toBand(), high: toBand() },
      { lowMid: 200, midHigh: 2000 },
      { left: outL, right: outR }
    );

    for (let i = 0; i < n; i++) {
      expect(outL[i]).toBe(left[i]);
      expect(outR[i]).toBe(right[i]);
    }
  });

  it("DEFAULT_PARAMS converts to all-disabled band params (byte-equal render)", () => {
    // The renderer's `band()` helper maps AudioParams → BandParams.
    // Every prefixed field in DEFAULT_PARAMS corresponds to a neutral/off band.
    for (const prefix of ["mbLow", "mbMid", "mbHigh"] as const) {
      expect(DEFAULT_PARAMS[`${prefix}Enabled` as const]).toBe(0);
      expect(DEFAULT_PARAMS[`${prefix}Solo` as const]).toBe(0);
      expect(DEFAULT_PARAMS[`${prefix}Mode` as const]).toBe("stereo");
    }
    expect(DEFAULT_PARAMS.multibandEnabled).toBe(0);
  });

  it("with multibandEnabled=1 + low band aggressive, output differs from input", () => {
    const fs = 48000;
    const dsp = new MultibandCompressorDSP(fs);
    const n = 8192;
    // Low-heavy 60 Hz sine
    const left = new Float32Array(n);
    const right = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const s = 0.6 * Math.sin((2 * Math.PI * 60 * i) / fs);
      left[i] = s;
      right[i] = s;
    }
    const outL = new Float32Array(n);
    const outR = new Float32Array(n);

    const aggressive: BandParams = {
      enabled: 1,
      solo: 0,
      threshold: -40,
      ratio: 10,
      attack: 0.001,
      release: 0.05,
      makeup: 0,
      mode: "stereo",
      msBalance: 0,
    };
    const neutral: BandParams = { ...aggressive, enabled: 0 };

    dsp.processStereo(
      left,
      right,
      { low: aggressive, mid: neutral, high: neutral },
      { lowMid: 200, midHigh: 2000 },
      { left: outL, right: outR }
    );

    // Output RMS should be clearly lower than input RMS (low 60 Hz crushed)
    let inSq = 0,
      outSq = 0;
    const start = 4096;
    for (let i = start; i < n; i++) {
      inSq += left[i] * left[i];
      outSq += outL[i] * outL[i];
    }
    const inRms = Math.sqrt(inSq / (n - start));
    const outRms = Math.sqrt(outSq / (n - start));
    expect(outRms).toBeLessThan(inRms);
    expect(20 * Math.log10(outRms / inRms)).toBeLessThan(-3);
  });
});

describe("renderer-multiband — mono export parity", () => {
  const fs = 48000;
  const n = 8192;
  // Aggressive low band so processing is clearly non-identity.
  const params = {
    ...DEFAULT_PARAMS,
    multibandEnabled: 1,
    mbLowEnabled: 1,
    mbLowThreshold: -40,
    mbLowRatio: 10,
    mbLowAttack: 1, // ms (band() divides by 1000)
    mbLowRelease: 50,
  };

  function lowSine(): Float32Array {
    const buf = new Float32Array(n);
    for (let i = 0; i < n; i++) buf[i] = 0.6 * Math.sin((2 * Math.PI * 60 * i) / fs);
    return buf;
  }

  it("applies multiband to a MONO buffer instead of skipping it", () => {
    const mono = lowSine();
    const before = Float32Array.from(mono);
    applyMultiband([mono], params, fs);
    let changed = false;
    for (let i = 0; i < n; i++) {
      if (mono[i] !== before[i]) {
        changed = true;
        break;
      }
    }
    expect(changed).toBe(true);
  });

  it("mono result equals the L channel of the duplicated-stereo render (worklet parity)", () => {
    const mono = lowSine();
    applyMultiband([mono], params, fs);

    const l = lowSine();
    const r = lowSine();
    applyMultiband([l, r], params, fs);

    for (let i = 0; i < n; i++) {
      expect(mono[i]).toBeCloseTo(l[i]!, 10);
    }
  });
});
