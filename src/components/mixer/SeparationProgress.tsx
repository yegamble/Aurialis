"use client";

import { motion } from "motion/react";
import { Music, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import type { StemStatus } from "@/lib/api/separation";

interface SeparationProgressProps {
  status: "queued" | "processing" | "done" | "error";
  progress: number;
  model: string;
  stems: StemStatus[];
  error: string | null;
}

export function SeparationProgress({
  status,
  progress,
  model,
  stems,
  error,
}: SeparationProgressProps) {
  return (
    <div className="w-full rounded-xl bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] p-6">
      <div className="flex items-center gap-3 mb-4">
        {status === "error" ? (
          <AlertCircle className="w-5 h-5 text-red-400" />
        ) : status === "done" ? (
          <CheckCircle2 className="w-5 h-5 text-green-400" />
        ) : (
          <Loader2 className="w-5 h-5 text-[#0a84ff] animate-spin" />
        )}
        <div>
          <p className="text-white text-sm">
            {status === "queued" && "Waiting in queue..."}
            {status === "processing" && "Separating stems..."}
            {status === "done" && "Separation complete"}
            {status === "error" && "Separation failed"}
          </p>
          <p className="text-[rgba(255,255,255,0.4)] text-xs">
            Model: {model} &middot; {progress}%
          </p>
        </div>
      </div>

      {/* Progress bar */}
      {status !== "error" && (
        <div className="w-full h-1.5 rounded-full bg-[rgba(255,255,255,0.08)] mb-4 overflow-hidden">
          <motion.div
            className={`h-full rounded-full ${
              status === "done"
                ? "bg-green-400"
                : "bg-gradient-to-r from-[#0a84ff] to-[#5ac8fa]"
            }`}
            initial={{ width: "0%" }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
      )}

      {/* Stem list (appear as they become ready) */}
      {stems.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {stems.map((stem) => (
            <motion.div
              key={stem.name}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs ${
                stem.ready
                  ? "bg-[rgba(255,255,255,0.06)] text-white"
                  : "bg-[rgba(255,255,255,0.03)] text-[rgba(255,255,255,0.3)]"
              }`}
            >
              <Music className="w-3 h-3" />
              <span className="capitalize">{stem.name}</span>
              {stem.ready && (
                <CheckCircle2 className="w-3 h-3 text-green-400" />
              )}
            </motion.div>
          ))}
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="mt-3 flex items-center gap-2 text-red-400 text-xs">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <p>{error}</p>
        </div>
      )}
    </div>
  );
}
