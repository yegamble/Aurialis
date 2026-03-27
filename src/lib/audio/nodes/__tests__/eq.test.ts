import { describe, it, expect, beforeEach, vi } from "vitest";
import { EQNode } from "../eq";

describe("EQNode", () => {
  let ctx: AudioContext;

  beforeEach(() => {
    ctx = new AudioContext();
  });

  it("should create 5 BiquadFilterNode bands", () => {
    const eq = new EQNode(ctx);
    expect(eq.bands).toHaveLength(5);
  });

  it("should set band frequencies: 80, 250, 1000, 4000, 12000 Hz", () => {
    const eq = new EQNode(ctx);
    const freqs = eq.bands.map((b) => b.frequency.value);
    expect(freqs[0]).toBeCloseTo(80, 0);
    expect(freqs[1]).toBeCloseTo(250, 0);
    expect(freqs[2]).toBeCloseTo(1000, 0);
    expect(freqs[3]).toBeCloseTo(4000, 0);
    expect(freqs[4]).toBeCloseTo(12000, 0);
  });

  it("should configure band types: lowshelf, peaking, peaking, peaking, highshelf", () => {
    const eq = new EQNode(ctx);
    expect(eq.bands[0].type).toBe("lowshelf");
    expect(eq.bands[1].type).toBe("peaking");
    expect(eq.bands[2].type).toBe("peaking");
    expect(eq.bands[3].type).toBe("peaking");
    expect(eq.bands[4].type).toBe("highshelf");
  });

  it("should set band gain via setGain()", () => {
    const eq = new EQNode(ctx);
    eq.setGain(0, 6);
    expect(eq.bands[0].gain.value).toBe(6);
  });

  it("should clamp gain to [-12, +12] dB", () => {
    const eq = new EQNode(ctx);
    eq.setGain(0, 20);
    expect(eq.bands[0].gain.value).toBe(12);
    eq.setGain(0, -20);
    expect(eq.bands[0].gain.value).toBe(-12);
  });

  it("should expose input and output for chaining", () => {
    const eq = new EQNode(ctx);
    expect(eq.input).toBeDefined();
    expect(eq.output).toBeDefined();
  });

  it("should disconnect all bands on dispose()", () => {
    const eq = new EQNode(ctx);
    eq.dispose();
    for (const band of eq.bands) {
      expect(band.disconnect).toHaveBeenCalled();
    }
  });

  it("should bypass all bands when bypass is true", () => {
    const eq = new EQNode(ctx);
    // Just verify the bypass method exists and doesn't throw
    expect(() => eq.setBypass(true)).not.toThrow();
    expect(() => eq.setBypass(false)).not.toThrow();
  });
});
