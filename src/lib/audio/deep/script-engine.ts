/**
 * script-engine — translation layer between the persistent `MasteringScript`
 * (in track-time, seconds from track start) and the worklet/AudioParam
 * envelope schedulers (in AudioContext time).
 *
 * Pure functions; no AudioContext or playback state of its own. The
 * `AudioEngine` (engine.ts) calls into this module on play / pause / seek /
 * live-edit and supplies the necessary timing context.
 */

import type { ProcessingChain } from "../chain";
import type {
  EnvelopePoint,
  MasteringScript,
  Move,
} from "@/types/deep-mastering";

/**
 * Compute the offset to add to a Move's track-time envelope timestamps so
 * they line up with `AudioContext.currentTime` for the running playback.
 *
 *   envelopeTime_in_context = trackTime - startedFromTrackTime + contextTimeAtPlayStart
 *
 * That collapses to: offset = contextTimeAtPlayStart - startedFromTrackTime.
 */
export function computeContextOffset(
  contextTimeAtPlayStart: number,
  startedFromTrackTime: number
): number {
  return contextTimeAtPlayStart - startedFromTrackTime;
}

/** Translate one Move's envelope into AudioContext time. */
export function translateEnvelope(
  envelope: ReadonlyArray<EnvelopePoint>,
  offset: number
): EnvelopePoint[] {
  const out: EnvelopePoint[] = new Array(envelope.length);
  for (let i = 0; i < envelope.length; i++) {
    const p = envelope[i]!;
    out[i] = [p[0] + offset, p[1]];
  }
  return out;
}

/**
 * Apply a single Move's envelope. Honors `move.muted` (translates to a clear
 * so the worklet falls back to the last static value). Returns true when a
 * node accepted the envelope, false when the param has no scheduling target.
 */
export function applyMove(
  chain: ProcessingChain,
  move: Move,
  contextTimeAtPlayStart: number,
  startedFromTrackTime: number
): boolean {
  if (move.muted) {
    return chain.clearMoveEnvelope(move.param);
  }
  const offset = computeContextOffset(contextTimeAtPlayStart, startedFromTrackTime);
  const translated = translateEnvelope(move.envelope, offset);
  return chain.applyMoveEnvelope(move.param, translated);
}

/**
 * Apply every Move in the script. Returns the count of envelopes successfully
 * posted (so callers can detect a "script applied but every param was a
 * scheduling no-op" pathological case).
 */
export function applyScript(
  chain: ProcessingChain,
  script: MasteringScript,
  contextTimeAtPlayStart: number,
  startedFromTrackTime: number = 0
): number {
  let posted = 0;
  for (const move of script.moves) {
    if (applyMove(chain, move, contextTimeAtPlayStart, startedFromTrackTime)) {
      posted++;
    }
  }
  return posted;
}

/**
 * Clear every Move's envelope. Used on pause and stop so the worklets revert
 * to the last static `value:` setting for each param (no audible glitch — the
 * one-pole smoother bridges the transition).
 */
export function clearScript(
  chain: ProcessingChain,
  script: MasteringScript
): void {
  for (const move of script.moves) {
    chain.clearMoveEnvelope(move.param);
  }
}
