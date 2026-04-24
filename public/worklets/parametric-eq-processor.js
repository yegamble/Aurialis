/**
 * ParametricEqProcessor — AudioWorklet
 * 5-band parametric EQ: per-band freq / Q / gain / type / mode / msBalance.
 *
 * Canonical reference: src/lib/audio/dsp/parametric-eq.ts
 * Biquad math:         src/lib/audio/dsp/biquad.ts
 *
 * Every formula duplicated here carries an `// IN SYNC WITH` comment pointing
 * to the canonical source. Parity is enforced by
 * src/lib/audio/dsp/__tests__/parametric-eq-parity.test.ts.
 *
 * Default state: parametricEqEnabled = 1 (process). Per-band enabled = 1.
 * Master bypass (`parametricEqEnabled = 0`) is true passthrough: bit-exact
 * memcpy of input → output, no filter state updates.
 *
 * Band filter shapes (see EqBandType):
 *   bell       — peaking (freq, Q, gain dB)
 *   lowShelf   — low-shelf (freq, gain dB; S=1 fixed Butterworth slope)
 *   highShelf  — high-shelf (freq, gain dB; S=1)
 *   highPass   — 2nd-order HPF (freq, Q; gain ignored)
 *   lowPass    — 2nd-order LPF (freq, Q; gain ignored)
 *
 * Mode semantics:
 *   stereo → L and R each run through one biquad (coeffsA = coeffsB)
 *   ms     → M and S each run through one biquad with gain weighted by msBalance:
 *              weight_M = msBalance >= 0 ? 1 : (1 + msBalance)
 *              weight_S = msBalance <= 0 ? 1 : (1 - msBalance)
 */

const EQ_BAND_COUNT = 5;

// IN SYNC WITH src/lib/audio/dsp/biquad.ts peakingCoeffs
function peakingCoeffs(fc, dBGain, Q, fs) {
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

// IN SYNC WITH src/lib/audio/dsp/biquad.ts lowShelfCoeffs (S argument)
function lowShelfCoeffs(fc, dBGain, S, fs) {
  const A = Math.pow(10, dBGain / 40);
  const omega = (2 * Math.PI * fc) / fs;
  const sinO = Math.sin(omega);
  const cosO = Math.cos(omega);
  const alpha = (sinO / 2) * Math.sqrt((A + 1 / A) * (1 / S - 1) + 2);
  const sqrtA2 = 2 * Math.sqrt(A) * alpha;
  const Ap1 = A + 1;
  const Am1 = A - 1;
  const a0 = Ap1 + Am1 * cosO + sqrtA2;
  return {
    b0: (A * (Ap1 - Am1 * cosO + sqrtA2)) / a0,
    b1: (2 * A * (Am1 - Ap1 * cosO)) / a0,
    b2: (A * (Ap1 - Am1 * cosO - sqrtA2)) / a0,
    a1: (-2 * (Am1 + Ap1 * cosO)) / a0,
    a2: (Ap1 + Am1 * cosO - sqrtA2) / a0,
  };
}

// IN SYNC WITH src/lib/audio/dsp/biquad.ts highShelfCoeffs (S argument)
function highShelfCoeffs(fc, dBGain, S, fs) {
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

// IN SYNC WITH src/lib/audio/dsp/biquad.ts highPassCoeffs
function highPassCoeffs(fc, Q, fs) {
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

// IN SYNC WITH src/lib/audio/dsp/biquad.ts lowPassCoeffs
function lowPassCoeffs(fc, Q, fs) {
  const omega = (2 * Math.PI * fc) / fs;
  const sinO = Math.sin(omega);
  const cosO = Math.cos(omega);
  const alpha = sinO / (2 * Q);
  const a0 = 1 + alpha;
  return {
    b0: (1 - cosO) / 2 / a0,
    b1: (1 - cosO) / a0,
    b2: (1 - cosO) / 2 / a0,
    a1: (-2 * cosO) / a0,
    a2: (1 - alpha) / a0,
  };
}

// IN SYNC WITH src/lib/audio/dsp/parametric-eq.ts buildCoeffs
function buildCoeffs(type, freq, gainDb, q, fs) {
  switch (type) {
    case "bell":
      return peakingCoeffs(freq, gainDb, q, fs);
    case "lowShelf":
      return lowShelfCoeffs(freq, gainDb, 1.0, fs);
    case "highShelf":
      return highShelfCoeffs(freq, gainDb, 1.0, fs);
    case "highPass":
      return highPassCoeffs(freq, q, fs);
    case "lowPass":
      return lowPassCoeffs(freq, q, fs);
    default:
      return { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };
  }
}

class ParametricEqProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._enabled = 1;
    this._parametricEqEnabled = 1;

    this._bands = [];
    for (let i = 0; i < EQ_BAND_COUNT; i++) {
      this._bands.push(this._makeBandDefaults(i));
    }

    this.port.onmessage = (e) => {
      const { param, value } = e.data;
      this._handleParam(param, value);
    };
  }

  _makeBandDefaults(i) {
    // IN SYNC WITH src/lib/audio/presets.ts DEFAULT_PARAMS eqBand{N} defaults
    const defaults = [
      { freq: 80, q: 0.7071067811865476, type: "lowShelf" },
      { freq: 250, q: 1.0, type: "bell" },
      { freq: 1000, q: 1.0, type: "bell" },
      { freq: 4000, q: 1.0, type: "bell" },
      { freq: 12000, q: 0.7071067811865476, type: "highShelf" },
    ];
    return {
      enabled: 1,
      freq: defaults[i].freq,
      q: defaults[i].q,
      gain: 0,
      type: defaults[i].type,
      mode: "stereo",
      msBalance: 0,
      // Filter state — Direct Form II Transposed
      zA1: 0,
      zA2: 0,
      zB1: 0,
      zB2: 0,
      coeffsA: { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 },
      coeffsB: { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 },
      dirty: true,
    };
  }

  _handleParam(param, value) {
    if (param === "parametricEqEnabled") {
      this._parametricEqEnabled = value;
      return;
    }
    if (param === "enabled") {
      this._enabled = value;
      return;
    }

    // Legacy eq80/eq250/eq1k/eq4k/eq12k → Band 1..5 gain
    const legacyMap = {
      eq80: 0,
      eq250: 1,
      eq1k: 2,
      eq4k: 3,
      eq12k: 4,
    };
    if (Object.prototype.hasOwnProperty.call(legacyMap, param)) {
      const bi = legacyMap[param];
      this._bands[bi].gain = value;
      this._bands[bi].dirty = true;
      return;
    }

    // eqBand{N}{Suffix} per-band params
    const match = /^eqBand([1-5])(Enabled|Freq|Q|Type|Mode|MsBalance)$/.exec(param);
    if (!match) return;
    const bi = parseInt(match[1], 10) - 1;
    const suffix = match[2];
    const band = this._bands[bi];
    const prevMode = band.mode;
    switch (suffix) {
      case "Enabled":
        band.enabled = value;
        break;
      case "Freq":
        band.freq = value;
        band.dirty = true;
        break;
      case "Q":
        band.q = value;
        band.dirty = true;
        break;
      case "Type":
        band.type = value;
        band.dirty = true;
        break;
      case "Mode":
        band.mode = value;
        band.dirty = true;
        // Reset state when mode changes to avoid a click from reinterpreting L/R ↔ M/S.
        if (prevMode !== band.mode) {
          band.zA1 = 0; band.zA2 = 0; band.zB1 = 0; band.zB2 = 0;
        }
        break;
      case "MsBalance":
        band.msBalance = value;
        band.dirty = true;
        break;
    }
  }

  // IN SYNC WITH src/lib/audio/dsp/parametric-eq.ts _ensureCoeffs
  _refreshCoeffs(band) {
    if (!band.dirty) return;
    let gainA;
    let gainB;
    if (band.mode === "stereo") {
      gainA = band.gain;
      gainB = band.gain;
    } else {
      // ms: weight gain per channel via msBalance.
      const weightM = band.msBalance >= 0 ? 1 : 1 + band.msBalance;
      const weightS = band.msBalance <= 0 ? 1 : 1 - band.msBalance;
      gainA = band.gain * weightM;
      gainB = band.gain * weightS;
    }
    band.coeffsA = buildCoeffs(band.type, band.freq, gainA, band.q, sampleRate);
    band.coeffsB = buildCoeffs(band.type, band.freq, gainB, band.q, sampleRate);
    band.dirty = false;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input[0]) return true;

    const numChannels = Math.min(input.length, output.length);
    const blockSize = input[0].length;

    // True bypass: worklet disabled OR master EQ off.
    if (!this._enabled || this._parametricEqEnabled <= 0) {
      for (let c = 0; c < numChannels; c++) {
        output[c].set(input[c]);
      }
      return true;
    }

    const isMono = numChannels < 2;
    const inL = input[0];
    const inR = isMono ? input[0] : input[1];
    const outL = output[0];
    const outR = numChannels > 1 ? output[1] : null;

    // Copy input to output before chaining bands (in-place after first band).
    outL.set(inL);
    if (outR) outR.set(inR);

    for (let bi = 0; bi < EQ_BAND_COUNT; bi++) {
      const band = this._bands[bi];
      if (!band.enabled) continue;
      this._refreshCoeffs(band);
      if (isMono || band.mode === "stereo") {
        this._processStereoBand(band, outL, outR, blockSize);
      } else {
        this._processMsBand(band, outL, outR, blockSize);
      }
    }
    return true;
  }

  // IN SYNC WITH src/lib/audio/dsp/parametric-eq.ts _processStereoBand
  _processStereoBand(band, L, R, n) {
    const cA = band.coeffsA;
    const cB = band.coeffsB;
    let zA1 = band.zA1;
    let zA2 = band.zA2;
    let zB1 = band.zB1;
    let zB2 = band.zB2;
    const hasR = R !== null;
    for (let i = 0; i < n; i++) {
      const xL = L[i];
      const yL = cA.b0 * xL + zA1;
      zA1 = cA.b1 * xL - cA.a1 * yL + zA2;
      zA2 = cA.b2 * xL - cA.a2 * yL;
      L[i] = yL;
      if (hasR) {
        const xR = R[i];
        const yR = cB.b0 * xR + zB1;
        zB1 = cB.b1 * xR - cB.a1 * yR + zB2;
        zB2 = cB.b2 * xR - cB.a2 * yR;
        R[i] = yR;
      }
    }
    band.zA1 = zA1;
    band.zA2 = zA2;
    band.zB1 = zB1;
    band.zB2 = zB2;
  }

  // IN SYNC WITH src/lib/audio/dsp/parametric-eq.ts _processMsBand
  _processMsBand(band, L, R, n) {
    const cM = band.coeffsA;
    const cS = band.coeffsB;
    let zM1 = band.zA1;
    let zM2 = band.zA2;
    let zS1 = band.zB1;
    let zS2 = band.zB2;
    for (let i = 0; i < n; i++) {
      const l = L[i];
      const r = R[i];
      const m = (l + r) * 0.5;
      const s = (l - r) * 0.5;
      const yM = cM.b0 * m + zM1;
      zM1 = cM.b1 * m - cM.a1 * yM + zM2;
      zM2 = cM.b2 * m - cM.a2 * yM;
      const yS = cS.b0 * s + zS1;
      zS1 = cS.b1 * s - cS.a1 * yS + zS2;
      zS2 = cS.b2 * s - cS.a2 * yS;
      L[i] = yM + yS;
      R[i] = yM - yS;
    }
    band.zA1 = zM1;
    band.zA2 = zM2;
    band.zB1 = zS1;
    band.zB2 = zS2;
  }
}

registerProcessor("parametric-eq-processor", ParametricEqProcessor);
