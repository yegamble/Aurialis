import { describe, it, expect, beforeEach, vi } from "vitest";
import { LimiterNode } from "../limiter";

describe("LimiterNode", () => {
  let ctx: AudioContext;

  beforeEach(() => {
    ctx = new AudioContext();
  });

  it("should load the limiter worklet on init", async () => {
    const lim = new LimiterNode(ctx);
    await lim.init();
    expect(ctx.audioWorklet.addModule).toHaveBeenCalledWith(
      expect.stringContaining("limiter-processor")
    );
  });

  it("should expose input and output after init", async () => {
    const lim = new LimiterNode(ctx);
    await lim.init();
    expect(lim.input).toBeDefined();
    expect(lim.output).toBeDefined();
  });

  it("should post 'ceiling' param on setCeiling()", async () => {
    const lim = new LimiterNode(ctx);
    await lim.init();
    lim.setCeiling(-1);
    expect(lim["_node"]!.port.postMessage).toHaveBeenCalledWith({
      param: "ceiling",
      value: -1,
    });
  });

  it("should post 'release' param on setRelease()", async () => {
    const lim = new LimiterNode(ctx);
    await lim.init();
    lim.setRelease(100);
    expect(lim["_node"]!.port.postMessage).toHaveBeenCalledWith({
      param: "release",
      value: 100,
    });
  });

  it("should call onGainReduction callback when worklet posts 'gr' message", async () => {
    const lim = new LimiterNode(ctx);
    await lim.init();
    const cb = vi.fn();
    lim.onGainReduction = cb;
    const handler = lim["_node"]!.port.onmessage as ((e: MessageEvent) => void) | null;
    if (handler) {
      handler(new MessageEvent("message", { data: { type: "gr", value: -2 } }));
    }
    expect(cb).toHaveBeenCalledWith(-2);
  });

  it("should disconnect on dispose()", async () => {
    const lim = new LimiterNode(ctx);
    await lim.init();
    lim.dispose();
    expect(lim["_node"]!.disconnect).toHaveBeenCalled();
  });
});
