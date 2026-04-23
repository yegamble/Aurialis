/**
 * MultibandCompressorNode — AudioWorkletNode wrapper for
 * `public/worklets/multiband-compressor-processor.js`.
 *
 * Three-band Linkwitz-Riley 4th-order crossover with independent per-band
 * dynamics, optional per-band Mid/Side mode, and an `msBalance` threshold
 * bias. Bypassed-by-default via `multibandEnabled = 0`.
 */

import type { MultibandMode } from "@/types/mastering";

export type BandName = "low" | "mid" | "high";

export interface MultibandGainReduction {
  low: number;
  mid: number;
  high: number;
}

export class MultibandCompressorNode {
  private readonly _ctx: AudioContext;
  private _node: AudioWorkletNode | null = null;
  private readonly _output: GainNode;

  onGainReduction: ((gr: MultibandGainReduction) => void) | null = null;

  constructor(ctx: AudioContext) {
    this._ctx = ctx;
    this._output = ctx.createGain();
  }

  async init(): Promise<void> {
    await this._ctx.audioWorklet.addModule(
      "/worklets/multiband-compressor-processor.js"
    );
    this._node = new AudioWorkletNode(
      this._ctx,
      "multiband-compressor-processor"
    );
    this._node.port.onmessage = (e: MessageEvent) => {
      if (e.data?.type === "gr" && this.onGainReduction) {
        const values = e.data.values as [number, number, number];
        this.onGainReduction({
          low: values[0],
          mid: values[1],
          high: values[2],
        });
      }
    };
    this._node.connect(this._output);
  }

  get input(): AudioNode {
    if (!this._node)
      throw new Error("MultibandCompressorNode: call init() first");
    return this._node;
  }

  get output(): AudioNode {
    return this._output;
  }

  /** Master bypass: 0 = bypass (bit-exact passthrough), 1 = process. */
  setEnabled(on: number): void {
    this._node?.port.postMessage({ param: "multibandEnabled", value: on });
  }

  /** Low|Mid crossover frequency (Hz). */
  setCrossLowMid(hz: number): void {
    this._node?.port.postMessage({ param: "mbCrossLowMid", value: hz });
  }

  /** Mid|High crossover frequency (Hz). */
  setCrossMidHigh(hz: number): void {
    this._node?.port.postMessage({ param: "mbCrossMidHigh", value: hz });
  }

  setBandEnabled(band: BandName, on: number): void {
    this._node?.port.postMessage({
      param: `mb${capitalize(band)}Enabled`,
      value: on,
    });
  }

  setBandSolo(band: BandName, on: number): void {
    this._node?.port.postMessage({
      param: `mb${capitalize(band)}Solo`,
      value: on,
    });
  }

  setBandThreshold(band: BandName, dB: number): void {
    this._node?.port.postMessage({
      param: `mb${capitalize(band)}Threshold`,
      value: dB,
    });
  }

  setBandRatio(band: BandName, ratio: number): void {
    this._node?.port.postMessage({
      param: `mb${capitalize(band)}Ratio`,
      value: ratio,
    });
  }

  setBandAttack(band: BandName, ms: number): void {
    this._node?.port.postMessage({
      param: `mb${capitalize(band)}Attack`,
      value: ms,
    });
  }

  setBandRelease(band: BandName, ms: number): void {
    this._node?.port.postMessage({
      param: `mb${capitalize(band)}Release`,
      value: ms,
    });
  }

  setBandMakeup(band: BandName, dB: number): void {
    this._node?.port.postMessage({
      param: `mb${capitalize(band)}Makeup`,
      value: dB,
    });
  }

  setBandMode(band: BandName, mode: MultibandMode): void {
    this._node?.port.postMessage({
      param: `mb${capitalize(band)}Mode`,
      value: mode,
    });
  }

  setBandMsBalance(band: BandName, value: number): void {
    this._node?.port.postMessage({
      param: `mb${capitalize(band)}MsBalance`,
      value,
    });
  }

  dispose(): void {
    this._node?.disconnect();
    this._output.disconnect();
  }
}

function capitalize(band: BandName): "Low" | "Mid" | "High" {
  return (band.charAt(0).toUpperCase() + band.slice(1)) as
    | "Low"
    | "Mid"
    | "High";
}
