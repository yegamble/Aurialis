/**
 * MeteringNode — AudioWorkletNode wrapper for metering-processor.js
 * ITU-R BS.1770-4 LUFS metering with true peak and dynamic range.
 * Receives metering data at ~30Hz via port.onmessage.
 */

export interface MeteringMessage {
  type: "metering";
  lufs: number;
  shortTermLufs: number;
  integratedLufs: number;
  truePeak: number;
  dynamicRange: number;
  leftLevel: number;
  rightLevel: number;
  lra: number;
  lraReady: boolean;
  correlation: number;
  correlationPeakMin: number;
}

export class MeteringNode {
  private readonly _ctx: AudioContext;
  private _node: AudioWorkletNode | null = null;
  private readonly _output: GainNode;

  onMetering: ((data: MeteringMessage) => void) | null = null;

  constructor(ctx: AudioContext) {
    this._ctx = ctx;
    this._output = ctx.createGain();
  }

  async init(): Promise<void> {
    await this._ctx.audioWorklet.addModule("/worklets/metering-processor.js");
    this._node = new AudioWorkletNode(this._ctx, "metering-processor");
    this._node.port.onmessage = (e: MessageEvent) => {
      if (e.data.type === "metering" && this.onMetering) {
        this.onMetering(e.data as MeteringMessage);
      }
    };
    this._node.connect(this._output);
  }

  get input(): AudioNode {
    if (!this._node) throw new Error("MeteringNode: call init() first");
    return this._node;
  }

  get output(): AudioNode {
    return this._output;
  }

  /** Reset integrated LUFS measurement */
  reset(): void {
    this._node?.port.postMessage({ type: "reset" });
  }

  dispose(): void {
    this._node?.disconnect();
    this._output.disconnect();
  }
}
