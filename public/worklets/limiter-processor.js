/**
 * LimiterProcessor — AudioWorklet
 * Brick-wall true-peak lookahead limiter per ITU-R BS.1770-4.
 *
 * Detector: 4× polyphase-oversampled mid-channel (L+R)/2 via cascaded halfband
 * FIR upsamplers (inlined from src/lib/audio/dsp/oversampling.ts). Peak is taken
 * as max(|·|) over each sample's 4 oversampled representatives → per-sample ISP.
 *
 * Signal path: audio is delayed by `_lookaheadSize` samples via a ring buffer,
 * which is derived from sampleRate (1.5 ms baseline + 18 samples at 1x rate
 * to compensate cascaded 4× halfband group delay). At 44.1 kHz: 84 samples
 * (66 base + 18 comp). At 48 kHz: 90. At 96 kHz: 162.
 *
 * Gain reduction: fast attack (~0.1 ms) + user-configurable release. The delayed
 * audio is multiplied by the smoothed gain AFTER the detector has "seen" the
 * upcoming peak, so the reduction is in place before the peak hits the output.
 *
 * Worklet-local coefficients (IN SYNC WITH src/lib/audio/dsp/oversampling.ts
 * HALFBAND_TAPS — verified by src/lib/audio/dsp/__tests__/halfband-parity.test.ts):
 */
const HALFBAND_TAPS = new Float32Array([
  -0.00003236808784602273,
  0,
  0.00021460425686417527,
  0,
  -0.0006900036008054104,
  0,
  0.0016906510319408042,
  0,
  -0.0035394678469438633,
  0,
  0.006670847582056133,
  0,
  -0.011685384108269973,
  0,
  0.01951168258705124,
  0,
  -0.03190621204482748,
  0,
  0.05323959921792349,
  0,
  -0.0995345836294369,
  0,
  0.3160629362213828,
  0.49999539684182204,
  0.3160629362213828,
  0,
  -0.0995345836294369,
  0,
  0.05323959921792349,
  0,
  -0.03190621204482748,
  0,
  0.01951168258705124,
  0,
  -0.011685384108269973,
  0,
  0.006670847582056133,
  0,
  -0.0035394678469438633,
  0,
  0.0016906510319408042,
  0,
  -0.0006900036008054104,
  0,
  0.00021460425686417527,
  0,
  -0.00003236808784602273,
]);

// Polyphase decomposition: H_EVEN[k] = HALFBAND_TAPS[2k] for k=0..23
const H_EVEN = new Float32Array(24);
for (let i = 0; i < 24; i++) H_EVEN[i] = HALFBAND_TAPS[2 * i];
const H_EVEN_LEN = 24;
const CENTER_TAP = HALFBAND_TAPS[23];
const ODD_PHASE_DELAY = 11;

const LOOKAHEAD_MS = 1.5;
const GROUP_DELAY_COMP_1X = 18;

class LimiterProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._ceiling = -1;
    this._release = 100;
    this._enabled = true;

    // Lookahead/delay size derived from the context's sample rate
    const baseSamples = Math.round((LOOKAHEAD_MS / 1000) * sampleRate);
    this._lookaheadSize = baseSamples + GROUP_DELAY_COMP_1X;

    // Audio-path delay rings (one per channel up to stereo)
    this._audioDelayL = new Float32Array(this._lookaheadSize);
    this._audioDelayR = new Float32Array(this._lookaheadSize);
    this._audioDelayPos = 0;

    // Per-sample true-peak ring buffer
    this._tpRing = new Float32Array(this._lookaheadSize);
    this._tpRingPos = 0;

    // Halfband polyphase state for the oversampler (two 2x stages cascaded)
    this._up1Ring = new Float32Array(H_EVEN_LEN);
    this._up1Pos = 0;
    this._up2Ring = new Float32Array(H_EVEN_LEN);
    this._up2Pos = 0;

    // Gain smoothing state
    this._currentGain = 1.0;
    this._frameCount = 0;

    this.port.onmessage = (e) => {
      const { param, value } = e.data;
      if (param === 'ceiling') this._ceiling = value;
      else if (param === 'release') this._release = value;
      else if (param === 'enabled') this._enabled = value;
    };
  }

  /**
   * Single 2× halfband upsample step. Matches Halfband2xUpsampler.processSample.
   * Returns [even, odd] output samples at the fast rate; mutates the provided state.
   */
  _up2x(ring, pos, x) {
    ring[pos] = x;
    let sum = 0;
    for (let k = 0; k < H_EVEN_LEN; k++) {
      const idx = (pos - k + H_EVEN_LEN) % H_EVEN_LEN;
      sum += H_EVEN[k] * ring[idx];
    }
    const even = sum * 2;
    const odd = ring[(pos - ODD_PHASE_DELAY + H_EVEN_LEN) % H_EVEN_LEN];
    return [even, odd];
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
    const attackCoeff = Math.exp(-1 / (0.0001 * sr));

    for (let i = 0; i < blockSize; i++) {
      // Mono guard — handle mono source by duplicating the single channel
      const l = input[0][i];
      const r = input.length > 1 ? input[1][i] : l;
      const mid = (l + r) * 0.5;

      // 4× oversample the mid signal via two cascaded 2× halfband stages
      const pair1 = this._up2x(this._up1Ring, this._up1Pos, mid);
      this._up1Pos = (this._up1Pos + 1) % H_EVEN_LEN;

      const pairA = this._up2x(this._up2Ring, this._up2Pos, pair1[0]);
      this._up2Pos = (this._up2Pos + 1) % H_EVEN_LEN;

      const pairB = this._up2x(this._up2Ring, this._up2Pos, pair1[1]);
      this._up2Pos = (this._up2Pos + 1) % H_EVEN_LEN;

      // True peak across the 4 oversampled samples
      let tp = Math.abs(pairA[0]);
      let a = Math.abs(pairA[1]);
      if (a > tp) tp = a;
      a = Math.abs(pairB[0]);
      if (a > tp) tp = a;
      a = Math.abs(pairB[1]);
      if (a > tp) tp = a;

      // Store true peak in ring
      this._tpRing[this._tpRingPos] = tp;
      this._tpRingPos = (this._tpRingPos + 1) % this._lookaheadSize;

      // Store audio in delay rings and read the oldest sample (delayed output)
      const delayedL = this._audioDelayL[this._audioDelayPos];
      const delayedR = this._audioDelayR[this._audioDelayPos];
      this._audioDelayL[this._audioDelayPos] = l;
      this._audioDelayR[this._audioDelayPos] = r;
      this._audioDelayPos = (this._audioDelayPos + 1) % this._lookaheadSize;

      // Scan the TP ring for the max — this is the worst-case peak in the
      // lookahead window relative to the delayed output sample
      let windowPeak = 0;
      for (let j = 0; j < this._lookaheadSize; j++) {
        const v = this._tpRing[j];
        if (v > windowPeak) windowPeak = v;
      }

      // Target gain to keep windowPeak at the ceiling
      const targetGain = windowPeak <= ceilingLin ? 1.0 : ceilingLin / windowPeak;

      // Smooth gain: fast attack when decreasing, slow release when increasing
      if (targetGain < this._currentGain) {
        this._currentGain = attackCoeff * this._currentGain + (1 - attackCoeff) * targetGain;
      } else {
        this._currentGain = releaseCoeff * this._currentGain + (1 - releaseCoeff) * targetGain;
      }

      // Write the delayed audio × gain to all output channels
      output[0][i] = delayedL * this._currentGain;
      if (numChannels > 1) {
        output[1][i] = delayedR * this._currentGain;
      }
    }

    this._frameCount++;
    if (this._frameCount % 45 === 0) {
      this.port.postMessage({
        type: 'gr',
        value: 20 * Math.log10(Math.max(this._currentGain, 1e-10)),
      });
    }
    return true;
  }
}

registerProcessor('limiter-processor', LimiterProcessor);
