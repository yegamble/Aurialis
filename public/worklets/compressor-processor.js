/**
 * CompressorProcessor — AudioWorklet
 * Envelope follower + gain computer + attack/release smoothing + makeup gain.
 * Matches src/lib/audio/dsp/compressor.ts and src/lib/audio/dsp/envelope.ts logic.
 *
 * Detector path: (L+R)/2 → 2nd-order Butterworth sidechain HPF → |·| → envelope
 *   followed by gain computer. Audio path bypasses the HPF — only the
 *   detector sees the high-passed signal. See src/lib/audio/dsp/sidechain-filter.ts
 *   for the canonical TS reference implementation.
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

class CompressorProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Default params
    this._threshold = -18; // dBFS
    this._ratio = 4;
    this._attack = 0.020;  // seconds
    this._release = 0.250; // seconds
    this._knee = 6;        // dB
    this._makeup = 0;      // dB
    this._sidechainHpfHz = 100; // sidechain HPF cutoff in Hz
    this._autoRelease = 0; // 0 = manual (P0), 1 = dual-stage parallel envelope
    this._enabled = true;

    // State
    this._envelope = 0;    // current envelope level (linear)
    this._envSlow = 0;     // slow envelope for auto-release (IN SYNC WITH
                           // src/lib/audio/dsp/auto-release.ts)
    this._gr = 0;          // current gain reduction (dB)
    this._frameCount = 0;  // for 30Hz throttle

    // Sidechain HPF state — DF-II transposed biquad on (L+R)/2 mid signal.
    // Coefficients recomputed whenever _sidechainHpfHz changes.
    // Keep in sync with src/lib/audio/dsp/biquad.ts highPassCoeffs() (Q=1/√2).
    this._scHpfZ1 = 0;
    this._scHpfZ2 = 0;
    this._scCoeffs = this._computeScCoeffs(this._sidechainHpfHz);

    // Deep-mode envelope scheduler — see src/worklets/envelope-scheduler.js.
    // Available because the inline-worklet-helpers script copies the helper
    // class above. Falls back to no-op if the helper hasn't been inlined yet.
    this._scheduler = (typeof EnvelopeScheduler !== 'undefined')
      ? new EnvelopeScheduler()
      : null;
    // ~5 ms time constant: cheap zipper-noise mitigation per S2.
    this._smootherCoeff = this._scheduler
      ? this._scheduler.smootherCoefficient(0.005, sampleRate)
      : 1;

    this.port.onmessage = (e) => {
      const { param, value, envelope } = e.data;
      if (envelope !== undefined) {
        // Envelope message — install (or clear with []) for sample-accurate ramps.
        if (this._scheduler) {
          if (Array.isArray(envelope) && envelope.length === 0) {
            this._scheduler.clearEnvelope(param);
          } else {
            this._scheduler.setEnvelope(param, envelope);
          }
        }
        return;
      }
      // Static value — clear any envelope on the same param so it doesn't override.
      if (this._scheduler) this._scheduler.clearEnvelope(param);
      if (param === 'threshold') this._threshold = value;
      else if (param === 'ratio') this._ratio = value;
      else if (param === 'attack') this._attack = value / 1000; // ms → s
      else if (param === 'release') this._release = value / 1000;
      else if (param === 'knee') this._knee = value;
      else if (param === 'makeup') this._makeup = value;
      else if (param === 'enabled') this._enabled = value;
      else if (param === 'sidechainHpfHz') {
        this._sidechainHpfHz = value;
        this._scCoeffs = this._computeScCoeffs(value);
      }
      else if (param === 'autoRelease') this._autoRelease = value;
    };
  }

  /** Read envelope-scheduled params at block start, smoothed per-sample. */
  _applyEnvelopes() {
    if (!this._scheduler) return;
    const t = currentTime;
    if (this._scheduler.hasEnvelope('threshold')) {
      const target = this._scheduler.getValueAt('threshold', t, this._threshold);
      this._threshold = this._scheduler.smoothStep('threshold', target, this._smootherCoeff);
    }
    if (this._scheduler.hasEnvelope('makeup')) {
      const target = this._scheduler.getValueAt('makeup', t, this._makeup);
      this._makeup = this._scheduler.smoothStep('makeup', target, this._smootherCoeff);
    }
    if (this._scheduler.hasEnvelope('ratio')) {
      const target = this._scheduler.getValueAt('ratio', t, this._ratio);
      this._ratio = this._scheduler.smoothStep('ratio', target, this._smootherCoeff);
    }
  }

  /**
   * Compute 2nd-order Butterworth HPF biquad coefficients.
   * Matches highPassCoeffs(fc, 1/√2, sampleRate) in src/lib/audio/dsp/biquad.ts.
   */
  _computeScCoeffs(fc) {
    const Q = Math.SQRT1_2; // Butterworth
    const omega = (2 * Math.PI * fc) / sampleRate;
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

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input[0]) return true;

    // Per Spike S2: read envelope values once per block (not per sample) and
    // rely on the one-pole smoother to mitigate zipper noise.
    this._applyEnvelopes();

    const sr = sampleRate;
    const attackCoeff = Math.exp(-1 / (this._attack * sr));
    const releaseCoeff = Math.exp(-1 / (this._release * sr));
    // Slow release coefficient for auto-release mode: 5× slower, capped at 2 s.
    // IN SYNC WITH src/lib/audio/dsp/auto-release.ts computeSlowReleaseSeconds().
    const slowReleaseSec = Math.min(this._release * 5, 2);
    const slowReleaseCoeff = Math.exp(-1 / (slowReleaseSec * sr));
    const autoRelease = this._autoRelease;
    const makeupLin = Math.pow(10, this._makeup / 20);
    const numChannels = Math.min(input.length, output.length);
    const blockSize = input[0].length;

    if (!this._enabled) {
      for (let c = 0; c < numChannels; c++) {
        output[c].set(input[c]);
      }
      return true;
    }

    const { b0, b1, b2, a1, a2 } = this._scCoeffs;

    for (let i = 0; i < blockSize; i++) {
      // Mono guard: if only one channel, duplicate it. Never compute (L + undefined)/2.
      const l = input[0][i];
      const r = input.length > 1 ? input[1][i] : l;
      const mid = (l + r) * 0.5;

      // Apply sidechain HPF (DF-II transposed biquad) to the mid detector signal
      const y = b0 * mid + this._scHpfZ1;
      this._scHpfZ1 = b1 * mid - a1 * y + this._scHpfZ2;
      this._scHpfZ2 = b2 * mid - a2 * y;
      const level = Math.abs(y);

      // Envelope follower (peak with attack/release + optional auto-release)
      let effectiveEnv;
      if (level > this._envelope) {
        this._envelope = attackCoeff * this._envelope + (1 - attackCoeff) * level;
        if (autoRelease > 0) {
          this._envSlow = attackCoeff * this._envSlow + (1 - attackCoeff) * level;
        }
        effectiveEnv = this._envelope;
      } else {
        this._envelope = releaseCoeff * this._envelope + (1 - releaseCoeff) * level;
        if (autoRelease > 0) {
          this._envSlow = slowReleaseCoeff * this._envSlow + (1 - slowReleaseCoeff) * level;
          effectiveEnv = this._envSlow > this._envelope ? this._envSlow : this._envelope;
        } else {
          effectiveEnv = this._envelope;
        }
      }

      // Convert to dB
      const inputDb = effectiveEnv > 0 ? 20 * Math.log10(effectiveEnv) : -120;

      // Gain computer
      const gr = this._computeGainReduction(inputDb);

      // Apply gain reduction to all channels of the AUDIO path (not HPF'd)
      const gainLin = Math.pow(10, gr / 20) * makeupLin;
      for (let c = 0; c < numChannels; c++) {
        output[c][i] = input[c][i] * gainLin;
      }
      this._gr = gr;
    }

    // Post gain reduction data at ~30Hz (every 45 blocks at 44.1kHz / 128 samples = ~30Hz)
    if (this._frameCount % 45 === 0) {
      this.port.postMessage({ type: 'gr', value: this._gr });
    }
    this._frameCount++;
    return true;
  }

  _computeGainReduction(inputDb) {
    const { _threshold: threshold, _ratio: ratio, _knee: knee } = this;
    const halfKnee = knee / 2;
    const overshoot = inputDb - threshold;

    if (knee > 0 && overshoot >= -halfKnee && overshoot <= halfKnee) {
      const x = overshoot + halfKnee;
      const r = ratio === Infinity ? 1e10 : ratio;
      return (1 / r - 1) * (x * x) / (2 * knee);
    }
    if (overshoot <= -halfKnee) return 0;
    if (ratio === Infinity) return -overshoot;
    return overshoot * (1 / ratio - 1);
  }
}

registerProcessor('compressor-processor', CompressorProcessor);
