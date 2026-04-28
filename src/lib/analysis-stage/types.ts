/**
 * Shared types for the analysis-stage observability harness.
 *
 * Every analysis flow (Deep Analysis, Smart Split, Mastering Auto-master,
 * Stem-Mixer auto-mix) emits events through the same shape so the UI cards
 * and console output have consistent semantics. See
 * `docs/plans/2026-04-28-verbose-analysis-progress.md` for the contract.
 */

/** The four flows in Aurialis that surface progress through the harness. */
export type AnalysisFlow =
  | "deep"
  | "smart-split"
  | "mastering-auto"
  | "auto-mix";

/** Lifecycle phase for a single stage event. */
export type AnalysisStagePhase = "start" | "tick" | "end" | "error";

/** A single observation point inside a flow's lifecycle. */
export interface AnalysisStageEvent {
  /** Which flow this event belongs to. */
  flow: AnalysisFlow;
  /** Per-run UUID — groups all events of one analysis run. */
  runId: string;
  /** Stage name within the flow, e.g. "stems", "loudness", "stem-2/4". */
  stage: string;
  /** Lifecycle phase for this event. */
  phase: AnalysisStagePhase;
  /** Optional 0–100 progress hint. */
  progress?: number;
  /** ms since epoch. */
  at: number;
  /** Free-form context — error messages, file names, etc. */
  note?: string;
}

/** Aggregated state for one analysis run. */
export interface AnalysisRun {
  /** UUID identifying this run. */
  runId: string;
  /** Which flow this run belongs to. */
  flow: AnalysisFlow;
  /** ms since epoch when the first event landed. */
  startedAt: number;
  /** ms since epoch of the terminal event (`end` or `error`). Null while running. */
  endedAt: number | null;
  /** Chronological event log. */
  stages: AnalysisStageEvent[];
  /** Most recent `start` whose `end` has not yet arrived. */
  activeStage: string | null;
  /** Populated when the run terminated via `error`. */
  error: { stage: string; message: string; raw: string } | null;
}
