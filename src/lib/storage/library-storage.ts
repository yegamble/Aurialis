/**
 * Library persistence — IndexedDB (metadata + script + settings) + OPFS (audio Blobs).
 *
 * Two-tier storage so heavy audio doesn't bloat the IDB index. Atomic writes
 * via two-phase put: OPFS first, then IDB; OPFS rollback if IDB throws.
 * `reconcileOrphans()` is the safety net for crash-mid-step.
 */

import * as idb from "idb-keyval";

const { createStore } = idb;

import type { LibraryEntry } from "./library-types";

// idb-keyval's createStore ties one object store to one database; calling it
// twice on the same DB silently no-ops the second store creation. So use two
// distinct databases — keeps preferences cleanly partitioned from entries.
const ENTRIES_DB = "aurialis-library-entries-v1";
const PREFS_DB = "aurialis-library-prefs-v1";
const STORE_NAME = "kv";
const OPFS_DIR = "library";

const entriesStore = createStore(ENTRIES_DB, STORE_NAME);
const prefsStore = createStore(PREFS_DB, STORE_NAME);

/** True when the runtime supports OPFS. Computed at call time so test hooks can flip it. */
export function isOpfsAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.storage !== "undefined" &&
    typeof navigator.storage.getDirectory === "function"
  );
}

/** Encode the fingerprint to a safe, reversible OPFS file name. */
function audioFileName(fingerprint: string): string {
  return `${encodeURIComponent(fingerprint)}.bin`;
}

function decodeFileName(name: string): string | null {
  if (!name.endsWith(".bin")) return null;
  try {
    return decodeURIComponent(name.slice(0, -4));
  } catch {
    return null;
  }
}

async function getOpfsLibraryDir(create: boolean): Promise<FileSystemDirectoryHandle | null> {
  if (!isOpfsAvailable()) return null;
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(OPFS_DIR, { create });
  } catch (e) {
    if ((e as Error).name === "NotFoundError") return null;
    throw e;
  }
}

async function opfsWrite(fingerprint: string, blob: Blob): Promise<void> {
  const dir = await getOpfsLibraryDir(true);
  if (!dir) return;
  const handle = await dir.getFileHandle(audioFileName(fingerprint), { create: true });
  // FileSystemFileHandle.createWritable is available in OPFS implementations.
  const writable = await (handle as unknown as {
    createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }>;
  }).createWritable();
  await writable.write(blob);
  await writable.close();
}

async function opfsRemove(fingerprint: string): Promise<void> {
  const dir = await getOpfsLibraryDir(false);
  if (!dir) return;
  try {
    await dir.removeEntry(audioFileName(fingerprint));
  } catch (e) {
    const name = (e as Error).name;
    if (name === "NotFoundError") return;
    // InvalidStateError / NoModificationAllowedError can fire if a stale
    // FileSystemFileHandle reference is held elsewhere (e.g., a recent
    // FileReader on the same file). The reconcileOrphans safety net catches
    // any leftover audio on next boot — don't block the UI delete on this.
    if (name === "InvalidStateError" || name === "NoModificationAllowedError") {
      console.warn(`[library-storage] OPFS removeEntry deferred for ${fingerprint}: ${name}`);
      return;
    }
    throw e;
  }
}

async function opfsRead(fingerprint: string): Promise<Blob | null> {
  const dir = await getOpfsLibraryDir(false);
  if (!dir) return null;
  try {
    const handle = await dir.getFileHandle(audioFileName(fingerprint));
    const file = await handle.getFile();
    return file;
  } catch (e) {
    if ((e as Error).name === "NotFoundError") return null;
    throw e;
  }
}

/** Write an entry. If `audioBlob` provided and OPFS available, write OPFS first then IDB; rollback on IDB failure. */
export async function putEntry(entry: LibraryEntry, audioBlob?: Blob): Promise<void> {
  const wroteAudio = audioBlob && isOpfsAvailable();
  if (wroteAudio) {
    await opfsWrite(entry.fingerprint, audioBlob);
  }
  try {
    await idb.set(entry.fingerprint, entry, entriesStore);
  } catch (idbErr) {
    if (wroteAudio) {
      try {
        await opfsRemove(entry.fingerprint);
      } catch {
        // Best-effort rollback. reconcileOrphans() catches what's left.
      }
    }
    throw idbErr;
  }
}

export async function getEntry(fingerprint: string): Promise<LibraryEntry | null> {
  try {
    const entry = await idb.get<LibraryEntry>(fingerprint, entriesStore);
    return entry ?? null;
  } catch {
    return null;
  }
}

export async function removeEntry(fingerprint: string): Promise<void> {
  try {
    await idb.del(fingerprint, entriesStore);
  } catch {
    // continue to OPFS cleanup regardless
  }
  await opfsRemove(fingerprint);
}

export async function listEntries(): Promise<LibraryEntry[]> {
  try {
    const allKeys = await idb.keys(entriesStore);
    const entries = await Promise.all(
      allKeys.map((k) => idb.get<LibraryEntry>(k as string, entriesStore))
    );
    const out: LibraryEntry[] = entries.filter((e): e is LibraryEntry => Boolean(e));
    out.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
    return out;
  } catch {
    return [];
  }
}

export async function getAudioBlob(fingerprint: string): Promise<Blob | null> {
  return opfsRead(fingerprint);
}

export async function getAudioFile(fingerprint: string): Promise<File | null> {
  const blob = await opfsRead(fingerprint);
  if (!blob) return null;
  const entry = await getEntry(fingerprint);
  if (!entry) return null;
  return new File([blob], entry.fileName, {
    type: entry.mimeType,
    lastModified: entry.lastModified,
  });
}

/** Remove OPFS files that have no matching IDB row. Returns the count removed. */
export async function reconcileOrphans(): Promise<number> {
  const dir = await getOpfsLibraryDir(false);
  if (!dir) return 0;

  const idbKeysSet = new Set((await idb.keys(entriesStore).catch(() => [])).map((k) => String(k)));

  let removed = 0;
  // FileSystemDirectoryHandle is async-iterable in modern browsers.
  const iter = (dir as unknown as { entries: () => AsyncIterableIterator<[string, unknown]> }).entries();
  for await (const [name] of iter) {
    const fp = decodeFileName(name);
    if (fp && !idbKeysSet.has(fp)) {
      try {
        await dir.removeEntry(name);
        removed += 1;
      } catch {
        // ignore — try next
      }
    }
  }
  return removed;
}

// Preferences -----------------------------------------------------------------

export async function getPreference<T = unknown>(key: string): Promise<T | undefined> {
  try {
    return await idb.get<T>(key, prefsStore);
  } catch {
    return undefined;
  }
}

export async function setPreference<T = unknown>(key: string, value: T): Promise<void> {
  await idb.set(key, value, prefsStore);
}
