import type { LibraryEntry } from "@/lib/storage/library-types";
import type { SidebarTrack } from "./Sidebar";

/** Cap the sidebar track list so a large library doesn't overflow the rail. */
export const MAX_SIDEBAR_TRACKS = 12;

/**
 * Shared builder: library entries → sidebar track rows. Used by every route
 * that renders the unified shell (`/`, `/master`, `/mix`, `/album`) so the
 * sidebar shows one consistent, real library list.
 *
 * All fields derive from persisted data only:
 *  - `analyzed` mirrors the library table's "Analyzed" flag (`script !== null`),
 *    driving the trailing check on a NavTrack row.
 *  - `artSeed` is the entry fingerprint so the deterministic art tile matches
 *    the same track's tile on the library table and master toolbar.
 */
export function libraryEntriesToSidebarTracks(
  entries: LibraryEntry[],
): SidebarTrack[] {
  return entries.slice(0, MAX_SIDEBAR_TRACKS).map((e) => ({
    id: e.fingerprint,
    title: e.fileName.replace(/\.[^.]+$/, ""),
    analyzed: e.script !== null,
    artSeed: e.fingerprint,
  }));
}
