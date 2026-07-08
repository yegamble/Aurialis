"use client";

import { useState, type ReactElement } from "react";
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
  /** Output channel count for the size estimate (defaults to stereo). */
  channels?: number;
}

/** Assumed constant MP3 bitrate (kbps) — matches the export path's default. */
const MP3_BITRATE_KBPS = 320;

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
 * Estimated encoded size in bytes for the current settings + duration.
 * WAV is exact PCM (duration × SR × bytes-per-sample × channels); MP3 is a
 * constant-bitrate approximation. Both are surfaced with a "~" label.
 */
function estimatedBytes(
  settings: ExportSettings,
  durationSec: number,
  channels: number,
): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 0;
  if (settings.format === "mp3") {
    return durationSec * ((MP3_BITRATE_KBPS * 1000) / 8);
  }
  return durationSec * settings.sampleRate * (settings.bitDepth / 8) * channels;
}

function fmtSize(bytes: number): string {
  if (bytes <= 0) return "—";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `~${mb.toFixed(1)} MB`;
  return `~${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Export screen (Direction A): the format/quality controls paired with an
 * audio-summary card so the user sees the mastered loudness/peak/range numbers
 * plus an estimated file size before rendering. Wraps the existing ExportPanel.
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
  channels = 2,
}: ExportViewProps): ReactElement {
  // Mirror the panel's current settings so the summary's size estimate reacts
  // to format/SR/bit-depth changes. Seeded with the panel's own defaults.
  const [settings, setSettings] = useState<ExportSettings>({
    format: "wav",
    sampleRate: 44100,
    bitDepth: 16,
    dither: "tpdf",
  });

  return (
    <div className="grid gap-4 lg:grid-cols-2" data-testid="export-view">
      <ExportPanel
        onExport={onExport}
        isExporting={isExporting}
        onSettingsChange={setSettings}
      />
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
          <SummaryRow
            k="Estimated size"
            v={fmtSize(estimatedBytes(settings, durationSec, channels))}
            testId="estimated-size"
          />
        </dl>
      </div>
    </div>
  );
}

function SummaryRow({
  k,
  v,
  accent = false,
  testId,
}: {
  k: string;
  v: string;
  accent?: boolean;
  testId?: string;
}): ReactElement {
  return (
    <div className="flex items-center justify-between text-[13px]">
      <dt className="text-[rgba(255,255,255,0.5)]">{k}</dt>
      <dd
        data-testid={testId}
        className={
          "tabular-nums " + (accent ? "text-[#0a84ff]" : "text-[rgba(255,255,255,0.9)]")
        }
      >
        {v}
      </dd>
    </div>
  );
}
