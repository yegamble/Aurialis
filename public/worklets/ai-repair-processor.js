/**
 * AiRepairProcessor — AudioWorklet
 * M/S widener for restoring stereo width on AI-generated narrow guitars.
 *
 * Mirrors src/lib/audio/dsp/ai-repair.ts one-to-one. Single `amount`
 * parameter (0-100%) controls the side-band boost; the exciter slot is a
 * no-op stub today and is filled in by T11.
 *
 * Default state: amount = 0 → bit-exact passthrough (no filter state
 * updates). Only when amount > 0 does the side-channel biquad run.
 */

// @@INLINE_BEGIN: envelope-scheduler
 
/**
 * EnvelopeScheduler — sample-rate-independent envelope storage + lookup
 * for AudioWorklet processors.
 *
 * Per Spike S2 (2026-04-25): per-block evaluation, no per-sample fallback.
 * Each worklet reads getValueAt(param, blockStartTime, fallback) once per
 * 128-sample block, then a one-pole IIR smoother is applied per sample to
 * mitigate zipper noise on parameter ramps.
 *
 * SOURCE OF TRUTH for both:
 *   - public/worklets/*-processor.js (inlined at build/dev via
 *     scripts/inline-worklet-helpers.mjs)
 *   - src/lib/audio/deep/envelope-scheduler-node.ts (Node test re-export)
 *
 * Pure ES5-compatible JS — no imports, no destructuring of unknowns,
 * no class fields. Runs in AudioWorkletGlobalScope and Node.
 */

class EnvelopeScheduler {
  constructor() {
    /** Map<paramName, Array<[time, value]>> */
    this._envelopes = Object.create(null);
    /** Map<paramName, smootherState{ value, coeff }> */
    this._smoothers = Object.create(null);
  }

  /** Install an envelope for `param`. Returns true on success, false if rejected. */
  setEnvelope(param, points) {
    if (!Array.isArray(points) || points.length < 2) return false;
    // Defensive copy + validate monotonic time
    const copy = new Array(points.length);
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (!Array.isArray(p) || p.length !== 2) return false;
      copy[i] = [Number(p[0]), Number(p[1])];
      if (i > 0 && copy[i][0] <= copy[i - 1][0]) return false;
    }
    this._envelopes[param] = copy;
    return true;
  }

  /** Remove the envelope for `param`. */
  clearEnvelope(param) {
    delete this._envelopes[param];
    delete this._smoothers[param];
  }

  /** True if `param` has an active envelope. */
  hasEnvelope(param) {
    return Object.prototype.hasOwnProperty.call(this._envelopes, param);
  }

  /**
   * Look up the envelope value at `time`. Returns `fallback` if no envelope
   * is set. Linear interpolation between adjacent points; clamps to first /
   * last value outside the envelope range.
   */
  getValueAt(param, time, fallback) {
    const env = this._envelopes[param];
    if (!env) return fallback;
    if (time <= env[0][0]) return env[0][1];
    const last = env[env.length - 1];
    if (time >= last[0]) return last[1];
    // Linear scan — envelopes are bounded (≤100 pts/sec, single Move) so
    // a binary search would be premature. Most worklets see <50 points total.
    for (let i = 1; i < env.length; i++) {
      if (time < env[i][0]) {
        const a = env[i - 1];
        const b = env[i];
        const t = (time - a[0]) / (b[0] - a[0]);
        return a[1] + t * (b[1] - a[1]);
      }
    }
    return last[1];
  }

  /** One-pole smoother coefficient for time-constant tau (seconds) at sr. */
  smootherCoefficient(tauSec, sampleRate) {
    if (tauSec <= 0) return 1;
    return 1 - Math.exp(-1 / (tauSec * sampleRate));
  }

  /**
   * Smooth an envelope target into the param's smoother state and return the
   * smoothed value. First call seeds the smoother to `target` (no transient).
   */
  smoothStep(param, target, coeff) {
    let st = this._smoothers[param];
    if (!st) {
      st = { value: target };
      this._smoothers[param] = st;
      return target;
    }
    st.value = coeff * target + (1 - coeff) * st.value;
    return st.value;
  }
}

// Make available in both AudioWorkletGlobalScope (where there's no module
// system) and in Node (where the test wrapper assigns globalThis).
// In AudioWorkletGlobalScope `globalThis` is the global object.
globalThis.EnvelopeScheduler = EnvelopeScheduler;
// @@INLINE_END: envelope-scheduler

const AI_REPAIR_BPF_CENTER_HZ = 2500;
const AI_REPAIR_BPF_Q = 1.0;
const AI_REPAIR_MAX_BOOST_DB = 6;
// IN SYNC WITH src/lib/audio/dsp/ai-repair.ts
const AI_REPAIR_EXCITER_Q = 2.0;
const AI_REPAIR_EXCITER_DRIVE = 2.0;
const AI_REPAIR_EXCITER_MAX_WET = 0.3;

/** IN SYNC WITH src/lib/audio/dsp/biquad.ts peakingCoeffs */
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

class AiRepairProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._amount = 0;
    this._enabled = true;
    this._sideZ1 = 0;
    this._sideZ2 = 0;
    this._coeffs = peakingCoeffsInline(
      AI_REPAIR_BPF_CENTER_HZ,
      AI_REPAIR_MAX_BOOST_DB,
      AI_REPAIR_BPF_Q,
      sampleRate,
    );
    // Exciter biquad state (per channel) + coeffs.
    this._exL_z1 = 0;
    this._exL_z2 = 0;
    this._exR_z1 = 0;
    this._exR_z2 = 0;
    this._exciterCoeffs = peakingCoeffsInline(
      AI_REPAIR_BPF_CENTER_HZ,
      AI_REPAIR_MAX_BOOST_DB,
      AI_REPAIR_EXCITER_Q,
      sampleRate,
    );

    // Deep-mode envelope scheduler — see src/worklets/envelope-scheduler.js.
    this._scheduler = (typeof EnvelopeScheduler !== 'undefined')
      ? new EnvelopeScheduler()
      : null;
    this._smootherCoeff = this._scheduler
      ? this._scheduler.smootherCoefficient(0.005, sampleRate)
      : 1;

    this.port.onmessage = (e) => {
      const { param, value, envelope } = e.data;
      if (envelope !== undefined) {
        if (this._scheduler) {
          if (Array.isArray(envelope) && envelope.length === 0) {
            this._scheduler.clearEnvelope(param);
          } else {
            this._scheduler.setEnvelope(param, envelope);
          }
        }
        return;
      }
      if (this._scheduler) this._scheduler.clearEnvelope(param);
      if (param === 'amount') this._amount = value;
      else if (param === 'enabled') this._enabled = value;
    };
  }

  /** Lazy currentTime per same convention as the other deep-mode processors. */
  _applyEnvelopes() {
    if (!this._scheduler) return;
    if (this._scheduler.hasEnvelope('amount')) {
      const target = this._scheduler.getValueAt('amount', currentTime, this._amount);
      this._amount = this._scheduler.smoothStep('amount', target, this._smootherCoeff);
    }
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input[0]) return true;

    this._applyEnvelopes();

    const numChannels = Math.min(input.length, output.length);
    const blockSize = input[0].length;

    // Bit-exact bypass when disabled or amount = 0.
    if (!this._enabled || this._amount <= 0) {
      for (let c = 0; c < numChannels; c++) {
        output[c].set(input[c]);
      }
      return true;
    }

    const a = this._amount >= 100 ? 1 : this._amount / 100;
    const wet = a * AI_REPAIR_EXCITER_MAX_WET;
    const isMono = numChannels < 2;
    const inL = input[0];
    const inR = isMono ? input[0] : input[1];
    const outL = output[0];
    const outR = numChannels > 1 ? output[1] : null;

    const { b0, b1, b2, a1, a2 } = this._coeffs;
    const exC = this._exciterCoeffs;

    for (let i = 0; i < blockSize; i++) {
      const l = inL[i];
      const r = inR[i];
      const mid = (l + r) * 0.5;
      const side = (l - r) * 0.5;

      // Widener: peaking biquad on side (DF-II Transposed).
      const sideFiltered = b0 * side + this._sideZ1;
      this._sideZ1 = b1 * side - a1 * sideFiltered + this._sideZ2;
      this._sideZ2 = b2 * side - a2 * sideFiltered;

      const sBoost = sideFiltered - side;
      const sWidened = side + sBoost * a;

      let lOut = mid + sWidened;
      let rOut = mid - sWidened;

      // Exciter: per-channel bandpass → soft-clip → mix back.
      const lBp = exC.b0 * l + this._exL_z1;
      this._exL_z1 = exC.b1 * l - exC.a1 * lBp + this._exL_z2;
      this._exL_z2 = exC.b2 * l - exC.a2 * lBp;
      const rBp = exC.b0 * r + this._exR_z1;
      this._exR_z1 = exC.b1 * r - exC.a1 * rBp + this._exR_z2;
      this._exR_z2 = exC.b2 * r - exC.a2 * rBp;

      const lDist = Math.tanh(lBp * AI_REPAIR_EXCITER_DRIVE);
      const rDist = Math.tanh(rBp * AI_REPAIR_EXCITER_DRIVE);
      lOut += lDist * wet;
      rOut += rDist * wet;

      outL[i] = lOut;
      if (outR) outR[i] = rOut;
    }

    return true;
  }
}

registerProcessor('ai-repair-processor', AiRepairProcessor);
