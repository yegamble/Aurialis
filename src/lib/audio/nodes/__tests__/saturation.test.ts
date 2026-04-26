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

  it("should post 'satMode' param on setSatMode()", async () => {
    const sat = new SaturationNode(ctx);
    await sat.init();
    sat.setSatMode("tube");
    expect(sat["_node"]!.port.postMessage).toHaveBeenCalledWith({
      param: "satMode",
      value: "tube",
    });
  });

  it("should disconnect on dispose()", async () => {
    const sat = new SaturationNode(ctx);
    await sat.init();
    sat.dispose();
    expect(sat["_node"]!.disconnect).toHaveBeenCalled();
  });

  describe("setEnvelope (T7a — deep-mode envelopes)", () => {
    it("posts an envelope message on the drive param", async () => {
      const sat = new SaturationNode(ctx);
      await sat.init();
      const env: Array<readonly [number, number]> = [
        [0, 0],
        [4, 30],
      ];
      sat.setEnvelope("drive", env);
      expect(sat["_node"]!.port.postMessage).toHaveBeenCalledWith({
        param: "drive",
        envelope: env,
      });
    });

    it("clears the envelope when given an empty array", async () => {
      const sat = new SaturationNode(ctx);
      await sat.init();
      sat.setEnvelope("drive", []);
      expect(sat["_node"]!.port.postMessage).toHaveBeenCalledWith({
        param: "drive",
        envelope: [],
      });
    });

    it("preserves the existing static-value contract (regression)", async () => {
      const sat = new SaturationNode(ctx);
      await sat.init();
      sat.setDrive(40);
      expect(sat["_node"]!.port.postMessage).toHaveBeenCalledWith({
        param: "drive",
        value: 40,
      });
    });
  });
});
