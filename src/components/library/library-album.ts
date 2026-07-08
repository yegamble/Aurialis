import type { LibraryEntry } from "@/lib/storage/library-types";
import { computeAlbumTargetLufs } from "@/lib/stores/album-store";
import type { LibraryAlbum } from "./LibraryView";

/** Loudness drift threshold (LU) — mirrors the Smart Master Album issue count. */
const DRIFT_LU = 1.5;

/**
 * Derive a real album summary for the library hero card from library entries.
 *
 * All figures come from persisted data — no fabricated BPM/key/artist:
 *  - `avgLufs`   mean of the *measured* integrated LUFS across analyzed tracks
 *                (undefined when nothing has been analyzed yet).
 *  - `variance`  loudness spread expressed as the range (max − min) of measured
 *                LUFS, in LU. Undefined until at least two tracks are analyzed.
 *                Range (not stddev) is used so it reads as a concrete "how far
 *                apart are my loudest and quietest masters" number.
 *  - `issues`    count of analyzed tracks whose measured LUFS drifts more than
 *                1.5 LU from the album target, using the SAME target derivation
 *                the /album view uses (`computeAlbumTargetLufs`), so the two
 *                surfaces never disagree.
 *
 * Returns `undefined` for an empty library (nothing to summarize).
 */
export function deriveLibraryAlbum(
  entries: LibraryEntry[],
): LibraryAlbum | undefined {
  if (entries.length === 0) return undefined;

  const measured = entries
    .map((e) => e.measuredLufs)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));

  const avgLufs =
    measured.length > 0
      ? measured.reduce((sum, v) => sum + v, 0) / measured.length
      : undefined;

  const variance =
    measured.length >= 2 ? Math.max(...measured) - Math.min(...measured) : undefined;

  const target = computeAlbumTargetLufs(entries, null);
  const issues = measured.filter((v) => Math.abs(v - target) > DRIFT_LU).length;

  return {
    title: "Library album",
    artist: "Loudness consistency across your tracks",
    trackCount: entries.length,
    avgLufs,
    variance,
    issues,
  };
}
