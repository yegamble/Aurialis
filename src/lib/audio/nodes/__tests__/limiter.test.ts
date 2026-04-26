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

  describe("setEnvelope (T7a — deep-mode envelopes)", () => {
    it("posts an envelope message on the ceiling param", async () => {
      const lim = new LimiterNode(ctx);
      await lim.init();
      const env: Array<readonly [number, number]> = [
        [0, -1],
        [10, -0.5],
      ];
      lim.setEnvelope("ceiling", env);
      expect(lim["_node"]!.port.postMessage).toHaveBeenCalledWith({
        param: "ceiling",
        envelope: env,
      });
    });

    it("posts an envelope message on the release param", async () => {
      const lim = new LimiterNode(ctx);
      await lim.init();
      lim.setEnvelope("release", [
        [0, 50],
        [5, 200],
      ]);
      expect(lim["_node"]!.port.postMessage).toHaveBeenCalledWith({
        param: "release",
        envelope: [
          [0, 50],
          [5, 200],
        ],
      });
    });

    it("clears the envelope when given an empty array", async () => {
      const lim = new LimiterNode(ctx);
      await lim.init();
      lim.setEnvelope("ceiling", []);
      expect(lim["_node"]!.port.postMessage).toHaveBeenCalledWith({
        param: "ceiling",
        envelope: [],
      });
    });

    it("preserves the existing static-value contract (regression)", async () => {
      const lim = new LimiterNode(ctx);
      await lim.init();
      lim.setCeiling(-2);
      expect(lim["_node"]!.port.postMessage).toHaveBeenCalledWith({
        param: "ceiling",
        value: -2,
      });
    });
  });
});
