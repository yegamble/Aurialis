"use client";

import { useState, useRef, useCallback } from "react";
import { motion } from "motion/react";
import { Upload, Music, Headphones, Download, Sparkles, Layers } from "lucide-react";
import Link from "next/link";

interface UploadScreenProps {
  onFileUploaded: (file: File) => void;
}

export function UploadScreen({ onFileUploaded }: UploadScreenProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (file: File) => {
      setUploadProgress(0);
      const interval = setInterval(() => {
        setUploadProgress((prev) => {
          if (prev === null) return 0;
          if (prev >= 100) {
            clearInterval(interval);
            setTimeout(() => onFileUploaded(file), 300);
            return 100;
          }
          return prev + Math.random() * 15 + 5;
        });
      }, 80);
    },
    [onFileUploaded]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 relative overflow-hidden">
      {/* Subtle background gradient */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-[#0a84ff]/[0.04] blur-[120px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="flex flex-col items-center gap-2 mb-10 relative z-10"
      >
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-b from-[#0a84ff] to-[#0066cc] flex items-center justify-center">
            <Headphones className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-[2.5rem] tracking-tight text-white">Waveish</h1>
        </div>
        <p className="text-[rgba(255,255,255,0.5)] tracking-wide">
          Professional audio mastering in your browser
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-lg relative z-10"
      >
        <div
          role="button"
          tabIndex={0}
          aria-label="Upload audio file. Drop audio here or click to browse."
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          className={`
            relative rounded-2xl border-2 border-dashed transition-all duration-300 cursor-pointer
            p-12 flex flex-col items-center gap-4
            ${
              isDragging
                ? "border-[#0a84ff] bg-[#0a84ff]/[0.08]"
                : "border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.03)] hover:border-[rgba(255,255,255,0.2)] hover:bg-[rgba(255,255,255,0.05)]"
            }
          `}
        >
          {uploadProgress !== null ? (
            <div className="flex flex-col items-center gap-4 w-full">
              <div className="w-12 h-12 rounded-full bg-[rgba(255,255,255,0.06)] flex items-center justify-center">
                <Music className="w-6 h-6 text-[#0a84ff]" />
              </div>
              <p className="text-white">Processing audio...</p>
              <div className="w-full h-1 rounded-full bg-[rgba(255,255,255,0.08)] overflow-hidden">
                <motion.div
                  className="h-full bg-gradient-to-r from-[#0a84ff] to-[#5ac8fa] rounded-full"
                  initial={{ width: "0%" }}
                  animate={{ width: `${Math.min(uploadProgress, 100)}%` }}
                  transition={{ duration: 0.1 }}
                />
              </div>
              <p className="text-[rgba(255,255,255,0.4)] text-sm">
                {Math.min(Math.round(uploadProgress), 100)}%
              </p>
            </div>
          ) : (
            <>
              <div className="w-14 h-14 rounded-2xl bg-[rgba(255,255,255,0.06)] flex items-center justify-center">
                <Upload className="w-7 h-7 text-[rgba(255,255,255,0.5)]" />
              </div>
              <div className="text-center">
                <p className="text-white mb-1">
                  Drop audio here or click to browse
                </p>
                <p className="text-[rgba(255,255,255,0.35)] text-sm">
                  WAV, MP3, FLAC, OGG, AAC, M4A
                </p>
              </div>
            </>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={handleChange}
          aria-hidden="true"
        />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="mt-6 relative z-10"
      >
        <Link
          href="/mix"
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)] hover:bg-[rgba(255,255,255,0.06)] hover:border-[rgba(255,255,255,0.2)] transition-all text-[rgba(255,255,255,0.6)] hover:text-white text-sm"
        >
          <Layers className="w-4 h-4" />
          Mix Stems
          <span className="text-[rgba(255,255,255,0.3)] text-xs ml-1">
            Upload &amp; mix multiple tracks
          </span>
        </Link>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.25, ease: [0.16, 1, 0.3, 1] }}
        className="flex flex-wrap justify-center gap-8 mt-12 relative z-10"
      >
        {[
          {
            icon: Sparkles,
            title: "One-Knob Mastering",
            desc: "Simple mode for everyone",
          },
          {
            icon: Headphones,
            title: "Pro Controls",
            desc: "Full chain for experts",
          },
          {
            icon: Download,
            title: "Export Ready",
            desc: "Streaming & Hi-Res formats",
          },
        ].map((item) => (
          <div
            key={item.title}
            className="flex flex-col items-center gap-2 w-40"
          >
            <div className="w-10 h-10 rounded-xl bg-[rgba(255,255,255,0.04)] flex items-center justify-center">
              <item.icon className="w-5 h-5 text-[#0a84ff]" />
            </div>
            <p className="text-white text-sm">{item.title}</p>
            <p className="text-[rgba(255,255,255,0.35)] text-xs text-center">
              {item.desc}
            </p>
          </div>
        ))}
      </motion.div>
    </div>
  );
}
