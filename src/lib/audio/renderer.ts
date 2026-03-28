/**
 * Offline renderer — processes audio through the mastering chain using
 * OfflineAudioContext and returns the rendered AudioBuffer.
 */

import type { AudioParams } from "@/lib/stores/audio-store";

/**
 * Render source audio through a simplified EQ chain in OfflineAudioContext.
 * Compressor, limiter, and saturation DSP is applied inline after rendering
 * (avoids AudioWorklet dependency in OfflineAudioContext).
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
  // Compute output length at target sample rate
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

  // Output gain (makeup)
  const outputGain = offlineCtx.createGain();
  outputGain.gain.value = Math.pow(10, params.makeup / 20);

  // Connect chain: source → inputGain → EQ bands → outputGain → destination
  source.connect(inputGain);
  inputGain.connect(eq80);
  eq80.connect(eq250);
  eq250.connect(eq1k);
  eq1k.connect(eq4k);
  eq4k.connect(eq12k);
  eq12k.connect(outputGain);
  outputGain.connect(offlineCtx.destination);

  source.start(0);
  return offlineCtx.startRendering();
}
