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

class SaturationProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._drive = 0;
    this._enabled = true;

    // Per-channel oversampler state
    this._up1 = [createUpsamplerState(), createUpsamplerState()];
    this._up2 = [createUpsamplerState(), createUpsamplerState()];
    this._down1 = [createDownsamplerState(), createDownsamplerState()];
    this._down2 = [createDownsamplerState(), createDownsamplerState()];

    this.port.onmessage = (e) => {
      const { param, value } = e.data;
      if (param === 'drive') this._drive = value;
      else if (param === 'enabled') this._enabled = value;
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input[0]) return true;

    const numChannels = Math.min(input.length, output.length);
    const blockSize = input[0].length;

    // Passthrough when disabled or drive is 0 (perf-critical bypass)
    if (!this._enabled || this._drive === 0) {
      for (let c = 0; c < numChannels; c++) {
        output[c].set(input[c]);
      }
      return true;
    }

    const driveFactor = 1 + (this._drive / 100) * 9;
    const norm = Math.tanh(driveFactor);

    for (let c = 0; c < numChannels; c++) {
      const u1 = this._up1[c];
      const u2 = this._up2[c];
      const d1 = this._down1[c];
      const d2 = this._down2[c];
      const inChan = input[c];
      const outChan = output[c];

      for (let i = 0; i < blockSize; i++) {
        const x = inChan[i];

        const pair1 = up2xStep(u1, x);
        const pairA = up2xStep(u2, pair1[0]);
        const pairB = up2xStep(u2, pair1[1]);

        const s0 = Math.tanh(driveFactor * pairA[0]) / norm;
        const s1 = Math.tanh(driveFactor * pairA[1]) / norm;
        const s2 = Math.tanh(driveFactor * pairB[0]) / norm;
        const s3 = Math.tanh(driveFactor * pairB[1]) / norm;

        const y0 = down2xStep(d2, s0, s1);
        const y1 = down2xStep(d2, s2, s3);
        outChan[i] = down2xStep(d1, y0, y1);
      }
    }
    return true;
  }
}

registerProcessor('saturation-processor', SaturationProcessor);
