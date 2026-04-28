/**
 * Stage emitter — single side-effecting entry point for the analysis-stage
 * harness. Calls the Zustand store and writes a structured console line.
 */

import { useAnalysisStageStore } from "@/lib/stores/analysis-stage-store";
import { formatLine, formatPrefix } from "./console-format";
import type {
  AnalysisFlow,
  AnalysisStageEvent,
  AnalysisStagePhase,
} from "./types";

interface EmitInput {
  flow: AnalysisFlow;
  runId: string;
  stage: string;
  phase: AnalysisStagePhase;
  progress?: number;
  note?: string;
  /** Optional override; defaults to Date.now(). */
  at?: number;
}

function isVerboseEnabled(): boolean {
  const override = (globalThis as { __ANALYSIS_VERBOSE__?: boolean })
    .__ANALYSIS_VERBOSE__;
  if (typeof override === "boolean") return override;
  // Reads through process.env so Next.js's compile-time substitution applies.
  return process.env.NEXT_PUBLIC_ANALYSIS_VERBOSE === "true";
}

/** Generate a UUID-ish string for one analysis run. */
export function newRunId(): string {
  const c = (
    globalThis as { crypto?: { randomUUID?: () => string } }
  ).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `run-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

/**
 * Emit a single stage event: append to the store and write the corresponding
 * console line. `tick` events are gated behind `NEXT_PUBLIC_ANALYSIS_VERBOSE`.
 */
export function emitStage(input: EmitInput): void {
  const event: AnalysisStageEvent = {
    flow: input.flow,
    runId: input.runId,
    stage: input.stage,
    phase: input.phase,
    progress: input.progress,
    note: input.note,
    at: input.at ?? Date.now(),
  };

  useAnalysisStageStore.getState().appendStage(event);

  // Resolve runStartedAt for elapsed formatting. After append, the run is
  // guaranteed to exist; fall back to event.at if somehow missing.
  const run = useAnalysisStageStore.getState().runs[event.runId];
  const runStartedAt = run?.startedAt ?? event.at;
  const line = formatLine(event, runStartedAt);

  switch (event.phase) {
    case "start":
    case "end":
      console.info(line);
      break;
    case "error":
      // No console output here — every error call site is followed by
      // `emitErrorTrace`, which writes the single authoritative
      // `console.error` line containing the full stages array. Logging
      // here would produce a duplicate line and contradict the
      // "exactly one console.error on failure" contract.
      break;
    case "tick":
      if (isVerboseEnabled()) console.debug(line);
      break;
  }
}

/**
 * Dump the chronological stage trace for a failed run as a single
 * `console.error` line so devs can copy/paste it and reconstruct the
 * timeline. Idempotent — does not mutate the store.
 */
export function emitErrorTrace(runId: string, errorMessage: string): void {
  const run = useAnalysisStageStore.getState().runs[runId];
  if (!run) {
    console.error(
      `[analysis:unknown:error] runId=${runId} ${errorMessage} (no trace available)`
    );
    return;
  }
  const trace = {
    flow: run.flow,
    runId,
    error: errorMessage,
    durationMs:
      run.endedAt !== null ? run.endedAt - run.startedAt : null,
    stages: run.stages.map((e) => ({
      stage: e.stage,
      phase: e.phase,
      atOffsetMs: e.at - run.startedAt,
      progress: e.progress,
      note: e.note,
    })),
  };
  const prefix = formatPrefix(run.flow, "error");
  console.error(`${prefix} ${JSON.stringify(trace)}`);
}
