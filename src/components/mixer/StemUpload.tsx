"use client";

import { useState, useRef, useCallback } from "react";
import { motion } from "motion/react";
import { Upload, Music, AlertCircle } from "lucide-react";
import { MAX_STEMS } from "@/types/mixer";

interface StemUploadProps {
  onStemsLoaded: (files: File[]) => void;
  isLoading: boolean;
  error?: string | null;
  stemCount?: number;
}

export function StemUpload({
  onStemsLoaded,
  isLoading,
  error,
  stemCount = 0,
}: StemUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      const fileArray = Array.from(files);
      if (fileArray.length > 0) {
        onStemsLoaded(fileArray);
      }
    },
    [onStemsLoaded]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files);
      }
    },
    [handleFiles]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        handleFiles(e.target.files);
      }
    },
    [handleFiles]
  );

  const atLimit = stemCount >= MAX_STEMS;

  return (
    <div className="w-full">
      <div
        data-testid="stem-upload-zone"
        role="button"
        tabIndex={0}
        aria-label="Upload audio stems. Drop audio files or ZIP here, or click to browse."
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => !isLoading && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !isLoading) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        className={`
          relative rounded-2xl border-2 border-dashed transition-all duration-300 cursor-pointer
          p-8 flex flex-col items-center gap-3
          ${
            isDragging
              ? "border-[#0a84ff] bg-[#0a84ff]/[0.08]"
              : "border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.03)] hover:border-[rgba(255,255,255,0.2)] hover:bg-[rgba(255,255,255,0.05)]"
          }
          ${isLoading ? "pointer-events-none opacity-60" : ""}
        `}
      >
        {isLoading ? (
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[rgba(255,255,255,0.06)] flex items-center justify-center">
              <Music className="w-5 h-5 text-[#0a84ff] animate-pulse" />
            </div>
            <p className="text-white text-sm">Loading stems...</p>
            <motion.div
              className="w-48 h-1 rounded-full bg-[rgba(255,255,255,0.08)] overflow-hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <motion.div
                className="h-full bg-gradient-to-r from-[#0a84ff] to-[#5ac8fa] rounded-full"
                animate={{ x: ["-100%", "100%"] }}
                transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                style={{ width: "50%" }}
              />
            </motion.div>
          </div>
        ) : (
          <>
            <div className="w-12 h-12 rounded-2xl bg-[rgba(255,255,255,0.06)] flex items-center justify-center">
              <Upload className="w-6 h-6 text-[rgba(255,255,255,0.5)]" />
            </div>
            <div className="text-center">
              <p className="text-white text-sm mb-1">
                Drop audio files or ZIP here, or click to browse
              </p>
              <p className="text-[rgba(255,255,255,0.35)] text-xs">
                WAV, MP3, FLAC, OGG, AAC, M4A — or a ZIP containing stems
              </p>
            </div>
          </>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="audio/*,.zip"
        multiple
        className="hidden"
        onChange={handleChange}
        aria-hidden="true"
      />

      {stemCount > 0 && (
        <div className="mt-3 flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <p className="text-[rgba(255,255,255,0.5)] text-xs">
              {stemCount} stems loaded
            </p>
            {atLimit && (
              <p className="text-yellow-400 text-xs flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                Maximum {MAX_STEMS} stems reached
              </p>
            )}
          </div>
          {stemCount >= 8 && !atLimit && (
            <p className="text-yellow-400/70 text-xs flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              8+ stems may impact performance on some devices
            </p>
          )}
        </div>
      )}

      {error && (
        <div className="mt-3 flex items-center gap-2 text-red-400 text-xs">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <p>{error}</p>
        </div>
      )}
    </div>
  );
}
