"use client";

import type { ReactElement } from "react";
import { Sparkles } from "lucide-react";

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
}

const ON_TARGET_LU = 0.5;

function formatLufs(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value).toFixed(1);
  return value < 0 ? `−${abs}` : value > 0 ? `+${abs}` : abs;
}

function formatDelta(delta: number): string {
  const abs = Math.abs(delta).toFixed(1);
  return delta < 0 ? `−${abs}` : delta > 0 ? `+${abs}` : "+0.0";
}

export function AlbumView({
  title,
  artist,
  tracks,
  targetLufs,
  onOpenTrack,
  onMasterAll,
}: AlbumViewProps): ReactElement {
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
                onClick={onMasterAll}
                disabled={!onMasterAll}
                className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-semibold text-[#1a1a1c] hover:bg-white/90 disabled:opacity-60"
              >
                <Sparkles className="h-3 w-3" />
                Master entire album
              </button>
            </div>
          </div>
        </div>
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

        {tracks.length === 0 ? (
          <div
            data-testid="album-empty"
            className="rounded-lg border border-dashed border-[rgba(255,255,255,0.08)] px-4 py-10 text-center text-sm text-[rgba(255,255,255,0.5)]"
          >
            Add at least one analyzed track to your library to see album consistency.
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {tracks.map((t) => {
              const delta =
                t.lufs !== null && Number.isFinite(t.lufs) ? t.lufs - targetLufs : null;
              const onTarget = delta !== null && Math.abs(delta) < ON_TARGET_LU;
              return (
                <li
                  key={t.id}
                  data-testid="album-track-row"
                  data-fingerprint={t.id}
                  className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 rounded-lg border border-transparent px-3 py-2 hover:border-[rgba(255,255,255,0.06)] hover:bg-[rgba(255,255,255,0.04)]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-white">{t.title}</p>
                    <p className="text-xs text-[rgba(255,255,255,0.4)]">
                      {onTarget ? "On target" : delta !== null ? `${formatDelta(delta)} LU from target` : "Not analyzed"}
                    </p>
                  </div>
                  <div
                    data-testid="album-track-lufs"
                    className="text-sm tabular-nums text-white"
                  >
                    {formatLufs(t.lufs)}
                  </div>
                  <div
                    data-testid="album-track-delta"
                    className={
                      "text-xs tabular-nums " +
                      (delta === null
                        ? "text-[rgba(255,255,255,0.4)]"
                        : onTarget
                          ? "text-green-400"
                          : Math.abs(delta) > 1.5
                            ? "text-red-400"
                            : "text-amber-300")
                    }
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
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
