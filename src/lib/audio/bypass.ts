/**
 * AudioBypass — A/B comparison toggle for the entire processing chain.
 * When active: inputGain connects directly to outputGain (bypassing chain).
 * When inactive: normal chain routing is active.
 */

interface ChainLike {
  input: AudioNode;
  output: AudioNode;
}

export class AudioBypass {
  private readonly _inputGain: GainNode;
  private readonly _chain: ChainLike;
  private readonly _outputGain: GainNode;
  private _active = false;

  constructor(inputGain: GainNode, chain: ChainLike, outputGain: GainNode) {
    this._inputGain = inputGain;
    this._chain = chain;
    this._outputGain = outputGain;
  }

  get isActive(): boolean {
    return this._active;
  }

  /** Activate bypass: route inputGain directly to outputGain */
  enable(): void {
    if (this._active) return;
    this._active = true;
    try {
      // Disconnect chain from input, connect direct path
      this._inputGain.disconnect(this._chain.input);
    } catch {
      // May already be disconnected
    }
    try {
      this._inputGain.connect(this._outputGain);
    } catch {
      // May already be connected
    }
  }

  /** Deactivate bypass: restore chain routing */
  disable(): void {
    if (!this._active) return;
    this._active = false;
    try {
      this._inputGain.disconnect(this._outputGain);
    } catch {
      // May already be disconnected
    }
    try {
      this._inputGain.connect(this._chain.input);
    } catch {
      // May already be connected
    }
  }

  /** Toggle bypass state */
  toggle(): void {
    if (this._active) {
      this.disable();
    } else {
      this.enable();
    }
  }
}
