"use client";

import { useCallback, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, RefObject } from "react";

export interface FileImport {
  isDragging: boolean;
  /** null when idle; 0–100 while the decode/import indicator runs. */
  uploadProgress: number | null;
  inputRef: RefObject<HTMLInputElement | null>;
  openPicker: () => void;
  onDragOver: (e: DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: DragEvent) => void;
  onInputChange: (e: ChangeEvent<HTMLInputElement>) => void;
}

/**
 * Shared drag/drop + file-select + progress-indicator logic for the two import
 * surfaces (the first-run marketing UploadScreen and the in-shell ImportPanel).
 * Extracted so both render distinct chrome over one behaviour instead of
 * duplicating the handler wiring.
 */
export function useFileImport(
  onFilesUploaded: (files: File[]) => void,
): FileImport {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      setUploadProgress(0);
      const interval = setInterval(() => {
        setUploadProgress((prev) => {
          if (prev === null) return 0;
          if (prev >= 100) {
            clearInterval(interval);
            setTimeout(() => onFilesUploaded(files), 300);
            return 100;
          }
          return prev + Math.random() * 15 + 5;
        });
      }, 80);
    },
    [onFilesUploaded],
  );

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) handleFiles(files);
    },
    [handleFiles],
  );

  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback(() => setIsDragging(false), []);

  const onInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (files.length > 0) handleFiles(files);
    },
    [handleFiles],
  );

  const openPicker = useCallback(() => inputRef.current?.click(), []);

  return {
    isDragging,
    uploadProgress,
    inputRef,
    openPicker,
    onDragOver,
    onDragLeave,
    onDrop,
    onInputChange,
  };
}
