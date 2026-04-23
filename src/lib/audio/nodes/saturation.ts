/**
 * SaturationNode — AudioWorkletNode wrapper for saturation-processor.js
 * tanh waveshaping with 4x oversampling for warm harmonic generation.
 */

export class SaturationNode {
  private readonly _ctx: AudioContext;
  private _node: AudioWorkletNode | null = null;
  private readonly _output: GainNode;

  constructor(ctx: AudioContext) {
    this._ctx = ctx;
    this._output = ctx.createGain();
  }

  async init(): Promise<void> {
    await this._ctx.audioWorklet.addModule("/worklets/saturation-processor.js");
    this._node = new AudioWorkletNode(this._ctx, "saturation-processor");
    this._node.connect(this._output);
  }

  get input(): AudioNode {
    if (!this._node) throw new Error("SaturationNode: call init() first");
    return this._node;
  }

  get output(): AudioNode {
    return this._output;
  }

  setDrive(pct: number): void {
    this._node?.port.postMessage({ param: "drive", value: pct });
  }

  setBypass(bypass: boolean): void {
    this._node?.port.postMessage({ param: "enabled", value: !bypass });
  }

  dispose(): void {
    this._node?.disconnect();
    this._output.disconnect();
  }
}
