"use client";

import type { ReactElement, ReactNode } from "react";
import { ArrowLeft, Music } from "lucide-react";

export type MasterMode = "simple" | "advanced" | "deep";

export interface MasterToolbarProps {
  fileName: string;
  durationLabel: string;
  sampleRateLabel: string;
  channelLabel: string;
  mode: MasterMode;
  onModeChange: (mode: MasterMode) => void;
  onBack: () => void;
  children?: ReactNode;
}

const MODES: { id: MasterMode; label: string }[] = [
  { id: "simple", label: "Simple" },
  { id: "advanced", label: "Advanced" },
  { id: "deep", label: "Deep" },
];

export function MasterToolbar({
  fileName,
  durationLabel,
  sampleRateLabel,
  channelLabel,
  mode,
  onModeChange,
  onBack,
  children,
}: MasterToolbarProps): ReactElement {
  return (
    <div
      data-testid="master-toolbar"
      className="sticky top-0 z-40 flex items-center justify-between gap-4 border-b border-[rgba(255,255,255,0.06)] bg-[rgba(20,20,22,0.8)] px-5 py-3 backdrop-blur-xl"
    >
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to library"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-[rgba(255,255,255,0.06)] text-[rgba(255,255,255,0.7)] hover:bg-[rgba(255,255,255,0.1)]"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[rgba(255,255,255,0.06)]">
          <Music className="h-4 w-4 text-[#0a84ff]" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm text-white">{fileName}</p>
          <p className="truncate text-xs text-[rgba(255,255,255,0.4)]">
            {durationLabel} &middot; {sampleRateLabel} &middot; {channelLabel}
          </p>
        </div>
      </div>

      <div
        aria-label="Mastering mode"
        className="inline-flex rounded-md border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.06)] p-0.5"
      >
        {MODES.map((m) => {
          const active = mode === m.id;
          return (
            <button
              key={m.id}
              type="button"
              data-testid={`mode-toggle-${m.id}`}
              onClick={() => onModeChange(m.id)}
              aria-pressed={active}
              className={
                "rounded px-4 py-1.5 text-xs capitalize transition-all " +
                (active
                  ? "bg-[rgba(255,255,255,0.12)] text-white shadow-sm"
                  : "text-[rgba(255,255,255,0.45)] hover:text-[rgba(255,255,255,0.7)]")
              }
            >
              {m.label}
            </button>
          );
        })}
      </div>

      <div className="flex min-w-[80px] items-center justify-end gap-2">{children}</div>
    </div>
  );
}
