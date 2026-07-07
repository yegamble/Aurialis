/**
 * Album loudness normalization — the truth fix for the batch pipeline.
 *
 * The offline renderer applies each track's persisted chain but ignores
 * `params.targetLufs`, so a batch would render every track at its own loudness
 * rather than the shared album target. This module measures the rendered
 * loudness with the repo's ITU-R BS.1770 integrated-LUFS code and returns the
 * static gain that lands the track on the album target — capped so the
 * post-gain true peak never exceeds the ceiling.
 *
 * Pure and buffer-agnostic (operates on channel Float32Arrays) so it unit-tests
 * without a Web Audio context. The renderer itself is never touched.
 */

import { computeIntegratedLufs } from "@/lib/audio/dsp/lufs";
import { detectTruePeakDbTp } from "@/lib/audio/dsp/true-peak";

/** Default streaming true-peak ceiling (dBTP) when a track has no persisted one. */
export const DEFAULT_CEILING_DBTP = -1;

/**
 * Gain (in dB) to move `channels` from their measured integrated loudness onto
 * `targetLufs`, guarded so the resulting true peak stays at or below
 * `ceilingDbTp`. Returns 0 (no-op) when loudness can't be measured (silence /
 * too short to gate), so a non-finite measurement never corrupts the render.
 */
export function computeAlbumGainDb(
  channels: Float32Array[],
  sampleRate: number,
  targetLufs: number,
  ceilingDbTp: number = DEFAULT_CEILING_DBTP,
): number {
  if (channels.length === 0) return 0;
  const left = channels[0]!;
  const right = channels[1] ?? left;

  const measured = computeIntegratedLufs(left, right, sampleRate);
  if (!Number.isFinite(measured)) return 0;

  const deltaDb = targetLufs - measured;

  // Predict the post-gain true peak (linear gain shifts dBTP by the same dB) and
  // cap the gain so it never pushes the loudest inter-sample peak past the
  // ceiling. Attenuation is always allowed; only boosts are clamped.
  let peakDbTp = -Infinity;
  for (const ch of channels) {
    const p = detectTruePeakDbTp(ch);
    if (p > peakDbTp) peakDbTp = p;
  }
  if (!Number.isFinite(peakDbTp)) return deltaDb;

  const maxBoost = ceilingDbTp - peakDbTp;
  return deltaDb > maxBoost ? maxBoost : deltaDb;
}

/** Multiply every channel in place by `gainDb`. A 0 dB gain is a no-op. */
export function applyGainDb(channels: Float32Array[], gainDb: number): void {
  if (gainDb === 0) return;
  const linear = Math.pow(10, gainDb / 20);
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i += 1) ch[i] *= linear;
  }
}

/**
 * Measure + gain in one step, mutating `channels` so they sit on `targetLufs`
 * (peak-guarded). Returns the applied gain in dB for logging/testing.
 */
export function normalizeToAlbumTarget(
  channels: Float32Array[],
  sampleRate: number,
  targetLufs: number,
  ceilingDbTp: number = DEFAULT_CEILING_DBTP,
): number {
  const gainDb = computeAlbumGainDb(channels, sampleRate, targetLufs, ceilingDbTp);
  applyGainDb(channels, gainDb);
  return gainDb;
}
