/**
 * LimiterNode — AudioWorkletNode wrapper for limiter-processor.js
 * Brick-wall lookahead limiter with true peak detection.
 */

export class LimiterNode {
  private readonly _ctx: AudioContext;
  private _node: AudioWorkletNode | null = null;
  private readonly _output: GainNode;

  onGainReduction: ((gr: number) => void) | null = null;

  constructor(ctx: AudioContext) {
    this._ctx = ctx;
    this._output = ctx.createGain();
  }

  async init(): Promise<void> {
    await this._ctx.audioWorklet.addModule("/worklets/limiter-processor.js");
    this._node = new AudioWorkletNode(this._ctx, "limiter-processor");
    this._node.port.onmessage = (e: MessageEvent) => {
      if (e.data.type === "gr" && this.onGainReduction) {
        this.onGainReduction(e.data.value as number);
      }
    };
    this._node.connect(this._output);
  }

  get input(): AudioNode {
    if (!this._node) throw new Error("LimiterNode: call init() first");
    return this._node;
  }

  get output(): AudioNode {
    return this._output;
  }

  setCeiling(dBTP: number): void {
    this._node?.port.postMessage({ param: "ceiling", value: dBTP });
  }

  setRelease(ms: number): void {
    this._node?.port.postMessage({ param: "release", value: ms });
  }

  setBypass(bypass: boolean): void {
    this._node?.port.postMessage({ param: "enabled", value: !bypass });
  }

  /**
   * Install a deep-mode envelope on a limiter parameter (ceiling, release).
   * Pass an empty array to clear and revert to the last static value.
   * Per-block evaluation + one-pole smoother in the worklet (Spike S2).
   */
  setEnvelope(
    param: "ceiling" | "release",
    points: ReadonlyArray<readonly [number, number]>
  ): void {
    this._node?.port.postMessage({ param, envelope: points });
  }

  dispose(): void {
    this._node?.disconnect();
    this._output.disconnect();
  }
}
