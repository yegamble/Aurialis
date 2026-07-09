/**
 * Envelope → timeline-geometry helpers for DeepTimeline.
 *
 * Real scripts emit ONE whole-track envelope move per parameter
 * (startSec = 0, per-section values inside `envelope`), not discrete
 * point-moves — so rendering a single marker at startSec collapsed every
 * lane to one dot half-clipped at x=0. These helpers turn an envelope into
 * the breakpoints worth drawing.
 */

import type { Move } from "@/types/deep-mastering";

export interface EnvelopeBreakpoint {
  t: number;
  v: number;
}

/**
 * The envelope points worth marking: the first point, plus every point
 * whose value differs from the previous kept point. A flat envelope yields
 * a single breakpoint; a malformed/empty one falls back to the move's
 * startSec/original so the move stays visible and clickable.
 */
export function envelopeBreakpoints(move: Move): EnvelopeBreakpoint[] {
  const env = Array.isArray(move.envelope) ? move.envelope : [];
  const out: EnvelopeBreakpoint[] = [];
  for (const point of env) {
    if (!Array.isArray(point) || point.length < 2) continue;
    const [t, v] = point;
    if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
    if (out.length === 0 || Math.abs(v - out[out.length - 1].v) > 1e-9) {
      out.push({ t, v });
    }
  }
  if (out.length === 0) {
    out.push({
      t: Number.isFinite(move.startSec) ? move.startSec : 0,
      v: Number.isFinite(move.original) ? move.original : 0,
    });
  }
  return out;
}

/**
 * Per-breakpoint vertical levels normalized to 0..1 (1 = the move's max
 * value). Parameters have wildly different units, so normalization is
 * per-move: the lane shows the SHAPE of the automation, not absolute
 * values. Flat envelopes sit at 0.5 (lane center).
 */
export function normalizedLevels(points: EnvelopeBreakpoint[]): number[] {
  const values = points.map((p) => p.v);
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (!(max - min > 1e-9)) return points.map(() => 0.5);
  return points.map((p) => (p.v - min) / (max - min));
}
