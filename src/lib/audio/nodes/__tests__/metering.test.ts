import { describe, it, expect, beforeEach, vi } from "vitest";
import { MeteringNode } from "../metering";

describe("MeteringNode", () => {
  let ctx: AudioContext;

  beforeEach(() => {
    ctx = new AudioContext();
  });

  it("should load the metering worklet on init", async () => {
    const meter = new MeteringNode(ctx);
    await meter.init();
    expect(ctx.audioWorklet.addModule).toHaveBeenCalledWith(
      expect.stringContaining("metering-processor")
    );
  });

  it("should expose input and output after init", async () => {
    const meter = new MeteringNode(ctx);
    await meter.init();
    expect(meter.input).toBeDefined();
    expect(meter.output).toBeDefined();
  });

  it("should call onMetering callback when worklet posts 'metering' message", async () => {
    const meter = new MeteringNode(ctx);
    await meter.init();
    const cb = vi.fn();
    meter.onMetering = cb;
    const meteringData = {
      type: "metering",
      lufs: -23,
      shortTermLufs: -22,
      integratedLufs: -23,
      truePeak: -1,
      dynamicRange: 22,
      leftLevel: 0.1,
      rightLevel: 0.1,
    };
    const handler = meter["_node"]!.port.onmessage as ((e: MessageEvent) => void) | null;
    if (handler) {
      handler(new MessageEvent("message", { data: meteringData }));
    }
    expect(cb).toHaveBeenCalledWith(meteringData);
  });

  it("should post 'reset' message on reset()", async () => {
    const meter = new MeteringNode(ctx);
    await meter.init();
    meter.reset();
    expect(meter["_node"]!.port.postMessage).toHaveBeenCalledWith({ type: "reset" });
  });

  it("should disconnect on dispose()", async () => {
    const meter = new MeteringNode(ctx);
    await meter.init();
    meter.dispose();
    expect(meter["_node"]!.disconnect).toHaveBeenCalled();
  });
});
