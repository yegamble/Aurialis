import { describe, it, expect, beforeEach, vi } from "vitest";
import { SaturationNode } from "../saturation";

describe("SaturationNode", () => {
  let ctx: AudioContext;

  beforeEach(() => {
    ctx = new AudioContext();
  });

  it("should load the saturation worklet on init", async () => {
    const sat = new SaturationNode(ctx);
    await sat.init();
    expect(ctx.audioWorklet.addModule).toHaveBeenCalledWith(
      expect.stringContaining("saturation-processor")
    );
  });

  it("should expose input and output after init", async () => {
    const sat = new SaturationNode(ctx);
    await sat.init();
    expect(sat.input).toBeDefined();
    expect(sat.output).toBeDefined();
  });

  it("should post 'drive' param on setDrive()", async () => {
    const sat = new SaturationNode(ctx);
    await sat.init();
    sat.setDrive(50);
    expect(sat["_node"]!.port.postMessage).toHaveBeenCalledWith({
      param: "drive",
      value: 50,
    });
  });

  it("should disconnect on dispose()", async () => {
    const sat = new SaturationNode(ctx);
    await sat.init();
    sat.dispose();
    expect(sat["_node"]!.disconnect).toHaveBeenCalled();
  });
});
