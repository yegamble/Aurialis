/**
 * EQNode — 5-band parametric EQ using native BiquadFilterNode
 * Bands: low shelf 80Hz, peaking 250Hz, 1kHz, 4kHz, high shelf 12kHz
 */

const EQ_BANDS = [
  { type: "lowshelf" as BiquadFilterType, frequency: 80 },
  { type: "peaking" as BiquadFilterType, frequency: 250 },
  { type: "peaking" as BiquadFilterType, frequency: 1000 },
  { type: "peaking" as BiquadFilterType, frequency: 4000 },
  { type: "highshelf" as BiquadFilterType, frequency: 12000 },
] as const;

export class EQNode {
  readonly bands: BiquadFilterNode[];
  private readonly _input: GainNode;
  private readonly _output: GainNode;
  private _bypassed = false;

  constructor(ctx: AudioContext) {
    this._input = ctx.createGain();
    this._output = ctx.createGain();

    this.bands = EQ_BANDS.map(({ type, frequency }) => {
      const band = ctx.createBiquadFilter();
      band.type = type;
      band.frequency.value = frequency;
      band.gain.value = 0;
      band.Q.value = 1;
      return band;
    });

    // Chain: _input -> band[0] -> ... -> band[4] -> _output
    this._input.connect(this.bands[0]);
    for (let i = 0; i < this.bands.length - 1; i++) {
      this.bands[i].connect(this.bands[i + 1]);
    }
    this.bands[this.bands.length - 1].connect(this._output);
  }

  get input(): AudioNode {
    return this._input;
  }

  get output(): AudioNode {
    return this._output;
  }

  /** Set gain for band at index (clamped to ±12 dB) */
  setGain(bandIndex: number, dB: number): void {
    const clamped = Math.max(-12, Math.min(12, dB));
    this.bands[bandIndex].gain.value = clamped;
  }

  setBypass(bypass: boolean): void {
    this._bypassed = bypass;
  }

  dispose(): void {
    this._input.disconnect();
    for (const band of this.bands) {
      band.disconnect();
    }
    this._output.disconnect();
  }
}
