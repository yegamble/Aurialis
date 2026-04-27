"use client";

import { memo, useState } from "react";
import type { DeepErrorDetails, DeepSubStatus } from "@/lib/api/deep-analysis";
import type { DeepStatus } from "@/lib/stores/deep-store";

export interface DeepProgressCardProps {
  status: DeepStatus;
  subStatus: DeepSubStatus;
  /** 0..100 (clamped). */
  progress: number;
  /** Whole seconds since the run started. */
  elapsedSec: number;
  /** Populated when `status === "error"`. */
  errorDetails: DeepErrorDetails | null;
  /** Fires when the user clicks Retry from the error state. */
  onRetry: () => void;
  /** Fires when the user clicks Cancel from the analyzing state. */
  onCancel: () => void;
}

const STAGES: ReadonlyArray<{ key: Exclude<DeepSubStatus, null>; label: string }> = [
  { key: "sections", label: "Detecting sections" },
  { key: "stems", label: "Analyzing stems" },
  { key: "script", label: "Generating script" },
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

function DeepProgressCardImpl({
  status,
  subStatus,
  progress,
  elapsedSec,
  errorDetails,
  onRetry,
  onCancel,
}: DeepProgressCardProps): React.ReactElement | null {
  const [detailsOpen, setDetailsOpen] = useState(false);

  if (status === "idle" || status === "ready") return null;

  if (status === "error") {
    return (
      <div
        data-testid="deep-progress-error"
        role="alert"
        className="rounded-md border border-red-500/60 bg-red-500/5 p-3 text-xs text-[rgba(255,255,255,0.85)]"
      >
        <p
          data-testid="deep-progress-error-message"
          className="font-medium text-red-300"
        >
          {errorDetails?.message ?? "Something went wrong."}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            data-testid="deep-progress-retry"
            onClick={onRetry}
            className="rounded-md bg-[#0a84ff] px-3 py-1.5 text-white hover:bg-[#0066cc]"
          >
            Retry
          </button>
          <button
            type="button"
            data-testid="deep-progress-details-toggle"
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen((v) => !v)}
            className="rounded-md border border-[rgba(255,255,255,0.15)] px-3 py-1.5 text-[rgba(255,255,255,0.7)] hover:bg-[rgba(255,255,255,0.04)]"
          >
            {detailsOpen ? "Hide details" : "Show details"}
          </button>
        </div>
        {detailsOpen ? (
          <pre
            data-testid="deep-progress-error-details"
            className="mt-3 overflow-x-auto rounded bg-black/40 p-2 text-[10px] leading-tight text-[rgba(255,255,255,0.7)]"
          >
{`URL:       ${errorDetails?.url ?? "(unknown)"}
Status:    ${errorDetails?.status ?? "(unknown)"}
Job ID:    ${errorDetails?.jobId ?? "(none)"}
Trace ID:  ${errorDetails?.traceId ?? "(none captured)"}
At:        ${errorDetails?.at ?? "(unknown)"}
Raw:       ${errorDetails?.raw ?? "(no raw payload)"}`}
          </pre>
        ) : null}
      </div>
    );
  }

  // analyzing OR cancelling
  const isCancelling = status === "cancelling";
  const percent = clampPercent(progress);

  return (
    <div
      data-testid="deep-progress-card"
      role="status"
      aria-live="polite"
      className="rounded-md border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] p-3 text-xs text-[rgba(255,255,255,0.85)]"
    >
      <div className="flex items-center justify-between">
        <div className="text-[rgba(255,255,255,0.7)]">
          {isCancelling ? "Cancelling…" : "Analyzing…"}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-[rgba(255,255,255,0.6)]">
            {percent}%
          </span>
          <span
            data-testid="deep-progress-elapsed"
            className="text-[10px] tabular-nums text-[rgba(255,255,255,0.6)]"
          >
            {formatElapsed(elapsedSec)}
          </span>
        </div>
      </div>

      <div
        className="mt-2 h-1 overflow-hidden rounded bg-[rgba(255,255,255,0.06)]"
        aria-hidden="true"
      >
        <div
          data-testid="deep-progress-bar-fill"
          className="h-full bg-[#0a84ff] transition-[width] duration-300 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>

      <ol className="mt-3 space-y-1 text-[10px] text-[rgba(255,255,255,0.55)]">
        {STAGES.map((stage, i) => {
          const active = subStatus === stage.key;
          return (
            <li
              key={stage.key}
              data-testid={`deep-progress-stage-${stage.key}`}
              data-active={active ? "true" : "false"}
              className={active ? "text-white" : ""}
            >
              {i + 1}. {stage.label}
              {active ? "…" : ""}
            </li>
          );
        })}
      </ol>

      {isCancelling ? (
        <p
          data-testid="deep-progress-cancelling-note"
          className="mt-3 text-[10px] text-[rgba(255,255,255,0.55)]"
        >
          Cancelling — this can take up to 30 seconds while the current phase
          finishes.
        </p>
      ) : null}

      <div className="mt-3 flex items-center justify-end">
        <button
          type="button"
          data-testid="deep-progress-cancel"
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
    </div>
  );
}

export const DeepProgressCard = memo(DeepProgressCardImpl);
