"use client";

import { memo, useState } from "react";
import { Music, Trash2, CheckCircle2 } from "lucide-react";
import { useLibraryStore } from "@/lib/stores/library-store";
import type { LibraryEntry } from "@/lib/storage/library-types";

export interface LibraryListProps {
  /** Fired when the user clicks a row. Parent wires this to the open flow. */
  onOpenEntry: (fingerprint: string) => void | Promise<void>;
}

export function LibraryList({ onOpenEntry }: LibraryListProps): React.ReactElement | null {
  const entries = useLibraryStore((s) => s.entries);
  const removeEntry = useLibraryStore((s) => s.removeEntry);
  const [confirmFp, setConfirmFp] = useState<string | null>(null);

  if (entries.length === 0) return null;

  const handleConfirmDelete = async (): Promise<void> => {
    if (!confirmFp) return;
    const fp = confirmFp;
    setConfirmFp(null);
    await removeEntry(fp);
  };

  return (
    <section
      data-testid="library-list"
      className="mx-auto max-w-2xl px-6 pb-10 -mt-6"
    >
      <h2 className="text-[rgba(255,255,255,0.5)] text-xs uppercase tracking-wider mb-3">
        Your library
      </h2>
      <ul className="space-y-1">
        {entries.map((entry) => (
          <LibraryRow
            key={entry.fingerprint}
            entry={entry}
            onOpen={onOpenEntry}
            onRequestDelete={setConfirmFp}
          />
        ))}
      </ul>

      {confirmFp && (
        <div
          role="alertdialog"
          aria-modal="true"
          data-testid="library-delete-confirm"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        >
          <div className="bg-[#0a0a0a] border border-[rgba(255,255,255,0.08)] rounded-xl p-5 max-w-sm">
            <p className="text-white text-sm mb-1">Delete this song from your library?</p>
            <p className="text-[rgba(255,255,255,0.5)] text-xs mb-4">
              The saved analysis and audio will be permanently removed from this browser.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmFp(null)}
                className="flex-1 px-3 py-2 rounded-md text-sm bg-[rgba(255,255,255,0.06)] text-[rgba(255,255,255,0.85)] hover:bg-[rgba(255,255,255,0.1)]"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="library-delete-confirm-button"
                onClick={() => void handleConfirmDelete()}
                className="flex-1 px-3 py-2 rounded-md text-sm bg-red-500/90 text-white hover:bg-red-500"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
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
}: LibraryRowProps): React.ReactElement {
  return (
    <li
      data-testid="library-row"
      data-fingerprint={entry.fingerprint}
      className="flex items-center gap-3 px-3 py-2 rounded-lg border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.05)] transition-colors"
    >
      <button
        type="button"
        onClick={() => void onOpen(entry.fingerprint)}
        className="flex items-center gap-3 flex-1 text-left"
      >
        <div className="w-8 h-8 rounded-md bg-[rgba(255,255,255,0.06)] flex items-center justify-center shrink-0">
          <Music className="w-4 h-4 text-[#0a84ff]" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-white text-sm truncate">{entry.fileName}</p>
          <p className="text-[rgba(255,255,255,0.4)] text-xs">
            {entry.durationSec ? formatDuration(entry.durationSec) : formatBytes(entry.fileSize)}
            {" · "}
            {formatRelative(entry.lastModified)}
          </p>
        </div>
        {entry.script && (
          <span className="flex items-center gap-1 text-[#0a84ff] text-[10px] uppercase tracking-wider">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Analyzed
          </span>
        )}
      </button>
      <button
        type="button"
        aria-label={`Delete ${entry.fileName}`}
        data-testid="library-delete-button"
        onClick={() => onRequestDelete(entry.fingerprint)}
        className="p-2 rounded-md text-[rgba(255,255,255,0.4)] hover:text-red-400 hover:bg-[rgba(255,255,255,0.05)] transition-colors"
      >
        <Trash2 className="w-3.5 h-3.5" />
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
