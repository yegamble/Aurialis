import { describe, it, expect } from "vitest";
import { applyProcessingPipeline } from "../renderer";
import { DEFAULT_PARAMS } from "../presets";
import { dbToLin } from "../dsp/limiter";
import { detectTruePeakDbTp } from "../dsp/true-peak";
import type { AudioParams } from "@/types/mastering";
import type { MasteringScript } from "@/types/deep-mastering";

const SR = 44100;
const CEILING_DB = -1;
const TOL = 0.5; // matches the validated processTruePeakLimiter tolerance

/**
 * ISP-hot signal: an alternating ±A pattern reconstructs to a waveform whose
 * inter-sample (true) peak sits well above the raw sample peak, so a sample-peak
 * limiter is blind to the overshoot. (Same generator the limiter-truepeak unit
 * test uses to prove the upgrade matters.)
 */
function ispHotAlternating(n: number, amplitude: number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = i % 2 === 0 ? amplitude : -amplitude;
  return out;
}

/** Every stage bypassed except the limiter, so we isolate true-peak limiting. */
function limiterOnlyParams(ceiling: number): AudioParams {
  return {
    ...DEFAULT_PARAMS,
    parametricEqEnabled: 0,
    compressorEnabled: 0,
    multibandEnabled: 0,
    saturationEnabled: 0,
    stereoWidthEnabled: 0,
    limiterEnabled: 1,
    ceiling,
  };
}

function flatScript(durationSec: number): MasteringScript {
  return {
    version: 1,
    trackId: "tp-test",
    sampleRate: SR,
    duration: durationSec,
    profile: "modern_pop_polish",
    sections: [],
    moves: [],
  };
}

describe("offline renderer — true-peak limiting on export", () => {
  it("ISP-hot input overshoots the true-peak ceiling before limiting (defect precondition)", () => {
    const sig = ispHotAlternating(8192, 0.95);
    // Sample peak (0.95) is only ~-0.45 dBFS; the limiter sees it, but…
    // …the true (inter-sample) peak is well above the -1 dBTP ceiling.
    expect(detectTruePeakDbTp(sig)).toBeGreaterThan(CEILING_DB + TOL);
  });

  it("legacy (non-script) path holds the -1 dBTP ceiling on export", () => {
    const l = ispHotAlternating(8192, 0.95);
    const r = ispHotAlternating(8192, 0.95);
    applyProcessingPipeline([l, r], limiterOnlyParams(CEILING_DB), SR, null);
    const skip = 1000; // skip attack/release settling transient
    expect(detectTruePeakDbTp(l.subarray(skip))).toBeLessThanOrEqual(CEILING_DB + TOL);
    expect(detectTruePeakDbTp(r.subarray(skip))).toBeLessThanOrEqual(CEILING_DB + TOL);
  });

  it("deep-script path holds the -1 dBTP ceiling on export", () => {
    const l = ispHotAlternating(8192, 0.95);
    const r = ispHotAlternating(8192, 0.95);
    applyProcessingPipeline([l, r], limiterOnlyParams(CEILING_DB), SR, flatScript(8192 / SR));
    const skip = 1000;
    expect(detectTruePeakDbTp(l.subarray(skip))).toBeLessThanOrEqual(CEILING_DB + TOL);
    expect(detectTruePeakDbTp(r.subarray(skip))).toBeLessThanOrEqual(CEILING_DB + TOL);
  });

  it("limiter stays bypassed (no true-peak processing) when limiterEnabled = 0", () => {
    // Guards the bypass-parity contract: disabling the limiter must not limit.
    const l = ispHotAlternating(4096, 0.95);
    const params = { ...limiterOnlyParams(CEILING_DB), limiterEnabled: 0 };
    const before = l.slice();
    applyProcessingPipeline([l, l.slice()], params, SR, null);
    expect(l).toEqual(before);
  });
});
