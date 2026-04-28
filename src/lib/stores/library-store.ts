/**
 * useLibraryStore — Zustand wrapper around library-storage with LRU eviction,
 * recently-touched protection, debounced settings writes, and flush-on-unload.
 */

import { create } from "zustand";

import {
  getAudioFile,
  getPreference,
  isOpfsAvailable,
  listEntries,
  putEntry,
  reconcileOrphans,
  removeEntry as storageRemoveEntry,
  setPreference as storageSetPreference,
} from "@/lib/storage/library-storage";
import * as storage from "@/lib/storage/library-storage";
import type {
  AudioPersistenceMode,
  LibraryEntry,
  PersistedSettings,
} from "@/lib/storage/library-types";
import {
  cheapFingerprint,
  composeFingerprint,
  contentFingerprint,
} from "@/lib/storage/library-fingerprint";

const MAX_ENTRIES = 20;
const RECENTLY_TOUCHED_MS = 5_000;
// Debounce window for settings writes. Kept short (200ms) to minimise the
// risk of losing the last tweak when the tab closes — IDB writes triggered
// by pagehide are async and the browser does not wait for them. Tab-switch
// (visibilitychange→hidden) fires earlier than pagehide and gives us a
// reliable flush window in normal use.
const SETTINGS_DEBOUNCE_MS = 200;
const MAX_EVICTION_RETRIES = 3;

export interface LibraryPreferences {
  alwaysResume: boolean;
}

export interface AddEntryOptions {
  audioBlob?: Blob;
  script?: LibraryEntry["script"];
  settings?: LibraryEntry["settings"];
  /** Override system clock for deterministic tests / explicit LRU positioning. */
  lastOpenedAt?: number;
}

export type AddEntryResult =
  | { ok: true; entry: LibraryEntry }
  | { ok: false; reason: "quota" };

export interface LibraryState {
  entries: LibraryEntry[];
  preferences: LibraryPreferences;
  audioPersistenceMode: AudioPersistenceMode;
  hydrated: boolean;
  /** Fingerprint of the entry currently loaded into the editor, if any. */
  activeFingerprint: string | null;

  hydrate: () => Promise<void>;
  addEntry: (file: File, opts?: AddEntryOptions) => Promise<AddEntryResult>;
  openEntry: (fingerprint: string) => Promise<LibraryEntry | null>;
  removeEntry: (fingerprint: string) => Promise<void>;
  updateScript: (fingerprint: string, script: LibraryEntry["script"]) => Promise<void>;
  updateSettings: (fingerprint: string, settings: PersistedSettings) => void;
  flushPendingWrites: () => Promise<void>;
  setPreference: <K extends keyof LibraryPreferences>(key: K, value: LibraryPreferences[K]) => Promise<void>;
  setActiveFingerprint: (fp: string | null) => void;
}

const DEFAULT_PREFERENCES: LibraryPreferences = {
  alwaysResume: false,
};

// Module-level debounce + flush plumbing — kept outside zustand state so timers
// don't trigger renders. Each fingerprint gets its own pending write.
const pendingWrites = new Map<string, { settings: PersistedSettings; timer: ReturnType<typeof setTimeout> }>();

function sortDesc(entries: LibraryEntry[]): LibraryEntry[] {
  return [...entries].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

function pickEvictionCandidate(entries: LibraryEntry[], now: number): LibraryEntry | null {
  // Eligible = not touched within the last 5s. Pick smallest lastOpenedAt.
  let best: LibraryEntry | null = null;
  for (const e of entries) {
    if (now - e.lastOpenedAt < RECENTLY_TOUCHED_MS) continue;
    if (!best || e.lastOpenedAt < best.lastOpenedAt) best = e;
  }
  return best;
}

let unloadHandlerInstalled = false;

function installUnloadHandler(flush: () => Promise<void>): void {
  if (unloadHandlerInstalled || typeof window === "undefined") return;
  const handler = (): void => {
    void flush();
  };
  window.addEventListener("pagehide", handler);
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush();
  });
  unloadHandlerInstalled = true;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  entries: [],
  preferences: { ...DEFAULT_PREFERENCES },
  audioPersistenceMode: isOpfsAvailable() ? "full" : "metadata-only",
  hydrated: false,
  activeFingerprint: null,

  hydrate: async () => {
    const entries = sortDesc(await listEntries());
    const alwaysResume = (await getPreference<boolean>("alwaysResume")) ?? false;
    set({
      entries,
      preferences: { alwaysResume },
      audioPersistenceMode: isOpfsAvailable() ? "full" : "metadata-only",
      hydrated: true,
    });
    // Safety net for crash-mid-two-phase-write: drop any OPFS files whose
    // matching IDB row was never written. Awaited so subsequent OPFS ops
    // (addEntry, removeEntry) don't race with directory iteration.
    try {
      await reconcileOrphans();
    } catch {
      // best-effort
    }
    installUnloadHandler(get().flushPendingWrites);
  },

  addEntry: async (file, opts = {}): Promise<AddEntryResult> => {
    const cheap = cheapFingerprint(file);
    const now = opts.lastOpenedAt ?? Date.now();
    const audioPersisted = Boolean(opts.audioBlob) && isOpfsAvailable();

    // Collision resolution: if a cheap-key match exists AND we have audio
    // bytes to compare against (either from opts.audioBlob or via OPFS), hash
    // both and disambiguate. Lazily backfills sha256 on the existing entry.
    let fingerprint = cheap;
    let existing = get().entries.find((e) => e.fingerprint === cheap);
    if (existing && opts.audioBlob && existing.audioPersisted) {
      const newSha = await contentFingerprint(file);
      let existingSha = existing.sha256;
      if (existingSha === null) {
        const existingFile = await getAudioFile(existing.fingerprint);
        if (existingFile) {
          existingSha = await contentFingerprint(existingFile);
          // Backfill the existing entry's sha256 so the next collision check is O(1).
          const backfilled: LibraryEntry = { ...existing, sha256: existingSha };
          await putEntry(backfilled);
          set((s) => ({
            entries: s.entries.map((e) => (e.fingerprint === existing!.fingerprint ? backfilled : e)),
          }));
          existing = backfilled;
        }
      }
      if (existingSha !== null && existingSha !== newSha) {
        // True collision — use a composed fingerprint and treat as brand-new.
        fingerprint = composeFingerprint(cheap, newSha);
        existing = get().entries.find((e) => e.fingerprint === fingerprint);
      }
    }

    const entry: LibraryEntry = existing
      ? {
          ...existing,
          script: opts.script ?? existing.script,
          settings: opts.settings ?? existing.settings,
          lastOpenedAt: now,
        }
      : {
          fingerprint,
          sha256: null,
          fileName: file.name,
          fileSize: file.size,
          lastModified: file.lastModified,
          mimeType: file.type || "application/octet-stream",
          durationSec: null,
          createdAt: now,
          lastOpenedAt: now,
          audioPersisted,
          script: opts.script ?? null,
          settings: opts.settings ?? null,
        };

    // Eviction loop — only when adding a brand-new entry.
    if (!existing && get().entries.length >= MAX_ENTRIES) {
      let attempts = 0;
      while (get().entries.length >= MAX_ENTRIES && attempts < MAX_EVICTION_RETRIES) {
        const candidate = pickEvictionCandidate(get().entries, now);
        if (!candidate) break;
        await get().removeEntry(candidate.fingerprint);
        attempts += 1;
      }
      if (get().entries.length >= MAX_ENTRIES) {
        return { ok: false, reason: "quota" };
      }
    }

    let attempts = 0;
    while (true) {
      try {
        await putEntry(entry, opts.audioBlob);
        break;
      } catch (e) {
        if ((e as Error).name !== "QuotaExceededError") throw e;
        if (attempts >= MAX_EVICTION_RETRIES) return { ok: false, reason: "quota" };
        const candidate = pickEvictionCandidate(get().entries, now);
        if (!candidate) return { ok: false, reason: "quota" };
        await get().removeEntry(candidate.fingerprint);
        attempts += 1;
      }
    }

    set((s) => ({
      entries: sortDesc(
        existing
          ? s.entries.map((e) => (e.fingerprint === entry.fingerprint ? entry : e))
          : [...s.entries, entry]
      ),
      activeFingerprint: entry.fingerprint,
    }));

    return { ok: true, entry };
  },

  openEntry: async (fingerprint): Promise<LibraryEntry | null> => {
    const entry = get().entries.find((e) => e.fingerprint === fingerprint);
    if (!entry) return null;
    const updated: LibraryEntry = { ...entry, lastOpenedAt: Date.now() };
    await putEntry(updated);
    set((s) => ({
      entries: sortDesc(s.entries.map((e) => (e.fingerprint === fingerprint ? updated : e))),
      activeFingerprint: fingerprint,
    }));
    return updated;
  },

  removeEntry: async (fingerprint): Promise<void> => {
    // Drop any pending debounced write for this fingerprint.
    const pending = pendingWrites.get(fingerprint);
    if (pending) {
      clearTimeout(pending.timer);
      pendingWrites.delete(fingerprint);
    }
    await storageRemoveEntry(fingerprint);
    set((s) => ({
      entries: s.entries.filter((e) => e.fingerprint !== fingerprint),
      activeFingerprint: s.activeFingerprint === fingerprint ? null : s.activeFingerprint,
    }));
  },

  updateScript: async (fingerprint, script): Promise<void> => {
    const entry = get().entries.find((e) => e.fingerprint === fingerprint);
    if (!entry) return;
    const updated: LibraryEntry = { ...entry, script };
    await putEntry(updated);
    set((s) => ({
      entries: s.entries.map((e) => (e.fingerprint === fingerprint ? updated : e)),
    }));
  },

  updateSettings: (fingerprint, settings): void => {
    const existing = pendingWrites.get(fingerprint);
    if (existing) clearTimeout(existing.timer);

    const timer = setTimeout(() => {
      void flushOne(fingerprint);
    }, SETTINGS_DEBOUNCE_MS);

    pendingWrites.set(fingerprint, { settings, timer });
  },

  flushPendingWrites: async (): Promise<void> => {
    const fps = Array.from(pendingWrites.keys());
    await Promise.all(fps.map((fp) => flushOne(fp)));
  },

  setPreference: async (key, value): Promise<void> => {
    await storageSetPreference(key, value);
    set((s) => ({ preferences: { ...s.preferences, [key]: value } }));
  },

  setActiveFingerprint: (fp) => set({ activeFingerprint: fp }),
}));

async function flushOne(fingerprint: string): Promise<void> {
  const pending = pendingWrites.get(fingerprint);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingWrites.delete(fingerprint);

  const state = useLibraryStore.getState();
  const entry = state.entries.find((e) => e.fingerprint === fingerprint);
  if (!entry) return;

  const updated: LibraryEntry = { ...entry, settings: pending.settings };
  // Use the spy-able namespace import so tests can intercept.
  await storage.putEntry(updated);
  useLibraryStore.setState((s) => ({
    entries: s.entries.map((e) => (e.fingerprint === fingerprint ? updated : e)),
  }));
}

// Dev convenience hook for E2E + manual debugging — same gating as audio-store.
if (
  typeof window !== "undefined" &&
  (process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_E2E_HOOKS === "1")
) {
  (window as unknown as { __aurialisLibraryStore?: typeof useLibraryStore }).__aurialisLibraryStore = useLibraryStore;
}
