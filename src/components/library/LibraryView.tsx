"use client";

import { memo, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { CheckCircle2, Music, Plus, Trash2 } from "lucide-react";
import type { LibraryEntry } from "@/lib/storage/library-types";
import { AlbumHeroCard } from "./AlbumHeroCard";

export type LibraryFilter = "all" | "analyzed" | "drafts";

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
  album,
}: LibraryViewProps): ReactElement {
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const totalDurationSec = useMemo(
    () => entries.reduce((s, e) => s + (e.durationSec ?? 0), 0),
    [entries],
  );
  const filtered = useMemo(() => {
    if (filter === "all") return entries;
    if (filter === "analyzed") return entries.filter((e) => e.script !== null);
    return entries.filter((e) => e.script === null);
  }, [entries, filter]);

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

      <ul
        data-testid="library-list"
        className="flex flex-col gap-1 overflow-hidden rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(28,28,30,0.6)] p-1.5"
      >
        {filtered.map((entry) => (
          <LibraryRow
            key={entry.fingerprint}
            entry={entry}
            onOpen={onOpenEntry}
            onRequestDelete={onRequestDelete}
          />
        ))}
        {filtered.length === 0 ? (
          <li className="px-3 py-6 text-center text-[12px] text-[rgba(255,255,255,0.5)]">
            No tracks match this filter.
          </li>
        ) : null}
      </ul>
    </div>
  );
}

interface LibraryRowProps {
  entry: LibraryEntry;
  onOpen: (fingerprint: string) => void | Promise<void>;
  onRequestDelete: (fingerprint: string) => void;
}

const LibraryRow = memo(function LibraryRow({
  entry,
  onOpen,
  onRequestDelete,
}: LibraryRowProps): ReactElement {
  const analyzed = entry.script !== null;
  return (
    <li
      data-testid="library-row"
      data-fingerprint={entry.fingerprint}
      className="flex items-center gap-3 rounded-lg border border-transparent px-3 py-2 hover:border-[rgba(255,255,255,0.06)] hover:bg-[rgba(255,255,255,0.04)]"
    >
      <button
        type="button"
        onClick={() => void onOpen(entry.fingerprint)}
        className="flex flex-1 items-center gap-3 text-left"
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[rgba(255,255,255,0.06)]">
          <Music className="h-4 w-4 text-[#0a84ff]" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-white">{entry.fileName}</p>
          <p className="text-xs text-[rgba(255,255,255,0.4)]">
            {entry.durationSec ? formatDuration(entry.durationSec) : formatBytes(entry.fileSize)}
            {" · "}
            {formatRelative(entry.lastModified)}
          </p>
        </div>
        {analyzed ? (
          <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-[#0a84ff]">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Analyzed
          </span>
        ) : null}
        {!entry.audioPersisted ? (
          <span
            data-testid="reupload-badge"
            title="The audio for this track isn't stored on this device — re-upload the file to play it."
            className="shrink-0 text-[10px] uppercase tracking-wider text-[rgba(255,196,84,0.9)]"
          >
            Re-upload audio to play
          </span>
        ) : null}
      </button>
      <button
        type="button"
        aria-label={`Delete ${entry.fileName}`}
        data-testid="library-delete-button"
        onClick={() => onRequestDelete(entry.fingerprint)}
        className="rounded-md p-2 text-[rgba(255,255,255,0.4)] hover:bg-[rgba(255,255,255,0.05)] hover:text-red-400"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </li>
  );
});

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatRelative(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(ms).toLocaleDateString();
}
