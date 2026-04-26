/**
 * SaturationNode — AudioWorkletNode wrapper for saturation-processor.js
 * tanh waveshaping with 4x oversampling + four character modes (clean/tube/tape/transformer).
 */

import type { SaturationMode } from "@/types/mastering";

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

  /** Set saturation character mode. */
  setSatMode(mode: SaturationMode): void {
    this._node?.port.postMessage({ param: "satMode", value: mode });
  }

  setBypass(bypass: boolean): void {
    this._node?.port.postMessage({ param: "enabled", value: !bypass });
  }

  /**
   * Install a deep-mode envelope on the drive param. Pass an empty array
   * to clear and revert to the last static value. Per-block evaluation +
   * one-pole smoother in the worklet (Spike S2).
   */
  setEnvelope(
    param: "drive",
    points: ReadonlyArray<readonly [number, number]>
  ): void {
    this._node?.port.postMessage({ param, envelope: points });
  }

  dispose(): void {
    this._node?.disconnect();
    this._output.disconnect();
  }
}
