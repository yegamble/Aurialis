import { create } from "zustand";
import type {
  MasteringScript,
  Move,
  ProfileId,
} from "@/types/deep-mastering";
import type {
  DeepErrorDetails,
  DeepSubStatus,
} from "@/lib/api/deep-analysis";
import { useAudioStore } from "./audio-store";
import { useLibraryStore } from "./library-store";

export type DeepStatus =
  | "idle"
  | "analyzing"
  | "cancelling"
  | "ready"
  | "error";

const DEFAULT_PROFILE: ProfileId = "modern_pop_polish";

export interface DeepState {
  /** Active script. Null when no analysis has run for the loaded track. */
  script: MasteringScript | null;
  /** Last selected engineer profile (sticks across re-analyses). */
  profile: ProfileId;
  /** Coarse job status. */
  status: DeepStatus;
  /** Most-advanced phase reached during analyze (sections → stems → script). */
  subStatus: DeepSubStatus;
  /** Polling progress percent 0..100 (mirrors backend `Job.progress`). */
  progress: number;
  /** ms since epoch when the current analyze run started; null when idle. */
  startedAt: number | null;
  /** A/B toggle: when false, the engine should treat the script as muted. */
  scriptActive: boolean;
  /** Last error details, if any. Drives the error UI. */
  errorDetails: DeepErrorDetails | null;
  /**
   * Per-run UUID for the analysis-stage harness. Lets `DeepProgressCard`
   * subscribe to the chronological stage trace in `useAnalysisStageStore`.
   * Null when no analysis has been run for the current track.
   */
  runId: string | null;
  /** True when the active script was loaded from the library (vs freshly analyzed). Drives the badge. */
  loadedFromLibrary: boolean;
  /**
   * When true, library-store side-effects (auto-save on setScript, settings
   * auto-update) are suppressed. Used during the "Start fresh" flow so the
   * old library entry stays intact until the next user-initiated Analyze.
   */
  suppressLibraryAutoUpdate: boolean;

  setProfile: (id: ProfileId) => void;
  setStatus: (s: DeepStatus) => void;
  setSubStatus: (s: DeepSubStatus) => void;
  setProgress: (n: number) => void;
  setStartedAt: (ms: number | null) => void;
  setRunId: (id: string | null) => void;
  setScript: (s: MasteringScript | null, opts?: { skipPersist?: boolean }) => void;
  setScriptActive: (active: boolean) => void;
  setError: (details: DeepErrorDetails | null) => void;
  setLoadedFromLibrary: (v: boolean) => void;
  setSuppressLibraryAutoUpdate: (v: boolean) => void;

  /** Patch a Move and flag it as edited. No-op if moveId not found. */
  applyMoveEdit: (moveId: string, patch: Partial<Move>) => void;
  /** Restore a Move's value to its `original` and clear edited/muted. */
  resetMove: (moveId: string) => void;
  /** True if any move has been user-edited (drives profile-switch guard). */
  hasEditedMoves: () => boolean;

  reset: () => void;
}

export const useDeepStore = create<DeepState>((set, get) => ({
  script: null,
  profile: DEFAULT_PROFILE,
  status: "idle",
  subStatus: null,
  progress: 0,
  startedAt: null,
  scriptActive: true,
  errorDetails: null,
  runId: null,
  loadedFromLibrary: false,
  suppressLibraryAutoUpdate: false,

  setProfile: (id) => set({ profile: id }),
  setStatus: (s) => set({ status: s }),
  setSubStatus: (s) => set({ subStatus: s }),
  setProgress: (n) => set({ progress: n }),
  setStartedAt: (ms) => set({ startedAt: ms }),
  setRunId: (runId) => set({ runId }),
  setScript: (s, opts) => {
    set({ script: s });
    if (s && !opts?.skipPersist && !get().suppressLibraryAutoUpdate) {
      void persistScriptToLibrary(s);
    }
  },
  setScriptActive: (scriptActive) => set({ scriptActive }),
  setError: (errorDetails) => set({ errorDetails }),
  setLoadedFromLibrary: (loadedFromLibrary) => set({ loadedFromLibrary }),
  setSuppressLibraryAutoUpdate: (suppressLibraryAutoUpdate) =>
    set({ suppressLibraryAutoUpdate }),

  applyMoveEdit: (moveId, patch) => {
    const script = get().script;
    if (!script) return;
    const idx = script.moves.findIndex((m) => m.id === moveId);
    if (idx < 0) return;
    const next: Move = {
      ...script.moves[idx]!,
      ...patch,
      // Preserve identity + original — patch may try to set them, ignore those.
      id: script.moves[idx]!.id,
      original: script.moves[idx]!.original,
      edited: true,
    };
    const moves = [...script.moves];
    moves[idx] = next;
    set({ script: { ...script, moves } });
  },

  resetMove: (moveId) => {
    const script = get().script;
    if (!script) return;
    const idx = script.moves.findIndex((m) => m.id === moveId);
    if (idx < 0) return;
    const cur = script.moves[idx]!;
    // Reset restores the envelope to a flat curve at `original` value, plus
    // clears the user-edit + mute flags. Per spec T15: "Reset restores the
    // original AI-proposed value."
    const next: Move = {
      ...cur,
      envelope: [
        [cur.startSec, cur.original],
        [cur.endSec, cur.original],
      ],
      muted: false,
      edited: false,
    };
    const moves = [...script.moves];
    moves[idx] = next;
    set({ script: { ...script, moves } });
  },

  hasEditedMoves: () => {
    const s = get().script;
    return !!s && s.moves.some((m) => m.edited);
  },

  reset: () =>
    set({
      script: null,
      profile: DEFAULT_PROFILE,
      status: "idle",
      subStatus: null,
      progress: 0,
      startedAt: null,
      scriptActive: true,
      errorDetails: null,
      runId: null,
      loadedFromLibrary: false,
      suppressLibraryAutoUpdate: false,
    }),
}));

/**
 * Persist a fresh script to the library. Looks up the active audio file via
 * `useAudioStore` — no-op when the store is empty (script can't be associated
 * with a song). Errors are logged, not thrown — losing a save is annoying but
 * shouldn't break the analysis flow.
 */
async function persistScriptToLibrary(script: MasteringScript): Promise<void> {
  try {
    const file = useAudioStore.getState().file;
    if (!file) return;
    const lib = useLibraryStore.getState();
    if (!lib.hydrated) return;
    await lib.addEntry(file, { script });
  } catch (err) {
    console.error("[deep-store] failed to persist script to library", err);
  }
}
