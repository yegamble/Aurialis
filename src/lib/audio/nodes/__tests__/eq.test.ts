import { describe, it, expect, beforeEach, vi } from "vitest";
import { EQNode } from "../eq";

describe("EQNode (AudioWorklet parametric EQ)", () => {
  let ctx: AudioContext;

  beforeEach(() => {
    ctx = new AudioContext();
  });

  it("loads the parametric-eq worklet on init()", async () => {
    const eq = new EQNode(ctx);
    await eq.init();
    expect(ctx.audioWorklet.addModule).toHaveBeenCalledWith(
      expect.stringContaining("parametric-eq-processor"),
    );
  });

  it("exposes input/output after init()", async () => {
    const eq = new EQNode(ctx);
    await eq.init();
    expect(eq.input).toBeDefined();
    expect(eq.output).toBeDefined();
  });

  it("throws when input is accessed before init()", () => {
    const eq = new EQNode(ctx);
    expect(() => eq.input).toThrow(/call init\(\) first/);
  });

  it("setEnabled posts parametricEqEnabled param", async () => {
    const eq = new EQNode(ctx);
    await eq.init();
    eq.setEnabled(0);
    expect(eq["_node"]!.port.postMessage).toHaveBeenCalledWith({
      param: "parametricEqEnabled",
      value: 0,
    });
  });

  it("setGain(0, dB) posts legacy eq80 param (backward-compat with ui-presets)", async () => {
    const eq = new EQNode(ctx);
    await eq.init();
    eq.setGain(0, 6);
    expect(eq["_node"]!.port.postMessage).toHaveBeenCalledWith({
      param: "eq80",
      value: 6,
    });
  });

  it("setGain clamps to [-12, +12] dB", async () => {
    const eq = new EQNode(ctx);
    await eq.init();
    eq.setGain(1, 20);
    expect(eq["_node"]!.port.postMessage).toHaveBeenCalledWith({
      param: "eq250",
      value: 12,
    });
    eq.setGain(1, -99);
    expect(eq["_node"]!.port.postMessage).toHaveBeenCalledWith({
      param: "eq250",
      value: -12,
    });
  });

  it("setGain maps band index 0..4 to eq80/eq250/eq1k/eq4k/eq12k", async () => {
    const eq = new EQNode(ctx);
    await eq.init();
    const expected = ["eq80", "eq250", "eq1k", "eq4k", "eq12k"];
    for (let i = 0; i < 5; i++) {
      eq.setGain(i, 0);
      expect(eq["_node"]!.port.postMessage).toHaveBeenCalledWith({
        param: expected[i],
        value: 0,
      });
    }
  });

  it("setBandFreq posts eqBand{N}Freq with 1-indexed band", async () => {
    const eq = new EQNode(ctx);
    await eq.init();
    eq.setBandFreq(2, 1500);
    expect(eq["_node"]!.port.postMessage).toHaveBeenCalledWith({
      param: "eqBand3Freq",
      value: 1500,
    });
  });

  it("setBandQ posts eqBand{N}Q", async () => {
    const eq = new EQNode(ctx);
    await eq.init();
    eq.setBandQ(0, 2.5);
    expect(eq["_node"]!.port.postMessage).toHaveBeenCalledWith({
      param: "eqBand1Q",
      value: 2.5,
    });
  });

  it("setBandType posts eqBand{N}Type with filter name", async () => {
    const eq = new EQNode(ctx);
    await eq.init();
    eq.setBandType(3, "highPass");
    expect(eq["_node"]!.port.postMessage).toHaveBeenCalledWith({
      param: "eqBand4Type",
      value: "highPass",
    });
  });

  it("setBandMode posts eqBand{N}Mode", async () => {
    const eq = new EQNode(ctx);
    await eq.init();
    eq.setBandMode(2, "ms");
    expect(eq["_node"]!.port.postMessage).toHaveBeenCalledWith({
      param: "eqBand3Mode",
      value: "ms",
    });
  });

  it("setBandEnabled posts eqBand{N}Enabled", async () => {
    const eq = new EQNode(ctx);
    await eq.init();
    eq.setBandEnabled(0, 0);
    expect(eq["_node"]!.port.postMessage).toHaveBeenCalledWith({
      param: "eqBand1Enabled",
      value: 0,
    });
  });

  it("setBandMsBalance clamps to [-1, +1]", async () => {
    const eq = new EQNode(ctx);
    await eq.init();
    eq.setBandMsBalance(1, 2);
    expect(eq["_node"]!.port.postMessage).toHaveBeenCalledWith({
      param: "eqBand2MsBalance",
      value: 1,
    });
    eq.setBandMsBalance(1, -7);
    expect(eq["_node"]!.port.postMessage).toHaveBeenCalledWith({
      param: "eqBand2MsBalance",
      value: -1,
    });
  });

  it("setBypass(true) posts parametricEqEnabled=0 (legacy alias)", async () => {
    const eq = new EQNode(ctx);
    await eq.init();
    eq.setBypass(true);
    expect(eq["_node"]!.port.postMessage).toHaveBeenCalledWith({
      param: "parametricEqEnabled",
      value: 0,
    });
    eq.setBypass(false);
    expect(eq["_node"]!.port.postMessage).toHaveBeenCalledWith({
      param: "parametricEqEnabled",
      value: 1,
    });
  });

  it("dispose disconnects node and output", async () => {
    const eq = new EQNode(ctx);
    await eq.init();
    eq.dispose();
    expect(eq["_node"]!.disconnect).toHaveBeenCalled();
  });

  describe("setBandGainEnvelope (T7a — deep-mode envelopes)", () => {
    it.each<[number, "eq80" | "eq250" | "eq1k" | "eq4k" | "eq12k"]>([
      [0, "eq80"],
      [1, "eq250"],
      [2, "eq1k"],
      [3, "eq4k"],
      [4, "eq12k"],
    ])("posts envelope on legacy gain param for band %i", async (idx, key) => {
      const eq = new EQNode(ctx);
      await eq.init();
      const env: Array<readonly [number, number]> = [
        [0, 0],
        [10, 3],
      ];
      eq.setBandGainEnvelope(idx, env);
      expect(eq["_node"]!.port.postMessage).toHaveBeenCalledWith({
        param: key,
        envelope: env,
      });
    });

    it("clears envelope when given an empty array", async () => {
      const eq = new EQNode(ctx);
      await eq.init();
      eq.setBandGainEnvelope(0, []);
      expect(eq["_node"]!.port.postMessage).toHaveBeenCalledWith({
        param: "eq80",
        envelope: [],
      });
    });

    it("ignores out-of-range band indices", async () => {
      const eq = new EQNode(ctx);
      await eq.init();
      const inner = eq["_node"]!;
      const before = (inner.port.postMessage as ReturnType<typeof vi.fn>).mock.calls.length;
      eq.setBandGainEnvelope(99, [[0, 0], [1, 1]]);
      const after = (inner.port.postMessage as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(after).toBe(before);
    });

    it("preserves existing static-value contract (regression)", async () => {
      const eq = new EQNode(ctx);
      await eq.init();
      eq.setGain(0, 4);
      expect(eq["_node"]!.port.postMessage).toHaveBeenCalledWith({
        param: "eq80",
        value: 4,
      });
    });
  });
});
