"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { LibraryEntry } from "@/lib/storage/library-types";

export type ResumeChoice = "resume" | "fresh";

export interface ResumeOrFreshDialogProps {
  open: boolean;
  entry: LibraryEntry | null;
  /** Fired with the user's choice. `dontAskAgain` is the checkbox state at click time. */
  onChoice: (choice: ResumeChoice, dontAskAgain: boolean) => void;
  /** Fired when the user dismisses the dialog (Esc, overlay click, X). */
  onDismiss: () => void;
}

export function ResumeOrFreshDialog({
  open,
  entry,
  onChoice,
  onDismiss,
}: ResumeOrFreshDialogProps): React.ReactElement | null {
  const [dontAskAgain, setDontAskAgain] = useState(false);

  if (!entry) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onDismiss();
      }}
    >
      <DialogContent
        data-testid="resume-or-fresh-dialog"
        className="bg-[#0a0a0a] border-[rgba(255,255,255,0.08)]"
      >
        <DialogHeader>
          <DialogTitle className="text-white">We&apos;ve seen this song before</DialogTitle>
          <DialogDescription>
            <span className="text-[rgba(255,255,255,0.7)]">
              You analyzed{" "}
              <span className="text-white font-medium">{entry.fileName}</span>{" "}
              previously. Resume your saved analysis and settings, or start fresh?
            </span>
          </DialogDescription>
        </DialogHeader>

        <label className="flex items-center gap-2 mt-2 text-xs text-[rgba(255,255,255,0.6)] cursor-pointer">
          <input
            type="checkbox"
            data-testid="dont-ask-again"
            checked={dontAskAgain}
            onChange={(e) => setDontAskAgain(e.target.checked)}
            className="accent-[#0a84ff]"
          />
          <span>Don&apos;t ask again — always resume</span>
        </label>

        <DialogFooter className="gap-2 sm:gap-2">
          <button
            type="button"
            data-testid="resume-button"
            onClick={() => onChoice("resume", dontAskAgain)}
            className="flex-1 px-4 py-2 rounded-md text-sm bg-[#0a84ff] text-white hover:bg-[#0066cc] transition-colors"
          >
            Resume saved settings
          </button>
          <button
            type="button"
            data-testid="start-fresh-button"
            onClick={() => onChoice("fresh", dontAskAgain)}
            className="flex-1 px-4 py-2 rounded-md text-sm bg-[rgba(255,255,255,0.06)] text-[rgba(255,255,255,0.85)] hover:bg-[rgba(255,255,255,0.1)] transition-colors"
          >
            Start fresh
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
