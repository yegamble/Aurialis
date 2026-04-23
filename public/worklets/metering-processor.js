/**
 * MeteringProcessor — AudioWorklet
 * ITU-R BS.1770-4 LUFS measurement with K-weighting + true-peak (4× oversampled).
 * Matches src/lib/audio/dsp/lufs.ts logic; true-peak matches src/lib/audio/dsp/true-peak.ts.
 * Posts metering data at ~30Hz via port.postMessage.
 *
 * Worklet-local halfband FIR coefficients IN SYNC WITH
 * src/lib/audio/dsp/oversampling.ts HALFBAND_TAPS — verified by halfband-parity.test.ts.
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

const H_EVEN = new Float32Array(24);
for (let i = 0; i < 24; i++) H_EVEN[i] = HALFBAND_TAPS[2 * i];
const H_EVEN_LEN = 24;
const ODD_PHASE_DELAY = 11;

function createUpsamplerState() {
  return { ring: new Float32Array(H_EVEN_LEN), pos: 0 };
}

/** Single 2× halfband upsample step. Returns [even, odd] at fast rate. */
function up2xStep(state, x) {
  const ring = state.ring;
  const pos = state.pos;
  ring[pos] = x;
  let sum = 0;
  for (let k = 0; k < H_EVEN_LEN; k++) {
    const idx = (pos - k + H_EVEN_LEN) % H_EVEN_LEN;
    sum += H_EVEN[k] * ring[idx];
  }
  const even = sum * 2;
  const odd = ring[(pos - ODD_PHASE_DELAY + H_EVEN_LEN) % H_EVEN_LEN];
  state.pos = (pos + 1) % H_EVEN_LEN;
  return [even, odd];
}

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
    this._preL = new BiquadFilter(kw.pre.b0, kw.pre.b1, kw.pre.b2, kw.pre.a1, kw.pre.a2);
    this._rlbL = new BiquadFilter(kw.rlb.b0, kw.rlb.b1, kw.rlb.b2, kw.rlb.a1, kw.rlb.a2);
    this._preR = new BiquadFilter(kw.pre.b0, kw.pre.b1, kw.pre.b2, kw.pre.a1, kw.pre.a2);
    this._rlbR = new BiquadFilter(kw.rlb.b0, kw.rlb.b1, kw.rlb.b2, kw.rlb.a1, kw.rlb.a2);

    this._blockSize = Math.round(0.4 * sr);
    this._blockBuf = new Float64Array(this._blockSize);
    this._blockPos = 0;

    this._stBufSize = Math.round(3 / 0.1);
    this._stBuf = new Float64Array(this._stBufSize).fill(-Infinity);
    this._stPos = 0;

    this._gatedBlocks = [];
    this._sampleCount = 0;
    this._hopSamples = Math.round(0.1 * sr);
    this._hopAccum = 0;
    this._hopSumSq = 0;

    // True peak tracking — 4× oversampled ISP detection per channel
    this._truePeak = -Infinity;
    this._tpUpL1 = createUpsamplerState();
    this._tpUpL2 = createUpsamplerState();
    this._tpUpR1 = createUpsamplerState();
    this._tpUpR2 = createUpsamplerState();

    // Correlation (EWMA-smoothed, τ=100ms). IN SYNC WITH src/lib/audio/dsp/correlation.ts
    this._corrCoeff = Math.exp(-1 / (0.1 * sr));
    this._corrAvgLR = 0;
    this._corrAvgLL = 0;
    this._corrAvgRR = 0;
    // Hold last valid correlation during silence (matches hardware meter behavior).
    // Initialized to +1 so pre-signal state reads as neutral mono.
    this._corrLastValid = 1;
    // Peak-hold buffer: one entry per 10 samples, 500 ms window
    const peakHoldSamples = Math.round(0.5 * sr / 10) + 1;
    this._corrPeakBuf = new Float32Array(peakHoldSamples).fill(1);
    this._corrPeakPos = 0;
    this._corrPeakCommitEvery = 10; // commit once per ~10 samples (every 100ms at 1000/10)
    this._corrPeakCommitCount = 0;

    // LRA — accumulates short-term LUFS values. Ready after 30 values (3 s).
    this._lraShortTermBuf = []; // ring-like; we don't bound it to cover full-track LRA
    this._lra = 0;
    this._lraReady = false;

    this._frameCount = 0;
    this._postEvery = Math.max(1, Math.round(sr / (128 * 30)));

    this._momentaryLufs = -Infinity;
    this._shortTermLufs = -Infinity;
    this._integratedLufs = -Infinity;

    this.port.onmessage = (e) => {
      if (e.data.type === 'reset') {
        this._gatedBlocks = [];
        this._integratedLufs = -Infinity;
        this._truePeak = -Infinity;
        this._corrAvgLR = 0;
        this._corrAvgLL = 0;
        this._corrAvgRR = 0;
        this._corrPeakBuf.fill(1);
        this._corrPeakPos = 0;
        this._corrLastValid = 1;
        this._lraShortTermBuf = [];
        this._lra = 0;
        this._lraReady = false;
      }
    };
  }

  /** Compute max |oversampled|·|·|·|·| for one input sample on one channel. */
  _channelTruePeak(x, up1, up2) {
    const pair1 = up2xStep(up1, x);
    const pairA = up2xStep(up2, pair1[0]);
    const pairB = up2xStep(up2, pair1[1]);
    let tp = Math.abs(pairA[0]);
    let a = Math.abs(pairA[1]);
    if (a > tp) tp = a;
    a = Math.abs(pairB[0]);
    if (a > tp) tp = a;
    a = Math.abs(pairB[1]);
    if (a > tp) tp = a;
    return tp;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input[0]) return true;

    const numChannels = Math.min(input.length, output ? output.length : 0);
    if (output) {
      for (let c = 0; c < numChannels; c++) {
        output[c].set(input[c]);
      }
    }

    const left = input[0];
    // Mono guard — if only one channel, duplicate to right
    const right = input.length > 1 ? input[1] : input[0];
    const isMono = input.length === 1;
    const blockLen = left.length;

    for (let i = 0; i < blockLen; i++) {
      // K-weighting for LUFS
      const lk = this._rlbL.processSample(this._preL.processSample(left[i]));
      const rk = this._rlbR.processSample(this._preR.processSample(right[i]));
      const ms = lk * lk + rk * rk;
      this._hopAccum++;
      this._hopSumSq += ms;

      // True-peak: 4× oversample per channel, take max across 4 oversampled + both channels
      const tpL = this._channelTruePeak(left[i], this._tpUpL1, this._tpUpL2);
      const tpR = isMono
        ? tpL
        : this._channelTruePeak(right[i], this._tpUpR1, this._tpUpR2);
      const tp = tpL > tpR ? tpL : tpR;
      if (tp > Math.pow(10, this._truePeak / 20)) {
        this._truePeak = 20 * Math.log10(tp);
      }

      // Stereo correlation (one-pole EWMA, τ=100ms)
      const rSample = isMono ? left[i] : right[i];
      const lSample = left[i];
      const cc = this._corrCoeff;
      this._corrAvgLR = cc * this._corrAvgLR + (1 - cc) * (lSample * rSample);
      this._corrAvgLL = cc * this._corrAvgLL + (1 - cc) * (lSample * lSample);
      this._corrAvgRR = cc * this._corrAvgRR + (1 - cc) * (rSample * rSample);

      // Commit to peak-hold buffer every ~10 samples
      this._corrPeakCommitCount++;
      if (this._corrPeakCommitCount >= this._corrPeakCommitEvery) {
        this._corrPeakCommitCount = 0;
        const denom = Math.sqrt(this._corrAvgLL * this._corrAvgRR);
        let corrNow;
        if (denom < 1e-10) {
          // Silence → hold last known value (also catches fresh pre-signal state)
          corrNow = this._corrLastValid;
        } else {
          corrNow = Math.max(-1, Math.min(1, this._corrAvgLR / denom));
          this._corrLastValid = corrNow;
        }
        this._corrPeakBuf[this._corrPeakPos] = corrNow;
        this._corrPeakPos = (this._corrPeakPos + 1) % this._corrPeakBuf.length;
      }

      // 100ms hop boundary
      if (this._hopAccum >= this._hopSamples) {
        const hopMeanSq = this._hopSumSq / this._hopAccum;
        this._hopSumSq = 0;
        this._hopAccum = 0;

        this._blockBuf[this._blockPos % 4] = hopMeanSq;
        this._blockPos++;
        if (this._blockPos >= 4) {
          let sumMom = 0;
          for (let j = 0; j < 4; j++) sumMom += this._blockBuf[j];
          const momMs = sumMom / 4;
          this._momentaryLufs = momMs > 0 ? -0.691 + 10 * Math.log10(momMs) : -Infinity;
        }

        const hopLufs = hopMeanSq > 0 ? -0.691 + 10 * Math.log10(hopMeanSq) : -Infinity;
        this._stBuf[this._stPos % this._stBufSize] = hopLufs;
        this._stPos++;

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

        if (isFinite(hopLufs) && hopLufs > -70) {
          this._gatedBlocks.push(hopLufs);
          this._integratedLufs = this._computeIntegrated();
        }

        // LRA: accumulate short-term LUFS value and recompute
        if (isFinite(this._shortTermLufs)) {
          this._lraShortTermBuf.push(this._shortTermLufs);
          if (this._lraShortTermBuf.length >= 30) {
            this._lra = this._computeLRA();
            this._lraReady = true;
          }
        }
      }
    }

    this._frameCount++;
    if (this._frameCount >= this._postEvery) {
      this._frameCount = 0;
      // Current smoothed correlation (with silence-hold — IN SYNC WITH
      // src/lib/audio/dsp/correlation.ts)
      const denom = Math.sqrt(this._corrAvgLL * this._corrAvgRR);
      let correlation;
      if (denom < 1e-10) {
        correlation = this._corrLastValid;
      } else {
        correlation = Math.max(-1, Math.min(1, this._corrAvgLR / denom));
        this._corrLastValid = correlation;
      }
      // Peak-min from hold buffer
      let corrPeakMin = 1;
      for (let j = 0; j < this._corrPeakBuf.length; j++) {
        if (this._corrPeakBuf[j] < corrPeakMin) corrPeakMin = this._corrPeakBuf[j];
      }

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
        lra: this._lra,
        lraReady: this._lraReady,
        correlation,
        correlationPeakMin: corrPeakMin,
      });
    }
    return true;
  }

  _computeLRA() {
    // IN SYNC WITH src/lib/audio/dsp/lufs.ts computeLRA
    const values = this._lraShortTermBuf;
    if (values.length < 30) return 0;
    const absGated = values.filter(v => isFinite(v) && v >= -70);
    if (absGated.length === 0) return 0;
    let pow = 0;
    for (let i = 0; i < absGated.length; i++) pow += Math.pow(10, absGated[i] / 10);
    const meanPow = pow / absGated.length;
    const relGate = 10 * Math.log10(meanPow) - 20;
    const gated = absGated.filter(v => v >= relGate);
    if (gated.length === 0) return 0;
    const sorted = gated.slice().sort((a, b) => a - b);
    const percentile = (q) => {
      if (sorted.length === 1) return sorted[0];
      const idx = q * (sorted.length - 1);
      const lo = Math.floor(idx);
      const hi = Math.ceil(idx);
      if (lo === hi) return sorted[lo];
      return sorted[lo] * (1 - (idx - lo)) + sorted[hi] * (idx - lo);
    };
    return Math.max(0, percentile(0.95) - percentile(0.1));
  }

  _computeIntegrated() {
    const blocks = this._gatedBlocks;
    if (blocks.length === 0) return -Infinity;
    const meanPow = blocks.reduce((s, l) => s + Math.pow(10, l / 10), 0) / blocks.length;
    const gateDb = 10 * Math.log10(meanPow) - 10;
    const gated = blocks.filter(l => l >= gateDb);
    if (gated.length === 0) return -Infinity;
    const finalMean = gated.reduce((s, l) => s + Math.pow(10, l / 10), 0) / gated.length;
    return 10 * Math.log10(finalMean);
  }
}

registerProcessor('metering-processor', MeteringProcessor);
