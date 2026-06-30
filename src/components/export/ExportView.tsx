"use client";

import type { ReactElement } from "react";
import { ExportPanel, type ExportSettings } from "./ExportPanel";

export interface ExportViewProps {
  onExport?: (settings: ExportSettings) => Promise<void>;
  isExporting?: boolean;
  /** Integrated loudness (LUFS); -Infinity / NaN renders as "—". */
  lufs: number;
  /** True peak (dBTP). */
  truePeak: number;
  /** Loudness range (LU). */
  lra: number;
  /** Whether LRA has converged (else shown as "—"). */
  lraReady: boolean;
  /** Dynamic range (dB). */
  dynamicRange: number;
  /** Track duration (seconds). */
  durationSec: number;
}

function fmt(v: number, digits = 1): string {
  return Number.isFinite(v) ? v.toFixed(digits) : "—";
}

function fmtDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Export screen (Direction A): the format/quality controls paired with an
 * audio-summary card so the user sees the mastered loudness/peak/range numbers
 * before rendering. Wraps the existing ExportPanel.
 */
export function ExportView({
  onExport,
  isExporting,
  lufs,
  truePeak,
  lra,
  lraReady,
  dynamicRange,
  durationSec,
}: ExportViewProps): ReactElement {
  return (
    <div className="grid gap-4 lg:grid-cols-2" data-testid="export-view">
      <ExportPanel onExport={onExport} isExporting={isExporting} />
      <div className="rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] p-5">
        <p className="mb-3 text-xs uppercase tracking-wider text-[rgba(255,255,255,0.6)]">
          Audio summary
        </p>
        <dl className="space-y-2">
          <SummaryRow k="LUFS-I" v={fmt(lufs)} accent />
          <SummaryRow k="True peak" v={`${fmt(truePeak)} dBTP`} />
          <SummaryRow k="LRA" v={lraReady ? `${fmt(lra)} LU` : "—"} />
          <SummaryRow k="DR" v={fmt(dynamicRange)} />
          <SummaryRow k="Duration" v={fmtDuration(durationSec)} />
        </dl>
      </div>
    </div>
  );
}

function SummaryRow({
  k,
  v,
  accent = false,
}: {
  k: string;
  v: string;
  accent?: boolean;
}): ReactElement {
  return (
    <div className="flex items-center justify-between text-[13px]">
      <dt className="text-[rgba(255,255,255,0.5)]">{k}</dt>
      <dd
        className={
          "tabular-nums " + (accent ? "text-[#0a84ff]" : "text-[rgba(255,255,255,0.9)]")
        }
      >
        {v}
      </dd>
    </div>
  );
}
