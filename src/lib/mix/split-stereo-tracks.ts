/**
 * Build the two hard-panned sub-stem tracks produced by a stereo sub-split.
 *
 * Kept separate from the DSP in `stereo-split.ts` (which stays free of mixer
 * types) and from the React handler in `StemsView` so the wiring decisions —
 * naming, hard-pan params, preserved offset/classification — are pure and
 * unit-testable without an AudioContext or the mixer engine.
 */

import type { StemTrack } from "@/types/mixer";
import { DEFAULT_CHANNEL_PARAMS, STEM_COLORS } from "@/types/mixer";
import type { StereoSplitResult } from "@/lib/audio/stereo-split";

interface SubTrackSpec {
  suffix: "L" | "R";
  /** Hard-pan position for the reconstructed channel. */
  pan: number;
  data: Float32Array;
}

/**
 * Turn a {@link StereoSplitResult} for `parent` into two new stems: the
 * reconstructed left channel hard-panned left, the right channel hard-panned
 * right. `makeBuffer`/`peaksOf` are injected so this stays testable.
 *
 * @param idSeed a monotonically-unique value (e.g. `Date.now()`) so repeated
 *   splits of the same parent never collide on `id`.
 */
export function buildStereoSubTracks(
  parent: StemTrack,
  split: StereoSplitResult,
  makeBuffer: (data: Float32Array) => AudioBuffer,
  peaksOf: (buffer: AudioBuffer) => number[],
  idSeed: number
): StemTrack[] {
  const base = parent.name.replace(/\.wav$/i, "");
  const sides: SubTrackSpec[] = [
    { suffix: "L", pan: -1, data: split.left },
    { suffix: "R", pan: 1, data: split.right },
  ];

  return sides.map((side, i) => {
    const buffer = makeBuffer(side.data);
    return {
      id: `${parent.id}-lr-${side.suffix}-${idSeed}`,
      name: `${base} → ${side.suffix}.wav`,
      audioBuffer: buffer,
      waveformPeaks: peaksOf(buffer),
      classification: parent.classification,
      confidence: parent.confidence,
      channelParams: { ...DEFAULT_CHANNEL_PARAMS, pan: side.pan },
      offset: parent.offset,
      duration: buffer.duration,
      color: STEM_COLORS[i % STEM_COLORS.length],
    };
  });
}
