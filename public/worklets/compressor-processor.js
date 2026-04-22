/**
 * CompressorProcessor — AudioWorklet
 * Envelope follower + gain computer + attack/release smoothing + makeup gain.
 * Matches src/lib/audio/dsp/compressor.ts and src/lib/audio/dsp/envelope.ts logic.
 *
 * Detector path: (L+R)/2 → 2nd-order Butterworth sidechain HPF → |·| → envelope
 *   followed by gain computer. Audio path bypasses the HPF — only the
 *   detector sees the high-passed signal. See src/lib/audio/dsp/sidechain-filter.ts
 *   for the canonical TS reference implementation.
 */
class CompressorProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Default params
    this._threshold = -18; // dBFS
    this._ratio = 4;
    this._attack = 0.020;  // seconds
    this._release = 0.250; // seconds
    this._knee = 6;        // dB
    this._makeup = 0;      // dB
    this._sidechainHpfHz = 100; // sidechain HPF cutoff in Hz
    this._enabled = true;

    // State
    this._envelope = 0;    // current envelope level (linear)
    this._gr = 0;          // current gain reduction (dB)
    this._frameCount = 0;  // for 30Hz throttle

    // Sidechain HPF state — DF-II transposed biquad on (L+R)/2 mid signal.
    // Coefficients recomputed whenever _sidechainHpfHz changes.
    // Keep in sync with src/lib/audio/dsp/biquad.ts highPassCoeffs() (Q=1/√2).
    this._scHpfZ1 = 0;
    this._scHpfZ2 = 0;
    this._scCoeffs = this._computeScCoeffs(this._sidechainHpfHz);

    this.port.onmessage = (e) => {
      const { param, value } = e.data;
      if (param === 'threshold') this._threshold = value;
      else if (param === 'ratio') this._ratio = value;
      else if (param === 'attack') this._attack = value / 1000; // ms → s
      else if (param === 'release') this._release = value / 1000;
      else if (param === 'knee') this._knee = value;
      else if (param === 'makeup') this._makeup = value;
      else if (param === 'enabled') this._enabled = value;
      else if (param === 'sidechainHpfHz') {
        this._sidechainHpfHz = value;
        this._scCoeffs = this._computeScCoeffs(value);
      }
    };
  }

  /**
   * Compute 2nd-order Butterworth HPF biquad coefficients.
   * Matches highPassCoeffs(fc, 1/√2, sampleRate) in src/lib/audio/dsp/biquad.ts.
   */
  _computeScCoeffs(fc) {
    const Q = Math.SQRT1_2; // Butterworth
    const omega = (2 * Math.PI * fc) / sampleRate;
    const sinO = Math.sin(omega);
    const cosO = Math.cos(omega);
    const alpha = sinO / (2 * Q);
    const a0 = 1 + alpha;
    return {
      b0: (1 + cosO) / 2 / a0,
      b1: -(1 + cosO) / a0,
      b2: (1 + cosO) / 2 / a0,
      a1: (-2 * cosO) / a0,
      a2: (1 - alpha) / a0,
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input[0]) return true;

    const sr = sampleRate;
    const attackCoeff = Math.exp(-1 / (this._attack * sr));
    const releaseCoeff = Math.exp(-1 / (this._release * sr));
    const makeupLin = Math.pow(10, this._makeup / 20);
    const numChannels = Math.min(input.length, output.length);
    const blockSize = input[0].length;

    if (!this._enabled) {
      for (let c = 0; c < numChannels; c++) {
        output[c].set(input[c]);
      }
      return true;
    }

    const { b0, b1, b2, a1, a2 } = this._scCoeffs;

    for (let i = 0; i < blockSize; i++) {
      // Mono guard: if only one channel, duplicate it. Never compute (L + undefined)/2.
      const l = input[0][i];
      const r = input.length > 1 ? input[1][i] : l;
      const mid = (l + r) * 0.5;

      // Apply sidechain HPF (DF-II transposed biquad) to the mid detector signal
      const y = b0 * mid + this._scHpfZ1;
      this._scHpfZ1 = b1 * mid - a1 * y + this._scHpfZ2;
      this._scHpfZ2 = b2 * mid - a2 * y;
      const level = Math.abs(y);

      // Envelope follower (peak with attack/release)
      if (level > this._envelope) {
        this._envelope = attackCoeff * this._envelope + (1 - attackCoeff) * level;
      } else {
        this._envelope = releaseCoeff * this._envelope + (1 - releaseCoeff) * level;
      }

      // Convert to dB
      const inputDb = this._envelope > 0 ? 20 * Math.log10(this._envelope) : -120;

      // Gain computer
      const gr = this._computeGainReduction(inputDb);

      // Apply gain reduction to all channels of the AUDIO path (not HPF'd)
      const gainLin = Math.pow(10, gr / 20) * makeupLin;
      for (let c = 0; c < numChannels; c++) {
        output[c][i] = input[c][i] * gainLin;
      }
      this._gr = gr;
    }

    // Post gain reduction data at ~30Hz (every 45 blocks at 44.1kHz / 128 samples = ~30Hz)
    if (this._frameCount % 45 === 0) {
      this.port.postMessage({ type: 'gr', value: this._gr });
    }
    this._frameCount++;
    return true;
  }

  _computeGainReduction(inputDb) {
    const { _threshold: threshold, _ratio: ratio, _knee: knee } = this;
    const halfKnee = knee / 2;
    const overshoot = inputDb - threshold;

    if (knee > 0 && overshoot >= -halfKnee && overshoot <= halfKnee) {
      const x = overshoot + halfKnee;
      const r = ratio === Infinity ? 1e10 : ratio;
      return (1 / r - 1) * (x * x) / (2 * knee);
    }
    if (overshoot <= -halfKnee) return 0;
    if (ratio === Infinity) return -overshoot;
    return overshoot * (1 / ratio - 1);
  }
}

registerProcessor('compressor-processor', CompressorProcessor);
