/**
 * Offline mix renderer — renders all stems with per-stem processing
 * into a single stereo AudioBuffer. Used for "Send to Master" and "Export Mix".
 */

import type { StemTrack } from "@/types/mixer";
import type { AudioParams } from "@/types/mastering";
import { renderOffline } from "./renderer";

/**
 * Render all stems mixed into a single stereo AudioBuffer offline.
 * Applies per-stem volume, pan, EQ, compressor, saturation, and time offset.
 */
export async function renderMix(
  stems: StemTrack[],
  targetSampleRate: number,
  masterParams?: AudioParams
): Promise<AudioBuffer> {
  if (stems.length === 0) {
    throw new Error("No stems to render");
  }

  // Calculate total duration (max stem duration + offset)
  let totalDuration = 0;
  for (const stem of stems) {
    const duration = stem.duration + stem.offset;
    if (duration > totalDuration) {
      totalDuration = duration;
    }
  }
  const totalSamples = Math.ceil(totalDuration * targetSampleRate);

  const offlineCtx = new OfflineAudioContext(
    2, // stereo output
    totalSamples,
    targetSampleRate
  );

  // Create a summing bus
  const summingBus = offlineCtx.createGain();
  summingBus.connect(offlineCtx.destination);

  for (const stem of stems) {
    if (!stem.audioBuffer || stem.channelParams.mute) continue;

    const params = stem.channelParams;

    // Source
    const source = offlineCtx.createBufferSource();
    source.buffer = stem.audioBuffer;

    // Volume
    const volumeGain = offlineCtx.createGain();
    volumeGain.gain.value = Math.pow(10, params.volume / 20);

    // Pan
    const panner = offlineCtx.createStereoPanner();
    panner.pan.value = params.pan;

    // 5-band EQ
    const eqTypes: BiquadFilterType[] = [
      "lowshelf", "peaking", "peaking", "peaking", "highshelf",
    ];
    const eqFreqs = [80, 250, 1000, 4000, 12000];
    const eqBands = eqTypes.map((type, i) => {
      const filter = offlineCtx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = eqFreqs[i];
      filter.gain.value = params.eq[i];
      if (type === "peaking") filter.Q.value = 1;
      return filter;
    });

    // Compressor
    const compressor = offlineCtx.createDynamicsCompressor();
    compressor.threshold.value = params.compThreshold;
    compressor.ratio.value = params.compRatio;
    compressor.attack.value = params.compAttack / 1000;
    compressor.release.value = params.compRelease / 1000;

    // Makeup gain (applied after compressor)
    const makeupGain = offlineCtx.createGain();
    makeupGain.gain.value = Math.pow(10, params.compMakeup / 20);

    // Saturation (WaveShaperNode with tanh curve)
    const saturation = offlineCtx.createWaveShaper();
    if (params.satDrive > 0) {
      const samples = 8192;
      const curve = new Float32Array(samples);
      const factor = 1 + (params.satDrive / 100) * 4;
      for (let j = 0; j < samples; j++) {
        const x = (j * 2) / samples - 1;
        curve[j] = Math.tanh(x * factor);
      }
      saturation.curve = curve as unknown as Float32Array;
      saturation.oversample = "4x";
    }

    // Wire: source → volume → pan → eq chain → compressor → makeup → saturation → summingBus
    source.connect(volumeGain);
    volumeGain.connect(panner);
    panner.connect(eqBands[0]);
    for (let i = 0; i < eqBands.length - 1; i++) {
      eqBands[i].connect(eqBands[i + 1]);
    }
    eqBands[eqBands.length - 1].connect(compressor);
    compressor.connect(makeupGain);
    if (params.satDrive > 0) {
      makeupGain.connect(saturation);
      saturation.connect(summingBus);
    } else {
      makeupGain.connect(summingBus);
    }

    // Start with time offset
    source.start(stem.offset);
  }

  const stemMix = await offlineCtx.startRendering();
  return masterParams
    ? renderOffline(stemMix, masterParams, targetSampleRate)
    : stemMix;
}
