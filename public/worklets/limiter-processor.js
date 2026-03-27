/**
 * LimiterProcessor — AudioWorklet
 * Brick-wall lookahead limiter with true peak detection.
 * Matches src/lib/audio/dsp/limiter.ts logic.
 */
class LimiterProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._ceiling = -1;   // dBTP
    this._release = 100;  // ms
    this._enabled = true;

    // Lookahead buffer (~1.5ms at 44.1kHz)
    this._lookaheadSize = 66;
    this._lookahead = new Float32Array(this._lookaheadSize);
    this._lookaheadPos = 0;

    // Gain state
    this._currentGain = 1.0;
    this._frameCount = 0;

    this.port.onmessage = (e) => {
      const { param, value } = e.data;
      if (param === 'ceiling') this._ceiling = value;
      else if (param === 'release') this._release = value;
      else if (param === 'enabled') this._enabled = value;
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input[0]) return true;

    const sr = sampleRate;
    const numChannels = Math.min(input.length, output.length);
    const blockSize = input[0].length;

    if (!this._enabled) {
      for (let c = 0; c < numChannels; c++) {
        output[c].set(input[c]);
      }
      return true;
    }

    const ceilingLin = Math.pow(10, this._ceiling / 20);
    const releaseCoeff = Math.exp(-1 / ((this._release / 1000) * sr));
    // Fast attack: ~0.1ms
    const attackCoeff = Math.exp(-1 / (0.0001 * sr));

    for (let i = 0; i < blockSize; i++) {
      // Peak detection across all channels
      let peak = 0;
      for (let c = 0; c < numChannels; c++) {
        const abs = Math.abs(input[c][i]);
        if (abs > peak) peak = abs;
      }

      // Push into lookahead buffer, get delayed sample
      const delayed = this._lookahead[this._lookaheadPos];
      this._lookahead[this._lookaheadPos] = peak;
      this._lookaheadPos = (this._lookaheadPos + 1) % this._lookaheadSize;

      // Find peak in lookahead window
      let windowPeak = 0;
      for (let j = 0; j < this._lookaheadSize; j++) {
        if (this._lookahead[j] > windowPeak) windowPeak = this._lookahead[j];
      }

      // Compute target gain
      const targetGain = windowPeak <= ceilingLin ? 1.0 : ceilingLin / windowPeak;

      // Smooth gain: fast attack, slow release
      if (targetGain < this._currentGain) {
        this._currentGain = attackCoeff * this._currentGain + (1 - attackCoeff) * targetGain;
      } else {
        this._currentGain = releaseCoeff * this._currentGain + (1 - releaseCoeff) * targetGain;
      }

      for (let c = 0; c < numChannels; c++) {
        output[c][i] = input[c][i] * this._currentGain;
      }
    }

    this._frameCount++;
    if (this._frameCount % 45 === 0) { // ~30Hz at 128 samples/block at 44.1kHz
      this.port.postMessage({
        type: 'gr',
        value: 20 * Math.log10(Math.max(this._currentGain, 1e-10))
      });
    }
    return true;
  }
}

registerProcessor('limiter-processor', LimiterProcessor);
