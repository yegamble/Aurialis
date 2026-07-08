"use client";

import type { ReactElement } from "react";
import { Upload, Music } from "lucide-react";
import { useFileImport } from "./useFileImport";

interface ImportPanelProps {
  onFilesUploaded: (files: File[]) => void;
  onCancel: () => void;
}

/**
 * Compact in-shell import surface shown when the library already has tracks.
 * Mirrors the design's UploadView (eyebrow + "Add audio" + bordered dropzone
 * card + Choose files / Cancel). Shares the drag/drop/progress behaviour with
 * the first-run marketing UploadScreen via useFileImport.
 */
export function ImportPanel({
  onFilesUploaded,
  onCancel,
}: ImportPanelProps): ReactElement {
  const {
    isDragging,
    uploadProgress,
    inputRef,
    openPicker,
    onDragOver,
    onDragLeave,
    onDrop,
    onInputChange,
  } = useFileImport(onFilesUploaded);

  const importing = uploadProgress !== null;

  return (
    <div className="flex h-full flex-col gap-[22px] p-8">
      <div>
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[rgba(255,255,255,0.45)]">
          Import
        </div>
        <h1 className="text-[24px] font-semibold tracking-tight text-white">Add audio</h1>
      </div>

      <div
        role="button"
        tabIndex={0}
        aria-label="Import audio. Drop files here or click to browse."
        onClick={importing ? undefined : openPicker}
        onKeyDown={(e) => {
          if (!importing && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            openPicker();
          }
        }}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={
          "flex flex-1 items-center justify-center rounded-2xl border transition-colors " +
          (isDragging
            ? "border-[#0a84ff] bg-[#0a84ff]/[0.06]"
            : "border-[rgba(255,255,255,0.08)] bg-[rgba(28,28,30,0.6)]") +
          (importing ? "" : " cursor-pointer")
        }
      >
        {importing ? (
          <div className="w-[460px] max-w-[80%]">
            <div className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[rgba(255,255,255,0.45)]">
              Decoding audio
            </div>
            <div className="mb-3.5 flex items-center gap-2 text-sm text-white">
              <Music className="h-4 w-4 text-[#0a84ff]" />
              Processing your import…
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#0a84ff] to-[#5ac8fa] transition-[width] duration-200"
                style={{ width: `${Math.min(uploadProgress ?? 0, 100)}%` }}
              />
            </div>
            <div className="mt-1.5 text-[11px] tabular-nums text-[rgba(255,255,255,0.45)]">
              {Math.min(Math.round(uploadProgress ?? 0), 100)}%
            </div>
          </div>
        ) : (
          <div className="text-center">
            <div className="mb-4 inline-flex h-20 w-20 items-center justify-center rounded-full bg-[rgba(10,132,255,0.1)] text-[#0a84ff]">
              <Upload className="h-7 w-7" />
            </div>
            <div className="text-[20px] font-medium text-white">Drop files anywhere</div>
            <div className="mx-auto mt-1.5 max-w-[320px] text-[13px] text-[rgba(255,255,255,0.55)]">
              WAV, MP3, FLAC, OGG, AAC, M4A — Aurialis fingerprints each file so your
              settings stick around.
            </div>
            <div className="mt-[22px] flex justify-center gap-2.5">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  openPicker();
                }}
                className="rounded-lg bg-[#0a84ff] px-[18px] py-2 text-[13px] font-semibold text-white shadow-[0_1px_4px_rgba(10,132,255,0.35)] hover:bg-[#0a7aff]"
              >
                Choose files…
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onCancel();
                }}
                className="rounded-lg border border-[rgba(255,255,255,0.14)] px-[18px] py-2 text-[13px] font-medium text-white hover:bg-[rgba(255,255,255,0.04)]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="audio/*,.zip"
        multiple
        className="hidden"
        aria-hidden="true"
        onChange={onInputChange}
      />
    </div>
  );
}
