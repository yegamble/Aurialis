import { describe, it, expect } from "vitest";
import { DEFAULT_PARAMS, GENRE_PRESETS } from "../presets";
import { applyProcessingPipeline } from "../renderer";
import type { AudioParams } from "@/types/mastering";

/**
 * Phase 4a Task 4: renderer bypass parity.
 *
 * 14 deterministic combinations:
 *   - all-on (1)
 *   - all-off (1)
 *   - each single stage off (6)
 *   - each single stage on — rest off (6)
 *
 * Every stage gated by its `*Enabled` field is tested at each boundary. This
 * file is the authoritative contract for the bypass behavior of
 * `applyProcessingPipeline` (extracted from `renderOffline` for direct
 * testing without OfflineAudioContext).
 */

const SR = 48000;
const N = 2048;

const STAGES = [
  "parametricEqEnabled",
  "compressorEnabled",
  "multibandEnabled",
  "saturationEnabled",
  "stereoWidthEnabled",
  "limiterEnabled",
] as const;

type StageKey = (typeof STAGES)[number];

function deterministicNoise(
  n: number,
  seed: number,
  amplitude = 0.3
): Float32Array {
  const out = new Float32Array(n);
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    out[i] = ((s / 0x7fffffff) * 2 - 1) * amplitude;
  }
  return out;
}

function baselineParams(): AudioParams {
  // Active preset with all stages engageable so that disabling each has a
  // measurable effect in the output.
  return {
    ...GENRE_PRESETS.pop,
    // Force satDrive non-zero so saturation actually modifies the signal
    satDrive: 20,
    // Force stereoWidth != 100 so the width stage actually modifies stereo
    stereoWidth: 120,
  };
}

function setAllEnables(
  params: AudioParams,
  value: 0 | 1
): AudioParams {
  return {
    ...params,
    parametricEqEnabled: value,
    compressorEnabled: value,
    multibandEnabled: value,
    saturationEnabled: value,
    stereoWidthEnabled: value,
    limiterEnabled: value,
  };
}

function runPipeline(
  left: Float32Array,
  right: Float32Array,
  params: AudioParams
): { left: Float32Array; right: Float32Array } {
  const l = new Float32Array(left);
  const r = new Float32Array(right);
  applyProcessingPipeline([l, r], params, SR);
  return { left: l, right: r };
}

function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  let max = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > max) max = d;
  }
  return max;
}

describe("renderer bypass parity — 14-combo matrix (Phase 4a Task 4)", () => {
  it("all-stages-OFF: output is bit-equal to input", () => {
    const left = deterministicNoise(N, 1);
    const right = deterministicNoise(N, 2);
    const params = setAllEnables(baselineParams(), 0);
    const out = runPipeline(left, right, params);
    expect(maxAbsDiff(out.left, left)).toBe(0);
    expect(maxAbsDiff(out.right, right)).toBe(0);
  });

  it("all-stages-ON: output differs from input (chain is engaged)", () => {
    const left = deterministicNoise(N, 1);
    const right = deterministicNoise(N, 2);
    const params = setAllEnables(baselineParams(), 1);
    const out = runPipeline(left, right, params);
    expect(maxAbsDiff(out.left, left)).toBeGreaterThan(0);
  });

  it.each(STAGES)(
    "single-stage-OFF: disabling %s changes output vs all-ON",
    (stage: StageKey) => {
      const left = deterministicNoise(N, 1);
      const right = deterministicNoise(N, 2);

      const allOn = setAllEnables(baselineParams(), 1);
      const oneOff: AudioParams = { ...allOn, [stage]: 0 };

      const refOut = runPipeline(left, right, allOn);
      const testOut = runPipeline(left, right, oneOff);

      // Disabling a stage must change the signal vs. all-on when the stage
      // was actually doing work. All six stages in this baseline are
      // configured to do non-trivial work, so every toggle must be audible.
      const diffL = maxAbsDiff(refOut.left, testOut.left);
      const diffR = maxAbsDiff(refOut.right, testOut.right);
      expect(diffL + diffR).toBeGreaterThan(0);
    }
  );

  it.each(STAGES)(
    "single-stage-ON (rest OFF): only %s engaged modifies input",
    (stage: StageKey) => {
      // Use hot input (amplitude near clipping) so the limiter also has
      // something to do — otherwise a single-stage-ON limiter test with a
      // quiet input is correctly a no-op.
      // Seeds 1 and 2 must produce uncorrelated L/R; stereoWidth only
      // modifies the M/S difference, so with correlated channels the single-
      // stage-ON stereoWidth test would have nothing to diff against.
      const left = deterministicNoise(N, 1, 0.95);
      const right = deterministicNoise(N, 2, 0.95);

      const allOff = setAllEnables(baselineParams(), 0);
      const oneOn: AudioParams = { ...allOff, [stage]: 1 };

      const out = runPipeline(left, right, oneOn);

      // Our baseline is built so every stage has non-neutral params; with
      // hot input every stage must modify the signal observably.
      const diffL = maxAbsDiff(out.left, left);
      const diffR = maxAbsDiff(out.right, right);
      expect(diffL + diffR).toBeGreaterThan(0);
    }
  );

  it("DEFAULT_PARAMS has all new *Enabled fields set to 1", () => {
    expect(DEFAULT_PARAMS.compressorEnabled).toBe(1);
    expect(DEFAULT_PARAMS.saturationEnabled).toBe(1);
    expect(DEFAULT_PARAMS.stereoWidthEnabled).toBe(1);
    expect(DEFAULT_PARAMS.limiterEnabled).toBe(1);
  });

  it("every genre preset preserves compressorEnabled=saturationEnabled=stereoWidthEnabled=limiterEnabled=1", () => {
    for (const [genre, params] of Object.entries(GENRE_PRESETS)) {
      expect(params.compressorEnabled, `${genre}.compressorEnabled`).toBe(1);
      expect(params.saturationEnabled, `${genre}.saturationEnabled`).toBe(1);
      expect(params.stereoWidthEnabled, `${genre}.stereoWidthEnabled`).toBe(1);
      expect(params.limiterEnabled, `${genre}.limiterEnabled`).toBe(1);
    }
  });
});
