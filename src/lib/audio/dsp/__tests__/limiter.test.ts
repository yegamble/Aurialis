import { describe, it, expect } from "vitest";
import {
  computeLookaheadGain,
  LookaheadBuffer,
  linToDb,
  dbToLin,
} from "../limiter";

describe("linToDb / dbToLin", () => {
  it("converts linear to dB correctly", () => {
    expect(linToDb(1)).toBeCloseTo(0, 3);
    expect(linToDb(0.5)).toBeCloseTo(-6.02, 1);
    expect(linToDb(2)).toBeCloseTo(6.02, 1);
  });

  it("converts dB to linear correctly", () => {
    expect(dbToLin(0)).toBeCloseTo(1, 3);
    expect(dbToLin(-6.02)).toBeCloseTo(0.5, 1);
    expect(dbToLin(6.02)).toBeCloseTo(2, 1);
  });

  it("round-trips correctly", () => {
    const val = 0.3;
    expect(dbToLin(linToDb(val))).toBeCloseTo(val, 5);
  });
});

describe("LookaheadBuffer", () => {
  it("creates buffer with specified size", () => {
    const buf = new LookaheadBuffer(66);
    expect(buf.size).toBe(66);
  });

  it("returns delayed sample after buffer is filled", () => {
    const buf = new LookaheadBuffer(4);
    buf.push(1.0);
    buf.push(0.5);
    buf.push(0.2);
    buf.push(0.8);
    // Push a 5th sample: first sample (1.0) should be output
    const delayed = buf.push(0.3);
    expect(delayed).toBeCloseTo(1.0, 5);
  });

  it("returns maximum absolute value in lookahead window", () => {
    const buf = new LookaheadBuffer(4);
    buf.push(0.1);
    buf.push(0.9);
    buf.push(0.3);
    const peak = buf.peakInWindow();
    expect(peak).toBeCloseTo(0.9, 5);
  });
});

describe("computeLookaheadGain", () => {
  it("returns gain = 1.0 when signal is below ceiling", () => {
    const ceiling = dbToLin(-1); // ~0.891
    const gain = computeLookaheadGain(0.5, ceiling);
    expect(gain).toBeCloseTo(1.0, 3);
  });

  it("reduces gain to enforce ceiling", () => {
    const ceiling = dbToLin(-1); // ~0.891
    const peakLevel = 1.0; // 0 dBFS, exceeds ceiling
    const gain = computeLookaheadGain(peakLevel, ceiling);
    // gain * peakLevel should not exceed ceiling
    expect(gain * peakLevel).toBeLessThanOrEqual(ceiling + 0.001);
  });

  it("limits signal at -1 dBTP ceiling with peak 0 dBFS input (above ceiling)", () => {
    const ceiling = dbToLin(-1);
    const inputPeak = 1.0; // 0 dBFS — exceeds ceiling
    const gain = computeLookaheadGain(inputPeak, ceiling);
    const outputPeak = gain * inputPeak;
    // Output should be exactly at ceiling
    expect(linToDb(outputPeak)).toBeCloseTo(-1, 3);
  });

  it("passes signal unchanged when input is below ceiling", () => {
    const ceiling = dbToLin(-1);
    const inputPeak = dbToLin(-3); // -3 dBFS < -1 dBTP ceiling
    const gain = computeLookaheadGain(inputPeak, ceiling);
    expect(gain).toBeCloseTo(1.0, 5);
  });
});
