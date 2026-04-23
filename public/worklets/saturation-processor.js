/**
 * SaturationProcessor — AudioWorklet
 * 4×-oversampled tanh waveshaping for alias-free harmonic generation.
 *
 * Each input sample is upsampled to 4× via cascaded halfband FIR (from
 * src/lib/audio/dsp/oversampling.ts HALFBAND_TAPS), the tanh nonlinearity
 * is applied at the 4× rate, and the result is decimated back to 1×. Aliasing
 * products drop ~40–60 dB vs the naive 1× implementation while preserving
 * passband flatness to ~18 kHz at 44.1 kHz.
 *
 * Worklet-local coefficients IN SYNC WITH src/lib/audio/dsp/oversampling.ts
 * HALFBAND_TAPS — verified by halfband-parity.test.ts.
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
const CENTER_TAP = HALFBAND_TAPS[23];
const ODD_PHASE_DELAY = 11;

function createUpsamplerState() {
  return { ring: new Float32Array(H_EVEN_LEN), pos: 0 };
}

function createDownsamplerState() {
  return {
    ringE: new Float32Array(H_EVEN_LEN),
    posE: 0,
    ringO: new Float32Array(ODD_PHASE_DELAY + 1),
    posO: 0,
  };
}

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

function down2xStep(state, xEven, xOdd) {
  const ringE = state.ringE;
  const posE = state.posE;
  ringE[posE] = xEven;
  let sum = 0;
  for (let k = 0; k < H_EVEN_LEN; k++) {
    const idx = (posE - k + H_EVEN_LEN) % H_EVEN_LEN;
    sum += H_EVEN[k] * ringE[idx];
  }
  state.posE = (posE + 1) % H_EVEN_LEN;

  const ringO = state.ringO;
  const posO = state.posO;
  const oldOdd = ringO[posO];
  ringO[posO] = xOdd;
  state.posO = (posO + 1) % (ODD_PHASE_DELAY + 1);

  return sum + CENTER_TAP * oldOdd;
}

/** DF-II transposed biquad state. IN SYNC WITH src/lib/audio/dsp/biquad.ts. */
function createBiquadState() {
  return { z1: 0, z2: 0 };
}

function biquadStep(state, coeffs, x) {
  const y = coeffs.b0 * x + state.z1;
  state.z1 = coeffs.b1 * x - coeffs.a1 * y + state.z2;
  state.z2 = coeffs.b2 * x - coeffs.a2 * y;
  return y;
}

// IN SYNC WITH src/lib/audio/dsp/sat-modes.ts — constants and biquad builders
const TUBE_BIAS = 0.1;
const TAPE_HF_FREQ_HZ = 12000;
const TAPE_HF_GAIN_DB = -3;
const XFMR_MID_FREQ_HZ = 1500;
const XFMR_MID_GAIN_DB = 2;
const XFMR_MID_Q = 1.2;
const TUBE_DC_HPF_HZ = 20;

function highShelfCoeffsInline(fc, dBGain, S, fs) {
  const A = Math.pow(10, dBGain / 40);
  const omega = (2 * Math.PI * fc) / fs;
  const sinO = Math.sin(omega);
  const cosO = Math.cos(omega);
  const alpha = (sinO / 2) * Math.sqrt((A + 1 / A) * (1 / S - 1) + 2);
  const sqrtA2 = 2 * Math.sqrt(A) * alpha;
  const Ap1 = A + 1;
  const Am1 = A - 1;
  const a0 = Ap1 - Am1 * cosO + sqrtA2;
  return {
    b0: (A * (Ap1 + Am1 * cosO + sqrtA2)) / a0,
    b1: (-2 * A * (Am1 + Ap1 * cosO)) / a0,
    b2: (A * (Ap1 + Am1 * cosO - sqrtA2)) / a0,
    a1: (2 * (Am1 - Ap1 * cosO)) / a0,
    a2: (Ap1 - Am1 * cosO - sqrtA2) / a0,
  };
}

function peakingCoeffsInline(fc, dBGain, Q, fs) {
  const A = Math.pow(10, dBGain / 40);
  const omega = (2 * Math.PI * fc) / fs;
  const sinO = Math.sin(omega);
  const cosO = Math.cos(omega);
  const alpha = sinO / (2 * Q);
  const a0 = 1 + alpha / A;
  return {
    b0: (1 + alpha * A) / a0,
    b1: (-2 * cosO) / a0,
    b2: (1 - alpha * A) / a0,
    a1: (-2 * cosO) / a0,
    a2: (1 - alpha / A) / a0,
  };
}

function highPassCoeffsInline(fc, Q, fs) {
  const omega = (2 * Math.PI * fc) / fs;
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

class SaturationProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._drive = 0;
    this._satMode = 'clean';
    this._enabled = true;

    // Per-channel oversampler state
    this._up1 = [createUpsamplerState(), createUpsamplerState()];
    this._up2 = [createUpsamplerState(), createUpsamplerState()];
    this._down1 = [createDownsamplerState(), createDownsamplerState()];
    this._down2 = [createDownsamplerState(), createDownsamplerState()];

    // Base-rate pre-filters (applied BEFORE the oversampler — see sat-modes.ts).
    // State is preserved across mode switches so switching doesn't click.
    this._tapePre = [createBiquadState(), createBiquadState()]; // L, R
    this._xfmrPre = [createBiquadState(), createBiquadState()];
    this._tubeDcHpf = [createBiquadState(), createBiquadState()];

    // Coefficients computed once at construction (sampleRate doesn't change)
    this._tapeHfCoeffs = highShelfCoeffsInline(TAPE_HF_FREQ_HZ, TAPE_HF_GAIN_DB, 1.0, sampleRate);
    this._xfmrMidCoeffs = peakingCoeffsInline(XFMR_MID_FREQ_HZ, XFMR_MID_GAIN_DB, XFMR_MID_Q, sampleRate);
    this._tubeDcCoeffs = highPassCoeffsInline(TUBE_DC_HPF_HZ, Math.SQRT1_2, sampleRate);

    this.port.onmessage = (e) => {
      const { param, value } = e.data;
      if (param === 'drive') this._drive = value;
      else if (param === 'satMode') this._satMode = value;
      else if (param === 'enabled') this._enabled = value;
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input[0]) return true;

    const numChannels = Math.min(input.length, output.length);
    const blockSize = input[0].length;

    // Passthrough when disabled or drive is 0
    if (!this._enabled || this._drive === 0) {
      for (let c = 0; c < numChannels; c++) {
        output[c].set(input[c]);
      }
      return true;
    }

    const driveFactor = 1 + (this._drive / 100) * 9;
    const norm = Math.tanh(driveFactor);
    const mode = this._satMode;
    // Tube nominal DC trim — zero-input removal of the bias offset
    const tubeNominalDc = Math.tanh(TUBE_BIAS) / norm;

    for (let c = 0; c < numChannels; c++) {
      const u1 = this._up1[c];
      const u2 = this._up2[c];
      const d1 = this._down1[c];
      const d2 = this._down2[c];
      const tapePre = this._tapePre[c];
      const xfmrPre = this._xfmrPre[c];
      const tubeDc = this._tubeDcHpf[c];
      const inChan = input[c];
      const outChan = output[c];

      for (let i = 0; i < blockSize; i++) {
        let x = inChan[i];

        // Base-rate pre-filter
        if (mode === 'tape') {
          x = biquadStep(tapePre, this._tapeHfCoeffs, x);
        } else if (mode === 'transformer') {
          x = biquadStep(xfmrPre, this._xfmrMidCoeffs, x);
        }

        // 4x upsample
        const pair1 = up2xStep(u1, x);
        const pairA = up2xStep(u2, pair1[0]);
        const pairB = up2xStep(u2, pair1[1]);

        // Waveshape 4 samples at 4x rate
        let s0, s1, s2, s3;
        if (mode === 'clean') {
          s0 = Math.tanh(driveFactor * pairA[0]) / norm;
          s1 = Math.tanh(driveFactor * pairA[1]) / norm;
          s2 = Math.tanh(driveFactor * pairB[0]) / norm;
          s3 = Math.tanh(driveFactor * pairB[1]) / norm;
        } else if (mode === 'tube') {
          s0 = Math.tanh(driveFactor * pairA[0] + TUBE_BIAS) / norm - tubeNominalDc;
          s1 = Math.tanh(driveFactor * pairA[1] + TUBE_BIAS) / norm - tubeNominalDc;
          s2 = Math.tanh(driveFactor * pairB[0] + TUBE_BIAS) / norm - tubeNominalDc;
          s3 = Math.tanh(driveFactor * pairB[1] + TUBE_BIAS) / norm - tubeNominalDc;
        } else if (mode === 'tape') {
          s0 = tapeShape(pairA[0], driveFactor);
          s1 = tapeShape(pairA[1], driveFactor);
          s2 = tapeShape(pairB[0], driveFactor);
          s3 = tapeShape(pairB[1], driveFactor);
        } else {
          // 'transformer'
          s0 = xfmrShape(pairA[0], driveFactor);
          s1 = xfmrShape(pairA[1], driveFactor);
          s2 = xfmrShape(pairB[0], driveFactor);
          s3 = xfmrShape(pairB[1], driveFactor);
        }

        // 4x downsample
        const y0 = down2xStep(d2, s0, s1);
        const y1 = down2xStep(d2, s2, s3);
        let out = down2xStep(d1, y0, y1);

        // Tube post-HPF at 20 Hz to remove DC drift on asymmetric content
        if (mode === 'tube') {
          out = biquadStep(tubeDc, this._tubeDcCoeffs, out);
        }

        outChan[i] = out;
      }
    }
    return true;
  }
}

// Waveshaper formulas IN SYNC WITH src/lib/audio/dsp/sat-modes.ts
function tapeShape(x, driveFactor) {
  const t = driveFactor * x;
  const abs = Math.abs(t);
  return t / Math.pow(1 + Math.pow(abs, 1.5), 1 / 1.5);
}

function xfmrShape(x, driveFactor) {
  const t = driveFactor * x;
  const a = Math.abs(t);
  if (a <= 1) return t * (1 - (a * a) / 3);
  return Math.sign(t) * (2 / 3);
}

registerProcessor('saturation-processor', SaturationProcessor);
