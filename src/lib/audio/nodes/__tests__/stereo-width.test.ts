import { describe, it, expect, beforeEach } from "vitest";
import { StereoWidthNode } from "../stereo-width";

describe("StereoWidthNode", () => {
  let ctx: AudioContext;

  beforeEach(() => {
    ctx = new AudioContext();
  });

  it("should expose input and output for chaining", () => {
    const sw = new StereoWidthNode(ctx);
    expect(sw.input).toBeDefined();
    expect(sw.output).toBeDefined();
  });

  it("should set width without throwing", () => {
    const sw = new StereoWidthNode(ctx);
    expect(() => sw.setWidth(0)).not.toThrow();
    expect(() => sw.setWidth(100)).not.toThrow();
    expect(() => sw.setWidth(200)).not.toThrow();
  });

  it("should set bass mono frequency without throwing", () => {
    const sw = new StereoWidthNode(ctx);
    expect(() => sw.setBassMonoFreq(200)).not.toThrow();
  });

  it("should set mid gain without throwing", () => {
    const sw = new StereoWidthNode(ctx);
    expect(() => sw.setMidGain(0)).not.toThrow();
    expect(() => sw.setMidGain(3)).not.toThrow();
  });

  it("should set side gain without throwing", () => {
    const sw = new StereoWidthNode(ctx);
    expect(() => sw.setSideGain(0)).not.toThrow();
    expect(() => sw.setSideGain(-3)).not.toThrow();
  });

  it("should dispose without throwing", () => {
    const sw = new StereoWidthNode(ctx);
    expect(() => sw.dispose()).not.toThrow();
  });

  it("should accept bypass toggle", () => {
    const sw = new StereoWidthNode(ctx);
    expect(() => sw.setBypass(true)).not.toThrow();
    expect(() => sw.setBypass(false)).not.toThrow();
  });
});
