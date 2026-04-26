import { describe, it, expect, beforeEach, vi } from "vitest";
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

  describe("setEnvelope (T7b — deep-mode envelopes)", () => {
    it("schedules a chain of AudioParam ramps for the width param", () => {
      const sw = new StereoWidthNode(ctx);
      const param = (sw as unknown as { _sideLevel: { gain: {
        cancelScheduledValues: ReturnType<typeof vi.fn>;
        setValueAtTime: ReturnType<typeof vi.fn>;
        linearRampToValueAtTime: ReturnType<typeof vi.fn>;
      } } })._sideLevel.gain;

      sw.setEnvelope("width", [
        [0, 100],
        [1, 200],
        [2, 50],
      ]);

      // Cancel any pending schedule first.
      expect(param.cancelScheduledValues).toHaveBeenCalled();
      // First point seeds the value at its time.
      expect(param.setValueAtTime).toHaveBeenCalledWith(1.0, 0);
      // Subsequent points are linear ramps. Width values are scaled by 1/100.
      expect(param.linearRampToValueAtTime).toHaveBeenCalledWith(2.0, 1);
      expect(param.linearRampToValueAtTime).toHaveBeenCalledWith(0.5, 2);
    });

    it("clears scheduled values when given an empty array", () => {
      const sw = new StereoWidthNode(ctx);
      const param = (sw as unknown as { _sideLevel: { gain: {
        cancelScheduledValues: ReturnType<typeof vi.fn>;
      } } })._sideLevel.gain;
      sw.setEnvelope("width", []);
      expect(param.cancelScheduledValues).toHaveBeenCalled();
    });

    it("preserves existing static-value contract (regression)", () => {
      const sw = new StereoWidthNode(ctx);
      const param = (sw as unknown as { _sideLevel: { gain: { value: number } } })._sideLevel.gain;
      sw.setWidth(150);
      expect(param.value).toBe(1.5);
    });
  });
});
