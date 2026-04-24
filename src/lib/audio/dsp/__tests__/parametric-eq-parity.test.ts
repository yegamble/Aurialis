/**
 * Parity test: parametric-eq-processor.js hot-loop formulas AND numerical
 * output remain in sync with src/lib/audio/dsp/parametric-eq.ts.
 *
 * Strategy:
 *   (A) Source inspection — the worklet's inline biquad helpers, coeff builder,
 *       MS encode/decode, and msBalance weighting must match the TS reference
 *       (guards against drift when only one side is edited).
 *   (B) Numerical parity — the worklet class is instantiated in a sandboxed vm
 *       with stubs for registerProcessor/sampleRate, and run against the same
 *       input as ParametricEqDSP. Outputs must agree to < 1e-7 absolute.
 *
 * Patterned after `multiband-parity.test.ts`.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import {
  EQ_BAND_COUNT,
  ParametricEqDSP,
  neutralBand,
  type EqBandParams,
} from "../parametric-eq";

const WORKLET_PATH = resolve(
  __dirname,
  "../../../../../public/worklets/parametric-eq-processor.js",
);

const worklet = readFileSync(WORKLET_PATH, "utf8");

describe("parametric-eq parity — constants + formula source inspection", () => {
  it("declares EQ_BAND_COUNT = 5", () => {
    const m = worklet.match(/const\s+EQ_BAND_COUNT\s*=\s*(\d+)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(EQ_BAND_COUNT);
  });

  it("registers the 'parametric-eq-processor' name", () => {
    expect(worklet).toMatch(/registerProcessor\(\s*["']parametric-eq-processor["']/);
  });

  it("true-bypass short-circuits when parametricEqEnabled <= 0", () => {
    expect(worklet).toMatch(/this\._parametricEqEnabled\s*<=\s*0/);
    expect(worklet).toMatch(/output\[c\]\.set\(input\[c\]\)/);
  });

  it("includes IN SYNC WITH markers for every biquad coeff function", () => {
    for (const fn of [
      "peakingCoeffs",
      "lowShelfCoeffs",
      "highShelfCoeffs",
      "highPassCoeffs",
      "lowPassCoeffs",
    ]) {
      const re = new RegExp(`IN SYNC WITH[^\\n]*biquad\\.ts ${fn}`);
      expect(worklet, `missing IN SYNC WITH marker for ${fn}`).toMatch(re);
    }
  });

  it("MS mode encode uses (l+r)*0.5 and (l-r)*0.5", () => {
    expect(worklet).toMatch(/const\s+m\s*=\s*\(l\s*\+\s*r\)\s*\*\s*0\.5/);
    expect(worklet).toMatch(/const\s+s\s*=\s*\(l\s*-\s*r\)\s*\*\s*0\.5/);
  });

  it("MS mode decode: L = yM + yS, R = yM - yS", () => {
    expect(worklet).toMatch(/L\[i\]\s*=\s*yM\s*\+\s*yS/);
    expect(worklet).toMatch(/R\[i\]\s*=\s*yM\s*-\s*yS/);
  });

  it("msBalance weighting matches parametric-eq.ts (weightM / weightS formula)", () => {
    expect(worklet).toMatch(
      /weightM\s*=\s*band\.msBalance\s*>=\s*0\s*\?\s*1\s*:\s*1\s*\+\s*band\.msBalance/,
    );
    expect(worklet).toMatch(
      /weightS\s*=\s*band\.msBalance\s*<=\s*0\s*\?\s*1\s*:\s*1\s*-\s*band\.msBalance/,
    );
  });

  it("buildCoeffs maps types to the correct biquad helpers", () => {
    expect(worklet).toMatch(/case\s+["']bell["'][\s\S]{0,80}peakingCoeffs/);
    expect(worklet).toMatch(/case\s+["']lowShelf["'][\s\S]{0,80}lowShelfCoeffs/);
    expect(worklet).toMatch(/case\s+["']highShelf["'][\s\S]{0,80}highShelfCoeffs/);
    expect(worklet).toMatch(/case\s+["']highPass["'][\s\S]{0,80}highPassCoeffs/);
    expect(worklet).toMatch(/case\s+["']lowPass["'][\s\S]{0,80}lowPassCoeffs/);
  });

  it("legacy eq80/eq250/eq1k/eq4k/eq12k map to bands 0..4 gain", () => {
    expect(worklet).toMatch(/eq80:\s*0/);
    expect(worklet).toMatch(/eq250:\s*1/);
    expect(worklet).toMatch(/eq1k:\s*2/);
    expect(worklet).toMatch(/eq4k:\s*3/);
    expect(worklet).toMatch(/eq12k:\s*4/);
  });
});

// --- Numerical parity (sandboxed worklet instance vs pure-TS DSP) ------------

const SR = 48000;
const BLOCK = 128; // AudioWorklet quantum

interface SandboxedProcessor {
  port: { onmessage: ((e: { data: { param: string; value: unknown } }) => void) | null };
  process: (inputs: Float32Array[][], outputs: Float32Array[][]) => boolean;
  _bands: Array<{ dirty: boolean; mode: string }>;
  [key: string]: unknown;
}

/** Load the worklet inside a vm sandbox, return the registered processor class. */
function loadWorkletProcessor(): new () => SandboxedProcessor {
  let registered: new () => SandboxedProcessor = null as unknown as new () => SandboxedProcessor;
  const sandbox: vm.Context = vm.createContext({
    sampleRate: SR,
    registerProcessor: (_name: string, ctor: new () => SandboxedProcessor) => {
      registered = ctor;
    },
    // Stub the base class with the bare API the processor uses.
    AudioWorkletProcessor: class {
      port = {
        onmessage: null as ((e: { data: { param: string; value: unknown } }) => void) | null,
        postMessage: (_: unknown) => {},
      };
    },
    Math,
    Object,
    Error,
  });
  vm.runInContext(worklet, sandbox, { filename: "parametric-eq-processor.js" });
  if (!registered) throw new Error("worklet did not register processor");
  return registered;
}

const WorkletCtor = loadWorkletProcessor();

function postParam(
  proc: SandboxedProcessor,
  param: string,
  value: unknown,
): void {
  if (proc.port.onmessage) {
    proc.port.onmessage({ data: { param, value } });
  }
}

/** Apply a 5-band config to both the DSP and the worklet instance. */
function applyConfig(
  proc: SandboxedProcessor,
  bands: EqBandParams[],
  parametricEqEnabled = 1,
): void {
  postParam(proc, "parametricEqEnabled", parametricEqEnabled);
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i];
    const n = i + 1;
    postParam(proc, `eqBand${n}Enabled`, b.enabled);
    postParam(proc, `eqBand${n}Freq`, b.freq);
    postParam(proc, `eqBand${n}Q`, b.q);
    postParam(proc, `eqBand${n}Type`, b.type);
    postParam(proc, `eqBand${n}Mode`, b.mode);
    postParam(proc, `eqBand${n}MsBalance`, b.msBalance);
  }
  // Gain is routed via legacy eq80..eq12k names (mirrors chain.ts).
  const legacyKeys = ["eq80", "eq250", "eq1k", "eq4k", "eq12k"];
  for (let i = 0; i < bands.length; i++) {
    postParam(proc, legacyKeys[i], bands[i].gain);
  }
}

/** Process a stereo buffer through the worklet in BLOCK-sized chunks. */
function runWorklet(
  proc: SandboxedProcessor,
  L: Float32Array,
  R: Float32Array,
): { L: Float32Array; R: Float32Array } {
  const outL = new Float32Array(L.length);
  const outR = new Float32Array(R.length);
  for (let offset = 0; offset < L.length; offset += BLOCK) {
    const end = Math.min(offset + BLOCK, L.length);
    const inL = L.subarray(offset, end);
    const inR = R.subarray(offset, end);
    const blockL = new Float32Array(BLOCK);
    const blockR = new Float32Array(BLOCK);
    blockL.set(inL);
    blockR.set(inR);
    const outBlkL = new Float32Array(BLOCK);
    const outBlkR = new Float32Array(BLOCK);
    proc.process([[blockL, blockR]], [[outBlkL, outBlkR]]);
    outL.set(outBlkL.subarray(0, end - offset), offset);
    outR.set(outBlkR.subarray(0, end - offset), offset);
  }
  return { L: outL, R: outR };
}

function genInput(n: number): { L: Float32Array; R: Float32Array } {
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // Deterministic pseudo-noise (no Math.random).
    const t = i / SR;
    L[i] = 0.3 * Math.sin(2 * Math.PI * 220 * t) + 0.1 * Math.sin(2 * Math.PI * 3500 * t);
    R[i] = 0.25 * Math.sin(2 * Math.PI * 330 * t) + 0.08 * Math.sin(2 * Math.PI * 5500 * t);
  }
  return { L, R };
}

function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  let max = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > max) max = d;
  }
  return max;
}

function runDsp(
  bands: EqBandParams[],
  L: Float32Array,
  R: Float32Array,
): { L: Float32Array; R: Float32Array } {
  const dsp = new ParametricEqDSP(SR);
  const outL = new Float32Array(L.length);
  const outR = new Float32Array(R.length);
  // Match worklet's block processing to keep filter state trajectories aligned.
  for (let offset = 0; offset < L.length; offset += BLOCK) {
    const end = Math.min(offset + BLOCK, L.length);
    const blockL = new Float32Array(BLOCK);
    const blockR = new Float32Array(BLOCK);
    blockL.set(L.subarray(offset, end));
    blockR.set(R.subarray(offset, end));
    const outBlkL = new Float32Array(BLOCK);
    const outBlkR = new Float32Array(BLOCK);
    dsp.processStereo(blockL, blockR, bands, { left: outBlkL, right: outBlkR });
    outL.set(outBlkL.subarray(0, end - offset), offset);
    outR.set(outBlkR.subarray(0, end - offset), offset);
  }
  return { L: outL, R: outR };
}

interface Case {
  name: string;
  bands: EqBandParams[];
  parametricEqEnabled: number;
  tolerance: number;
}

function allNeutral(): EqBandParams[] {
  const b: EqBandParams[] = [];
  for (let i = 0; i < EQ_BAND_COUNT; i++) b.push(neutralBand());
  return b;
}

const CASES: Case[] = [
  {
    name: "flat (all bands disabled)",
    bands: allNeutral(),
    parametricEqEnabled: 1,
    tolerance: 1e-7,
  },
  {
    name: "single bell +6 dB @ 1 kHz Q=2 on band 3",
    bands: (() => {
      const b = allNeutral();
      b[2] = {
        enabled: 1,
        freq: 1000,
        q: 2,
        gain: 6,
        type: "bell",
        mode: "stereo",
        msBalance: 0,
      };
      return b;
    })(),
    parametricEqEnabled: 1,
    tolerance: 1e-6,
  },
  {
    name: "low-shelf +3 dB band 1 + bell -4 dB band 3",
    bands: (() => {
      const b = allNeutral();
      b[0] = { enabled: 1, freq: 80, q: 0.7071, gain: 3, type: "lowShelf", mode: "stereo", msBalance: 0 };
      b[2] = { enabled: 1, freq: 1000, q: 1, gain: -4, type: "bell", mode: "stereo", msBalance: 0 };
      return b;
    })(),
    parametricEqEnabled: 1,
    tolerance: 1e-6,
  },
  {
    name: "high-pass band 2 @ 200 Hz Q=0.7071",
    bands: (() => {
      const b = allNeutral();
      b[1] = { enabled: 1, freq: 200, q: 0.7071, gain: 0, type: "highPass", mode: "stereo", msBalance: 0 };
      return b;
    })(),
    parametricEqEnabled: 1,
    tolerance: 1e-6,
  },
  {
    name: "ms mode on band 4: +5 dB, msBalance=+0.7",
    bands: (() => {
      const b = allNeutral();
      b[3] = { enabled: 1, freq: 4000, q: 1, gain: 5, type: "bell", mode: "ms", msBalance: 0.7 };
      return b;
    })(),
    parametricEqEnabled: 1,
    tolerance: 1e-6,
  },
  {
    name: "master parametricEqEnabled=0 → bit-exact bypass",
    bands: (() => {
      const b = allNeutral();
      b[2] = { enabled: 1, freq: 1000, q: 2, gain: 12, type: "bell", mode: "stereo", msBalance: 0 };
      return b;
    })(),
    parametricEqEnabled: 0,
    tolerance: 0,
  },
];

describe("parametric-eq parity — numerical output matches ParametricEqDSP", () => {
  const N = SR; // 1 second
  for (const c of CASES) {
    it(c.name, () => {
      const proc = new WorkletCtor();
      applyConfig(proc, c.bands, c.parametricEqEnabled);

      const input = genInput(N);
      const wkOut = runWorklet(proc, input.L, input.R);

      if (c.parametricEqEnabled === 0) {
        // True bypass: worklet output MUST be bit-exact to input.
        const diffL = maxAbsDiff(wkOut.L, input.L);
        const diffR = maxAbsDiff(wkOut.R, input.R);
        expect(diffL, "L differs from input under bypass").toBe(0);
        expect(diffR, "R differs from input under bypass").toBe(0);
        return;
      }

      const dspOut = runDsp(c.bands, input.L, input.R);
      const dL = maxAbsDiff(wkOut.L, dspOut.L);
      const dR = maxAbsDiff(wkOut.R, dspOut.R);
      expect(
        dL,
        `L: worklet-dsp diff ${dL.toExponential(3)} > tolerance ${c.tolerance}`,
      ).toBeLessThan(c.tolerance);
      expect(
        dR,
        `R: worklet-dsp diff ${dR.toExponential(3)} > tolerance ${c.tolerance}`,
      ).toBeLessThan(c.tolerance);
    });
  }
});
