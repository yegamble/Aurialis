/**
 * Deep Analysis stage derivation + emitter factory.
 *
 * Translates `DeepJobStatus` snapshots from `pollDeepJobStatus` into the
 * stage names surfaced by the analysis-stage harness. The emitter returned
 * by `makeDeepStageEmitter` is meant to be passed verbatim as the `onPoll`
 * callback to `pollUntilDone`.
 */

import { emitStage, emitErrorTrace } from "@/lib/analysis-stage/emitter";
import type { DeepJobStatus } from "./deep-analysis";

/** Stage names surfaced for the deep-analysis flow. */
export type DeepStage =
  | "upload-start"
  | "queued"
  | "sections"
  | "stems"
  | "script"
  | "done"
  | "error";

/**
 * Map a status snapshot to a `DeepStage`. Order of checks matters:
 * `script` > `stems` > `sections` because `partial_result` accumulates keys
 * and the most-advanced one is the active stage.
 */
export function deriveDeepStage(status: DeepJobStatus): DeepStage {
  if (status.status === "error") return "error";
  if (status.status === "done") return "done";
  const partial = status.partialResult ?? {};
  if ("script" in partial) return "script";
  if ("stems" in partial) return "stems";
  if ("sections" in partial) return "sections";
  return "queued";
}

const STAGE_LABELS: Record<DeepStage, string> = {
  "upload-start": "Uploading",
  queued: "Queued",
  sections: "Detecting sections",
  stems: "Analyzing stems",
  script: "Generating script",
  done: "Done",
  error: "Error",
};

/** Human-readable label for a DeepStage. Used by the progress card UI. */
export function deepStageLabel(stage: DeepStage): string {
  return STAGE_LABELS[stage];
}

export type DeepStageEmitter = (
  status: DeepJobStatus,
  elapsedMs: number
) => void;

/**
 * Build a stateful onPoll callback that emits stage transitions for one run.
 *
 * - On the first poll, emits a `start` for whichever stage is active.
 * - On each subsequent poll, only emits when the derived stage CHANGES.
 * - When the terminal `done` stage is reached, emits an `end` event so the
 *   harness store records `endedAt` and prunes after the success TTL.
 * - On `error` status, emits an `error` event and dumps the chronological
 *   trace as a single `console.error` JSON line via `emitErrorTrace`.
 */
export function makeDeepStageEmitter(runId: string): DeepStageEmitter {
  let prevStage: DeepStage | null = null;

  return (status, _elapsedMs) => {
    const stage = deriveDeepStage(status);

    if (stage === "error") {
      const errorMsg = status.error ?? "Unknown backend error";
      emitStage({
        flow: "deep",
        runId,
        stage: "error",
        phase: "error",
        note: errorMsg,
      });
      emitErrorTrace(runId, errorMsg);
      prevStage = "error";
      return;
    }

    if (stage === "done") {
      // Single end event marks the run complete.
      emitStage({
        flow: "deep",
        runId,
        stage: "done",
        phase: "end",
        progress: 100,
      });
      prevStage = "done";
      return;
    }

    if (stage !== prevStage) {
      emitStage({
        flow: "deep",
        runId,
        stage,
        phase: "start",
        progress: status.progress,
      });
      prevStage = stage;
    }
  };
}

/**
 * Emit the synthetic "upload-start" stage at the very beginning of a run,
 * before the network request to `/analyze/deep` resolves. This gives the
 * UI an immediate first stage so users see motion within ~50ms of clicking
 * Analyze.
 */
export function emitUploadStart(runId: string): void {
  emitStage({
    flow: "deep",
    runId,
    stage: "upload-start",
    phase: "start",
  });
}

import type { AnalysisRun } from "@/lib/analysis-stage/types";

/** View-derived props for `DeepProgressCard`, computed from one harness run. */
export interface DeepStageView {
  stageDurationsMs: { sections?: number; stems?: number; script?: number };
  failedAtStageLabel: string | null;
  stageTraceText: string | null;
}

/**
 * Reduce a harness run into the values the progress card needs:
 *
 * - per-stage durations for `sections`, `stems`, `script` (in ms)
 * - human-readable failed-at-stage label when the run errored
 * - chronological trace text for the error details `<pre>` block
 *
 * Pure — given the same run, returns the same view. Safe to call inside
 * a React render path.
 */
export function computeDeepStageView(
  run: AnalysisRun | undefined,
  now: number = Date.now()
): DeepStageView {
  if (!run) {
    return {
      stageDurationsMs: {},
      failedAtStageLabel: null,
      stageTraceText: null,
    };
  }

  const stageDurationsMs: DeepStageView["stageDurationsMs"] = {};
  const trackedStages: ReadonlyArray<"sections" | "stems" | "script"> = [
    "sections",
    "stems",
    "script",
  ];
  for (const stage of trackedStages) {
    const startEvent = run.stages.find(
      (e) => e.stage === stage && e.phase === "start"
    );
    if (!startEvent) continue;
    // End time is the next event after this one, or run.endedAt, or now.
    const idx = run.stages.indexOf(startEvent);
    const next = run.stages[idx + 1];
    const endAt = next?.at ?? run.endedAt ?? now;
    stageDurationsMs[stage] = Math.max(0, endAt - startEvent.at);
  }

  let failedAtStageLabel: string | null = null;
  if (run.error) {
    // Look back for the most recent `start` to identify which stage was
    // active when the error landed.
    const lastStart = [...run.stages]
      .reverse()
      .find((e) => e.phase === "start");
    const failedStage = (lastStart?.stage ?? "queued") as DeepStage;
    failedAtStageLabel = deepStageLabel(failedStage);
  }

  const stageTraceText = run.stages.length
    ? run.stages
        .map((e) => {
          const offsetSec = ((e.at - run.startedAt) / 1000).toFixed(1);
          const phaseTag =
            e.phase === "error"
              ? " (failed)"
              : e.phase === "end"
                ? " (done)"
                : "";
          const note = e.note ? ` — ${e.note}` : "";
          return `${e.stage} +${offsetSec}s${phaseTag}${note}`;
        })
        .join("\n")
    : null;

  return { stageDurationsMs, failedAtStageLabel, stageTraceText };
}
