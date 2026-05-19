"use client";

import type { ReactElement } from "react";
import { ArrowLeft, Download, Sparkles, SendHorizonal, Wand2 } from "lucide-react";

export interface MixToolbarProps {
  onBack: () => void;
  hasStemsLoaded: boolean;

  smartRepairEnabled: boolean;
  onSmartRepairToggle: () => void;

  onAutoMix: () => void;
  autoMixDisabled?: boolean;
  autoMixLabel: string;

  onSendToMaster: () => void;
  sendDisabled?: boolean;

  onExportMix: () => void;
  exportDisabled?: boolean;
}

export function MixToolbar({
  onBack,
  hasStemsLoaded,
  smartRepairEnabled,
  onSmartRepairToggle,
  onAutoMix,
  autoMixDisabled = false,
  autoMixLabel,
  onSendToMaster,
  sendDisabled = false,
  onExportMix,
  exportDisabled = false,
}: MixToolbarProps): ReactElement {
  return (
    <div
      data-testid="mix-toolbar"
      className="sticky top-0 z-40 flex items-center justify-between gap-4 border-b border-[rgba(255,255,255,0.06)] bg-[rgba(20,20,22,0.8)] px-5 py-3 backdrop-blur-xl"
    >
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to library"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-[rgba(255,255,255,0.06)] text-[rgba(255,255,255,0.7)] hover:bg-[rgba(255,255,255,0.1)]"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-2 text-sm text-white">
          <span className="font-medium">Mix</span>
          <span className="text-[rgba(255,255,255,0.3)] text-xs">
            · Smart Split
          </span>
        </div>
      </div>

      {hasStemsLoaded ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onSmartRepairToggle}
            aria-pressed={smartRepairEnabled}
            aria-label="Smart Repair"
            className={
              "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors " +
              (smartRepairEnabled
                ? "border-green-500/30 bg-green-500/20 text-green-400"
                : "border-transparent bg-[rgba(255,255,255,0.06)] text-[rgba(255,255,255,0.4)]")
            }
          >
            <Wand2 className="h-3.5 w-3.5" />
            Smart Repair
          </button>
          <button
            type="button"
            data-testid="auto-mix-button"
            onClick={onAutoMix}
            disabled={autoMixDisabled}
            className="flex items-center gap-1.5 rounded-lg bg-[rgba(255,255,255,0.06)] px-3 py-1.5 text-xs text-[rgba(255,255,255,0.7)] transition-colors hover:bg-[rgba(255,255,255,0.1)] hover:text-white disabled:opacity-40"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {autoMixLabel}
          </button>
          <button
            type="button"
            aria-label="Send to Master"
            onClick={onSendToMaster}
            disabled={sendDisabled}
            className="flex items-center gap-1.5 rounded-lg bg-[#0a84ff]/20 px-3 py-1.5 text-xs text-[#0a84ff] transition-colors hover:bg-[#0a84ff]/30 disabled:opacity-40"
          >
            <SendHorizonal className="h-3.5 w-3.5" />
            {sendDisabled ? "Rendering..." : "Send to Master"}
          </button>
          <button
            type="button"
            onClick={onExportMix}
            disabled={exportDisabled}
            className="flex items-center gap-1.5 rounded-lg bg-[rgba(255,255,255,0.06)] px-3 py-1.5 text-xs text-[rgba(255,255,255,0.7)] transition-colors hover:bg-[rgba(255,255,255,0.1)] hover:text-white disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" />
            Export Mix
          </button>
        </div>
      ) : null}
    </div>
  );
}
