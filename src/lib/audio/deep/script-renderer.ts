/**
 * script-renderer — offline-render counterpart of `script-engine.ts`.
 *
 * Where `script-engine` posts envelopes into running worklets,
 * `script-renderer` resolves a `MasteringScript` to a per-time-slice
 * `AudioParams` override that the offline pipeline can read at the start
 * of each 128-sample block. This keeps offline rendering bit-aligned
 * with real-time worklet evaluation (per Spike S2: per-block + smoother).
 */

import type {
  EnvelopePoint,
  MasteringScript,
  Move,
  MoveParam,
} from "@/types/deep-mastering";
import type { AudioParams } from "@/lib/stores/audio-store";

/**
 * The pipeline reads envelope values once per 128 samples — matching the
 * real-time worklet's block size (per Spike S2). Smaller chunks would
 * over-resolve; larger chunks would deviate from real-time bit-for-bit.
 */
export const SCRIPT_RENDER_BLOCK_SIZE = 128;

/**
 * Linear-interpolate envelope value at `time`. Returns `null` when:
 *   - the envelope has fewer than 2 points (not legal per schema, but be safe)
 *   - `time` falls before the first point or after the last (we let the
 *     caller decide whether to clamp; the MoveParam override path clamps to
 *     first/last per AudioParam semantics).
 *
 * Used internally by `resolveParamsAtTime`. Exported for testing.
 */
export function envelopeValueAt(
  env: ReadonlyArray<EnvelopePoint>,
  time: number
): number | null {
  if (env.length < 2) return null;
  if (time <= env[0]![0]) return env[0]![1];
  const last = env[env.length - 1]!;
  if (time >= last[0]) return last[1];
  for (let i = 1; i < env.length; i++) {
    const a = env[i - 1]!;
    const b = env[i]!;
    if (time < b[0]) {
      const span = b[0] - a[0];
      if (span <= 0) return b[1];
      const u = (time - a[0]) / span;
      return a[1] + u * (b[1] - a[1]);
    }
  }
  return last[1];
}

/**
 * Apply one Move's resolved value as an `AudioParams` field override.
 * Unsupported MoveParams (master.aiRepair.amount before T10 / T11,
 * inputGain, compressor attack/release) are silent no-ops.
 */
export function applyMoveOverride(
  params: AudioParams,
  param: MoveParam,
  value: number
): AudioParams {
  switch (param) {
    case "master.compressor.threshold":
      return { ...params, threshold: value };
    case "master.compressor.ratio":
      return { ...params, ratio: value };
    case "master.compressor.makeup":
      return { ...params, makeup: value };
    case "master.saturation.drive":
      return { ...params, satDrive: value };
    case "master.stereoWidth.width":
      return { ...params, stereoWidth: value };
    case "master.eq.band1.gain":
      return { ...params, eq80: value };
    case "master.eq.band2.gain":
      return { ...params, eq250: value };
    case "master.eq.band3.gain":
      return { ...params, eq1k: value };
    case "master.eq.band4.gain":
      return { ...params, eq4k: value };
    case "master.eq.band5.gain":
      return { ...params, eq12k: value };
    // No offline override defined for: inputGain, compressor.{attack,release},
    // master.aiRepair.amount (added in T10/T11).
    default:
      return params;
  }
}

/**
 * Resolve the effective `AudioParams` at a given track-time by overlaying
 * each Move's envelope value on the base params. Muted moves are skipped.
 */
export function resolveParamsAtTime(
  base: AudioParams,
  script: MasteringScript | null,
  time: number
): AudioParams {
  if (!script) return base;
  let out = base;
  for (const m of script.moves) {
    if (m.muted) continue;
    const v = envelopeValueAt(m.envelope, time);
    if (v === null) continue;
    out = applyMoveOverride(out, m.param, v);
  }
  return out;
}

/** Test helper — derive the block start time at sample-index `start`. */
export function blockStartTimeSec(start: number, sampleRate: number): number {
  return start / sampleRate;
}

/** Filter a script's moves down to those targeting offline-supported params. */
export function offlineSupportedMoves(script: MasteringScript): Move[] {
  return script.moves.filter((m) => isOfflineSupported(m.param));
}

function isOfflineSupported(param: MoveParam): boolean {
  switch (param) {
    case "master.compressor.threshold":
    case "master.compressor.ratio":
    case "master.compressor.makeup":
    case "master.saturation.drive":
    case "master.stereoWidth.width":
    case "master.eq.band1.gain":
    case "master.eq.band2.gain":
    case "master.eq.band3.gain":
    case "master.eq.band4.gain":
    case "master.eq.band5.gain":
      return true;
    default:
      return false;
  }
}
