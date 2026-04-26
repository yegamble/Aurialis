import { create } from "zustand";
import type {
  MasteringScript,
  Move,
  ProfileId,
} from "@/types/deep-mastering";
import type { DeepSubStatus } from "@/lib/api/deep-analysis";

export type DeepStatus = "idle" | "analyzing" | "ready" | "error";

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
  /** A/B toggle: when false, the engine should treat the script as muted. */
  scriptActive: boolean;
  /** Last error message, if any. */
  error: string | null;

  setProfile: (id: ProfileId) => void;
  setStatus: (s: DeepStatus) => void;
  setSubStatus: (s: DeepSubStatus) => void;
  setScript: (s: MasteringScript | null) => void;
  setScriptActive: (active: boolean) => void;
  setError: (e: string | null) => void;

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
  scriptActive: true,
  error: null,

  setProfile: (id) => set({ profile: id }),
  setStatus: (s) => set({ status: s }),
  setSubStatus: (s) => set({ subStatus: s }),
  setScript: (s) => set({ script: s }),
  setScriptActive: (scriptActive) => set({ scriptActive }),
  setError: (error) => set({ error }),

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
      scriptActive: true,
      error: null,
    }),
}));
