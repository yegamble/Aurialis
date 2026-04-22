/**
 * CompressorNode — AudioWorkletNode wrapper for compressor-processor.js
 * Professional dynamic range compressor with configurable attack/release/ratio/knee.
 */

export class CompressorNode {
  private readonly _ctx: AudioContext;
  private _node: AudioWorkletNode | null = null;
  private readonly _output: GainNode;
  private _bypassed = false;

  onGainReduction: ((gr: number) => void) | null = null;

  constructor(ctx: AudioContext) {
    this._ctx = ctx;
    this._output = ctx.createGain();
  }

  async init(): Promise<void> {
    await this._ctx.audioWorklet.addModule("/worklets/compressor-processor.js");
    this._node = new AudioWorkletNode(this._ctx, "compressor-processor");
    this._node.port.onmessage = (e: MessageEvent) => {
      if (e.data.type === "gr" && this.onGainReduction) {
        this.onGainReduction(e.data.value as number);
      }
    };
    this._node.connect(this._output);
  }

  get input(): AudioNode {
    if (!this._node) throw new Error("CompressorNode: call init() first");
    return this._node;
  }

  get output(): AudioNode {
    return this._output;
  }

  setThreshold(dB: number): void {
    this._node?.port.postMessage({ param: "threshold", value: dB });
  }

  setRatio(ratio: number): void {
    this._node?.port.postMessage({ param: "ratio", value: ratio });
  }

  setAttack(ms: number): void {
    this._node?.port.postMessage({ param: "attack", value: ms });
  }

  setRelease(ms: number): void {
    this._node?.port.postMessage({ param: "release", value: ms });
  }

  setMakeup(dB: number): void {
    this._node?.port.postMessage({ param: "makeup", value: dB });
  }

  setKnee(dB: number): void {
    this._node?.port.postMessage({ param: "knee", value: dB });
  }

  /** Set sidechain high-pass cutoff (Hz) applied to the detector path only. */
  setSidechainHpfHz(hz: number): void {
    this._node?.port.postMessage({ param: "sidechainHpfHz", value: hz });
  }

  setBypass(bypass: boolean): void {
    this._bypassed = bypass;
    this._node?.port.postMessage({ param: "enabled", value: !bypass });
  }

  dispose(): void {
    this._node?.disconnect();
    this._output.disconnect();
  }
}
