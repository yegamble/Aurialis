/**
 * Offline renderer — processes audio through the mastering chain using
 * OfflineAudioContext for input gain + resampling, then applies the
 * parametric EQ, compressor, saturation, stereo width, and limiter inline
 * via pure DSP functions (so offline output matches real-time output).
 */

import type { AudioParams } from "@/lib/stores/audio-store";
import {
  computeGainReduction,
  makeAttackReleaseCoeffs,
} from "./dsp/compressor";
import { applySaturation, drivePctToFactor } from "./dsp/saturation";
import { processLimiter, dbToLin, LookaheadBuffer } from "./dsp/limiter";
import {
  MultibandCompressorDSP,
  type BandParams,
} from "./dsp/multiband";
import {
  ParametricEqDSP,
  bandsFromAudioParams,
} from "./dsp/parametric-eq";
import type { MasteringScript } from "@/types/deep-mastering";
import {
  SCRIPT_RENDER_BLOCK_SIZE,
  resolveParamsAtTime,
} from "./deep/script-renderer";

/**
 * Render source audio through the full mastering chain offline.
 *
 * 1. OfflineAudioContext handles EQ (BiquadFilter) + input gain + resampling
 * 2. Compressor, saturation, stereo width, and limiter are applied inline
 *    on the rendered buffer using pure DSP functions (no AudioWorklet needed).
 *
 * @param sourceBuffer  Input AudioBuffer to process
 * @param params        Mastering parameters
 * @param targetSampleRate  Output sample rate (browser resamples internally)
 * @returns Rendered AudioBuffer at targetSampleRate
 */
export async function renderOffline(
  sourceBuffer: AudioBuffer,
  params: AudioParams,
  targetSampleRate: number,
  script?: MasteringScript | null
): Promise<AudioBuffer> {
  const numChannels = sourceBuffer.numberOfChannels;
  const outputLength = Math.round(sourceBuffer.duration * targetSampleRate);

  const offlineCtx = new OfflineAudioContext(numChannels, outputLength, targetSampleRate);

  // Source node
  const source = offlineCtx.createBufferSource();
  source.buffer = sourceBuffer;

  // Input gain
  const inputGain = offlineCtx.createGain();
  inputGain.gain.value = Math.pow(10, params.inputGain / 20);

  // Connect chain: source → inputGain → destination.
  // EQ is applied inline below so the offline path matches the real-time
  // AudioWorklet-based ParametricEqDSP bit-for-bit.
  source.connect(inputGain);
  inputGain.connect(offlineCtx.destination);

  source.start(0);
  const rendered = await offlineCtx.startRendering();

  // --- Inline DSP: Parametric EQ → Compressor → Saturation → Stereo Width → Limiter ---
  // Matches the real-time chain order in chain.ts

  const channels: Float32Array[] = [];
  for (let c = 0; c < rendered.numberOfChannels; c++) {
    channels.push(rendered.getChannelData(c));
  }
  const sr = rendered.sampleRate;

  applyProcessingPipeline(channels, params, sr, script ?? null);

  return rendered;
}

/**
 * Run the full DSP chain inline on the given channels, in the same order as
 * the real-time chain (`src/lib/audio/chain.ts`). Every stage respects its
 * `*Enabled` master flag — when 0, the stage is skipped (bit-exact
 * passthrough for that stage's slice of the pipeline).
 *
 * Extracted from `renderOffline` for direct unit testing of the 14-combo
 * bypass parity matrix (Phase 4a Task 4) without needing OfflineAudioContext.
 */
export function applyProcessingPipeline(
  channels: Float32Array[],
  params: AudioParams,
  sr: number,
  script: MasteringScript | null = null,
): void {
  // When a deep-mode script is active, route through the per-block pipeline
  // so envelope-driven params are evaluated once per 128-sample block (matching
  // the worklet's evaluation cadence per Spike S2). When `script` is null we
  // keep the legacy whole-buffer path — no perf regression for non-deep renders.
  if (script) {
    applyProcessingPipelineWithScript(channels, params, sr, script);
    return;
  }

  // 0. Parametric EQ (skipped when parametricEqEnabled === 0 for bit-exact bypass)
  if (params.parametricEqEnabled > 0) {
    applyParametricEq(channels, params, sr);
  }

  // 1. Compressor (mirrors compressor-processor.js algorithm)
  if (params.compressorEnabled > 0) {
    applyCompressor(channels, params, sr);
  }

  // 1b. Multiband compressor (skipped when multibandEnabled === 0 for
  // bit-equivalent output vs. pre-P2 renders)
  if (params.multibandEnabled > 0 && channels.length >= 2) {
    applyMultiband(channels, params, sr);
  }

  // 2. Saturation
  if (params.saturationEnabled > 0 && params.satDrive > 0) {
    const driveFactor = drivePctToFactor(params.satDrive);
    for (let c = 0; c < channels.length; c++) {
      const processed = applySaturation(channels[c], driveFactor);
      channels[c].set(processed);
    }
  }

  // 3. Stereo Width (M/S processing, only for stereo)
  if (params.stereoWidthEnabled > 0 && channels.length >= 2) {
    const needsWidth = params.stereoWidth !== 100 || params.midGain !== 0 || params.sideGain !== 0;
    if (needsWidth) {
      applyStereoWidth(channels[0], channels[1], params);
    }
  }

  // 4. Limiter
  if (params.limiterEnabled > 0) {
    const ceilingLin = dbToLin(params.ceiling);
    const limiterReleaseSamples = Math.round((params.limiterRelease / 1000) * sr);
    const releaseCoeff = limiterReleaseSamples > 0
      ? Math.exp(-1 / limiterReleaseSamples)
      : 0.9999;
    const lookaheadSamples = Math.round(0.0015 * sr); // ~1.5ms lookahead
    for (let c = 0; c < channels.length; c++) {
      const limited = processLimiter(channels[c], ceilingLin, lookaheadSamples, 0.001, releaseCoeff);
      channels[c].set(limited);
    }
  }
}

/**
 * Per-block, state-preserving variant of `applyProcessingPipeline` used when
 * a deep mastering script is active. Each 128-sample block resolves
 * `AudioParams` from the script's envelopes at block-start time, then runs
 * compressor / multiband / saturation / stereo-width / limiter on that slice
 * with the resolved params. State (compressor envelope, multiband per-band
 * envs, limiter lookahead + currentGain) persists across blocks so the
 * output is bit-aligned with what the real-time worklet chain would produce.
 *
 * EQ (`parametricEq`) is intentionally not envelope-routed here — T9b moves
 * EQ to a pure-DSP block-aware path; until then we fall back to applying EQ
 * once with the base params (good enough for rendering, EQ envelopes from
 * the script generator are limited to ±2 dB so the offline drift is small).
 */
function applyProcessingPipelineWithScript(
  channels: Float32Array[],
  baseParams: AudioParams,
  sr: number,
  script: MasteringScript,
): void {
  const numChannels = channels.length;
  const numSamples = channels[0].length;
  const blockSize = SCRIPT_RENDER_BLOCK_SIZE;
  const numBlocks = Math.ceil(numSamples / blockSize);
  const knee = 6;

  // Compressor state (per-channel envelope follower output: shared across
  // channels via averaged input, matching applyCompressor's mono detector).
  let compEnv = 0;

  // Parametric-EQ DSP — preserves filter memory + cached coeffs across calls,
  // recomputing biquad coefficients only when band gain (or any other band
  // param) changes. Per T9b: this matches the worklet's per-block coefficient
  // recomputation, keeping real-time and offline within ±0.001 dB at every
  // block boundary for the same envelope input.
  const eqDsp = new ParametricEqDSP(sr);

  // Multiband DSP — preserves splitter + per-band env state across calls.
  const multibandDsp = new MultibandCompressorDSP(sr);

  // Limiter state per channel.
  const limLookahead = Math.round(0.0015 * sr);
  const limAttackCoeff = 0.001;
  const limBuffers: LookaheadBuffer[] = [];
  const limGains: number[] = [];
  for (let c = 0; c < numChannels; c++) {
    limBuffers.push(new LookaheadBuffer(limLookahead));
    limGains.push(1.0);
  }
  // Pre-fill lookahead buffers with the first lookaheadSize-1 samples so the
  // streaming limiter matches the whole-buffer processLimiter at block 0.
  for (let c = 0; c < numChannels; c++) {
    const ch = channels[c]!;
    const fillN = Math.min(limLookahead - 1, ch.length);
    for (let i = 0; i < fillN; i++) {
      limBuffers[c]!.push(ch[i]!);
    }
  }

  for (let b = 0; b < numBlocks; b++) {
    const start = b * blockSize;
    const end = Math.min(start + blockSize, numSamples);
    const blockTime = start / sr;
    const p = resolveParamsAtTime(baseParams, script, blockTime);

    // 0. Parametric EQ — per-block coefficient recomputation when an envelope
    // ramps a band gain. Pure-DSP biquad on this slice, state preserved via eqDsp.
    if (p.parametricEqEnabled > 0) {
      const bands = bandsFromAudioParams(p);
      if (numChannels >= 2) {
        const lSlice = channels[0]!.subarray(start, end);
        const rSlice = channels[1]!.subarray(start, end);
        eqDsp.processStereo(lSlice, rSlice, bands, {
          left: lSlice,
          right: rSlice,
        });
      } else {
        const slice = channels[0]!.subarray(start, end);
        eqDsp.processMono(slice, bands, slice);
      }
    }

    // 1. Compressor — per-block params, per-sample envelope follower.
    if (p.compressorEnabled > 0) {
      compEnv = processCompressorBlock(
        channels,
        start,
        end,
        p,
        sr,
        compEnv,
        knee,
      );
    }

    // 1b. Multiband — preserves state across calls; each block uses the
    // currently-resolved per-band params.
    if (p.multibandEnabled > 0 && numChannels >= 2) {
      processMultibandBlock(multibandDsp, channels, start, end, p, sr);
    }

    // 2. Saturation — stateless per sample.
    if (p.saturationEnabled > 0 && p.satDrive > 0) {
      const driveFactor = drivePctToFactor(p.satDrive);
      const norm = Math.tanh(driveFactor);
      for (let c = 0; c < numChannels; c++) {
        const ch = channels[c]!;
        for (let i = start; i < end; i++) {
          ch[i] = Math.tanh(driveFactor * ch[i]!) / norm;
        }
      }
    }

    // 3. Stereo width — stateless per sample.
    if (p.stereoWidthEnabled > 0 && numChannels >= 2) {
      const needsWidth =
        p.stereoWidth !== 100 || p.midGain !== 0 || p.sideGain !== 0;
      if (needsWidth) {
        processStereoWidthBlock(channels[0]!, channels[1]!, start, end, p);
      }
    }

    // 4. Limiter — streaming with persistent lookahead + gain state.
    if (p.limiterEnabled > 0) {
      const ceilingLin = dbToLin(p.ceiling);
      const limReleaseSamples = Math.round((p.limiterRelease / 1000) * sr);
      const limReleaseCoeff =
        limReleaseSamples > 0 ? Math.exp(-1 / limReleaseSamples) : 0.9999;
      for (let c = 0; c < numChannels; c++) {
        limGains[c] = processLimiterStreamingBlock(
          channels[c]!,
          start,
          end,
          numSamples,
          ceilingLin,
          limLookahead,
          limAttackCoeff,
          limReleaseCoeff,
          limBuffers[c]!,
          limGains[c]!,
        );
      }
    }
  }
}

/**
 * Compressor inner loop on the [start, end) slice. Returns the updated
 * envelope state so the next block continues from there.
 */
function processCompressorBlock(
  channels: Float32Array[],
  start: number,
  end: number,
  params: AudioParams,
  sampleRate: number,
  envelope: number,
  knee: number,
): number {
  const numChannels = channels.length;
  const { attack: attackCoeff, release: releaseCoeff } = makeAttackReleaseCoeffs(
    params.attack / 1000,
    params.release / 1000,
    sampleRate,
  );
  const makeupLin = Math.pow(10, params.makeup / 20);
  let env = envelope;
  for (let i = start; i < end; i++) {
    let level = 0;
    for (let c = 0; c < numChannels; c++) {
      level += Math.abs(channels[c]![i]!);
    }
    level /= numChannels;
    if (level > env) {
      env = attackCoeff * env + (1 - attackCoeff) * level;
    } else {
      env = releaseCoeff * env + (1 - releaseCoeff) * level;
    }
    const inputDb = env > 0 ? 20 * Math.log10(env) : -120;
    const gr = computeGainReduction(inputDb, {
      threshold: params.threshold,
      ratio: params.ratio,
      knee,
    });
    const gainLin = Math.pow(10, gr / 20) * makeupLin;
    for (let c = 0; c < numChannels; c++) {
      channels[c]![i] = channels[c]![i]! * gainLin;
    }
  }
  return env;
}

/**
 * Multiband on a [start, end) slice. Calls `MultibandCompressorDSP.processStereo`
 * with sliced views; the DSP class preserves its splitter + per-band env state
 * across calls, so the slice composition is identical to the whole-buffer call
 * at the same param values.
 */
function processMultibandBlock(
  dsp: MultibandCompressorDSP,
  channels: Float32Array[],
  start: number,
  end: number,
  params: AudioParams,
  _sr: number,
): void {
  const left = channels[0]!.subarray(start, end);
  const right = channels[1]!.subarray(start, end);
  const outL = new Float32Array(end - start);
  const outR = new Float32Array(end - start);

  const band = (prefix: "mbLow" | "mbMid" | "mbHigh"): BandParams => ({
    enabled: params[`${prefix}Enabled` as const],
    solo: params[`${prefix}Solo` as const],
    threshold: params[`${prefix}Threshold` as const],
    ratio: params[`${prefix}Ratio` as const],
    attack: params[`${prefix}Attack` as const] / 1000,
    release: params[`${prefix}Release` as const] / 1000,
    makeup: params[`${prefix}Makeup` as const],
    mode: params[`${prefix}Mode` as const],
    msBalance: params[`${prefix}MsBalance` as const],
  });

  dsp.processStereo(
    left,
    right,
    { low: band("mbLow"), mid: band("mbMid"), high: band("mbHigh") },
    { lowMid: params.mbCrossLowMid, midHigh: params.mbCrossMidHigh },
    { left: outL, right: outR },
  );
  channels[0]!.set(outL, start);
  channels[1]!.set(outR, start);
}

/** Stereo-width on a [start, end) slice. */
function processStereoWidthBlock(
  left: Float32Array,
  right: Float32Array,
  start: number,
  end: number,
  params: AudioParams,
): void {
  const widthScale = params.stereoWidth / 100;
  const midGainLin = Math.pow(10, params.midGain / 20);
  const sideGainLin = Math.pow(10, params.sideGain / 20);
  for (let i = start; i < end; i++) {
    const l = left[i]!;
    const r = right[i]!;
    const mid = (l + r) * 0.5;
    const side = (l - r) * 0.5;
    const midOut = mid * midGainLin;
    const sideOut = side * widthScale * sideGainLin;
    left[i] = midOut + sideOut;
    right[i] = midOut - sideOut;
  }
}

/**
 * Streaming limiter: processes a [start, end) slice in place using a
 * persistent `LookaheadBuffer` + `currentGain`. Returns the updated
 * `currentGain` so the next block's call continues smoothly.
 *
 * `total` is the full input length so the lookahead can read past the slice
 * end (until the global tail).
 */
function processLimiterStreamingBlock(
  buffer: Float32Array,
  start: number,
  end: number,
  total: number,
  ceiling: number,
  lookaheadSamples: number,
  attackCoeff: number,
  releaseCoeff: number,
  state: LookaheadBuffer,
  currentGain: number,
): number {
  let g = currentGain;
  for (let i = start; i < end; i++) {
    const lookAheadIdx = i + lookaheadSamples - 1;
    state.push(lookAheadIdx < total ? buffer[lookAheadIdx]! : 0);
    const peakInWindow = state.peakInWindow();
    const targetGain = peakInWindow <= ceiling ? 1.0 : ceiling / peakInWindow;
    if (targetGain < g) {
      g = attackCoeff * g + (1 - attackCoeff) * targetGain;
    } else {
      g = releaseCoeff * g + (1 - releaseCoeff) * targetGain;
    }
    buffer[i] = buffer[i]! * g;
  }
  return g;
}

/**
 * Apply the 5-band parametric EQ inline using the pure-TS ParametricEqDSP
 * reference (same module the worklet mirrors). Stereo buffers are processed
 * in place. Mono buffers go through processMono.
 */
function applyParametricEq(
  channels: Float32Array[],
  params: AudioParams,
  sampleRate: number,
): void {
  const dsp = new ParametricEqDSP(sampleRate);
  const bands = bandsFromAudioParams(params);
  if (channels.length >= 2) {
    dsp.processStereo(
      channels[0],
      channels[1],
      bands,
      { left: channels[0], right: channels[1] },
    );
  } else if (channels.length === 1) {
    dsp.processMono(channels[0], bands, channels[0]);
  }
}

/**
 * Apply compressor inline — mirrors the compressor-processor.js worklet algorithm.
 * Per-sample envelope follower + gain computer + attack/release smoothing + makeup.
 */
function applyCompressor(
  channels: Float32Array[],
  params: AudioParams,
  sampleRate: number
): void {
  const numChannels = channels.length;
  const numSamples = channels[0].length;

  const { attack: attackCoeff, release: releaseCoeff } = makeAttackReleaseCoeffs(
    params.attack / 1000, // ms → s
    params.release / 1000,
    sampleRate
  );

  const makeupLin = Math.pow(10, params.makeup / 20);
  const knee = 6; // Matches worklet default (AudioParams has no knee field)

  let envelope = 0;

  for (let i = 0; i < numSamples; i++) {
    // Mix to mono for level detection (same as worklet)
    let level = 0;
    for (let c = 0; c < numChannels; c++) {
      level += Math.abs(channels[c][i]);
    }
    level /= numChannels;

    // Envelope follower (peak with attack/release)
    if (level > envelope) {
      envelope = attackCoeff * envelope + (1 - attackCoeff) * level;
    } else {
      envelope = releaseCoeff * envelope + (1 - releaseCoeff) * level;
    }

    // Convert to dB
    const inputDb = envelope > 0 ? 20 * Math.log10(envelope) : -120;

    // Gain computer
    const gr = computeGainReduction(inputDb, {
      threshold: params.threshold,
      ratio: params.ratio,
      knee,
    });

    // Apply gain reduction + makeup to all channels
    const gainLin = Math.pow(10, gr / 20) * makeupLin;
    for (let c = 0; c < numChannels; c++) {
      channels[c][i] *= gainLin;
    }
  }
}

/**
 * Apply multiband compression inline — mirrors the multiband worklet.
 * Processes stereo pair in place using `MultibandCompressorDSP` (the canonical
 * pure-TS reference shared with the worklet).
 *
 * Mono buffers are ignored by the caller — the multiband stage requires L and R.
 */
function applyMultiband(
  channels: Float32Array[],
  params: AudioParams,
  sampleRate: number
): void {
  const left = channels[0];
  const right = channels[1];
  const dsp = new MultibandCompressorDSP(sampleRate);
  const outL = new Float32Array(left.length);
  const outR = new Float32Array(right.length);

  const band = (prefix: "mbLow" | "mbMid" | "mbHigh"): BandParams => ({
    enabled: params[`${prefix}Enabled` as const],
    solo: params[`${prefix}Solo` as const],
    threshold: params[`${prefix}Threshold` as const],
    ratio: params[`${prefix}Ratio` as const],
    attack: params[`${prefix}Attack` as const] / 1000, // ms → s
    release: params[`${prefix}Release` as const] / 1000,
    makeup: params[`${prefix}Makeup` as const],
    mode: params[`${prefix}Mode` as const],
    msBalance: params[`${prefix}MsBalance` as const],
  });

  dsp.processStereo(
    left,
    right,
    { low: band("mbLow"), mid: band("mbMid"), high: band("mbHigh") },
    { lowMid: params.mbCrossLowMid, midHigh: params.mbCrossMidHigh },
    { left: outL, right: outR }
  );
  left.set(outL);
  right.set(outR);
}

/**
 * Apply stereo width via Mid/Side processing.
 * Modifies L and R channels in-place.
 */
function applyStereoWidth(
  left: Float32Array,
  right: Float32Array,
  params: AudioParams
): void {
  const widthScale = params.stereoWidth / 100;
  const midGainLin = Math.pow(10, params.midGain / 20);
  const sideGainLin = Math.pow(10, params.sideGain / 20);

  for (let i = 0; i < left.length; i++) {
    const l = left[i];
    const r = right[i];

    // M/S encode
    const mid = (l + r) * 0.5;
    const side = (l - r) * 0.5;

    // Apply gains
    const midOut = mid * midGainLin;
    const sideOut = side * widthScale * sideGainLin;

    // M/S decode
    left[i] = midOut + sideOut;
    right[i] = midOut - sideOut;
  }
}
