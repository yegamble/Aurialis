import { create } from "zustand";
import type { LibraryEntry } from "@/lib/storage/library-types";
import type { AlbumTrackRow } from "@/components/album/AlbumView";

/** Album loudness target used when no track has a configured target. */
export const DEFAULT_ALBUM_TARGET_LUFS = -14;

const STRIP_EXT = /\.[^.]+$/;

interface AlbumState {
  /**
   * Manual album loudness target override (LUFS). `null` = auto, i.e. derive
   * the target from the average of the per-track configured targets.
   */
  targetLufsOverride: number | null;
  setTargetLufsOverride: (value: number | null) => void;
}

/**
 * Album-level UI state for the Smart Master Album. The per-track rows and the
 * effective target are derived from the library via the helpers below; this
 * store only holds album-scoped settings (currently the manual target override).
 */
export const useAlbumStore = create<AlbumState>((set) => ({
  targetLufsOverride: null,
  setTargetLufsOverride: (value) => set({ targetLufsOverride: value }),
}));

/**
 * Map library entries to album rows using the *measured* integrated LUFS
 * (`measuredLufs`). Tracks that have never been analyzed surface `lufs: null`
 * so the view renders the "Not analyzed" / "—" state rather than fabricating a
 * value from the configured target.
 */
export function libraryEntriesToAlbumRows(
  entries: LibraryEntry[],
): AlbumTrackRow[] {
  return entries.map((e) => ({
    id: e.fingerprint,
    title: e.fileName.replace(STRIP_EXT, ""),
    lufs: e.measuredLufs ?? null,
    durationSec: e.durationSec,
  }));
}

/**
 * The album's loudness target. Uses the manual override when set; otherwise the
 * average of each track's *configured* target LUFS (the intended loudness, NOT
 * the measured value, so per-track deltas reflect real drift), falling back to
 * the default when no track carries settings.
 */
export function computeAlbumTargetLufs(
  entries: LibraryEntry[],
  override: number | null,
): number {
  if (override !== null && Number.isFinite(override)) return override;
  const targets = entries
    .map((e) => e.settings?.params.targetLufs)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (targets.length === 0) return DEFAULT_ALBUM_TARGET_LUFS;
  return targets.reduce((sum, v) => sum + v, 0) / targets.length;
}
