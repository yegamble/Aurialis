/**
 * Offline renderer — processes audio through the mastering chain using
 * OfflineAudioContext for EQ, then applies compressor, saturation,
 * stereo width, and limiter inline via pure DSP functions.
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

  // 5-band EQ using BiquadFilterNodes (same topology as nodes/eq.ts)
  const eq80 = offlineCtx.createBiquadFilter();
  eq80.type = "lowshelf";
  eq80.frequency.value = 80;
  eq80.gain.value = params.eq80;

  const eq250 = offlineCtx.createBiquadFilter();
  eq250.type = "peaking";
  eq250.frequency.value = 250;
  eq250.Q.value = 1.0;
  eq250.gain.value = params.eq250;

  const eq1k = offlineCtx.createBiquadFilter();
  eq1k.type = "peaking";
  eq1k.frequency.value = 1000;
  eq1k.Q.value = 1.0;
  eq1k.gain.value = params.eq1k;

  const eq4k = offlineCtx.createBiquadFilter();
  eq4k.type = "peaking";
  eq4k.frequency.value = 4000;
  eq4k.Q.value = 1.0;
  eq4k.gain.value = params.eq4k;

  const eq12k = offlineCtx.createBiquadFilter();
  eq12k.type = "highshelf";
  eq12k.frequency.value = 12000;
  eq12k.gain.value = params.eq12k;

  // Connect chain: source → inputGain → EQ bands → destination
  // (No output gain node — makeup is part of the compressor stage below)
  source.connect(inputGain);
  inputGain.connect(eq80);
  eq80.connect(eq250);
  eq250.connect(eq1k);
  eq1k.connect(eq4k);
  eq4k.connect(eq12k);
  eq12k.connect(offlineCtx.destination);

  source.start(0);
  const rendered = await offlineCtx.startRendering();

  // --- Inline DSP: Compressor → Saturation → Stereo Width → Limiter ---
  // Matches the real-time chain order in chain.ts

  const channels: Float32Array[] = [];
  for (let c = 0; c < rendered.numberOfChannels; c++) {
    channels.push(rendered.getChannelData(c));
  }
  const sr = rendered.sampleRate;

  // 1. Compressor (mirrors compressor-processor.js algorithm)
  applyCompressor(channels, params, sr);

  // 1b. Multiband compressor (skipped when multibandEnabled === 0 for
  // bit-equivalent output vs. pre-P2 renders)
  if (params.multibandEnabled > 0 && channels.length >= 2) {
    applyMultiband(channels, params, sr);
  }

  // 2. Saturation
  if (params.satDrive > 0) {
    const driveFactor = drivePctToFactor(params.satDrive);
    for (let c = 0; c < channels.length; c++) {
      const processed = applySaturation(channels[c], driveFactor);
      channels[c].set(processed);
    }
  }

  // 3. Stereo Width (M/S processing, only for stereo)
  if (channels.length >= 2) {
    const needsWidth = params.stereoWidth !== 100 || params.midGain !== 0 || params.sideGain !== 0;
    if (needsWidth) {
      applyStereoWidth(channels[0], channels[1], params);
    }
  }

  // 4. Limiter
  const ceilingLin = dbToLin(params.ceiling);
  // Convert limiterRelease from ms to appropriate coefficients
  const limiterReleaseSamples = Math.round((params.limiterRelease / 1000) * sr);
  const releaseCoeff = limiterReleaseSamples > 0
    ? Math.exp(-1 / limiterReleaseSamples)
    : 0.9999;
  const lookaheadSamples = Math.round(0.0015 * sr); // ~1.5ms lookahead
  for (let c = 0; c < channels.length; c++) {
    const limited = processLimiter(channels[c], ceilingLin, lookaheadSamples, 0.001, releaseCoeff);
    channels[c].set(limited);
  }

  return rendered;
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
