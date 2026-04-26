import { describe, it, expect, beforeEach, vi } from "vitest";
import { MultibandCompressorNode, type BandName } from "../multiband-compressor";

describe("MultibandCompressorNode", () => {
  let ctx: AudioContext;

  beforeEach(() => {
    ctx = new AudioContext();
  });

  it("creates an AudioWorkletNode on init", async () => {
    const node = new MultibandCompressorNode(ctx);
    await node.init();
    expect(ctx.audioWorklet.addModule).toHaveBeenCalledWith(
      expect.stringContaining("multiband-compressor-processor")
    );
  });

  it("exposes input and output after init", async () => {
    const node = new MultibandCompressorNode(ctx);
    await node.init();
    expect(node.input).toBeDefined();
    expect(node.output).toBeDefined();
  });

  it("setEnabled posts multibandEnabled param", async () => {
    const node = new MultibandCompressorNode(ctx);
    await node.init();
    node.setEnabled(1);
    const inner = (node as unknown as { _node: AudioWorkletNode })._node;
    expect(inner.port.postMessage).toHaveBeenCalledWith({
      param: "multibandEnabled",
      value: 1,
    });
  });

  it("setCrossLowMid + setCrossMidHigh post crossover params", async () => {
    const node = new MultibandCompressorNode(ctx);
    await node.init();
    node.setCrossLowMid(150);
    node.setCrossMidHigh(2500);
    const inner = (node as unknown as { _node: AudioWorkletNode })._node;
    expect(inner.port.postMessage).toHaveBeenCalledWith({
      param: "mbCrossLowMid",
      value: 150,
    });
    expect(inner.port.postMessage).toHaveBeenCalledWith({
      param: "mbCrossMidHigh",
      value: 2500,
    });
  });

  it.each<BandName>(["low", "mid", "high"])(
    "per-band setters post correctly-prefixed params for band %s",
    async (band) => {
      const node = new MultibandCompressorNode(ctx);
      await node.init();
      const inner = (node as unknown as { _node: AudioWorkletNode })._node;
      const Cap = band.charAt(0).toUpperCase() + band.slice(1);
      node.setBandEnabled(band, 1);
      node.setBandSolo(band, 1);
      node.setBandThreshold(band, -22);
      node.setBandRatio(band, 4);
      node.setBandAttack(band, 10);
      node.setBandRelease(band, 200);
      node.setBandMakeup(band, 3);
      node.setBandMode(band, "ms");
      node.setBandMsBalance(band, -0.5);
      expect(inner.port.postMessage).toHaveBeenCalledWith({ param: `mb${Cap}Enabled`, value: 1 });
      expect(inner.port.postMessage).toHaveBeenCalledWith({ param: `mb${Cap}Solo`, value: 1 });
      expect(inner.port.postMessage).toHaveBeenCalledWith({ param: `mb${Cap}Threshold`, value: -22 });
      expect(inner.port.postMessage).toHaveBeenCalledWith({ param: `mb${Cap}Ratio`, value: 4 });
      expect(inner.port.postMessage).toHaveBeenCalledWith({ param: `mb${Cap}Attack`, value: 10 });
      expect(inner.port.postMessage).toHaveBeenCalledWith({ param: `mb${Cap}Release`, value: 200 });
      expect(inner.port.postMessage).toHaveBeenCalledWith({ param: `mb${Cap}Makeup`, value: 3 });
      expect(inner.port.postMessage).toHaveBeenCalledWith({ param: `mb${Cap}Mode`, value: "ms" });
      expect(inner.port.postMessage).toHaveBeenCalledWith({ param: `mb${Cap}MsBalance`, value: -0.5 });
    }
  );

  it("forwards gr messages to onGainReduction", async () => {
    const node = new MultibandCompressorNode(ctx);
    await node.init();
    const cb = vi.fn();
    node.onGainReduction = cb;
    const inner = (node as unknown as { _node: AudioWorkletNode })._node;
    const handler = inner.port.onmessage;
    if (handler) {
      handler(
        new MessageEvent("message", { data: { type: "gr", values: [-2, -1, -0.5] } })
      );
    }
    expect(cb).toHaveBeenCalledWith({ low: -2, mid: -1, high: -0.5 });
  });

  it("disconnects on dispose", async () => {
    const node = new MultibandCompressorNode(ctx);
    await node.init();
    node.dispose();
    const inner = (node as unknown as { _node: AudioWorkletNode })._node;
    expect(inner.disconnect).toHaveBeenCalled();
  });

  describe("setBandEnvelope (T7a — deep-mode envelopes)", () => {
    it.each<[BandName, "Low" | "Mid" | "High"]>([
      ["low", "Low"],
      ["mid", "Mid"],
      ["high", "High"],
    ])("posts band threshold envelope for %s", async (band, Cap) => {
      const node = new MultibandCompressorNode(ctx);
      await node.init();
      const env: Array<readonly [number, number]> = [
        [0, -24],
        [10, -18],
      ];
      node.setBandEnvelope(band, "threshold", env);
      const inner = (node as unknown as { _node: AudioWorkletNode })._node;
      expect(inner.port.postMessage).toHaveBeenCalledWith({
        param: `mb${Cap}Threshold`,
        envelope: env,
      });
    });

    it("posts band makeup envelope", async () => {
      const node = new MultibandCompressorNode(ctx);
      await node.init();
      node.setBandEnvelope("mid", "makeup", [
        [0, 0],
        [5, 3],
      ]);
      const inner = (node as unknown as { _node: AudioWorkletNode })._node;
      expect(inner.port.postMessage).toHaveBeenCalledWith({
        param: "mbMidMakeup",
        envelope: [
          [0, 0],
          [5, 3],
        ],
      });
    });

    it("clears envelope when given an empty array", async () => {
      const node = new MultibandCompressorNode(ctx);
      await node.init();
      node.setBandEnvelope("low", "threshold", []);
      const inner = (node as unknown as { _node: AudioWorkletNode })._node;
      expect(inner.port.postMessage).toHaveBeenCalledWith({
        param: "mbLowThreshold",
        envelope: [],
      });
    });

    it("preserves existing static-value contract (regression)", async () => {
      const node = new MultibandCompressorNode(ctx);
      await node.init();
      node.setBandThreshold("low", -20);
      const inner = (node as unknown as { _node: AudioWorkletNode })._node;
      expect(inner.port.postMessage).toHaveBeenCalledWith({
        param: "mbLowThreshold",
        value: -20,
      });
    });
  });
});
