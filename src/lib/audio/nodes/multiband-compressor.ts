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

/** Minimum separation (Hz) the node enforces between the two crossovers. */
const MIN_BAND_HZ = 50;

export class MultibandCompressorNode {
  private readonly _ctx: AudioContext;
  private _node: AudioWorkletNode | null = null;
  private readonly _output: GainNode;

  // Last-set crossover frequencies (defaults match DEFAULT_PARAMS). Tracked so
  // the node can enforce low|mid < mid|high even if a caller (or a future UI
  // without its own clamp) sends out-of-order values — defense in depth.
  private _crossLowMid = 200;
  private _crossMidHigh = 2000;

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

  /** Low|Mid crossover frequency (Hz). Clamped to stay below Mid|High. */
  setCrossLowMid(hz: number): void {
    const clamped = Math.min(hz, this._crossMidHigh - MIN_BAND_HZ);
    this._crossLowMid = clamped;
    this._node?.port.postMessage({ param: "mbCrossLowMid", value: clamped });
  }

  /** Mid|High crossover frequency (Hz). Clamped to stay above Low|Mid. */
  setCrossMidHigh(hz: number): void {
    const clamped = Math.max(hz, this._crossLowMid + MIN_BAND_HZ);
    this._crossMidHigh = clamped;
    this._node?.port.postMessage({ param: "mbCrossMidHigh", value: clamped });
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

  /**
   * Install a deep-mode envelope on a per-band parameter (threshold or makeup).
   * Pass an empty array to clear and revert to the last static value.
   * Per-block evaluation + one-pole smoother in the worklet (Spike S2).
   */
  setBandEnvelope(
    band: BandName,
    param: "threshold" | "makeup",
    points: ReadonlyArray<readonly [number, number]>
  ): void {
    const wireParam = `mb${capitalize(band)}${param === "threshold" ? "Threshold" : "Makeup"}`;
    this._node?.port.postMessage({ param: wireParam, envelope: points });
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
