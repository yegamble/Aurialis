/**
 * Parity test: multiband-compressor-processor.js hot-loop formulas and
 * constants remain in sync with src/lib/audio/dsp/multiband.ts + crossover.ts +
 * compressor.ts.
 *
 * Source-inspection style (like halfband-parity.test.ts). Guards against
 * inadvertent drift when either side is edited.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BALANCE_RANGE_DB } from "../multiband";

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
