/**
 * MeteringProcessor — AudioWorklet
 * ITU-R BS.1770-4 LUFS measurement with K-weighting + true peak.
 * Matches src/lib/audio/dsp/lufs.ts logic.
 * Posts metering data at ~30Hz via port.postMessage.
 */

/** Biquad filter — Direct Form II Transposed */
class BiquadFilter {
  constructor(b0, b1, b2, a1, a2) {
    this.b0 = b0; this.b1 = b1; this.b2 = b2;
    this.a1 = a1; this.a2 = a2;
    this.z1 = 0; this.z2 = 0;
  }
  processSample(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

/** K-weighting coefficients for a given sample rate */
function makeKWeighting(fs) {
  // Pre-filter: high shelf +4dB at fc=1500Hz, S=1
  const fc1 = 1500, dB = 4.0, S = 1.0;
  const A = Math.pow(10, dB / 40);
  const w1 = 2 * Math.PI * fc1 / fs;
  const s1 = Math.sin(w1), c1 = Math.cos(w1);
  const alpha1 = s1 / 2 * Math.sqrt((A + 1/A) * (1/S - 1) + 2);
  const sqrtA2 = 2 * Math.sqrt(A) * alpha1;
  const Ap1 = A + 1, Am1 = A - 1;
  const a0p = Ap1 - Am1 * c1 + sqrtA2;
  const pre = {
    b0: A * (Ap1 + Am1 * c1 + sqrtA2) / a0p,
    b1: -2 * A * (Am1 + Ap1 * c1) / a0p,
    b2: A * (Ap1 + Am1 * c1 - sqrtA2) / a0p,
    a1: 2 * (Am1 - Ap1 * c1) / a0p,
    a2: (Ap1 - Am1 * c1 - sqrtA2) / a0p,
  };

  // RLB: 2nd-order Butterworth HPF at fc=38.135Hz, Q=0.7071
  const fc2 = 38.135, Q = 0.7071;
  const w2 = 2 * Math.PI * fc2 / fs;
  const s2 = Math.sin(w2), c2 = Math.cos(w2);
  const alpha2 = s2 / (2 * Q);
  const a0r = 1 + alpha2;
  const rlb = {
    b0: (1 + c2) / 2 / a0r,
    b1: -(1 + c2) / a0r,
    b2: (1 + c2) / 2 / a0r,
    a1: -2 * c2 / a0r,
    a2: (1 - alpha2) / a0r,
  };
  return { pre, rlb };
}

class MeteringProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    const sr = sampleRate;
    const kw = makeKWeighting(sr);
    // Two K-weighting filter chains (left, right)
    this._preL = new BiquadFilter(kw.pre.b0, kw.pre.b1, kw.pre.b2, kw.pre.a1, kw.pre.a2);
    this._rlbL = new BiquadFilter(kw.rlb.b0, kw.rlb.b1, kw.rlb.b2, kw.rlb.a1, kw.rlb.a2);
    this._preR = new BiquadFilter(kw.pre.b0, kw.pre.b1, kw.pre.b2, kw.pre.a1, kw.pre.a2);
    this._rlbR = new BiquadFilter(kw.rlb.b0, kw.rlb.b1, kw.rlb.b2, kw.rlb.a1, kw.rlb.a2);

    // Momentary block (400ms)
    this._blockSize = Math.round(0.4 * sr);
    this._blockBuf = new Float64Array(this._blockSize);
    this._blockPos = 0;

    // Short-term buffer (3s) — ring buffer of momentary values
    this._stBufSize = Math.round(3 / 0.1); // 30 values (100ms hop)
    this._stBuf = new Float64Array(this._stBufSize).fill(-Infinity);
    this._stPos = 0;

    // Integrated measurement
    this._gatedBlocks = []; // LUFS values of all passing blocks
    this._sampleCount = 0;
    this._hopSamples = Math.round(0.1 * sr); // 100ms hop
    this._hopAccum = 0;
    this._hopSumSq = 0;

    // True peak tracking
    this._truePeak = -Infinity;

    // Post rate: every N frames
    this._frameCount = 0;
    this._postEvery = Math.max(1, Math.round(sr / (128 * 30))); // ~30Hz

    // Current metering state
    this._momentaryLufs = -Infinity;
    this._shortTermLufs = -Infinity;
    this._integratedLufs = -Infinity;

    this.port.onmessage = (e) => {
      if (e.data.type === 'reset') {
        this._gatedBlocks = [];
        this._integratedLufs = -Infinity;
        this._truePeak = -Infinity;
      }
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input[0]) return true;

    // Pass through (metering is side-chain, not in-line)
    const numChannels = Math.min(input.length, output ? output.length : 0);
    if (output) {
      for (let c = 0; c < numChannels; c++) {
        output[c].set(input[c]);
      }
    }

    const left = input[0];
    const right = input.length > 1 ? input[1] : input[0];
    const blockLen = left.length;

    for (let i = 0; i < blockLen; i++) {
      // Apply K-weighting
      const lk = this._rlbL.processSample(this._preL.processSample(left[i]));
      const rk = this._rlbR.processSample(this._preR.processSample(right[i]));

      // Per-sample mean square (BS.1770: sum_i G_i * z_i, G=1 for L and R)
      const ms = lk * lk + rk * rk;
      this._hopAccum++;
      this._hopSumSq += ms;

      // True peak (simple peak detection on K-weighted signal)
      const absPeak = Math.max(Math.abs(left[i]), Math.abs(right[i]));
      if (absPeak > Math.pow(10, this._truePeak / 20)) {
        this._truePeak = 20 * Math.log10(absPeak);
      }

      // 100ms hop boundary
      if (this._hopAccum >= this._hopSamples) {
        const hopMeanSq = this._hopSumSq / this._hopAccum;
        this._hopSumSq = 0;
        this._hopAccum = 0;

        // Momentary (400ms window = 4 hops of 100ms with 75% overlap using ring buffer)
        this._blockBuf[this._blockPos % 4] = hopMeanSq;
        this._blockPos++;
        if (this._blockPos >= 4) {
          let sumMom = 0;
          for (let j = 0; j < 4; j++) sumMom += this._blockBuf[j];
          const momMs = sumMom / 4;
          this._momentaryLufs = momMs > 0 ? -0.691 + 10 * Math.log10(momMs) : -Infinity;
        }

        // Store in short-term ring buffer
        const hopLufs = hopMeanSq > 0 ? -0.691 + 10 * Math.log10(hopMeanSq) : -Infinity;
        this._stBuf[this._stPos % this._stBufSize] = hopLufs;
        this._stPos++;

        // Short-term (3s = 30 hops)
        if (this._stPos >= this._stBufSize) {
          let sumSt = 0, cnt = 0;
          for (let j = 0; j < this._stBufSize; j++) {
            if (isFinite(this._stBuf[j])) {
              sumSt += Math.pow(10, this._stBuf[j] / 10);
              cnt++;
            }
          }
          this._shortTermLufs = cnt > 0 ? 10 * Math.log10(sumSt / cnt) : -Infinity;
        }

        // Integrated gating: add block if above absolute gate (-70 LUFS)
        if (isFinite(hopLufs) && hopLufs > -70) {
          this._gatedBlocks.push(hopLufs);
          // Recompute integrated with relative gate
          this._integratedLufs = this._computeIntegrated();
        }
      }
    }

    // Post metering data at ~30Hz
    this._frameCount++;
    if (this._frameCount >= this._postEvery) {
      this._frameCount = 0;
      this.port.postMessage({
        type: 'metering',
        lufs: this._momentaryLufs,
        shortTermLufs: this._shortTermLufs,
        integratedLufs: this._integratedLufs,
        truePeak: this._truePeak,
        dynamicRange: isFinite(this._shortTermLufs) && isFinite(this._truePeak)
          ? this._truePeak - this._shortTermLufs
          : 0,
        leftLevel: Math.abs(input[0][blockLen - 1]),
        rightLevel: Math.abs((input[1] || input[0])[blockLen - 1]),
      });
    }
    return true;
  }

  _computeIntegrated() {
    const blocks = this._gatedBlocks;
    if (blocks.length === 0) return -Infinity;
    // Relative gate: mean power - 10 LU
    const meanPow = blocks.reduce((s, l) => s + Math.pow(10, l / 10), 0) / blocks.length;
    const gateDb = 10 * Math.log10(meanPow) - 10;
    const gated = blocks.filter(l => l >= gateDb);
    if (gated.length === 0) return -Infinity;
    const finalMean = gated.reduce((s, l) => s + Math.pow(10, l / 10), 0) / gated.length;
    return 10 * Math.log10(finalMean);
  }
}

registerProcessor('metering-processor', MeteringProcessor);
