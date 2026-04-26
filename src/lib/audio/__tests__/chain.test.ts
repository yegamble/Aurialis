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

  it("should load all 7 worklets during init (incl. multiband-compressor + parametric-eq + ai-repair)", async () => {
    chain = new ProcessingChain(ctx);
    await chain.init();
    expect(ctx.audioWorklet.addModule).toHaveBeenCalledTimes(7);
    const calls = (ctx.audioWorklet.addModule as ReturnType<typeof vi.fn>).mock.calls;
    const paths = calls.map((c: unknown[]) => c[0] as string);
    expect(paths.some((p) => p.includes("compressor-processor"))).toBe(true);
    expect(paths.some((p) => p.includes("multiband-compressor-processor"))).toBe(true);
    expect(paths.some((p) => p.includes("limiter"))).toBe(true);
    expect(paths.some((p) => p.includes("saturation"))).toBe(true);
    expect(paths.some((p) => p.includes("metering"))).toBe(true);
    expect(paths.some((p) => p.includes("parametric-eq-processor"))).toBe(true);
    expect(paths.some((p) => p.includes("ai-repair-processor"))).toBe(true);
  });

  it("should route all parametric EQ params without throwing", async () => {
    chain = new ProcessingChain(ctx);
    await chain.init();
    expect(() => chain.updateParam("parametricEqEnabled", 1)).not.toThrow();
    for (let b = 1; b <= 5; b++) {
      expect(() => chain.updateParam(`eqBand${b}Enabled` as never, 1)).not.toThrow();
      expect(() => chain.updateParam(`eqBand${b}Freq` as never, 1000)).not.toThrow();
      expect(() => chain.updateParam(`eqBand${b}Q` as never, 1.5)).not.toThrow();
      expect(() =>
        chain.updateParam(`eqBand${b}Type` as never, "bell" as never),
      ).not.toThrow();
      expect(() =>
        chain.updateParam(`eqBand${b}Mode` as never, "ms" as never),
      ).not.toThrow();
      expect(() =>
        chain.updateParam(`eqBand${b}MsBalance` as never, 0.5),
      ).not.toThrow();
    }
  });

  it("should route all multiband params without throwing", async () => {
    chain = new ProcessingChain(ctx);
    await chain.init();
    expect(() => chain.updateParam("multibandEnabled", 1)).not.toThrow();
    expect(() => chain.updateParam("mbCrossLowMid", 180)).not.toThrow();
    expect(() => chain.updateParam("mbCrossMidHigh", 2200)).not.toThrow();
    for (const band of ["Low", "Mid", "High"] as const) {
      expect(() => chain.updateParam(`mb${band}Enabled` as const, 1)).not.toThrow();
      expect(() => chain.updateParam(`mb${band}Solo` as const, 0)).not.toThrow();
      expect(() => chain.updateParam(`mb${band}Threshold` as const, -20)).not.toThrow();
      expect(() => chain.updateParam(`mb${band}Ratio` as const, 3)).not.toThrow();
      expect(() => chain.updateParam(`mb${band}Attack` as const, 15)).not.toThrow();
      expect(() => chain.updateParam(`mb${band}Release` as const, 150)).not.toThrow();
      expect(() => chain.updateParam(`mb${band}Makeup` as const, 2)).not.toThrow();
      expect(() => chain.updateParam(`mb${band}Mode` as const, "ms")).not.toThrow();
      expect(() => chain.updateParam(`mb${band}MsBalance` as const, -0.3)).not.toThrow();
    }
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
