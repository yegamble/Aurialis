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
import { processLimiter, dbToLin } from "./dsp/limiter";
import {
  MultibandCompressorDSP,
  type BandParams,
} from "./dsp/multiband";
import {
  ParametricEqDSP,
  bandsFromAudioParams,
} from "./dsp/parametric-eq";

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
  targetSampleRate: number
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

  applyProcessingPipeline(channels, params, sr);

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
): void {
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
