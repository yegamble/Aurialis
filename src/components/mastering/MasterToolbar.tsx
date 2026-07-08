"use client";

import type { ReactElement, ReactNode } from "react";
import { ArrowLeft, Scissors, Download } from "lucide-react";
import { artGradient } from "@/lib/art-tile";

export type MasterMode = "simple" | "advanced" | "deep";

export interface MasterToolbarProps {
  fileName: string;
  durationLabel: string;
  sampleRateLabel: string;
  channelLabel: string;
  mode: MasterMode;
  onModeChange: (mode: MasterMode) => void;
  onBack: () => void;
  /** Right-side "Split stems" action (→ /mix). Omitted when not provided. */
  onStems?: () => void;
  /** Right-side primary "Export" action. Omitted when not provided. */
  onExport?: () => void;
  children?: ReactNode;
}

/**
 * Deterministic gradient album-art tile seeded by a string (the file name).
 * Colours come from the shared {@link artGradient} helper so every surface
 * (sidebar, library table, this toolbar) derives the same hue from a seed.
 */
function ArtThumb({ seed, size = 36 }: { seed: string; size?: number }): ReactElement {
  const g = artGradient(seed);
  return (
    <div
      aria-hidden
      data-testid="master-art-tile"
      className="shrink-0 rounded-lg"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, ${g.a}, ${g.b})`,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.12)",
      }}
    />
  );
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
  onStems,
  onExport,
  children,
}: MasterToolbarProps): ReactElement {
  return (
    <div
      data-testid="master-toolbar"
      className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-x-2 gap-y-2 border-b border-[rgba(255,255,255,0.06)] bg-[rgba(20,20,22,0.8)] px-3 py-3 backdrop-blur-xl sm:flex-nowrap sm:gap-4 sm:px-5"
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
        <ArtThumb seed={fileName} />
        <div className="min-w-0">
          <p className="truncate text-sm text-white">{fileName}</p>
          <p className="truncate text-xs text-[rgba(255,255,255,0.4)]">
            {durationLabel} &middot; {sampleRateLabel} &middot; {channelLabel}
          </p>
        </div>
      </div>

      <div
        aria-label="Mastering mode"
        className="order-last flex w-full justify-center rounded-md border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.06)] p-0.5 sm:order-none sm:inline-flex sm:w-auto"
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

      <div className="flex items-center justify-end gap-2">
        {children}
        {onStems && (
          <button
            type="button"
            data-testid="master-split-stems-button"
            onClick={onStems}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[rgba(255,255,255,0.06)] px-3 py-1.5 text-xs text-[rgba(255,255,255,0.7)] hover:bg-[rgba(255,255,255,0.1)]"
          >
            <Scissors className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Split stems</span>
          </button>
        )}
        {onExport && (
          <button
            type="button"
            data-testid="master-export-button"
            onClick={onExport}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#0a84ff] px-3.5 py-1.5 text-xs font-medium text-white shadow-[0_1px_4px_rgba(10,132,255,0.4)] hover:bg-[#0066cc]"
          >
            <Download className="h-3.5 w-3.5" />
            Export
          </button>
        )}
      </div>
    </div>
  );
}
