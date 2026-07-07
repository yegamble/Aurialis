"use client";

import { memo, useState } from "react";
import { Scissors } from "lucide-react";
import type { SeparationErrorDetails } from "@/lib/api/separation";
import type { SeparationStage } from "@/lib/api/separation-stage";

export type SeparationStatus =
  | "idle"
  | "analyzing"
  | "cancelling"
  | "ready"
  | "error";

export interface SeparationProgressCardProps {
  status: SeparationStatus;
  /** Active backend stage; null when no run is active. */
  activeStage: SeparationStage | null;
  /** 0..100 (clamped). */
  progress: number;
  /** Whole seconds since the run started. */
  elapsedSec: number;
  /** Populated when `status === "error"`. */
  errorDetails: SeparationErrorDetails | null;
  /** Optional Cancel handler. When omitted, the cancel button is hidden. */
  onCancel?: () => void;
  /** Optional Retry handler. When omitted, the retry button is hidden. */
  onRetry?: () => void;
  /** Per-stage durations from the analysis-stage harness. */
  stageDurationsMs?: {
    "separating-stems"?: number;
    finalizing?: number;
    downloading?: number;
  };
  /** Failed-at-stage human label. */
  failedAtStageLabel?: string | null;
  /** Pretty-printed stage trace for the error details `<pre>`. */
  stageTraceText?: string | null;
}

const STAGES: ReadonlyArray<{
  key: "separating-stems" | "finalizing" | "downloading";
  label: string;
}> = [
  { key: "separating-stems", label: "Separating stems" },
  { key: "finalizing", label: "Finalizing" },
  { key: "downloading", label: "Downloading stems" },
];

function formatElapsed(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function clampPercent(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

function formatStageDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m${s.toString().padStart(2, "0")}s`;
}

function SeparationProgressCardImpl({
  status,
  activeStage,
  progress,
  elapsedSec,
  errorDetails,
  onCancel,
  onRetry,
  stageDurationsMs,
  failedAtStageLabel,
  stageTraceText,
}: SeparationProgressCardProps): React.ReactElement | null {
  const [detailsOpen, setDetailsOpen] = useState(false);

  if (status === "idle" || status === "ready") return null;

  if (status === "error") {
    const headline = failedAtStageLabel
      ? `Failed at: ${failedAtStageLabel}`
      : (errorDetails?.message ?? "Something went wrong.");
    return (
      <div
        data-testid="separation-progress-error"
        role="alert"
        className="rounded-md border border-red-500/60 bg-red-500/5 p-3 text-xs text-[rgba(255,255,255,0.85)]"
      >
        <p
          data-testid="separation-progress-error-message"
          className="font-medium text-red-300"
        >
          {headline}
        </p>
        {failedAtStageLabel && errorDetails?.message ? (
          <p
            data-testid="separation-progress-error-detail-message"
            className="mt-1 text-[rgba(255,255,255,0.7)]"
          >
            {errorDetails.message}
          </p>
        ) : null}
        <div className="mt-2 flex items-center gap-2">
          {onRetry ? (
            <button
              type="button"
              data-testid="separation-progress-retry"
              onClick={onRetry}
              className="rounded-md bg-[#0a84ff] px-3 py-1.5 text-white hover:bg-[#0066cc]"
            >
              Retry
            </button>
          ) : null}
          <button
            type="button"
            data-testid="separation-progress-details-toggle"
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen((v) => !v)}
            className="rounded-md border border-[rgba(255,255,255,0.15)] px-3 py-1.5 text-[rgba(255,255,255,0.7)] hover:bg-[rgba(255,255,255,0.04)]"
          >
            {detailsOpen ? "Hide details" : "Show details"}
          </button>
        </div>
        {detailsOpen ? (
          <>
            <pre
              data-testid="separation-progress-error-details"
              className="mt-3 overflow-x-auto rounded bg-black/40 p-2 text-[10px] leading-tight text-[rgba(255,255,255,0.7)]"
            >
{`URL:       ${errorDetails?.url ?? "(unknown)"}
Status:    ${errorDetails?.status ?? "(unknown)"}
Job ID:    ${errorDetails?.jobId ?? "(none)"}
At:        ${errorDetails?.at ?? "(unknown)"}
Raw:       ${errorDetails?.raw ?? "(no raw payload)"}`}
            </pre>
            {stageTraceText ? (
              <pre
                data-testid="separation-progress-stage-trace"
                className="mt-2 overflow-x-auto rounded bg-black/40 p-2 text-[10px] leading-tight text-[rgba(255,255,255,0.7)]"
              >
                {stageTraceText}
              </pre>
            ) : null}
          </>
        ) : null}
      </div>
    );
  }

  const isCancelling = status === "cancelling";
  const percent = clampPercent(progress);
  const activeStageLabel =
    STAGES.find((s) => s.key === activeStage)?.label ?? "Separating stems";
  const statusLine = isCancelling ? "Cancelling…" : `${activeStageLabel}…`;
  const activeIdx = STAGES.findIndex((s) => s.key === activeStage);

  return (
    <div
      data-testid="separation-progress-card"
      role="status"
      aria-live="polite"
      className="flex flex-col items-center rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] p-7 text-center text-xs text-[rgba(255,255,255,0.85)]"
    >
      <div
        className="mb-3.5 flex h-16 w-16 items-center justify-center rounded-full bg-[#0a84ff]/10 text-[#0a84ff]"
        aria-hidden="true"
      >
        <Scissors className="h-7 w-7" />
      </div>
      <div className="text-base font-medium text-white">
        Aurialis is splitting your track into stems
      </div>
      <div className="mt-1 text-[rgba(255,255,255,0.5)]">
        Vocals, drums, bass, other · runs on our server
      </div>

      <div className="mt-5 w-full max-w-[360px]">
        <div className="mb-1.5 flex items-center justify-between text-[11px] text-[rgba(255,255,255,0.7)]">
          <span>{statusLine}</span>
          <span className="flex items-center gap-3">
            <span className="tabular-nums">{percent}%</span>
            <span
              data-testid="separation-progress-elapsed"
              className="tabular-nums text-[rgba(255,255,255,0.6)]"
            >
              {formatElapsed(elapsedSec)}
            </span>
          </span>
        </div>

        <div
          className="h-[3px] overflow-hidden rounded bg-[rgba(255,255,255,0.08)]"
          aria-hidden="true"
        >
          <div
            data-testid="separation-progress-bar-fill"
            className="h-full bg-gradient-to-r from-[#0a84ff] to-[#5ac8fa] transition-[width] duration-300 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>

        <div className="mt-3 flex flex-wrap justify-center gap-1.5">
          {STAGES.map((stage, i) => {
            const active = activeStage === stage.key;
            // A stage is "reached" once we're at or past it, so completed
            // stages stay highlighted as the run advances.
            const reached = activeIdx >= 0 && i <= activeIdx;
            const durationMs = stageDurationsMs?.[stage.key];
            return (
              <span
                key={stage.key}
                data-testid={`separation-progress-stage-${stage.key}`}
                data-active={active ? "true" : "false"}
                className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                  reached
                    ? "bg-[#0a84ff]/15 text-[#0a84ff]"
                    : "bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.4)]"
                }`}
              >
                {stage.label}
                {typeof durationMs === "number" && durationMs > 0 ? (
                  <span
                    data-testid={`separation-progress-stage-${stage.key}-duration`}
                    className="ml-1.5 tabular-nums font-normal text-[rgba(255,255,255,0.45)]"
                  >
                    {formatStageDuration(durationMs)}
                  </span>
                ) : null}
              </span>
            );
          })}
        </div>

        {onCancel ? (
          <div className="mt-4 flex items-center justify-center">
            <button
              type="button"
              data-testid="separation-progress-cancel"
              onClick={onCancel}
              disabled={isCancelling}
              className={`rounded-md border border-[rgba(255,255,255,0.15)] px-3 py-1.5 text-[rgba(255,255,255,0.85)] transition-colors ${
                isCancelling
                  ? "cursor-not-allowed opacity-50"
                  : "hover:bg-[rgba(255,255,255,0.06)]"
              }`}
            >
              Cancel
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export const SeparationProgressCard = memo(SeparationProgressCardImpl);
