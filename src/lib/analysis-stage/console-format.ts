/**
 * Console-line formatting helpers for analysis stage events.
 * Pure functions — no side effects.
 */

import type { AnalysisFlow, AnalysisStageEvent } from "./types";

/** Render the bracketed prefix `[analysis:<flow>:<stage>]`. */
export function formatPrefix(flow: AnalysisFlow, stage: string): string {
  return `[analysis:${flow}:${stage}]`;
}

/**
 * Render an elapsed-since-runStart duration as `+Ns` for sub-minute,
 * `+NmSSs` for minute+ values. Negative inputs clamp to `+0.0s`.
 */
export function formatElapsed(elapsedMs: number): string {
  const ms = Math.max(0, elapsedMs);
  if (ms < 60_000) {
    const sec = (ms / 1000).toFixed(1);
    return `+${sec}s`;
  }
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `+${m}m${s.toString().padStart(2, "0")}s`;
}

/**
 * Render one full line: prefix + elapsed + optional note + optional progress.
 * Example: `[analysis:deep:stems] +12.3s queued by backend (progress: 40%)`.
 */
export function formatLine(
  event: AnalysisStageEvent,
  runStartedAt: number
): string {
  const prefix = formatPrefix(event.flow, event.stage);
  const elapsed = formatElapsed(event.at - runStartedAt);
  const parts: string[] = [prefix, elapsed];
  if (event.note) parts.push(event.note);
  if (typeof event.progress === "number") {
    parts.push(`(progress: ${Math.round(event.progress)}%)`);
  }
  return parts.join(" ");
}
