/**
 * Audio analysis — computes LUFS, peak, dynamic range, and spectral balance
 * from an AudioBuffer as pure functions (no Web Audio API required).
 */

import { computeIntegratedLufs } from "./dsp/lufs";
import { BiquadFilter, lowPassCoeffs, highPassCoeffs } from "./dsp/biquad";
import { emitStage } from "@/lib/analysis-stage/emitter";

export interface AnalysisResult {
  /** Integrated loudness in LUFS (-Infinity for silence) */
  integratedLufs: number;
  /** True peak in dBFS */
  peakDb: number;
  /** Dynamic range in dB (peak - RMS) */
  dynamicRange: number;
  /** Fraction of energy in bass band (< 300 Hz) */
  bassRatio: number;
  /** Fraction of energy in mid band (300 Hz – 3 kHz) */
  midRatio: number;
  /** Fraction of energy in high band (> 3 kHz) */
  highRatio: number;
}

/**
 * Synchronous analysis path. Kept for tests and any caller that needs to
 * block on the result on the main thread. Production callers should prefer
 * the async {@link analyzeAudio} variant which yields between phases.
 */
export function analyzeAudioSync(buffer: AudioBuffer): AnalysisResult {
  const sampleRate = buffer.sampleRate;
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;

  // 1. Integrated LUFS
  const integratedLufs = computeIntegratedLufs(left, right, sampleRate);

  // 2. True peak (highest absolute sample across both channels)
  let peak = 0;
  for (let i = 0; i < left.length; i++) {
    const s = Math.abs(left[i]);
    if (s > peak) peak = s;
  }
  if (right !== left) {
    for (let i = 0; i < right.length; i++) {
      const s = Math.abs(right[i]);
      if (s > peak) peak = s;
    }
  }
  const peakDb = peak > 0 ? 20 * Math.log10(peak) : -Infinity;

  // 3. Dynamic range: peak (dBFS) – RMS (dBFS)
  const N = left.length;
  let sumSq = 0;
  for (let i = 0; i < N; i++) sumSq += left[i] * left[i];
  const rmsValue = Math.sqrt(sumSq / N);
  const rmsDb = rmsValue > 0 ? 20 * Math.log10(rmsValue) : -Infinity;
  const dynamicRange = isFinite(peakDb) && isFinite(rmsDb) ? peakDb - rmsDb : 0;

  // 4. Spectral balance — compute RMS energy in three bands on a mono mix
  const mono = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    mono[i] = right !== left ? (left[i] + right[i]) / 2 : left[i];
  }

  const { bassRatio, midRatio, highRatio } = computeSpectralBalance(mono, sampleRate);

  return { integratedLufs, peakDb, dynamicRange, bassRatio, midRatio, highRatio };
}

/** Options for the async analyzer. */
export interface AnalyzeAudioOptions {
  /**
   * When set, emit `[analysis:mastering-auto:<phase>]` stage events through
   * the analysis-stage harness on each phase boundary.
   */
  runId?: string;
}

/**
 * Async analysis path. Computes the same numbers as {@link analyzeAudioSync}
 * but yields to the event loop between the four phases (loudness → peak →
 * dynamic-range → spectral-balance) so the main thread can repaint the
 * progress indicator. When `opts.runId` is provided, emits stage events
 * through the harness so the UI and the console can narrate progress.
 */
export async function analyzeAudio(
  buffer: AudioBuffer,
  opts: AnalyzeAudioOptions = {}
): Promise<AnalysisResult> {
  const { runId } = opts;
  const sampleRate = buffer.sampleRate;
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;

  // Phase 1: integrated LUFS
  if (runId) {
    emitStage({
      flow: "mastering-auto",
      runId,
      stage: "loudness",
      phase: "start",
    });
  }
  const integratedLufs = computeIntegratedLufs(left, right, sampleRate);
  await Promise.resolve();

  // Phase 2: true peak
  if (runId) {
    emitStage({
      flow: "mastering-auto",
      runId,
      stage: "peak",
      phase: "start",
    });
  }
  let peak = 0;
  for (let i = 0; i < left.length; i++) {
    const s = Math.abs(left[i]);
    if (s > peak) peak = s;
    // Yield every CHUNK_SIZE samples to keep the main thread responsive on
    // very long buffers. CHUNK_SIZE = 65536 ≈ 1.5 s of 44.1 kHz audio.
    if ((i & 65535) === 65535) await Promise.resolve();
  }
  if (right !== left) {
    for (let i = 0; i < right.length; i++) {
      const s = Math.abs(right[i]);
      if (s > peak) peak = s;
      if ((i & 65535) === 65535) await Promise.resolve();
    }
  }
  const peakDb = peak > 0 ? 20 * Math.log10(peak) : -Infinity;

  // Phase 3: dynamic range (RMS-based)
  if (runId) {
    emitStage({
      flow: "mastering-auto",
      runId,
      stage: "dynamic-range",
      phase: "start",
    });
  }
  const N = left.length;
  let sumSq = 0;
  for (let i = 0; i < N; i++) {
    sumSq += left[i] * left[i];
    if ((i & 65535) === 65535) await Promise.resolve();
  }
  const rmsValue = Math.sqrt(sumSq / N);
  const rmsDb = rmsValue > 0 ? 20 * Math.log10(rmsValue) : -Infinity;
  const dynamicRange = isFinite(peakDb) && isFinite(rmsDb) ? peakDb - rmsDb : 0;
  await Promise.resolve();

  // Phase 4: spectral balance
  if (runId) {
    emitStage({
      flow: "mastering-auto",
      runId,
      stage: "spectral-balance",
      phase: "start",
    });
  }
  const mono = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    mono[i] = right !== left ? (left[i] + right[i]) / 2 : left[i];
  }
  const { bassRatio, midRatio, highRatio } = computeSpectralBalance(
    mono,
    sampleRate
  );

  // Done.
  if (runId) {
    emitStage({
      flow: "mastering-auto",
      runId,
      stage: "done",
      phase: "end",
      progress: 100,
    });
  }

  return {
    integratedLufs,
    peakDb,
    dynamicRange,
    bassRatio,
    midRatio,
    highRatio,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function rms(signal: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < signal.length; i++) sum += signal[i] * signal[i];
  return Math.sqrt(sum / signal.length);
}

function computeSpectralBalance(
  signal: Float32Array,
  sampleRate: number
): { bassRatio: number; midRatio: number; highRatio: number } {
  // Bass band: lowpass at 300 Hz
  const bassLp = new BiquadFilter(lowPassCoeffs(300, 0.7071, sampleRate));
  const bassSignal = bassLp.process(signal);

  // High band: highpass at 3 kHz
  const highHp = new BiquadFilter(highPassCoeffs(3000, 0.7071, sampleRate));
  const highSignal = highHp.process(signal);

  // Mid band: highpass at 300 Hz then lowpass at 3 kHz
  const midHp = new BiquadFilter(highPassCoeffs(300, 0.7071, sampleRate));
  const midLp = new BiquadFilter(lowPassCoeffs(3000, 0.7071, sampleRate));
  const midSignal = midLp.process(midHp.process(signal));

  const bassRms = rms(bassSignal);
  const midRms = rms(midSignal);
  const highRms = rms(highSignal);

  const total = bassRms + midRms + highRms;
  if (total === 0) return { bassRatio: 1 / 3, midRatio: 1 / 3, highRatio: 1 / 3 };

  return {
    bassRatio: bassRms / total,
    midRatio: midRms / total,
    highRatio: highRms / total,
  };
}
