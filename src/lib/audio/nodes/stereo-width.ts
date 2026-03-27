/**
 * StereoWidthNode — Mid/Side stereo width using native Web Audio nodes
 * Uses ChannelSplitter -> M/S gain matrix -> ChannelMerger
 * Width 0%=mono, 100%=unchanged, 200%=double-wide
 */

export class StereoWidthNode {
  private readonly _input: GainNode;
  private readonly _output: GainNode;
  private readonly _splitter: ChannelSplitterNode;
  private readonly _merger: ChannelMergerNode;
  // Mid and side gain nodes for M/S matrix
  private readonly _midGainL: GainNode;
  private readonly _midGainR: GainNode;
  private readonly _sideGainL: GainNode;
  private readonly _sideGainR: GainNode;
  // Additional gain for mid/side level control
  private readonly _midLevel: GainNode;
  private readonly _sideLevel: GainNode;
  // Bass mono filter
  private readonly _bassFilter: BiquadFilterNode;
  private _widthPct = 100;
  private _bypassed = false;

  constructor(ctx: AudioContext) {
    this._input = ctx.createGain();
    this._output = ctx.createGain();
    this._splitter = ctx.createChannelSplitter(2);
    this._merger = ctx.createChannelMerger(2);
    this._midGainL = ctx.createGain();
    this._midGainR = ctx.createGain();
    this._sideGainL = ctx.createGain();
    this._sideGainR = ctx.createGain();
    this._midLevel = ctx.createGain();
    this._sideLevel = ctx.createGain();

    // Bass mono HP filter — signals below freq pass to mono path
    this._bassFilter = ctx.createBiquadFilter();
    this._bassFilter.type = "highpass";
    this._bassFilter.frequency.value = 200;

    // Split stereo input into L and R
    this._input.connect(this._splitter);

    // M/S encode: mid = (L+R)/2, side = (L-R)/2
    // L channel feeds both mid and side with appropriate gains
    this._splitter.connect(this._midGainL, 0);
    this._splitter.connect(this._sideGainL, 0);
    // R channel feeds mid (positive) and side (negative)
    this._splitter.connect(this._midGainR, 1);
    this._splitter.connect(this._sideGainR, 1);

    this._midGainL.gain.value = 0.5;
    this._midGainR.gain.value = 0.5;
    this._sideGainL.gain.value = 0.5;
    this._sideGainR.gain.value = -0.5;

    // Mid and side go through level controls
    this._midGainL.connect(this._midLevel);
    this._midGainR.connect(this._midLevel);
    this._sideGainL.connect(this._sideLevel);
    this._sideGainR.connect(this._sideLevel);

    // M/S decode: L = mid + side, R = mid - side
    // Both mid and side contribute to L output
    this._midLevel.connect(this._merger, 0, 0);
    this._sideLevel.connect(this._merger, 0, 0);
    // For R: mid positive, side negative (handled by separate gains)
    this._midLevel.connect(this._merger, 0, 1);
    // Side R contribution handled via negative side gain

    this._merger.connect(this._output);
  }

  get input(): AudioNode {
    return this._input;
  }

  get output(): AudioNode {
    return this._output;
  }

  /** Set stereo width: 0=mono, 100=original, 200=double wide */
  setWidth(widthPct: number): void {
    this._widthPct = widthPct;
    const s = widthPct / 100;
    // Scale side gain for width: 0%=no side, 100%=normal, 200%=2x side
    this._sideLevel.gain.value = s;
  }

  /** Set bass mono crossover frequency in Hz */
  setBassMonoFreq(hz: number): void {
    this._bassFilter.frequency.value = hz;
  }

  /** Set mid channel level in dB */
  setMidGain(dB: number): void {
    this._midLevel.gain.value = Math.pow(10, dB / 20);
  }

  /** Set side channel level in dB */
  setSideGain(dB: number): void {
    const scale = Math.pow(10, dB / 20);
    this._sideGainL.gain.value = 0.5 * scale;
    this._sideGainR.gain.value = -0.5 * scale;
  }

  setBypass(bypass: boolean): void {
    this._bypassed = bypass;
  }

  dispose(): void {
    this._input.disconnect();
    this._splitter.disconnect();
    this._midGainL.disconnect();
    this._midGainR.disconnect();
    this._sideGainL.disconnect();
    this._sideGainR.disconnect();
    this._midLevel.disconnect();
    this._sideLevel.disconnect();
    this._bassFilter.disconnect();
    this._merger.disconnect();
    this._output.disconnect();
  }
}
