import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ProcessingChain } from "../chain";

describe("ProcessingChain", () => {
  let ctx: AudioContext;
  let chain: ProcessingChain;

  beforeEach(() => {
    ctx = new AudioContext();
  });

  afterEach(() => {
    chain?.dispose();
  });

  it("should build and expose input/output nodes after init", async () => {
    chain = new ProcessingChain(ctx);
    await chain.init();
    expect(chain.input).toBeDefined();
    expect(chain.output).toBeDefined();
  });

  it("should load all 4 worklets during init", async () => {
    chain = new ProcessingChain(ctx);
    await chain.init();
    expect(ctx.audioWorklet.addModule).toHaveBeenCalledTimes(4);
    const calls = (ctx.audioWorklet.addModule as ReturnType<typeof vi.fn>).mock.calls;
    const paths = calls.map((c: unknown[]) => c[0] as string);
    expect(paths.some((p) => p.includes("compressor"))).toBe(true);
    expect(paths.some((p) => p.includes("limiter"))).toBe(true);
    expect(paths.some((p) => p.includes("saturation"))).toBe(true);
    expect(paths.some((p) => p.includes("metering"))).toBe(true);
  });

  it("should fallback gracefully when worklet loading fails", async () => {
    (ctx.audioWorklet.addModule as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("AudioWorklet not supported")
    );
    chain = new ProcessingChain(ctx);
    // Should not throw even if addModule rejects
    await expect(chain.init()).resolves.not.toThrow();
    expect(chain.processingAvailable).toBe(false);
  });

  it("should update EQ band gain via updateParam('eq80', value)", async () => {
    chain = new ProcessingChain(ctx);
    await chain.init();
    expect(() => chain.updateParam("eq80", 6)).not.toThrow();
    expect(() => chain.updateParam("eq250", -3)).not.toThrow();
    expect(() => chain.updateParam("eq1k", 0)).not.toThrow();
    expect(() => chain.updateParam("eq4k", 3)).not.toThrow();
    expect(() => chain.updateParam("eq12k", -6)).not.toThrow();
  });

  it("should update compressor params", async () => {
    chain = new ProcessingChain(ctx);
    await chain.init();
    expect(() => chain.updateParam("threshold", -18)).not.toThrow();
    expect(() => chain.updateParam("ratio", 4)).not.toThrow();
    expect(() => chain.updateParam("attack", 20)).not.toThrow();
    expect(() => chain.updateParam("release", 250)).not.toThrow();
    expect(() => chain.updateParam("makeup", 3)).not.toThrow();
  });

  it("should update limiter ceiling", async () => {
    chain = new ProcessingChain(ctx);
    await chain.init();
    expect(() => chain.updateParam("ceiling", -1)).not.toThrow();
    expect(() => chain.updateParam("limiterRelease", 100)).not.toThrow();
  });

  it("should update saturation drive", async () => {
    chain = new ProcessingChain(ctx);
    await chain.init();
    expect(() => chain.updateParam("satDrive", 50)).not.toThrow();
  });

  it("should update stereo width params", async () => {
    chain = new ProcessingChain(ctx);
    await chain.init();
    expect(() => chain.updateParam("stereoWidth", 100)).not.toThrow();
    expect(() => chain.updateParam("bassMonoFreq", 200)).not.toThrow();
    expect(() => chain.updateParam("midGain", 0)).not.toThrow();
    expect(() => chain.updateParam("sideGain", 0)).not.toThrow();
  });

  it("should set onMetering callback for metering data", async () => {
    chain = new ProcessingChain(ctx);
    await chain.init();
    const cb = vi.fn();
    expect(() => {
      chain.onMetering = cb;
    }).not.toThrow();
  });

  it("should dispose without throwing", async () => {
    chain = new ProcessingChain(ctx);
    await chain.init();
    expect(() => chain.dispose()).not.toThrow();
  });
});
