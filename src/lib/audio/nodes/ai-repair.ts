/**
 * AiRepairNode — AudioWorkletNode wrapper for `public/worklets/ai-repair-processor.js`.
 *
 * Restores stereo width on AI-generated narrow guitars (e.g., Suno output)
 * via an M/S widener. Single `amount` parameter (0–100 %); 0 = bit-exact
 * bypass. T11 fills in the harmonic exciter inside the same node + worklet.
 */

export class AiRepairNode {
  private readonly _ctx: AudioContext;
  private _node: AudioWorkletNode | null = null;
  private readonly _output: GainNode;

  constructor(ctx: AudioContext) {
    this._ctx = ctx;
    this._output = ctx.createGain();
  }

  async init(): Promise<void> {
    await this._ctx.audioWorklet.addModule("/worklets/ai-repair-processor.js");
    this._node = new AudioWorkletNode(this._ctx, "ai-repair-processor");
    this._node.connect(this._output);
  }

  get input(): AudioNode {
    if (!this._node) throw new Error("AiRepairNode: call init() first");
    return this._node;
  }

  get output(): AudioNode {
    return this._output;
  }

  /** Set repair amount (0–100). 0 is bit-exact bypass. */
  setAmount(pct: number): void {
    this._node?.port.postMessage({ param: "amount", value: pct });
  }

  setBypass(bypass: boolean): void {
    this._node?.port.postMessage({ param: "enabled", value: !bypass });
  }

  /**
   * Install a deep-mode envelope on the amount parameter. Pass an empty
   * array to clear and revert to the last static value.
   */
  setEnvelope(
    param: "amount",
    points: ReadonlyArray<readonly [number, number]>,
  ): void {
    this._node?.port.postMessage({ param, envelope: points });
  }

  dispose(): void {
    this._node?.disconnect();
    this._output.disconnect();
  }
}
