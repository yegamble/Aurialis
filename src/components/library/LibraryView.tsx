"use client";

import { memo, useCallback, useMemo, useRef, useState } from "react";
import type { DragEvent, ReactElement } from "react";
import { Plus, Trash2, Upload } from "lucide-react";
import type { LibraryEntry } from "@/lib/storage/library-types";
import { computeAlbumTargetLufs } from "@/lib/stores/album-store";
import { artGradient } from "@/lib/art-tile";
import { AlbumHeroCard } from "./AlbumHeroCard";

export type LibraryFilter = "all" | "analyzed" | "drafts";

/** Shared column template so the header row and data rows stay aligned. */
const LIBRARY_GRID =
  "grid grid-cols-[1fr_84px_84px_112px_40px] items-center gap-3";

/** Loudness drift threshold (LU) for the amber LUFS flag. */
const DRIFT_LU = 1.5;

/**
 * Deterministic gradient for a row's art tile, seeded by a stable string
 * (the fingerprint). Colours come from the shared {@link artGradient} helper so
 * a track keeps one colour across the sidebar, toolbar and this table.
 */
function gradientFor(seed: string): string {
  const g = artGradient(seed);
  return `linear-gradient(135deg, ${g.a}, ${g.b})`;
}

export interface LibraryAlbum {
  title: string;
  artist: string;
  trackCount: number;
  avgLufs?: number;
  /** Loudness spread (range, in LU) across analyzed tracks; undefined until ≥2. */
  variance?: number;
  /** Count of analyzed tracks drifting >1.5 LU from the album target. */
  issues?: number;
}

export interface LibraryViewProps {
  entries: LibraryEntry[];
  onOpenEntry: (fingerprint: string) => void | Promise<void>;
  onRequestDelete: (fingerprint: string) => void;
  onOpenAlbum?: () => void;
  onUpload?: () => void;
  /**
   * Import files directly from the persistent library dropzone. Wired to the
   * same upload handler the Import screen uses, so dropping/selecting here
   * follows the identical resume/analyze/mix routing.
   */
  onImportFiles?: (files: File[]) => void;
  album?: LibraryAlbum;
}

const FILTERS: { id: LibraryFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "analyzed", label: "Analyzed" },
  { id: "drafts", label: "Drafts" },
];

export function LibraryView({
  entries,
  onOpenEntry,
  onRequestDelete,
  onOpenAlbum,
  onUpload,
  onImportFiles,
  album,
}: LibraryViewProps): ReactElement {
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [dropActive, setDropActive] = useState(false);
  const dropInputRef = useRef<HTMLInputElement>(null);

  const emitImport = useCallback(
    (files: File[]) => {
      if (files.length > 0) onImportFiles?.(files);
    },
    [onImportFiles],
  );

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDropActive(false);
      emitImport(Array.from(e.dataTransfer.files));
    },
    [emitImport],
  );
  const totalDurationSec = useMemo(
    () => entries.reduce((s, e) => s + (e.durationSec ?? 0), 0),
    [entries],
  );
  const filtered = useMemo(() => {
    if (filter === "all") return entries;
    if (filter === "analyzed") return entries.filter((e) => e.script !== null);
    return entries.filter((e) => e.script === null);
  }, [entries, filter]);
  // Reference target for the per-row LUFS drift flag — the same derivation the
  // /album view and the hero card use, so nothing disagrees across surfaces.
  const albumTarget = useMemo(() => computeAlbumTargetLufs(entries, null), [entries]);

  return (
    <div className="flex min-h-full flex-col gap-[22px] p-8 pt-6">
      <header className="flex items-end justify-between">
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[rgba(255,255,255,0.45)]">
            Library
          </div>
          <h1 className="text-[28px] font-semibold tracking-tight text-white">Your tracks</h1>
          <div
            data-testid="library-summary"
            className="mt-1 text-[13px] text-[rgba(255,255,255,0.6)]"
          >
            {`${entries.length} ${entries.length === 1 ? "song" : "songs"} · ${Math.max(1, Math.floor(totalDurationSec / 60))} min · stored locally`}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div
            role="tablist"
            aria-label="Filter library"
            className="inline-flex rounded-md border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] p-0.5"
          >
            {FILTERS.map((f) => {
              const active = filter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setFilter(f.id)}
                  className={
                    "rounded px-2.5 py-1 text-[12px] " +
                    (active
                      ? "bg-[rgba(255,255,255,0.1)] text-white"
                      : "text-[rgba(255,255,255,0.6)] hover:text-white")
                  }
                >
                  {f.label}
                </button>
              );
            })}
          </div>
          {onUpload ? (
            <button
              type="button"
              onClick={onUpload}
              className="inline-flex items-center gap-1 rounded-md bg-[#0a84ff] px-3 py-1.5 text-[12px] font-semibold text-white shadow-[0_1px_6px_rgba(10,132,255,0.35)] hover:bg-[#0a7aff]"
            >
              <Plus className="h-3 w-3" />
              Import
            </button>
          ) : null}
        </div>
      </header>

      {album ? (
        <AlbumHeroCard
          title={album.title}
          artist={album.artist}
          trackCount={album.trackCount}
          avgLufs={album.avgLufs}
          variance={album.variance}
          issues={album.issues}
          onClick={onOpenAlbum}
        />
      ) : null}

      <div
        role="list"
        data-testid="library-list"
        className="overflow-hidden rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(28,28,30,0.6)]"
      >
        <div
          className={
            LIBRARY_GRID +
            " border-b border-[rgba(255,255,255,0.06)] px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-[rgba(255,255,255,0.4)]"
          }
        >
          <span>Title</span>
          <span className="text-right">LUFS</span>
          <span className="text-right">Length</span>
          <span className="text-right">Modified</span>
          <span aria-hidden />
        </div>
        {filtered.map((entry) => (
          <LibraryRow
            key={entry.fingerprint}
            entry={entry}
            target={albumTarget}
            onOpen={onOpenEntry}
            onRequestDelete={onRequestDelete}
          />
        ))}
        {filtered.length === 0 ? (
          <div className="px-3 py-6 text-center text-[12px] text-[rgba(255,255,255,0.5)]">
            No tracks match this filter.
          </div>
        ) : null}
      </div>

      {onImportFiles ? (
        <>
          <div
            role="button"
            tabIndex={0}
            data-testid="library-dropzone"
            aria-label="Import audio. Drop files here or click to browse."
            onClick={() => dropInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                dropInputRef.current?.click();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDropActive(true);
            }}
            onDragLeave={() => setDropActive(false)}
            onDrop={handleDrop}
            className={
              "cursor-pointer rounded-2xl border-[1.5px] border-dashed px-6 py-[26px] text-center transition-colors " +
              (dropActive
                ? "border-[#0a84ff] bg-[#0a84ff]/[0.08]"
                : "border-[rgba(255,255,255,0.14)] bg-[rgba(255,255,255,0.02)] hover:border-[rgba(255,255,255,0.24)]")
            }
          >
            <div className="mb-2.5 inline-flex h-11 w-11 items-center justify-center rounded-full bg-[rgba(10,132,255,0.1)] text-[#0a84ff]">
              <Upload className="h-[18px] w-[18px]" />
            </div>
            <div className="text-sm font-medium text-white">Drop audio files to import</div>
            <div className="mt-0.5 text-[12px] text-[rgba(255,255,255,0.55)]">
              WAV, MP3, FLAC, OGG, AAC, M4A · or a ZIP of stems
            </div>
          </div>
          <input
            ref={dropInputRef}
            type="file"
            accept="audio/*,.zip"
            multiple
            className="hidden"
            aria-hidden="true"
            onChange={(e) => {
              emitImport(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
        </>
      ) : null}
    </div>
  );
}

interface LibraryRowProps {
  entry: LibraryEntry;
  target: number;
  onOpen: (fingerprint: string) => void | Promise<void>;
  onRequestDelete: (fingerprint: string) => void;
}

const LibraryRow = memo(function LibraryRow({
  entry,
  target,
  onOpen,
  onRequestDelete,
}: LibraryRowProps): ReactElement {
  const analyzed = entry.script !== null;
  const lufs = entry.measuredLufs;
  const hasLufs = typeof lufs === "number" && Number.isFinite(lufs);
  const drift = hasLufs && Math.abs(lufs - target) > DRIFT_LU;
  return (
    <div
      role="listitem"
      data-testid="library-row"
      data-fingerprint={entry.fingerprint}
      className={
        LIBRARY_GRID +
        " border-b border-[rgba(255,255,255,0.04)] px-5 py-2.5 last:border-b-0 hover:bg-[rgba(255,255,255,0.03)]"
      }
    >
      <button
        type="button"
        onClick={() => void onOpen(entry.fingerprint)}
        className="contents text-left"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span
            data-testid="library-art"
            aria-hidden
            className="h-10 w-10 shrink-0 rounded-md"
            style={{ background: gradientFor(entry.fingerprint) }}
          />
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="truncate text-[13.5px] font-medium text-white">
                {entry.fileName}
              </span>
              {analyzed ? (
                <span className="shrink-0 rounded bg-[rgba(10,132,255,0.13)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[#0a84ff]">
                  Analyzed
                </span>
              ) : null}
            </span>
            {!entry.audioPersisted ? (
              <span
                data-testid="reupload-badge"
                title="The audio for this track isn't stored on this device — re-upload the file to play it."
                className="mt-0.5 block text-[10px] uppercase tracking-wider text-[rgba(255,196,84,0.9)]"
              >
                Re-upload audio to play
              </span>
            ) : null}
          </span>
        </span>
        <span
          data-testid="library-lufs"
          data-drift={drift ? "true" : "false"}
          className={
            "text-right text-[12px] tabular-nums " +
            (drift ? "font-medium text-[#ff9f0a]" : "text-white")
          }
        >
          {hasLufs ? formatLufs(lufs) : "—"}
        </span>
        <span className="text-right text-[12px] tabular-nums text-[rgba(255,255,255,0.7)]">
          {entry.durationSec ? formatDuration(entry.durationSec) : "—"}
        </span>
        <span className="text-right text-[12px] tabular-nums text-[rgba(255,255,255,0.45)]">
          {formatRelative(entry.lastModified)}
        </span>
      </button>
      <button
        type="button"
        aria-label={`Delete ${entry.fileName}`}
        data-testid="library-delete-button"
        onClick={() => onRequestDelete(entry.fingerprint)}
        className="justify-self-end rounded-md p-2 text-[rgba(255,255,255,0.4)] hover:bg-[rgba(255,255,255,0.05)] hover:text-red-400"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
});

function formatLufs(value: number): string {
  const abs = Math.abs(value).toFixed(1);
  return value < 0 ? `−${abs}` : value > 0 ? `+${abs}` : abs;
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatRelative(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(ms).toLocaleDateString();
}
