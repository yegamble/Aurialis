/**
 * MultibandCompressorProcessor — AudioWorklet
 * Three-band Linkwitz-Riley 4th-order crossover + three compressor cores +
 * per-band optional Mid/Side mode with `msBalance` threshold biasing.
 *
 * Canonical reference: src/lib/audio/dsp/multiband.ts
 * Crossover math:     src/lib/audio/dsp/crossover.ts
 * Gain computer:      src/lib/audio/dsp/compressor.ts
 *
 * Every formula duplicated here carries an `// IN SYNC WITH` comment pointing
 * to the canonical source. Parity is enforced by
 * src/lib/audio/dsp/__tests__/multiband-parity.test.ts.
 *
 * Default state: multibandEnabled = 0 → true bypass (bit-exact passthrough,
 * no splitter, no filtering).
 */

// IN SYNC WITH src/lib/audio/dsp/multiband.ts BALANCE_RANGE_DB
const BALANCE_RANGE_DB = 6;
// IN SYNC WITH src/lib/audio/dsp/multiband.ts KNEE_DB
const KNEE_DB = 6;
// IN SYNC WITH src/lib/audio/dsp/crossover.ts BUTTERWORTH_Q
const BUTTERWORTH_Q = Math.SQRT1_2;

// IN SYNC WITH src/lib/audio/dsp/biquad.ts lowPassCoeffs (Q = 1/√2)
function lowPassCoeffs(fc, fs) {
  const omega = (2 * Math.PI * fc) / fs;
  const sinO = Math.sin(omega);
  const cosO = Math.cos(omega);
  const alpha = sinO / (2 * BUTTERWORTH_Q);
  const a0 = 1 + alpha;
  return {
    b0: ((1 - cosO) / 2) / a0,
    b1: (1 - cosO) / a0,
    b2: ((1 - cosO) / 2) / a0,
    a1: (-2 * cosO) / a0,
    a2: (1 - alpha) / a0,
  };
}

// IN SYNC WITH src/lib/audio/dsp/biquad.ts highPassCoeffs (Q = 1/√2)
function highPassCoeffs(fc, fs) {
  const omega = (2 * Math.PI * fc) / fs;
  const sinO = Math.sin(omega);
  const cosO = Math.cos(omega);
  const alpha = sinO / (2 * BUTTERWORTH_Q);
  const a0 = 1 + alpha;
  return {
    b0: ((1 + cosO) / 2) / a0,
    b1: -(1 + cosO) / a0,
    b2: ((1 + cosO) / 2) / a0,
    a1: (-2 * cosO) / a0,
    a2: (1 - alpha) / a0,
  };
}

/** LR4 lowpass = two cascaded identical Butterworth LP biquads. */
function makeLR4LP(fc, fs) {
  return {
    c: lowPassCoeffs(fc, fs),
    z1a: 0, z2a: 0, z1b: 0, z2b: 0,
  };
}
function makeLR4HP(fc, fs) {
  return {
    c: highPassCoeffs(fc, fs),
    z1a: 0, z2a: 0, z1b: 0, z2b: 0,
  };
}
function lr4Process(f, x) {
  const { b0, b1, b2, a1, a2 } = f.c;
  // Stage A
  const yA = b0 * x + f.z1a;
  f.z1a = b1 * x - a1 * yA + f.z2a;
  f.z2a = b2 * x - a2 * yA;
  // Stage B (same coefficients)
  const yB = b0 * yA + f.z1b;
  f.z1b = b1 * yA - a1 * yB + f.z2b;
  f.z2b = b2 * yA - a2 * yB;
  return yB;
}
function lr4Reset(f) {
  f.z1a = 0; f.z2a = 0; f.z1b = 0; f.z2b = 0;
}
function lr4SetCutoff(f, isLp, fc, fs) {
  f.c = isLp ? lowPassCoeffs(fc, fs) : highPassCoeffs(fc, fs);
}

/**
 * IN SYNC WITH src/lib/audio/dsp/compressor.ts computeGainReduction
 * Returns gain reduction in dB (≤ 0).
 */
function computeGainReduction(inputDb, threshold, ratio, knee) {
  const halfKnee = knee / 2;
  const overshoot = inputDb - threshold;
  if (knee > 0 && overshoot >= -halfKnee && overshoot <= halfKnee) {
    const x = overshoot + halfKnee;
    const r = ratio === Infinity ? 1e10 : ratio;
    return ((1 / r - 1) * (x * x)) / (2 * knee);
  }
  if (overshoot <= -halfKnee) return 0;
  if (ratio === Infinity) return -overshoot;
  return overshoot * (1 / ratio - 1);
}

/** IN SYNC WITH src/lib/audio/dsp/multiband.ts updateEnv */
function updateEnv(env, level, attackCoeff, releaseCoeff) {
  if (level > env) {
    return attackCoeff * env + (1 - attackCoeff) * level;
  }
  return releaseCoeff * env + (1 - releaseCoeff) * level;
}

class MultibandCompressorProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._enabled = true;
    this._multibandEnabled = 0;
    this._crossLowMid = 200;
    this._crossMidHigh = 2000;

    // Per-band params: enabled, solo, threshold, ratio, attack(s), release(s), makeup, mode, msBalance
    this._bands = {
      low:  this._makeBandDefaults(),
      mid:  this._makeBandDefaults(),
      high: this._makeBandDefaults(),
    };

    // Per-band envelope/gr state. For stereo mode: envA=L env, envB=R env.
    // For M/S mode: envA=M env, envB=S env.
    this._state = {
      low:  { envA: 0, envB: 0, lastGr: 0 },
      mid:  { envA: 0, envB: 0, lastGr: 0 },
      high: { envA: 0, envB: 0, lastGr: 0 },
    };

    // LR4 filter state per channel: 2 crossovers × 2 branches (LP/HP) × 2 channels
    // plus AP compensation on the low path.
    this._splitL = this._makeSplitter();
    this._splitR = this._makeSplitter();

    this._frameCount = 0;

    this.port.onmessage = (e) => {
      const { param, value } = e.data;
      this._handleParam(param, value);
    };
  }

  _makeBandDefaults() {
    return {
      enabled: 0,
      solo: 0,
      threshold: -18,
      ratio: 2,
      attack: 0.02,   // seconds (param received as ms → /1000 at set time)
      release: 0.25,
      makeup: 0,
      mode: "stereo",
      msBalance: 0,
    };
  }

  _makeSplitter() {
    return {
      lpLowMid:    makeLR4LP(this._crossLowMid, sampleRate),
      hpLowMid:    makeLR4HP(this._crossLowMid, sampleRate),
      lpMidHigh:   makeLR4LP(this._crossMidHigh, sampleRate),
      hpMidHigh:   makeLR4HP(this._crossMidHigh, sampleRate),
      lpMidHighAp: makeLR4LP(this._crossMidHigh, sampleRate),
      hpMidHighAp: makeLR4HP(this._crossMidHigh, sampleRate),
    };
  }

  _refreshSplitter(splitter) {
    lr4SetCutoff(splitter.lpLowMid,    true,  this._crossLowMid,  sampleRate);
    lr4SetCutoff(splitter.hpLowMid,    false, this._crossLowMid,  sampleRate);
    lr4SetCutoff(splitter.lpMidHigh,   true,  this._crossMidHigh, sampleRate);
    lr4SetCutoff(splitter.hpMidHigh,   false, this._crossMidHigh, sampleRate);
    lr4SetCutoff(splitter.lpMidHighAp, true,  this._crossMidHigh, sampleRate);
    lr4SetCutoff(splitter.hpMidHighAp, false, this._crossMidHigh, sampleRate);
  }

  _handleParam(param, value) {
    if (param === "multibandEnabled") {
      this._multibandEnabled = value;
      return;
    }
    if (param === "enabled") {
      this._enabled = value;
      return;
    }
    if (param === "mbCrossLowMid") {
      this._crossLowMid = value;
      this._refreshSplitter(this._splitL);
      this._refreshSplitter(this._splitR);
      return;
    }
    if (param === "mbCrossMidHigh") {
      this._crossMidHigh = value;
      this._refreshSplitter(this._splitL);
      this._refreshSplitter(this._splitR);
      return;
    }
    const bandName = this._bandForParam(param);
    if (!bandName) return;
    const band = this._bands[bandName];
    const suffix = param.slice(`mb${bandName[0].toUpperCase() + bandName.slice(1)}`.length);
    switch (suffix) {
      case "Enabled":   band.enabled = value; break;
      case "Solo":      band.solo = value; break;
      case "Threshold": band.threshold = value; break;
      case "Ratio":     band.ratio = value; break;
      case "Attack":    band.attack = value / 1000; break;   // ms → s
      case "Release":   band.release = value / 1000; break;  // ms → s
      case "Makeup":    band.makeup = value; break;
      case "Mode":      band.mode = value; break;
      case "MsBalance": band.msBalance = value; break;
    }
  }

  _bandForParam(param) {
    if (param.startsWith("mbLow")) return "low";
    if (param.startsWith("mbMid")) return "mid";
    if (param.startsWith("mbHigh")) return "high";
    return null;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input[0]) return true;

    const numChannels = Math.min(input.length, output.length);
    const blockSize = input[0].length;

    // True bypass: worklet disabled OR master multiband off.
    if (!this._enabled || this._multibandEnabled <= 0) {
      for (let c = 0; c < numChannels; c++) {
        output[c].set(input[c]);
      }
      // Reset metering to zero while bypassed
      this._state.low.lastGr = 0;
      this._state.mid.lastGr = 0;
      this._state.high.lastGr = 0;
      this._maybePostGr();
      return true;
    }

    const anyEnabled =
      this._bands.low.enabled > 0 ||
      this._bands.mid.enabled > 0 ||
      this._bands.high.enabled > 0;
    const anySolo =
      this._bands.low.solo > 0 ||
      this._bands.mid.solo > 0 ||
      this._bands.high.solo > 0;

    if (!anyEnabled && !anySolo) {
      for (let c = 0; c < numChannels; c++) {
        output[c].set(input[c]);
      }
      this._state.low.lastGr = 0;
      this._state.mid.lastGr = 0;
      this._state.high.lastGr = 0;
      this._maybePostGr();
      return true;
    }

    // Pre-compute per-band context (coeffs, makeup gain)
    const ctxLow  = this._bandCtx(this._bands.low);
    const ctxMid  = this._bandCtx(this._bands.mid);
    const ctxHigh = this._bandCtx(this._bands.high);

    const isMono = input.length < 2;
    const inL = input[0];
    const inR = isMono ? input[0] : input[1];
    const outL = output[0];
    const outR = numChannels > 1 ? output[1] : null;

    for (let i = 0; i < blockSize; i++) {
      const l = inL[i];
      const r = inR[i];

      const lSplit = this._splitSample(this._splitL, l);
      const rSplit = this._splitSample(this._splitR, r);

      const lowOut  = this._processBand(lSplit.low,  rSplit.low,  this._bands.low,  ctxLow,  this._state.low,  anySolo);
      const midOut  = this._processBand(lSplit.mid,  rSplit.mid,  this._bands.mid,  ctxMid,  this._state.mid,  anySolo);
      const highOut = this._processBand(lSplit.high, rSplit.high, this._bands.high, ctxHigh, this._state.high, anySolo);

      outL[i] = lowOut.l + midOut.l + highOut.l;
      if (outR) outR[i] = lowOut.r + midOut.r + highOut.r;
    }

    this._maybePostGr();
    return true;
  }

  _bandCtx(band) {
    return {
      attackCoeff: Math.exp(-1 / (Math.max(band.attack, 1e-5) * sampleRate)),
      releaseCoeff: Math.exp(-1 / (Math.max(band.release, 1e-5) * sampleRate)),
      makeupLin: Math.pow(10, band.makeup / 20),
    };
  }

  _splitSample(s, x) {
    const lowRaw = lr4Process(s.lpLowMid, x);
    const hpOnce = lr4Process(s.hpLowMid, x);
    const mid = lr4Process(s.lpMidHigh, hpOnce);
    const high = lr4Process(s.hpMidHigh, hpOnce);
    // IN SYNC WITH src/lib/audio/dsp/crossover.ts ThreeWaySplitter.process
    // Low path = AP(fcMidHigh, lowRaw) = LP(fcMidHigh) + HP(fcMidHigh)
    const low = lr4Process(s.lpMidHighAp, lowRaw) + lr4Process(s.hpMidHighAp, lowRaw);
    return { low, mid, high };
  }

  _processBand(bL, bR, params, ctx, state, anySolo) {
    if (anySolo && params.solo <= 0) {
      state.lastGr = 0;
      return { l: 0, r: 0 };
    }
    if (params.enabled <= 0) {
      state.lastGr = 0;
      return { l: bL, r: bR };
    }
    if (params.mode === "ms") {
      return this._processBandMS(bL, bR, params, ctx, state);
    }
    return this._processBandStereo(bL, bR, params, ctx, state);
  }

  _processBandStereo(bL, bR, params, ctx, state) {
    // IN SYNC WITH src/lib/audio/dsp/multiband.ts processBandStereo
    const absL = Math.abs(bL);
    const absR = Math.abs(bR);
    state.envA = updateEnv(state.envA, absL, ctx.attackCoeff, ctx.releaseCoeff);
    state.envB = updateEnv(state.envB, absR, ctx.attackCoeff, ctx.releaseCoeff);
    const env = state.envA > state.envB ? state.envA : state.envB;
    const inputDb = env > 0 ? 20 * Math.log10(env) : -120;
    const gr = computeGainReduction(inputDb, params.threshold, params.ratio, KNEE_DB);
    state.lastGr = gr;
    const gainLin = Math.pow(10, gr / 20) * ctx.makeupLin;
    return { l: bL * gainLin, r: bR * gainLin };
  }

  _processBandMS(bL, bR, params, ctx, state) {
    // IN SYNC WITH src/lib/audio/dsp/multiband.ts processBandMS
    const m = (bL + bR) * 0.5;
    const s = (bL - bR) * 0.5;
    const thrM = params.threshold + params.msBalance * BALANCE_RANGE_DB;
    const thrS = params.threshold - params.msBalance * BALANCE_RANGE_DB;
    state.envA = updateEnv(state.envA, Math.abs(m), ctx.attackCoeff, ctx.releaseCoeff);
    state.envB = updateEnv(state.envB, Math.abs(s), ctx.attackCoeff, ctx.releaseCoeff);
    const mDb = state.envA > 0 ? 20 * Math.log10(state.envA) : -120;
    const sDb = state.envB > 0 ? 20 * Math.log10(state.envB) : -120;
    const grM = computeGainReduction(mDb, thrM, params.ratio, KNEE_DB);
    const grS = computeGainReduction(sDb, thrS, params.ratio, KNEE_DB);
    state.lastGr = grM < grS ? grM : grS;
    const gainM = Math.pow(10, grM / 20) * ctx.makeupLin;
    const gainS = Math.pow(10, grS / 20) * ctx.makeupLin;
    const mOut = m * gainM;
    const sOut = s * gainS;
    return { l: mOut + sOut, r: mOut - sOut };
  }

  _maybePostGr() {
    // Throttle to ~30 Hz (every 45 blocks at 44.1 kHz / 128 samples)
    if (this._frameCount % 45 === 0) {
      this.port.postMessage({
        type: "gr",
        values: [this._state.low.lastGr, this._state.mid.lastGr, this._state.high.lastGr],
      });
    }
    this._frameCount++;
  }
}

registerProcessor("multiband-compressor-processor", MultibandCompressorProcessor);
