import { describe, it, expect, beforeEach } from "vitest";
import { AiRepairNode } from "../ai-repair";

describe("AiRepairNode", () => {
  let ctx: AudioContext;

  beforeEach(() => {
    ctx = new AudioContext();
  });

  it("loads the ai-repair worklet on init()", async () => {
    const ar = new AiRepairNode(ctx);
    await ar.init();
    expect(ctx.audioWorklet.addModule).toHaveBeenCalledWith(
      expect.stringContaining("ai-repair-processor"),
    );
  });

  it("exposes input/output after init()", async () => {
    const ar = new AiRepairNode(ctx);
    await ar.init();
    expect(ar.input).toBeDefined();
    expect(ar.output).toBeDefined();
  });

  it("throws if input is accessed before init()", () => {
    const ar = new AiRepairNode(ctx);
    expect(() => ar.input).toThrow(/call init\(\) first/);
  });

  it("posts the amount param via setAmount()", async () => {
    const ar = new AiRepairNode(ctx);
    await ar.init();
    ar.setAmount(50);
    expect(ar["_node"]!.port.postMessage).toHaveBeenCalledWith({
      param: "amount",
      value: 50,
    });
  });

  it("posts enabled param via setBypass()", async () => {
    const ar = new AiRepairNode(ctx);
    await ar.init();
    ar.setBypass(true);
    expect(ar["_node"]!.port.postMessage).toHaveBeenCalledWith({
      param: "enabled",
      value: false,
    });
  });

  it("posts an envelope on the amount param via setEnvelope()", async () => {
    const ar = new AiRepairNode(ctx);
    await ar.init();
    const env: Array<readonly [number, number]> = [
      [0, 0],
      [5, 50],
    ];
    ar.setEnvelope("amount", env);
    expect(ar["_node"]!.port.postMessage).toHaveBeenCalledWith({
      param: "amount",
      envelope: env,
    });
  });

  it("clears the envelope when given an empty array", async () => {
    const ar = new AiRepairNode(ctx);
    await ar.init();
    ar.setEnvelope("amount", []);
    expect(ar["_node"]!.port.postMessage).toHaveBeenCalledWith({
      param: "amount",
      envelope: [],
    });
  });

  it("disconnects on dispose()", async () => {
    const ar = new AiRepairNode(ctx);
    await ar.init();
    ar.dispose();
    expect(ar["_node"]!.disconnect).toHaveBeenCalled();
  });
});
