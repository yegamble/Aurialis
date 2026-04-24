/**
 * ParametricEqDSP — pure TypeScript reference for the 5-band parametric EQ.
 *
 * Canonical reference: `public/worklets/parametric-eq-processor.js` must mirror
 * this module one-to-one. Parity is enforced by
 * `src/lib/audio/dsp/__tests__/parametric-eq-parity.test.ts`.
 *
 * Per-band parameters:
 *   - enabled, freq, q, gain (dB), type, mode, msBalance (-1..+1)
 *
 * Filter shapes:
 *   - `bell`      — peaking (freq, Q, gain)
 *   - `lowShelf`  — low-shelf (freq, gain); Q ignored (slope fixed Butterworth S=1)
 *   - `highShelf` — high-shelf (freq, gain); Q ignored
 *   - `highPass`  — 2nd-order HPF (freq, Q); gain ignored
 *   - `lowPass`   — 2nd-order LPF (freq, Q); gain ignored
 *
 * Mode semantics:
 *   - `stereo` → band processes L and R identically (linked).
 *   - `ms`     → band M/S encodes, applies biquad to M and S independently,
 *                M/S decodes. Per-channel gain weighted by `msBalance`:
 *                  weight_M = msBalance >= 0 ? 1 : (1 + msBalance)
 *                  weight_S = msBalance <= 0 ? 1 : (1 - msBalance)
 *                Freq/Q/type are identical on M and S; only gain dB is weighted.
 *                +1 → band affects Mid only. 0 → both channels get full band
 *                gain (≈ stereo, up to MS encode/decode precision). -1 → Side only.
 */

import type { EqBandMode, EqBandType } from "@/types/mastering";
import {
  highPassCoeffs,
  highShelfCoeffs,
  lowPassCoeffs,
  lowShelfCoeffs,
  peakingCoeffs,
  type BiquadCoeffs,
} from "./biquad";

export const EQ_BAND_COUNT = 5;

export interface EqBandParams {
  /** 0 = bypass this band (passthrough); 1 = process. */
  enabled: number;
  /** Center/corner frequency in Hz. */
  freq: number;
  /** Quality factor. Used for bell/HPF/LPF. Ignored for shelves (S=1 fixed). */
  q: number;
  /** Gain in dB. Used for bell/shelves. Ignored for HPF/LPF. */
  gain: number;
  type: EqBandType;
  mode: EqBandMode;
  /** -1..+1. In ms mode, weights band gain between Mid and Side. */
  msBalance: number;
}

/** Neutral band — unity passthrough (bell @ 1 kHz, 0 dB, Q=1, disabled). */
export function neutralBand(): EqBandParams {
  return {
    enabled: 0,
    freq: 1000,
    q: 1,
    gain: 0,
    type: "bell",
    mode: "stereo",
    msBalance: 0,
  };
}

interface BandState {
  // Direct Form II Transposed state for two channels (A/B).
  // Stereo mode: A=L, B=R. MS mode: A=M, B=S.
  zA1: number;
  zA2: number;
  zB1: number;
  zB2: number;
  coeffsA: BiquadCoeffs;
  coeffsB: BiquadCoeffs;
  // Cached params to detect change → recompute coeffs.
  cFreq: number;
  cQ: number;
  cGain: number;
  cType: EqBandType;
  cMode: EqBandMode;
  cMsBalance: number;
  initialized: boolean;
}

function makeBandState(): BandState {
  return {
    zA1: 0,
    zA2: 0,
    zB1: 0,
    zB2: 0,
    coeffsA: { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 },
    coeffsB: { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 },
    cFreq: -1,
    cQ: -1,
    cGain: Number.NaN,
    cType: "bell",
    cMode: "stereo",
    cMsBalance: Number.NaN,
    initialized: false,
  };
}

/** Build biquad coefficients for a given filter type. */
export function buildCoeffs(
  type: EqBandType,
  freq: number,
  gainDb: number,
  q: number,
  sampleRate: number,
): BiquadCoeffs {
  switch (type) {
    case "bell":
      return peakingCoeffs(freq, gainDb, q, sampleRate);
    case "lowShelf":
      // Butterworth slope (S=1); Q on shelves has no standard meaning.
      return lowShelfCoeffs(freq, gainDb, 1.0, sampleRate);
    case "highShelf":
      return highShelfCoeffs(freq, gainDb, 1.0, sampleRate);
    case "highPass":
      return highPassCoeffs(freq, q, sampleRate);
    case "lowPass":
      return lowPassCoeffs(freq, q, sampleRate);
  }
}

export interface EqOutputBuffers {
  left: Float32Array;
  right: Float32Array;
}

export class ParametricEqDSP {
  private readonly _sampleRate: number;
  private readonly _bands: BandState[];

  constructor(sampleRate: number) {
    this._sampleRate = sampleRate;
    this._bands = [];
    for (let i = 0; i < EQ_BAND_COUNT; i++) {
      this._bands.push(makeBandState());
    }
  }

  get sampleRate(): number {
    return this._sampleRate;
  }

  /** Clear all filter memory. Useful when jumping playback position. */
  reset(): void {
    for (const s of this._bands) {
      s.zA1 = 0;
      s.zA2 = 0;
      s.zB1 = 0;
      s.zB2 = 0;
    }
  }

  /**
   * Process a stereo block in-place-equivalent fashion.
   * Writes results into `output.left` / `output.right`. Input arrays are not
   * mutated (caller may pass the output arrays as the input to simulate in-place).
   *
   * `bands` MUST have length EQ_BAND_COUNT; extras are ignored.
   */
  processStereo(
    left: Float32Array,
    right: Float32Array,
    bands: EqBandParams[],
    output: EqOutputBuffers,
  ): void {
    const n = Math.min(left.length, right.length, output.left.length, output.right.length);
    // Start from input; subsequent bands process in-place on output buffers.
    if (output.left !== left) output.left.set(left.subarray(0, n));
    if (output.right !== right) output.right.set(right.subarray(0, n));

    for (let bi = 0; bi < EQ_BAND_COUNT; bi++) {
      const p = bands[bi];
      if (!p.enabled) continue;
      const state = this._bands[bi];
      this._ensureCoeffs(state, p);
      if (p.mode === "stereo") {
        this._processStereoBand(state, output.left, output.right, n);
      } else {
        this._processMsBand(state, output.left, output.right, n);
      }
    }
  }

  /** Mono convenience — processes only channel A (stereo mode uses coeffsA). */
  processMono(
    input: Float32Array,
    bands: EqBandParams[],
    output: Float32Array,
  ): void {
    const n = Math.min(input.length, output.length);
    if (output !== input) output.set(input.subarray(0, n));
    for (let bi = 0; bi < EQ_BAND_COUNT; bi++) {
      const p = bands[bi];
      if (!p.enabled) continue;
      const state = this._bands[bi];
      // Force stereo-mode coeffs for mono: msBalance has no meaning.
      const monoParams: EqBandParams = { ...p, mode: "stereo", msBalance: 0 };
      this._ensureCoeffs(state, monoParams);
      const { b0, b1, b2, a1, a2 } = state.coeffsA;
      let z1 = state.zA1;
      let z2 = state.zA2;
      for (let i = 0; i < n; i++) {
        const x = output[i];
        const y = b0 * x + z1;
        z1 = b1 * x - a1 * y + z2;
        z2 = b2 * x - a2 * y;
        output[i] = y;
      }
      state.zA1 = z1;
      state.zA2 = z2;
    }
  }

  private _ensureCoeffs(state: BandState, p: EqBandParams): void {
    if (
      state.initialized &&
      state.cFreq === p.freq &&
      state.cQ === p.q &&
      state.cGain === p.gain &&
      state.cType === p.type &&
      state.cMode === p.mode &&
      state.cMsBalance === p.msBalance
    ) {
      return;
    }
    const fs = this._sampleRate;
    let gainA: number;
    let gainB: number;
    if (p.mode === "stereo") {
      gainA = p.gain;
      gainB = p.gain;
    } else {
      // ms: weight gain per channel via msBalance.
      // balance=0 → both weights = 1 (full gain on M and S ⇒ ≈ stereo)
      // balance=+1 → weight_M=1, weight_S=0 (Mid only)
      // balance=-1 → weight_M=0, weight_S=1 (Side only)
      const weightM = p.msBalance >= 0 ? 1 : 1 + p.msBalance;
      const weightS = p.msBalance <= 0 ? 1 : 1 - p.msBalance;
      gainA = p.gain * weightM; // Mid
      gainB = p.gain * weightS; // Side
    }
    state.coeffsA = buildCoeffs(p.type, p.freq, gainA, p.q, fs);
    state.coeffsB = buildCoeffs(p.type, p.freq, gainB, p.q, fs);
    // Reset filter memory when MODE changes to avoid a click from
    // reinterpreting L/R state as M/S state (or vice-versa).
    if (state.initialized && state.cMode !== p.mode) {
      state.zA1 = 0;
      state.zA2 = 0;
      state.zB1 = 0;
      state.zB2 = 0;
    }
    state.cFreq = p.freq;
    state.cQ = p.q;
    state.cGain = p.gain;
    state.cType = p.type;
    state.cMode = p.mode;
    state.cMsBalance = p.msBalance;
    state.initialized = true;
  }

  private _processStereoBand(
    state: BandState,
    L: Float32Array,
    R: Float32Array,
    n: number,
  ): void {
    const { b0: b0A, b1: b1A, b2: b2A, a1: a1A, a2: a2A } = state.coeffsA;
    const { b0: b0B, b1: b1B, b2: b2B, a1: a1B, a2: a2B } = state.coeffsB;
    let zA1 = state.zA1;
    let zA2 = state.zA2;
    let zB1 = state.zB1;
    let zB2 = state.zB2;
    for (let i = 0; i < n; i++) {
      const xL = L[i];
      const yL = b0A * xL + zA1;
      zA1 = b1A * xL - a1A * yL + zA2;
      zA2 = b2A * xL - a2A * yL;
      L[i] = yL;
      const xR = R[i];
      const yR = b0B * xR + zB1;
      zB1 = b1B * xR - a1B * yR + zB2;
      zB2 = b2B * xR - a2B * yR;
      R[i] = yR;
    }
    state.zA1 = zA1;
    state.zA2 = zA2;
    state.zB1 = zB1;
    state.zB2 = zB2;
  }

  private _processMsBand(
    state: BandState,
    L: Float32Array,
    R: Float32Array,
    n: number,
  ): void {
    const { b0: b0M, b1: b1M, b2: b2M, a1: a1M, a2: a2M } = state.coeffsA;
    const { b0: b0S, b1: b1S, b2: b2S, a1: a1S, a2: a2S } = state.coeffsB;
    let zM1 = state.zA1;
    let zM2 = state.zA2;
    let zS1 = state.zB1;
    let zS2 = state.zB2;
    for (let i = 0; i < n; i++) {
      const l = L[i];
      const r = R[i];
      const m = (l + r) * 0.5;
      const s = (l - r) * 0.5;
      const yM = b0M * m + zM1;
      zM1 = b1M * m - a1M * yM + zM2;
      zM2 = b2M * m - a2M * yM;
      const yS = b0S * s + zS1;
      zS1 = b1S * s - a1S * yS + zS2;
      zS2 = b2S * s - a2S * yS;
      L[i] = yM + yS;
      R[i] = yM - yS;
    }
    state.zA1 = zM1;
    state.zA2 = zM2;
    state.zB1 = zS1;
    state.zB2 = zS2;
  }
}

/**
 * Convenience: extract per-band EqBandParams from an AudioParams-like object.
 * Used by the offline renderer and tests to translate the flat
 * `eqBand{N}Freq / Q / Gain / Type / Mode / MsBalance + eq80..eq12k` shape
 * into the per-band struct expected by `ParametricEqDSP`.
 */
export function bandsFromAudioParams(p: {
  eq80: number;
  eq250: number;
  eq1k: number;
  eq4k: number;
  eq12k: number;
  eqBand1Enabled: number;
  eqBand1Freq: number;
  eqBand1Q: number;
  eqBand1Type: EqBandType;
  eqBand1Mode: EqBandMode;
  eqBand1MsBalance: number;
  eqBand2Enabled: number;
  eqBand2Freq: number;
  eqBand2Q: number;
  eqBand2Type: EqBandType;
  eqBand2Mode: EqBandMode;
  eqBand2MsBalance: number;
  eqBand3Enabled: number;
  eqBand3Freq: number;
  eqBand3Q: number;
  eqBand3Type: EqBandType;
  eqBand3Mode: EqBandMode;
  eqBand3MsBalance: number;
  eqBand4Enabled: number;
  eqBand4Freq: number;
  eqBand4Q: number;
  eqBand4Type: EqBandType;
  eqBand4Mode: EqBandMode;
  eqBand4MsBalance: number;
  eqBand5Enabled: number;
  eqBand5Freq: number;
  eqBand5Q: number;
  eqBand5Type: EqBandType;
  eqBand5Mode: EqBandMode;
  eqBand5MsBalance: number;
}): EqBandParams[] {
  const gains = [p.eq80, p.eq250, p.eq1k, p.eq4k, p.eq12k];
  const bands: EqBandParams[] = [];
  for (let i = 1; i <= 5; i++) {
    const obj = p as unknown as Record<string, unknown>;
    bands.push({
      enabled: obj[`eqBand${i}Enabled`] as number,
      freq: obj[`eqBand${i}Freq`] as number,
      q: obj[`eqBand${i}Q`] as number,
      gain: gains[i - 1],
      type: obj[`eqBand${i}Type`] as EqBandType,
      mode: obj[`eqBand${i}Mode`] as EqBandMode,
      msBalance: obj[`eqBand${i}MsBalance`] as number,
    });
  }
  return bands;
}
