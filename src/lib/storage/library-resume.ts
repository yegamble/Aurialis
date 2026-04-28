/**
 * Bridge between an uploaded File and a library entry, plus the Resume hydration sequence.
 *
 * Order of operations matters: settings must be restored BEFORE the audio
 * engine instantiates (which happens when `useAudioStore.setFile` triggers
 * MasterPage's loadFile effect), so that the engine reads the restored
 * params on first init — no default-then-restore transition.
 */

import { useAudioStore } from "@/lib/stores/audio-store";
import { useDeepStore } from "@/lib/stores/deep-store";
import { useLibraryStore } from "@/lib/stores/library-store";
import { cheapFingerprint } from "./library-fingerprint";
import { getAudioFile } from "./library-storage";
import type { LibraryEntry } from "./library-types";

/** Look up a library entry that matches a freshly-uploaded file. Cheap-fingerprint only. */
export function findLibraryEntryForFile(file: File): LibraryEntry | null {
  const fp = cheapFingerprint(file);
  const entry = useLibraryStore.getState().entries.find((e) => e.fingerprint === fp);
  return entry ?? null;
}

/**
 * Resume hydration sequence — used by both the upload-with-fresh-File path
 * and the library-list-click path. Set settings first, then script, then
 * file LAST so the engine instantiates with restored params on first read.
 */
export async function resumeFromLibraryEntry(
  entry: LibraryEntry,
  file: File
): Promise<void> {
  if (entry.settings) {
    useAudioStore.getState().setParams(entry.settings.params);
  }
  if (entry.script) {
    useDeepStore.getState().setScript(entry.script, { skipPersist: true });
    useDeepStore.getState().setProfile(entry.script.profile);
  }
  useDeepStore.getState().setLoadedFromLibrary(true);
  useDeepStore.getState().setSuppressLibraryAutoUpdate(false);
  useAudioStore.getState().setFile(file);
  await useLibraryStore.getState().openEntry(entry.fingerprint);
}

/**
 * Open a library entry from the list (no fresh File on hand). Reconstructs a
 * File from the OPFS Blob, then runs the same Resume sequence.
 */
export async function openLibraryEntryFromList(
  fingerprint: string
): Promise<{ ok: true } | { ok: false; reason: "no-audio" | "not-found" }> {
  const entry = useLibraryStore.getState().entries.find((e) => e.fingerprint === fingerprint);
  if (!entry) return { ok: false, reason: "not-found" };

  const file = await getAudioFile(fingerprint);
  if (!file) return { ok: false, reason: "no-audio" };

  await resumeFromLibraryEntry(entry, file);
  return { ok: true };
}

/**
 * Start-fresh sequence — load the audio but skip restoring saved analysis /
 * settings, and flag the deep-store so settings touches don't write back to
 * the existing library entry. Caller is responsible for the user-facing
 * confirm prompt before calling this.
 */
export function startFreshFromUpload(file: File): void {
  useDeepStore.getState().setScript(null, { skipPersist: true });
  useDeepStore.getState().setLoadedFromLibrary(false);
  useDeepStore.getState().setSuppressLibraryAutoUpdate(true);
  useAudioStore.getState().setFile(file);
}
