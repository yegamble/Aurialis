import { describe, it, expect, beforeEach, vi } from "vitest";
import { AudioBypass } from "../bypass";

describe("AudioBypass", () => {
  let ctx: AudioContext;
  let inputGain: GainNode;
  let chain: { input: AudioNode; output: AudioNode };
  let outputGain: GainNode;

  beforeEach(() => {
    ctx = new AudioContext();
    inputGain = ctx.createGain();
    chain = {
      input: ctx.createGain(),
      output: ctx.createGain(),
    };
    outputGain = ctx.createGain();
  });

  it("should start in processed (non-bypass) mode", () => {
    const bypass = new AudioBypass(inputGain, chain, outputGain);
    expect(bypass.isActive).toBe(false);
  });

  it("should toggle to bypass mode on enable()", () => {
    const bypass = new AudioBypass(inputGain, chain, outputGain);
    bypass.enable();
    expect(bypass.isActive).toBe(true);
  });

  it("should toggle back to processed mode on disable()", () => {
    const bypass = new AudioBypass(inputGain, chain, outputGain);
    bypass.enable();
    bypass.disable();
    expect(bypass.isActive).toBe(false);
  });

  it("should toggle state on toggle()", () => {
    const bypass = new AudioBypass(inputGain, chain, outputGain);
    bypass.toggle();
    expect(bypass.isActive).toBe(true);
    bypass.toggle();
    expect(bypass.isActive).toBe(false);
  });

  it("should not throw during enable/disable", () => {
    const bypass = new AudioBypass(inputGain, chain, outputGain);
    expect(() => bypass.enable()).not.toThrow();
    expect(() => bypass.disable()).not.toThrow();
  });
});
