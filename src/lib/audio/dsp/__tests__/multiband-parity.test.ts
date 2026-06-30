/**
 * Parity test: multiband-compressor-processor.js hot-loop formulas and
 * constants remain in sync with src/lib/audio/dsp/multiband.ts + crossover.ts +
 * compressor.ts.
 *
 * Two layers:
 *   (A) Source-inspection (like halfband-parity.test.ts) — formulas/constants.
 *   (B) Numerical parity — the worklet class is instantiated in a sandboxed vm
 *       (EnvelopeScheduler absent → static params, no smoothing) and run against
 *       the same input as MultibandCompressorDSP. Outputs must agree to < 1e-6.
 *       This is what guarantees export (offline DSP) == preview (worklet).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { BALANCE_RANGE_DB, MultibandCompressorDSP, type BandParams } from "../multiband";

const WORKLET_PATH = resolve(
  __dirname,
  "../../../../../public/worklets/multiband-compressor-processor.js"
);

const worklet = readFileSync(WORKLET_PATH, "utf8");

describe("multiband-parity — constants + formulas match TS reference", () => {
  it("exposes BALANCE_RANGE_DB constant matching TS export", () => {
    const m = worklet.match(/const\s+BALANCE_RANGE_DB\s*=\s*(-?\d+(?:\.\d+)?)/);
    expect(m, "BALANCE_RANGE_DB constant not found in worklet").not.toBeNull();
    expect(Number(m![1])).toBe(BALANCE_RANGE_DB);
  });

  it("uses KNEE_DB = 6 (matches src/lib/audio/dsp/multiband.ts)", () => {
    const m = worklet.match(/const\s+KNEE_DB\s*=\s*(-?\d+(?:\.\d+)?)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(6);
  });

  it("uses BUTTERWORTH_Q = Math.SQRT1_2 for crossover filters", () => {
    expect(worklet).toMatch(/const\s+BUTTERWORTH_Q\s*=\s*Math\.SQRT1_2/);
  });

  it("threshold bias formula (M): threshold + msBalance * BALANCE_RANGE_DB", () => {
    // The exact formula must appear in processBandMS.
    expect(worklet).toMatch(
      /const\s+thrM\s*=\s*params\.threshold\s*\+\s*params\.msBalance\s*\*\s*BALANCE_RANGE_DB/
    );
  });

  it("threshold bias formula (S): threshold - msBalance * BALANCE_RANGE_DB", () => {
    expect(worklet).toMatch(
      /const\s+thrS\s*=\s*params\.threshold\s*-\s*params\.msBalance\s*\*\s*BALANCE_RANGE_DB/
    );
  });

  it("M/S encode uses (L+R)*0.5 and (L-R)*0.5", () => {
    expect(worklet).toMatch(/const\s+m\s*=\s*\(bL\s*\+\s*bR\)\s*\*\s*0\.5/);
    expect(worklet).toMatch(/const\s+s\s*=\s*\(bL\s*-\s*bR\)\s*\*\s*0\.5/);
  });

  it("M/S decode: l = mOut + sOut; r = mOut - sOut", () => {
    expect(worklet).toMatch(/l:\s*mOut\s*\+\s*sOut/);
    expect(worklet).toMatch(/r:\s*mOut\s*-\s*sOut/);
  });

  it("envelope update uses attackCoeff when rising, releaseCoeff when falling", () => {
    // Single updateEnv function encapsulates the invariant.
    const m = worklet.match(/function\s+updateEnv[\s\S]*?\n\}/);
    expect(m, "updateEnv function missing").not.toBeNull();
    const body = m![0];
    expect(body).toMatch(/if\s*\(\s*level\s*>\s*env\s*\)/);
    expect(body).toMatch(/attackCoeff\s*\*\s*env\s*\+\s*\(1\s*-\s*attackCoeff\)\s*\*\s*level/);
    expect(body).toMatch(/releaseCoeff\s*\*\s*env\s*\+\s*\(1\s*-\s*releaseCoeff\)\s*\*\s*level/);
  });

  it("gain application: pow(10, gr/20) * makeupLin", () => {
    expect(worklet).toMatch(/Math\.pow\(10,\s*gr\s*\/\s*20\)\s*\*\s*ctx\.makeupLin/);
  });

  it("stereo detector: max(envA, envB)", () => {
    expect(worklet).toMatch(/state\.envA\s*>\s*state\.envB\s*\?\s*state\.envA\s*:\s*state\.envB/);
  });

  it("ThreeWaySplitter AP compensation: low = LP(fc2, lowRaw) + HP(fc2, lowRaw)", () => {
    // In the worklet, the aliases are lpMidHighAp/hpMidHighAp.
    expect(worklet).toMatch(
      /const\s+low\s*=\s*lr4Process\(s\.lpMidHighAp,\s*lowRaw\)\s*\+\s*lr4Process\(s\.hpMidHighAp,\s*lowRaw\)/
    );
  });

  it("bypass-on-disabled: output.set(input) short-circuit when multibandEnabled <= 0", () => {
    expect(worklet).toMatch(/this\._multibandEnabled\s*<=\s*0/);
    expect(worklet).toMatch(/output\[c\]\.set\(input\[c\]\)/);
  });

  it("posts gr as a 3-element array {low, mid, high}", () => {
    expect(worklet).toMatch(/type:\s*["']gr["']/);
    expect(worklet).toMatch(
      /values:\s*\[\s*this\._state\.low\.lastGr\s*,\s*this\._state\.mid\.lastGr\s*,\s*this\._state\.high\.lastGr\s*\]/
    );
  });
});

// ── (B) Numerical parity — sandboxed worklet instance vs pure-TS DSP ─────────

const SR = 48000;
const BLOCK = 128; // AudioWorklet render quantum

interface SandboxedProcessor {
  port: { onmessage: ((e: { data: { param: string; value: unknown } }) => void) | null };
  process: (inputs: Float32Array[][], outputs: Float32Array[][]) => boolean;
}

function loadWorkletProcessor(): new () => SandboxedProcessor {
  let registered: new () => SandboxedProcessor =
    null as unknown as new () => SandboxedProcessor;
  const sandbox: vm.Context = vm.createContext({
    sampleRate: SR,
    currentTime: 0,
    // EnvelopeScheduler intentionally absent → _scheduler = null → static
    // params are applied directly with no per-block smoothing.
    registerProcessor: (_n: string, ctor: new () => SandboxedProcessor) => {
      registered = ctor;
    },
    AudioWorkletProcessor: class {
      port = {
        onmessage: null as
          | ((e: { data: { param: string; value: unknown } }) => void)
          | null,
        postMessage: () => {},
      };
    },
    Math,
    Object,
    Error,
  });
  vm.runInContext(worklet, sandbox, { filename: "multiband-compressor-processor.js" });
  if (!registered) throw new Error("worklet did not register processor");
  return registered;
}

const WorkletCtor = loadWorkletProcessor();

interface CfgBand {
  enabled: number;
  solo: number;
  threshold: number;
  ratio: number;
  attackMs: number;
  releaseMs: number;
  makeup: number;
  mode: "stereo" | "ms";
  msBalance: number;
}
interface Cfg {
  crossLowMid: number;
  crossMidHigh: number;
  low: CfgBand;
  mid: CfgBand;
  high: CfgBand;
}

function post(proc: SandboxedProcessor, param: string, value: unknown): void {
  proc.port.onmessage?.({ data: { param, value } });
}

function makeWorklet(cfg: Cfg): SandboxedProcessor {
  const p = new WorkletCtor();
  post(p, "multibandEnabled", 1);
  post(p, "mbCrossLowMid", cfg.crossLowMid);
  post(p, "mbCrossMidHigh", cfg.crossMidHigh);
  for (const name of ["Low", "Mid", "High"] as const) {
    const b = cfg[name.toLowerCase() as "low" | "mid" | "high"];
    post(p, `mb${name}Enabled`, b.enabled);
    post(p, `mb${name}Solo`, b.solo);
    post(p, `mb${name}Threshold`, b.threshold);
    post(p, `mb${name}Ratio`, b.ratio);
    post(p, `mb${name}Attack`, b.attackMs);
    post(p, `mb${name}Release`, b.releaseMs);
    post(p, `mb${name}Makeup`, b.makeup);
    post(p, `mb${name}Mode`, b.mode);
    post(p, `mb${name}MsBalance`, b.msBalance);
  }
  return p;
}

function toBand(b: CfgBand): BandParams {
  return {
    enabled: b.enabled,
    solo: b.solo,
    threshold: b.threshold,
    ratio: b.ratio,
    attack: b.attackMs / 1000,
    release: b.releaseMs / 1000,
    makeup: b.makeup,
    mode: b.mode,
    msBalance: b.msBalance,
  };
}

function genInput(n: number): { L: Float32Array; R: Float32Array } {
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    // low (60 Hz) + mid (900 Hz) + high (6 kHz), slightly different per channel.
    L[i] =
      0.4 * Math.sin(2 * Math.PI * 60 * t) +
      0.2 * Math.sin(2 * Math.PI * 900 * t) +
      0.1 * Math.sin(2 * Math.PI * 6000 * t);
    R[i] =
      0.35 * Math.sin(2 * Math.PI * 60 * t) +
      0.22 * Math.sin(2 * Math.PI * 900 * t) +
      0.12 * Math.sin(2 * Math.PI * 6500 * t);
  }
  return { L, R };
}

function runWorklet(
  proc: SandboxedProcessor,
  L: Float32Array,
  R: Float32Array,
): { L: Float32Array; R: Float32Array } {
  const outL = new Float32Array(L.length);
  const outR = new Float32Array(R.length);
  for (let off = 0; off < L.length; off += BLOCK) {
    const bL = new Float32Array(BLOCK);
    const bR = new Float32Array(BLOCK);
    bL.set(L.subarray(off, off + BLOCK));
    bR.set(R.subarray(off, off + BLOCK));
    const oL = new Float32Array(BLOCK);
    const oR = new Float32Array(BLOCK);
    proc.process([[bL, bR]], [[oL, oR]]);
    outL.set(oL, off);
    outR.set(oR, off);
  }
  return { L: outL, R: outR };
}

function runDsp(cfg: Cfg, L: Float32Array, R: Float32Array): { L: Float32Array; R: Float32Array } {
  const dsp = new MultibandCompressorDSP(SR);
  const bands = { low: toBand(cfg.low), mid: toBand(cfg.mid), high: toBand(cfg.high) };
  const cross = { lowMid: cfg.crossLowMid, midHigh: cfg.crossMidHigh };
  const outL = new Float32Array(L.length);
  const outR = new Float32Array(R.length);
  for (let off = 0; off < L.length; off += BLOCK) {
    const bL = new Float32Array(BLOCK);
    const bR = new Float32Array(BLOCK);
    bL.set(L.subarray(off, off + BLOCK));
    bR.set(R.subarray(off, off + BLOCK));
    const oL = new Float32Array(BLOCK);
    const oR = new Float32Array(BLOCK);
    dsp.processStereo(bL, bR, bands, cross, { left: oL, right: oR });
    outL.set(oL, off);
    outR.set(oR, off);
  }
  return { L: outL, R: outR };
}

function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i]! - b[i]!);
    if (d > m) m = d;
  }
  return m;
}

const NEUTRAL: CfgBand = {
  enabled: 0,
  solo: 0,
  threshold: -18,
  ratio: 2,
  attackMs: 20,
  releaseMs: 250,
  makeup: 0,
  mode: "stereo",
  msBalance: 0,
};

const CASES: { name: string; cfg: Cfg }[] = [
  {
    name: "low band compressing (stereo)",
    cfg: {
      crossLowMid: 200,
      crossMidHigh: 2000,
      low: { ...NEUTRAL, enabled: 1, threshold: -40, ratio: 8, attackMs: 5, releaseMs: 80, makeup: 2 },
      mid: { ...NEUTRAL },
      high: { ...NEUTRAL },
    },
  },
  {
    name: "all three bands active, mid in M/S",
    cfg: {
      crossLowMid: 250,
      crossMidHigh: 2500,
      low: { ...NEUTRAL, enabled: 1, threshold: -36, ratio: 4, makeup: 1 },
      mid: { ...NEUTRAL, enabled: 1, threshold: -30, ratio: 3, mode: "ms", msBalance: 0.4 },
      high: { ...NEUTRAL, enabled: 1, threshold: -28, ratio: 6, makeup: 0.5 },
    },
  },
];

describe("multiband-parity — numerical (worklet === offline DSP)", () => {
  it.each(CASES)("worklet output matches the DSP for $name", ({ cfg }) => {
    const n = BLOCK * 64; // 8192 samples, exact block multiple
    const { L, R } = genInput(n);
    const w = runWorklet(makeWorklet(cfg), L, R);
    const d = runDsp(cfg, L, R);
    // skip the first block (filter/envelope warm-up identical on both sides,
    // but compare the steady state too)
    expect(maxAbsDiff(w.L, d.L)).toBeLessThan(1e-6);
    expect(maxAbsDiff(w.R, d.R)).toBeLessThan(1e-6);
  });
});
