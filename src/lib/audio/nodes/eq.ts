/**
 * EQNode — AudioWorkletNode wrapper for
 * `public/worklets/parametric-eq-processor.js`.
 *
 * 5-band parametric EQ with per-band sweepable frequency / Q / gain /
 * filter type, plus per-band Stereo | M/S mode with msBalance gain weighting.
 * Defaults reproduce the pre-P3 5-band topology exactly (80 Hz low-shelf,
 * 250/1k/4k Hz bells, 12 kHz high-shelf). Master bypass via
 * `parametricEqEnabled = 0` yields bit-exact passthrough.
 */

import type { EqBandMode, EqBandType } from "@/types/mastering";

export type EqBandIndex = 0 | 1 | 2 | 3 | 4;

export class EQNode {
  private readonly _ctx: AudioContext;
  private _node: AudioWorkletNode | null = null;
  private readonly _output: GainNode;

  constructor(ctx: AudioContext) {
    this._ctx = ctx;
    this._output = ctx.createGain();
  }

  async init(): Promise<void> {
    await this._ctx.audioWorklet.addModule(
      "/worklets/parametric-eq-processor.js",
    );
    this._node = new AudioWorkletNode(this._ctx, "parametric-eq-processor");
    this._node.connect(this._output);
  }

  get input(): AudioNode {
    if (!this._node) throw new Error("EQNode: call init() first");
    return this._node;
  }

  get output(): AudioNode {
    return this._output;
  }

  /** Master EQ bypass: 0 = bit-exact passthrough, 1 = process. */
  setEnabled(on: number): void {
    this._node?.port.postMessage({ param: "parametricEqEnabled", value: on });
  }

  /**
   * Backward-compatible gain setter that drives band N gain by index.
   * Band index is 0-based (0..4) matching Band 1..5 labels in the UI.
   * Routed through the legacy eq80/eq250/eq1k/eq4k/eq12k port params so that
   * existing `ui-presets.ts` offsets (warm/bright/deharsh/Add Air/etc.) work
   * unchanged.
   */
  setGain(bandIndex: EqBandIndex | number, dB: number): void {
    const legacyKeys = ["eq80", "eq250", "eq1k", "eq4k", "eq12k"] as const;
    const key = legacyKeys[bandIndex];
    if (!key) return;
    const clamped = Math.max(-12, Math.min(12, dB));
    this._node?.port.postMessage({ param: key, value: clamped });
  }

  setBandEnabled(bandIndex: EqBandIndex | number, on: number): void {
    this._node?.port.postMessage({
      param: `eqBand${bandIndex + 1}Enabled`,
      value: on,
    });
  }

  setBandFreq(bandIndex: EqBandIndex | number, hz: number): void {
    this._node?.port.postMessage({
      param: `eqBand${bandIndex + 1}Freq`,
      value: hz,
    });
  }

  setBandQ(bandIndex: EqBandIndex | number, q: number): void {
    this._node?.port.postMessage({
      param: `eqBand${bandIndex + 1}Q`,
      value: q,
    });
  }

  setBandType(bandIndex: EqBandIndex | number, type: EqBandType): void {
    this._node?.port.postMessage({
      param: `eqBand${bandIndex + 1}Type`,
      value: type,
    });
  }

  setBandMode(bandIndex: EqBandIndex | number, mode: EqBandMode): void {
    this._node?.port.postMessage({
      param: `eqBand${bandIndex + 1}Mode`,
      value: mode,
    });
  }

  setBandMsBalance(bandIndex: EqBandIndex | number, value: number): void {
    const clamped = Math.max(-1, Math.min(1, value));
    this._node?.port.postMessage({
      param: `eqBand${bandIndex + 1}MsBalance`,
      value: clamped,
    });
  }

  /** Legacy alias for callers that think in terms of a boolean EQ bypass. */
  setBypass(bypass: boolean): void {
    this.setEnabled(bypass ? 0 : 1);
  }

  /**
   * Install a deep-mode envelope on a band's gain. Routed through the legacy
   * eq80/eq250/eq1k/eq4k/eq12k port keys so it lines up with the script
   * generator's `master.eq.bandN.gain` param mapping. Pass an empty array
   * to clear. Out-of-range band indices are silently ignored.
   */
  setBandGainEnvelope(
    bandIndex: EqBandIndex | number,
    points: ReadonlyArray<readonly [number, number]>
  ): void {
    const legacyKeys = ["eq80", "eq250", "eq1k", "eq4k", "eq12k"] as const;
    const key = legacyKeys[bandIndex];
    if (!key) return;
    this._node?.port.postMessage({ param: key, envelope: points });
  }

  dispose(): void {
    this._node?.disconnect();
    this._output.disconnect();
  }
}
