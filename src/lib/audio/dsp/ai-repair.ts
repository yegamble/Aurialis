/**
 * AI Repair DSP — pure TypeScript reference for the M/S widener used to
 * restore stereo width on AI-generated narrow guitars (e.g., Suno output).
 *
 * Per Spec T10:
 * - Algorithm: M/S decompose → bandpass-shape Side around 1.5–4 kHz → lift
 *   the in-band component by `amount`% × 6 dB → re-encode L/R.
 * - At amount = 0 the output is bit-identical to the input.
 * - The bandpass shape is implemented as a peaking (bell) filter at 2.5 kHz,
 *   Q = 1 with +6 dB peak gain. We isolate the in-band boost by computing
 *   the filter excess `(filteredSide - side)`, which keeps out-of-band
 *   energy untouched.
 *
 * T11 will fill in the harmonic exciter using the `_exciter*` state slots
 * declared here (kept as no-ops so T10's filename/API doesn't change).
 */

import { BiquadFilter, peakingCoeffs } from "./biquad";

/** Center frequency of the M/S widener's bandpass (Hz). */
export const AI_REPAIR_BPF_CENTER_HZ = 2500;
/** Q of the bandpass-shaped peaking filter (Q = 1 ≈ ~1.5–4 kHz coverage). */
export const AI_REPAIR_BPF_Q = 1.0;
/** Maximum side-band boost in dB at amount = 100%. */
export const AI_REPAIR_MAX_BOOST_DB = 6;

/** Q of the exciter's bandpass (narrower than the widener's) for focused harmonics. */
export const AI_REPAIR_EXCITER_Q = 2.0;
/** Soft-clip drive multiplier — controls how aggressively the exciter generates harmonics. */
export const AI_REPAIR_EXCITER_DRIVE = 2.0;
/** Max wet/dry blend at amount = 100%. */
export const AI_REPAIR_EXCITER_MAX_WET = 0.3;

export interface AiRepairState {
  /** DF-II Transposed biquad applied to the M/S Side channel (widener). */
  bpfSide: BiquadFilter;
  /** Per-channel bandpass biquads for the exciter (narrower Q, harmonic-focused). */
  bpfExciterL: BiquadFilter;
  bpfExciterR: BiquadFilter;
}

export function makeAiRepairState(sampleRate: number): AiRepairState {
  const widenerCoeffs = peakingCoeffs(
    AI_REPAIR_BPF_CENTER_HZ,
    AI_REPAIR_MAX_BOOST_DB,
    AI_REPAIR_BPF_Q,
    sampleRate,
  );
  const exciterCoeffs = peakingCoeffs(
    AI_REPAIR_BPF_CENTER_HZ,
    AI_REPAIR_MAX_BOOST_DB,
    AI_REPAIR_EXCITER_Q,
    sampleRate,
  );
  return {
    bpfSide: new BiquadFilter(widenerCoeffs),
    bpfExciterL: new BiquadFilter(exciterCoeffs),
    bpfExciterR: new BiquadFilter(exciterCoeffs),
  };
}

/**
 * Apply the M/S widener in-place on `left` and `right`. `amountPct` is in
 * [0, 100] — values outside this range are clamped silently.
 *
 * State (filter memory) is preserved across calls via `state` so the function
 * can be called per-block by an offline renderer or per-buffer for a one-shot
 * render. At amountPct = 0 the function returns early without touching the
 * input — guarantees bit-identical bypass.
 */
export function applyAiRepairWidener(
  left: Float32Array,
  right: Float32Array,
  amountPct: number,
  state: AiRepairState,
): void {
  const a = amountPct <= 0 ? 0 : amountPct >= 100 ? 1 : amountPct / 100;
  if (a === 0) return;
  const n = Math.min(left.length, right.length);
  for (let i = 0; i < n; i++) {
    const l = left[i]!;
    const r = right[i]!;
    const m = (l + r) * 0.5;
    const s = (l - r) * 0.5;
    const sFiltered = state.bpfSide.processSample(s);
    const sBoost = sFiltered - s; // in-band excess only
    const sWidened = s + sBoost * a;
    left[i] = m + sWidened;
    right[i] = m - sWidened;
  }
}

/**
 * Targeted harmonic exciter — bandpass each channel around 1–4 kHz, soft-clip
 * the band-passed signal to generate even+odd harmonics, and mix back into
 * the dry signal by `amount × MAX_WET`. At amount = 0 the function returns
 * early, guaranteeing bit-identical bypass.
 *
 * Intended to restore the harmonic richness lost in AI-generated guitars
 * whose top-band content sounds "matte" / lacking presence.
 */
export function applyAiRepairExciter(
  left: Float32Array,
  right: Float32Array,
  amountPct: number,
  state: AiRepairState,
): void {
  const a = amountPct <= 0 ? 0 : amountPct >= 100 ? 1 : amountPct / 100;
  if (a === 0) return;
  const wet = a * AI_REPAIR_EXCITER_MAX_WET;
  const n = Math.min(left.length, right.length);
  for (let i = 0; i < n; i++) {
    const lBp = state.bpfExciterL.processSample(left[i]!);
    const rBp = state.bpfExciterR.processSample(right[i]!);
    const lDist = Math.tanh(lBp * AI_REPAIR_EXCITER_DRIVE);
    const rDist = Math.tanh(rBp * AI_REPAIR_EXCITER_DRIVE);
    left[i] = left[i]! + lDist * wet;
    right[i] = right[i]! + rDist * wet;
  }
}

/**
 * Run the full AI Repair chain: widener (M/S) → exciter (per-channel
 * harmonic generation). Both stages share the same `amount` parameter and
 * `state` so a single envelope drives both. At amount = 0 the function is
 * a no-op (bit-identical bypass).
 */
export function applyAiRepair(
  left: Float32Array,
  right: Float32Array,
  amountPct: number,
  state: AiRepairState,
): void {
  applyAiRepairWidener(left, right, amountPct, state);
  applyAiRepairExciter(left, right, amountPct, state);
}
