/**
 * SaturationProcessor — AudioWorklet
 * tanh waveshaping with 4x oversampling for alias-free harmonic generation.
 * Matches src/lib/audio/dsp/saturation.ts and oversampling.ts logic.
 */
class SaturationProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._drive = 0;    // 0-100%
    this._mix = 100;    // dry/wet %
    this._enabled = true;
    // Per-channel filter state for simple 4x oversampling LP filter
    // Using a simple first-order IIR as LP anti-alias (sufficient for real-time)
    this._lpState = [0, 0]; // left, right filter state

    this.port.onmessage = (e) => {
      const { param, value } = e.data;
      if (param === 'drive') this._drive = value;
      else if (param === 'mix') this._mix = value;
      else if (param === 'enabled') this._enabled = value;
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input[0]) return true;

    const numChannels = Math.min(input.length, output.length);
    const blockSize = input[0].length;

    if (!this._enabled || this._drive === 0) {
      for (let c = 0; c < numChannels; c++) {
        output[c].set(input[c]);
      }
      return true;
    }

    // Drive factor: 0-100% maps to 1-10
    const driveFactor = 1 + (this._drive / 100) * 9;
    const norm = Math.tanh(driveFactor);
    const wetGain = this._mix / 100;
    const dryGain = 1 - wetGain;
    // LP filter coefficient for anti-alias (cutoff ≈ Nyquist/4, simple 1-pole IIR)
    // α = exp(-2π * cutoff/sampleRate) where cutoff = sampleRate/8
    const alpha = Math.exp(-2 * Math.PI * 0.125); // ≈ 0.4559

    for (let c = 0; c < numChannels; c++) {
      if (!this._lpState[c]) this._lpState[c] = 0;
      let lpState = this._lpState[c];

      for (let i = 0; i < blockSize; i++) {
        const x = input[c][i];

        // Simple 4x oversampling via linear interpolation + LP filtering
        // For each input sample, process 4 virtual samples then average
        let sum = 0;
        for (let k = 0; k < 4; k++) {
          // Linear interpolation for the 4 sub-samples
          const frac = k / 4;
          const prev = i > 0 ? input[c][i - 1] : x;
          const xUp = prev + frac * (x - prev);

          // tanh saturation
          const sat = Math.tanh(driveFactor * xUp) / norm;

          // LP filter (anti-alias at Nyquist/4)
          lpState = alpha * lpState + (1 - alpha) * sat;
          sum += lpState;
        }
        const saturated = sum / 4;
        output[c][i] = dryGain * x + wetGain * saturated;
      }
      this._lpState[c] = lpState;
    }
    return true;
  }
}

registerProcessor('saturation-processor', SaturationProcessor);
