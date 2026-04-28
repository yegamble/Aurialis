/**
 * Smart Split stage derivation + emitter factory. Mirrors `deep-stage.ts`.
 *
 * Backend reference: `backend/separation.py:36-130` — progress jumps
 * 0 → 10 → 50–89 → 90 → 100 across the lifecycle.
 */

import { emitStage, emitErrorTrace } from "@/lib/analysis-stage/emitter";
import type { AnalysisRun } from "@/lib/analysis-stage/types";
import type { JobStatus } from "./separation";

/** Stage names surfaced for the smart-split flow. */
export type SeparationStage =
  | "upload-start"
  | "queued"
  | "separating-stems"
  | "finalizing"
  | "downloading"
  | "done"
  | "error";

const STAGE_LABELS: Record<SeparationStage, string> = {
  "upload-start": "Uploading",
  queued: "Queued",
  "separating-stems": "Separating stems",
  finalizing: "Finalizing",
  downloading: "Downloading stems",
  done: "Done",
  error: "Error",
};

export function separationStageLabel(stage: SeparationStage): string {
  return STAGE_LABELS[stage];
}

/** Map a backend `JobStatus` to the active SeparationStage. */
export function deriveSeparationStage(status: JobStatus): SeparationStage {
  if (status.status === "error") return "error";
  if (status.status === "done") return "done";
  if (status.status === "queued") return "queued";
  // status === "processing"
  if (status.progress >= 90) return "finalizing";
  return "separating-stems";
}

export type SeparationStageEmitter = (
  status: JobStatus,
  elapsedMs: number
) => void;

/**
 * Build a stateful onPoll-style emitter for one separation run. Mirrors
 * `makeDeepStageEmitter` exactly so the consoles look uniform across flows.
 */
export function makeSeparationStageEmitter(
  runId: string
): SeparationStageEmitter {
  let prevStage: SeparationStage | null = null;

  return (status, _elapsedMs) => {
    const stage = deriveSeparationStage(status);

    if (stage === "error") {
      const errorMsg = status.error ?? "Unknown backend error";
      emitStage({
        flow: "smart-split",
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
      emitStage({
        flow: "smart-split",
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
        flow: "smart-split",
        runId,
        stage,
        phase: "start",
        progress: status.progress,
      });
      prevStage = stage;
    }
  };
}

/** Emit `upload-start` before the network request to `/separate` resolves. */
export function emitSeparationUploadStart(runId: string): void {
  emitStage({
    flow: "smart-split",
    runId,
    stage: "upload-start",
    phase: "start",
  });
}

/** Emit the client-side "downloading" stage that bridges done → loaded. */
export function emitSeparationDownloading(runId: string): void {
  emitStage({
    flow: "smart-split",
    runId,
    stage: "downloading",
    phase: "start",
  });
}

/** View-derived props for `SeparationProgressCard`. */
export interface SeparationStageView {
  stageDurationsMs: {
    "separating-stems"?: number;
    finalizing?: number;
    downloading?: number;
  };
  failedAtStageLabel: string | null;
  stageTraceText: string | null;
}

const VIEW_TRACKED: ReadonlyArray<
  "separating-stems" | "finalizing" | "downloading"
> = ["separating-stems", "finalizing", "downloading"];

export function computeSeparationStageView(
  run: AnalysisRun | undefined,
  now: number = Date.now()
): SeparationStageView {
  if (!run) {
    return {
      stageDurationsMs: {},
      failedAtStageLabel: null,
      stageTraceText: null,
    };
  }
  const stageDurationsMs: SeparationStageView["stageDurationsMs"] = {};
  for (const stage of VIEW_TRACKED) {
    const startEvent = run.stages.find(
      (e) => e.stage === stage && e.phase === "start"
    );
    if (!startEvent) continue;
    const idx = run.stages.indexOf(startEvent);
    const next = run.stages[idx + 1];
    const endAt = next?.at ?? run.endedAt ?? now;
    stageDurationsMs[stage] = Math.max(0, endAt - startEvent.at);
  }
  let failedAtStageLabel: string | null = null;
  if (run.error) {
    const lastStart = [...run.stages]
      .reverse()
      .find((e) => e.phase === "start");
    const failedStage = (lastStart?.stage ?? "queued") as SeparationStage;
    failedAtStageLabel = separationStageLabel(failedStage);
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
