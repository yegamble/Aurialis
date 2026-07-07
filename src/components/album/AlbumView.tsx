"use client";

import type { ReactElement } from "react";
import { Sparkles, Loader2, Check, AlertCircle, X } from "lucide-react";
import { LufsBarChart } from "./LufsBarChart";
import type { AlbumMasterProgress, AlbumTrackState } from "@/lib/album/master-album";

export interface AlbumTrackRow {
  id: string;
  title: string;
  lufs: number | null;
  durationSec: number | null;
}

export interface AlbumViewProps {
  title: string;
  artist: string;
  tracks: AlbumTrackRow[];
  targetLufs: number;
  onOpenTrack: (id: string) => void;
  onMasterAll?: () => void;
  /** Live batch-master progress, or null when idle. */
  master?: AlbumMasterProgress | null;
  /** Cancel the in-flight batch (honoured between tracks). */
  onCancelMaster?: () => void;
}

const ON_TARGET_LU = 0.5;
const ISSUE_LU = 1.5;

interface AlbumStats {
  min: number | null;
  max: number | null;
  issues: number;
}

/** Derive range + issue count from the *measured* tracks only. */
function computeStats(tracks: AlbumTrackRow[], targetLufs: number): AlbumStats {
  const measured = tracks
    .map((t) => t.lufs)
    .filter((v): v is number => v !== null && Number.isFinite(v));
  if (measured.length === 0) return { min: null, max: null, issues: 0 };
  const issues = measured.filter((v) => Math.abs(v - targetLufs) > ISSUE_LU).length;
  return { min: Math.min(...measured), max: Math.max(...measured), issues };
}

function formatLufs(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value).toFixed(1);
  return value < 0 ? `−${abs}` : value > 0 ? `+${abs}` : abs;
}

function formatDelta(delta: number): string {
  const abs = Math.abs(delta).toFixed(1);
  return delta < 0 ? `−${abs}` : delta > 0 ? `+${abs}` : "+0.0";
}

interface Severity {
  color: string;
  copy: string;
}

/** Three-tier severity copy + dot color from a signed delta (LU). */
function severityFor(delta: number | null): Severity {
  if (delta === null) return { color: "rgba(255,255,255,0.3)", copy: "Not analyzed" };
  const sev = Math.abs(delta);
  if (sev > 1.5) return { color: "#ff9f0a", copy: `Loudness off by ${formatDelta(delta)} LU` };
  if (sev > 0.8) return { color: "#ffd60a", copy: `Close to target (${formatDelta(delta)} LU)` };
  return { color: "#30d158", copy: "On target" };
}

function Dot({ color }: { color: string }): ReactElement {
  return (
    <span
      aria-hidden
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={{ background: color }}
    />
  );
}

function TrackStatusIcon({ status }: { status: AlbumTrackState["status"] }): ReactElement {
  if (status === "done") return <Check className="h-3.5 w-3.5 text-[#30d158]" />;
  if (status === "error") return <AlertCircle className="h-3.5 w-3.5 text-[#ff453a]" />;
  if (status === "rendering")
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-white/80" />;
  return <span className="h-1.5 w-1.5 rounded-full bg-white/30" aria-hidden />;
}

/** Live per-track batch-master progress, shown inside the hero while running. */
function MasterProgress({
  master,
  onCancel,
}: {
  master: AlbumMasterProgress;
  onCancel?: () => void;
}): ReactElement {
  const active = master.phase === "running" || master.phase === "zipping";
  const pct = Math.round(master.fraction * 100);
  const headline =
    master.phase === "zipping"
      ? "Packaging archive…"
      : master.phase === "done"
        ? "Album mastered"
        : master.phase === "cancelled"
          ? "Cancelled"
          : `Mastering ${master.completed} of ${master.total}`;
  return (
    <div
      data-testid="album-master-progress"
      className="mt-3.5 border-t border-white/12 pt-3.5"
    >
      <div className="mb-1.5 flex items-center justify-between text-[11px]">
        <span>{headline}</span>
        <div className="flex items-center gap-3">
          <span className="tabular-nums">{pct}%</span>
          {active && onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-medium hover:bg-white/25"
            >
              <X className="h-3 w-3" />
              Cancel
            </button>
          ) : null}
        </div>
      </div>
      <div className="h-[3px] overflow-hidden rounded-full bg-white/18">
        <div
          className="h-full bg-white transition-[width] duration-150"
          style={{ width: `${pct}%` }}
        />
      </div>
      <ul className="mt-2.5 flex flex-col gap-1">
        {master.tracks.map((t) => (
          <li
            key={t.id}
            className="flex items-center gap-2 text-[11px] text-white/85"
          >
            <TrackStatusIcon status={t.status} />
            <span className="min-w-0 flex-1 truncate">{t.title}</span>
            {t.status === "error" ? (
              <span className="truncate text-[#ff8a80]">{t.error ?? "Failed"}</span>
            ) : (
              <span className="capitalize text-white/45">{t.status}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Consistency dimension selector. Only LUFS is wired today; Tonal and Dynamics
 * render but are honestly disabled ("Coming soon") — no dead-looking active
 * options.
 */
function ConsistencySegmented(): ReactElement {
  const dims: { id: string; label: string; enabled: boolean }[] = [
    { id: "lufs", label: "LUFS", enabled: true },
    { id: "tonal", label: "Tonal", enabled: false },
    { id: "dr", label: "Dynamics", enabled: false },
  ];
  return (
    <div
      data-testid="album-consistency-segmented"
      role="group"
      aria-label="Consistency dimension"
      className="inline-flex rounded-lg border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-0.5"
    >
      {dims.map((d) => {
        const active = d.enabled; // LUFS is the only active dimension today
        return (
          <button
            key={d.id}
            type="button"
            aria-pressed={active}
            disabled={!d.enabled}
            title={d.enabled ? undefined : "Coming soon"}
            className={
              "rounded-md px-3 py-1 text-xs font-medium transition-colors " +
              (active
                ? "bg-[rgba(255,255,255,0.1)] text-white"
                : "text-[rgba(255,255,255,0.35)] disabled:cursor-not-allowed")
            }
          >
            {d.label}
          </button>
        );
      })}
    </div>
  );
}

export function AlbumView({
  title,
  artist,
  tracks,
  targetLufs,
  onOpenTrack,
  onMasterAll,
  master,
  onCancelMaster,
}: AlbumViewProps): ReactElement {
  const stats = computeStats(tracks, targetLufs);
  const rangeText =
    stats.min !== null && stats.max !== null
      ? `${formatLufs(stats.min)} → ${formatLufs(stats.max)}`
      : "—";
  const hasMeasured = stats.min !== null;
  const isRunning = master?.phase === "running" || master?.phase === "zipping";
  const canMasterAll = Boolean(onMasterAll) && hasMeasured && !isRunning;
  return (
    <div className="flex min-h-full flex-col gap-[22px] p-8">
      <section
        data-testid="album-hero"
        className="overflow-hidden rounded-2xl border border-[rgba(255,255,255,0.08)] bg-gradient-to-br from-[#7b1d4d] to-[#1b0612] p-6 text-white"
      >
        <div className="flex items-center gap-5">
          <div className="flex h-[120px] w-[120px] items-center justify-center rounded-xl bg-white/10 backdrop-blur">
            <Sparkles className="h-10 w-10 text-white/70" />
          </div>
          <div className="flex-1">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider opacity-70">
              Smart Master Album
            </div>
            <h1 className="text-[26px] font-semibold tracking-tight">{title}</h1>
            <p className="text-[13px] opacity-70">
              {artist} · {tracks.length} {tracks.length === 1 ? "track" : "tracks"}
            </p>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                data-testid="album-master-all"
                onClick={onMasterAll}
                disabled={!canMasterAll}
                title={
                  !hasMeasured
                    ? "Analyze at least one track to master the album"
                    : undefined
                }
                className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-semibold text-[#1a1a1c] hover:bg-white/90 disabled:opacity-60"
              >
                {isRunning ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Sparkles className="h-3 w-3" />
                )}
                {isRunning ? "Mastering…" : "Master entire album"}
              </button>
            </div>
          </div>
          <dl
            data-testid="album-hero-stats"
            className="hidden w-[180px] flex-col gap-2.5 border-l border-white/15 pl-[18px] sm:flex"
          >
            <div>
              <dt className="text-[9px] font-semibold uppercase tracking-wider opacity-60">
                Target
              </dt>
              <dd className="mt-0.5 text-lg font-medium tabular-nums">
                {formatLufs(targetLufs)} LUFS
              </dd>
            </div>
            <div>
              <dt className="text-[9px] font-semibold uppercase tracking-wider opacity-60">
                Range
              </dt>
              <dd
                data-testid="album-hero-range"
                className="mt-0.5 text-lg font-medium tabular-nums"
              >
                {rangeText}
              </dd>
            </div>
            <div>
              <dt className="text-[9px] font-semibold uppercase tracking-wider opacity-60">
                Issues
              </dt>
              <dd
                data-testid="album-hero-issues"
                className={
                  "mt-0.5 text-lg font-medium tabular-nums " +
                  (stats.issues > 0 ? "text-[#ffd60a]" : "")
                }
              >
                {stats.issues}
              </dd>
            </div>
          </dl>
        </div>
        {master && master.phase !== "empty" ? (
          <MasterProgress master={master} onCancel={onCancelMaster} />
        ) : null}
      </section>

      <section className="rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(28,28,30,0.6)] p-5">
        <div className="mb-4 flex items-end justify-between">
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[rgba(255,255,255,0.45)]">
              Loudness across album
            </div>
            <p className="text-sm text-white">
              Aurialis compares every track to your album target and flags drift.
            </p>
          </div>
          <div className="text-right">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[rgba(255,255,255,0.45)]">
              Target LUFS
            </div>
            <div
              data-testid="album-target-lufs"
              className="text-lg tabular-nums text-[#0a84ff]"
            >
              {formatLufs(targetLufs)}
            </div>
          </div>
        </div>

        <div className="mb-4">
          <ConsistencySegmented />
        </div>

        {tracks.length === 0 ? (
          <div
            data-testid="album-empty"
            className="rounded-lg border border-dashed border-[rgba(255,255,255,0.08)] px-4 py-10 text-center text-sm text-[rgba(255,255,255,0.5)]"
          >
            Add at least one analyzed track to your library to see album consistency.
          </div>
        ) : hasMeasured ? (
          <LufsBarChart tracks={tracks} target={targetLufs} onOpen={onOpenTrack} />
        ) : (
          <div className="rounded-lg border border-dashed border-[rgba(255,255,255,0.08)] px-4 py-8 text-center text-sm text-[rgba(255,255,255,0.5)]">
            Analyze your tracks in the mastering view to plot loudness across the album.
          </div>
        )}
      </section>

      {tracks.length > 0 ? (
        <section className="overflow-hidden rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(28,28,30,0.6)]">
          <div className="border-b border-[rgba(255,255,255,0.06)] px-5 py-3.5">
            <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wider text-[rgba(255,255,255,0.45)]">
              Smart suggestions
            </div>
            <p className="text-[13px] text-[rgba(255,255,255,0.7)]">
              {stats.issues > 0
                ? `${stats.issues} ${stats.issues === 1 ? "track drifts" : "tracks drift"} more than 1.5 LU from the target — open a track to apply a correction.`
                : "Every analyzed track sits within 1.5 LU of the album target."}
            </p>
          </div>
          {tracks.map((t) => {
            const delta =
              t.lufs !== null && Number.isFinite(t.lufs) ? t.lufs - targetLufs : null;
            const sev = severityFor(delta);
            const deltaClass =
              delta === null
                ? "text-[rgba(255,255,255,0.4)]"
                : Math.abs(delta) < ON_TARGET_LU
                  ? "text-green-400"
                  : Math.abs(delta) > 1.5
                    ? "text-red-400"
                    : "text-amber-300";
            return (
              <div
                key={t.id}
                data-testid="album-track-row"
                data-fingerprint={t.id}
                className="grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-4 border-b border-[rgba(255,255,255,0.05)] px-5 py-3 last:border-b-0"
              >
                <Dot color={sev.color} />
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-white">{t.title}</p>
                  <p className="text-xs text-[rgba(255,255,255,0.6)]">{sev.copy}</p>
                </div>
                <div
                  data-testid="album-track-lufs"
                  className="text-sm tabular-nums text-white"
                >
                  {formatLufs(t.lufs)}
                </div>
                <div
                  data-testid="album-track-delta"
                  className={"text-xs tabular-nums " + deltaClass}
                >
                  {delta === null ? "—" : formatDelta(delta)}
                </div>
                <button
                  type="button"
                  onClick={() => onOpenTrack(t.id)}
                  className="rounded-md bg-[rgba(255,255,255,0.06)] px-3 py-1 text-xs text-[rgba(255,255,255,0.85)] hover:bg-[rgba(255,255,255,0.1)]"
                >
                  Open
                </button>
              </div>
            );
          })}
        </section>
      ) : null}
    </div>
  );
}
