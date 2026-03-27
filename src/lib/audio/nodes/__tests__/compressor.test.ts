import { describe, it, expect, beforeEach, vi } from "vitest";
import { CompressorNode } from "../compressor";

describe("CompressorNode", () => {
  let ctx: AudioContext;

  beforeEach(() => {
    ctx = new AudioContext();
  });

  it("should create an AudioWorkletNode on init", async () => {
    const comp = new CompressorNode(ctx);
    await comp.init();
    expect(ctx.audioWorklet.addModule).toHaveBeenCalledWith(
      expect.stringContaining("compressor-processor")
    );
  });

  it("should expose input and output after init", async () => {
    const comp = new CompressorNode(ctx);
    await comp.init();
    expect(comp.input).toBeDefined();
    expect(comp.output).toBeDefined();
  });

  it("should post 'threshold' param message on setThreshold()", async () => {
    const comp = new CompressorNode(ctx);
    await comp.init();
    comp.setThreshold(-18);
    const node = comp["_node"]!;
    expect(node.port.postMessage).toHaveBeenCalledWith({
      param: "threshold",
      value: -18,
    });
  });

  it("should post 'ratio' param message on setRatio()", async () => {
    const comp = new CompressorNode(ctx);
    await comp.init();
    comp.setRatio(4);
    expect(comp["_node"]!.port.postMessage).toHaveBeenCalledWith({
      param: "ratio",
      value: 4,
    });
  });

  it("should post 'attack' param message on setAttack()", async () => {
    const comp = new CompressorNode(ctx);
    await comp.init();
    comp.setAttack(20);
    expect(comp["_node"]!.port.postMessage).toHaveBeenCalledWith({
      param: "attack",
      value: 20,
    });
  });

  it("should post 'release' param message on setRelease()", async () => {
    const comp = new CompressorNode(ctx);
    await comp.init();
    comp.setRelease(250);
    expect(comp["_node"]!.port.postMessage).toHaveBeenCalledWith({
      param: "release",
      value: 250,
    });
  });

  it("should post 'makeup' param message on setMakeup()", async () => {
    const comp = new CompressorNode(ctx);
    await comp.init();
    comp.setMakeup(3);
    expect(comp["_node"]!.port.postMessage).toHaveBeenCalledWith({
      param: "makeup",
      value: 3,
    });
  });

  it("should post 'knee' param message on setKnee()", async () => {
    const comp = new CompressorNode(ctx);
    await comp.init();
    comp.setKnee(6);
    expect(comp["_node"]!.port.postMessage).toHaveBeenCalledWith({
      param: "knee",
      value: 6,
    });
  });

  it("should set GR callback via onGainReduction", async () => {
    const comp = new CompressorNode(ctx);
    await comp.init();
    const cb = vi.fn();
    comp.onGainReduction = cb;
    // Simulate message from worklet
    const node = comp["_node"]!;
    const handler = node.port.onmessage as ((e: MessageEvent) => void) | null;
    if (handler) {
      handler(new MessageEvent("message", { data: { type: "gr", value: -3 } }));
    }
    expect(cb).toHaveBeenCalledWith(-3);
  });

  it("should disconnect on dispose()", async () => {
    const comp = new CompressorNode(ctx);
    await comp.init();
    comp.dispose();
    expect(comp["_node"]!.disconnect).toHaveBeenCalled();
  });
});
