/**
 * Tests for useLibraryStore — hydration, LRU eviction, quota retry, debounced
 * settings writes, flush-on-pagehide, preferences.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";

import type { LibraryEntry, PersistedSettings } from "@/lib/storage/library-types";

// In-memory OPFS shim (mirrors library-storage.test.ts) -----------------------

class MemoryFileHandle {
  constructor(public name: string, private bytes: ArrayBuffer = new ArrayBuffer(0)) {}
  async getFile(): Promise<File> {
    return new File([this.bytes], this.name, { type: "audio/wav" });
  }
  async createWritable() {
    let buf: ArrayBuffer = new ArrayBuffer(0);
    return {
      write: async (data: BufferSource | Blob) => {
        if (data instanceof Blob) buf = await data.arrayBuffer();
        else if (data instanceof ArrayBuffer) buf = data;
        else {
          const view = data as ArrayBufferView;
          buf = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
        }
      },
      close: async () => {
        this.bytes = buf;
      },
    };
  }
}

class MemoryDirHandle {
  files = new Map<string, MemoryFileHandle>();
  dirs = new Map<string, MemoryDirHandle>();
  constructor(public name = "") {}
  async getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<MemoryDirHandle> {
    let dir = this.dirs.get(name);
    if (!dir) {
      if (!opts?.create) {
        const err = new Error(`NotFoundError: ${name}`);
        err.name = "NotFoundError";
        throw err;
      }
      dir = new MemoryDirHandle(name);
      this.dirs.set(name, dir);
    }
    return dir;
  }
  async getFileHandle(name: string, opts?: { create?: boolean }): Promise<MemoryFileHandle> {
    let file = this.files.get(name);
    if (!file) {
      if (!opts?.create) {
        const err = new Error(`NotFoundError: ${name}`);
        err.name = "NotFoundError";
        throw err;
      }
      file = new MemoryFileHandle(name, new ArrayBuffer(0));
      this.files.set(name, file);
    }
    return file;
  }
  async removeEntry(name: string, opts?: { recursive?: boolean }): Promise<void> {
    if (this.files.delete(name)) return;
    if (this.dirs.has(name)) {
      if (opts?.recursive) {
        this.dirs.delete(name);
        return;
      }
      const err = new Error("InvalidStateError");
      err.name = "InvalidStateError";
      throw err;
    }
    const err = new Error("NotFoundError");
    err.name = "NotFoundError";
    throw err;
  }
  async *entries(): AsyncIterableIterator<[string, MemoryFileHandle | MemoryDirHandle]> {
    for (const [k, v] of this.files) yield [k, v];
    for (const [k, v] of this.dirs) yield [k, v];
  }
}

let opfsRoot: MemoryDirHandle;
function installOpfs(): void {
  opfsRoot = new MemoryDirHandle();
  Object.defineProperty(globalThis.navigator, "storage", {
    configurable: true,
    value: { getDirectory: async () => opfsRoot },
  });
}

async function clearIDB(): Promise<void> {
  const { createStore, clear } = await import("idb-keyval");
  await clear(createStore("aurialis-library-entries-v1", "kv"));
  await clear(createStore("aurialis-library-prefs-v1", "kv"));
}

// Helpers --------------------------------------------------------------------

function fileWith(name: string, size: number, lastModified: number, bytes?: Uint8Array): File {
  const data = bytes ?? new Uint8Array(size);
  return new File([data], name, { type: "audio/wav", lastModified });
}

const sampleSettings: PersistedSettings = {
  params: {} as PersistedSettings["params"],
  simple: { genre: "pop", intensity: 50, toggles: { deharsh: false, glueComp: false } },
  tonePreset: null,
  outputPreset: null,
  savedAt: 0,
};

describe("useLibraryStore", () => {
  beforeEach(async () => {
    // Use REAL timers in setup — fake timers stall idb-keyval's microtasks.
    // Tests that need fake timers (debounce, LRU clock control) opt in locally.
    vi.useRealTimers();
    vi.resetModules();
    await clearIDB();
    installOpfs();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("hydrate", () => {
    it("loads entries from storage sorted by lastOpenedAt desc", async () => {
      const { putEntry } = await import("@/lib/storage/library-storage");
      await putEntry({
        fingerprint: "fp-a",
        sha256: null,
        fileName: "a.wav",
        fileSize: 0,
        lastModified: 0,
        mimeType: "audio/wav",
        durationSec: null,
        createdAt: 0,
        lastOpenedAt: 100,
        audioPersisted: false,
        script: null,
        settings: null,
      } satisfies LibraryEntry);
      await putEntry({
        fingerprint: "fp-b",
        sha256: null,
        fileName: "b.wav",
        fileSize: 0,
        lastModified: 0,
        mimeType: "audio/wav",
        durationSec: null,
        createdAt: 0,
        lastOpenedAt: 300,
        audioPersisted: false,
        script: null,
        settings: null,
      } satisfies LibraryEntry);

      const { useLibraryStore } = await import("../library-store");
      await useLibraryStore.getState().hydrate();

      const fps = useLibraryStore.getState().entries.map((e) => e.fingerprint);
      expect(fps).toEqual(["fp-b", "fp-a"]);
      expect(useLibraryStore.getState().hydrated).toBe(true);
    });

    it("reconciles orphan OPFS files (no IDB row) on hydrate", async () => {
      // Drop an orphan OPFS file directly, then hydrate. The orphan should be gone.
      const root = (await navigator.storage.getDirectory()) as unknown as {
        getDirectoryHandle: (n: string, o?: { create?: boolean }) => Promise<{
          getFileHandle: (n: string, o?: { create?: boolean }) => Promise<{
            createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }>;
          }>;
          entries: () => AsyncIterableIterator<[string, unknown]>;
        }>;
      };
      const lib = await root.getDirectoryHandle("library", { create: true });
      const orphanName = `${encodeURIComponent("fp-orphan")}.bin`;
      const orphan = await lib.getFileHandle(orphanName, { create: true });
      const writable = await orphan.createWritable();
      await writable.write(new Blob([new Uint8Array([1])]));
      await writable.close();

      const { useLibraryStore } = await import("../library-store");
      await useLibraryStore.getState().hydrate();
      // reconcile is async + non-blocking — give it a tick.
      await new Promise((r) => setTimeout(r, 50));

      const after: string[] = [];
      for await (const [name] of lib.entries()) after.push(name);
      expect(after).not.toContain(orphanName);
    });

    it("hydrates preferences", async () => {
      const { setPreference } = await import("@/lib/storage/library-storage");
      await setPreference("alwaysResume", true);

      const { useLibraryStore } = await import("../library-store");
      await useLibraryStore.getState().hydrate();

      expect(useLibraryStore.getState().preferences.alwaysResume).toBe(true);
    });
  });

  describe("addEntry", () => {
    it("adds a new entry for an unknown file", async () => {
      const { useLibraryStore } = await import("../library-store");
      await useLibraryStore.getState().hydrate();

      const file = fileWith("song.wav", 5, 1000, new Uint8Array([1, 2, 3, 4, 5]));
      const result = await useLibraryStore.getState().addEntry(file, {
        audioBlob: new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: "audio/wav" }),
      });

      expect(result.ok).toBe(true);
      expect(useLibraryStore.getState().entries.length).toBe(1);
      expect(useLibraryStore.getState().entries[0]!.fileName).toBe("song.wav");
    });

    it("enforces 20-song cap by evicting LRU on the 21st insert", async () => {
      const { useLibraryStore } = await import("../library-store");
      await useLibraryStore.getState().hydrate();

      // Seed 20 entries with explicit lastOpenedAt offset from real Date.now()
      // by 60s, so they all fall outside the 5s recently-touched window.
      const seedBase = Date.now() - 60_000;
      for (let i = 0; i < 20; i++) {
        const file = fileWith(`song-${i}.wav`, 5, i, new Uint8Array([i, 0, 0, 0, 0]));
        await useLibraryStore.getState().addEntry(file, {
          audioBlob: new Blob([new Uint8Array([i, 0, 0, 0, 0])]),
          lastOpenedAt: seedBase + i, // oldest = idx 0
        });
      }
      expect(useLibraryStore.getState().entries.length).toBe(20);

      // Oldest by lastOpenedAt is "song-0.wav" (lowest seed value).
      const oldestFp = useLibraryStore
        .getState()
        .entries.find((e) => e.fileName === "song-0.wav")!.fingerprint;

      // Add the 21st (now, well after the seed).
      const newFile = fileWith("song-new.wav", 5, 9999, new Uint8Array([99, 0, 0, 0, 0]));
      await useLibraryStore.getState().addEntry(newFile, {
        audioBlob: new Blob([new Uint8Array([99, 0, 0, 0, 0])]),
      });

      const entries = useLibraryStore.getState().entries;
      expect(entries.length).toBe(20);
      expect(entries.find((e) => e.fingerprint === oldestFp)).toBeUndefined();
      expect(entries.find((e) => e.fileName === "song-new.wav")).toBeDefined();
    });

    it("two files with the same name|size|lastModified but different content produce two distinct entries", async () => {
      const { useLibraryStore } = await import("../library-store");
      await useLibraryStore.getState().hydrate();

      const sharedName = "duplicate.wav";
      const sharedMtime = 1700000000000;
      const sharedSize = 5;

      const fileA = new File([new Uint8Array([1, 2, 3, 4, 5])], sharedName, {
        type: "audio/wav",
        lastModified: sharedMtime,
      });
      const fileB = new File([new Uint8Array([9, 9, 9, 9, 9])], sharedName, {
        type: "audio/wav",
        lastModified: sharedMtime,
      });
      // Sanity: cheap fingerprints match.
      const { cheapFingerprint } = await import("@/lib/storage/library-fingerprint");
      expect(cheapFingerprint(fileA)).toBe(cheapFingerprint(fileB));
      expect(fileA.size).toBe(sharedSize);
      expect(fileB.size).toBe(sharedSize);

      const resA = await useLibraryStore.getState().addEntry(fileA, {
        audioBlob: new Blob([new Uint8Array([1, 2, 3, 4, 5])]),
      });
      const resB = await useLibraryStore.getState().addEntry(fileB, {
        audioBlob: new Blob([new Uint8Array([9, 9, 9, 9, 9])]),
      });
      expect(resA.ok).toBe(true);
      expect(resB.ok).toBe(true);
      if (!resA.ok || !resB.ok) return;

      // Two distinct fingerprints — fileB took the composed key.
      expect(resA.entry.fingerprint).not.toBe(resB.entry.fingerprint);
      expect(useLibraryStore.getState().entries.length).toBe(2);
      // Lazy backfill: existing entry's sha256 should now be filled in.
      const a = useLibraryStore
        .getState()
        .entries.find((e) => e.fingerprint === resA.entry.fingerprint)!;
      expect(a.sha256).not.toBeNull();
    });

    it("does NOT evict an entry touched within the last 5 seconds", async () => {
      const { useLibraryStore } = await import("../library-store");
      await useLibraryStore.getState().hydrate();
      const refNow = Date.now();

      // Seed 20 entries — entry idx 0 sits within the 5s protection window;
      // others are 60s+ old. The 21st insert (Date.now() ~= refNow) should
      // evict an OLDER entry, not the protected one.
      for (let i = 0; i < 20; i++) {
        const file = fileWith(`song-${i}.wav`, 5, i, new Uint8Array([i, 0, 0, 0, 0]));
        const isProtected = i === 0;
        await useLibraryStore.getState().addEntry(file, {
          audioBlob: new Blob([new Uint8Array([i, 0, 0, 0, 0])]),
          lastOpenedAt: isProtected
            ? refNow - 1_000 // 1s ago — within 5s protection window
            : refNow - 60_000 + i, // older
        });
      }

      const protectedFp = useLibraryStore
        .getState()
        .entries.find((e) => e.fileName === "song-0.wav")!.fingerprint;

      // Trigger eviction by adding a 21st.
      const newFile = fileWith("new.wav", 5, 9999, new Uint8Array([99, 0, 0, 0, 0]));
      await useLibraryStore.getState().addEntry(newFile, {
        audioBlob: new Blob([new Uint8Array([99, 0, 0, 0, 0])]),
      });

      // Protected entry survives; some OLDER one (lastOpenedAt=baseTime-60000+1)
      // got evicted instead.
      const entries = useLibraryStore.getState().entries;
      expect(entries.find((e) => e.fingerprint === protectedFp)).toBeDefined();
      expect(entries.length).toBe(20);
    });
  });

  describe("openEntry", () => {
    it("bumps lastOpenedAt and re-sorts", async () => {
      const { useLibraryStore } = await import("../library-store");
      await useLibraryStore.getState().hydrate();

      const refNow = Date.now();
      const f1 = fileWith("a.wav", 5, 1, new Uint8Array([1, 0, 0, 0, 0]));
      await useLibraryStore.getState().addEntry(f1, {
        audioBlob: new Blob([new Uint8Array([1, 0, 0, 0, 0])]),
        lastOpenedAt: refNow - 10_000,
      });
      const fpA = useLibraryStore.getState().entries[0]!.fingerprint;

      const f2 = fileWith("b.wav", 5, 2, new Uint8Array([2, 0, 0, 0, 0]));
      await useLibraryStore.getState().addEntry(f2, {
        audioBlob: new Blob([new Uint8Array([2, 0, 0, 0, 0])]),
        lastOpenedAt: refNow - 5_000,
      });

      // b is most recent → first
      expect(useLibraryStore.getState().entries[0]!.fileName).toBe("b.wav");

      // openEntry uses Date.now() directly, which is > both seed values
      await useLibraryStore.getState().openEntry(fpA);

      // a is now most recent
      expect(useLibraryStore.getState().entries[0]!.fileName).toBe("a.wav");
    });
  });

  describe("removeEntry", () => {
    it("removes from store + storage", async () => {
      const { useLibraryStore } = await import("../library-store");
      await useLibraryStore.getState().hydrate();

      const file = fileWith("song.wav", 5, 1, new Uint8Array([1, 2, 3, 4, 5]));
      await useLibraryStore.getState().addEntry(file, {
        audioBlob: new Blob([new Uint8Array([1, 2, 3, 4, 5])]),
      });
      const fp = useLibraryStore.getState().entries[0]!.fingerprint;

      await useLibraryStore.getState().removeEntry(fp);

      expect(useLibraryStore.getState().entries.length).toBe(0);
      const { getEntry } = await import("@/lib/storage/library-storage");
      expect(await getEntry(fp)).toBeNull();
    });
  });

  describe("updateSettings (debounce)", () => {
    it("collapses N rapid calls within debounce window into a single storage write", async () => {
      const { useLibraryStore } = await import("../library-store");
      await useLibraryStore.getState().hydrate();
      const file = fileWith("s.wav", 5, 1, new Uint8Array([1, 2, 3, 4, 5]));
      await useLibraryStore.getState().addEntry(file, {
        audioBlob: new Blob([new Uint8Array([1, 2, 3, 4, 5])]),
      });
      const fp = useLibraryStore.getState().entries[0]!.fingerprint;

      const storage = await import("@/lib/storage/library-storage");
      const putSpy = vi.spyOn(storage, "putEntry");

      // Burst of rapid calls — debounce should collapse them.
      for (let i = 0; i < 10; i++) {
        useLibraryStore.getState().updateSettings(fp, {
          ...sampleSettings,
          simple: { ...sampleSettings.simple, intensity: i },
        });
      }
      expect(putSpy).not.toHaveBeenCalled();

      // Wait for real-time debounce to fire (200ms + buffer for IDB write).
      await new Promise((r) => setTimeout(r, 400));

      expect(putSpy).toHaveBeenCalledTimes(1);
      // Last update wins
      const stored = putSpy.mock.calls[0]![0] as LibraryEntry;
      expect(stored.settings?.simple.intensity).toBe(9);
    });
  });

  describe("flushPendingWrites", () => {
    it("forces pending debounced write to disk synchronously", async () => {
      const { useLibraryStore } = await import("../library-store");
      await useLibraryStore.getState().hydrate();
      const file = fileWith("s.wav", 5, 1, new Uint8Array([1, 2, 3, 4, 5]));
      await useLibraryStore.getState().addEntry(file, {
        audioBlob: new Blob([new Uint8Array([1, 2, 3, 4, 5])]),
      });
      const fp = useLibraryStore.getState().entries[0]!.fingerprint;

      const storage = await import("@/lib/storage/library-storage");
      const putSpy = vi.spyOn(storage, "putEntry");

      useLibraryStore.getState().updateSettings(fp, {
        ...sampleSettings,
        simple: { ...sampleSettings.simple, intensity: 77 },
      });
      expect(putSpy).not.toHaveBeenCalled();

      await useLibraryStore.getState().flushPendingWrites();

      expect(putSpy).toHaveBeenCalledTimes(1);
      const stored = putSpy.mock.calls[0]![0] as LibraryEntry;
      expect(stored.settings?.simple.intensity).toBe(77);
    });
  });

  describe("setPreference", () => {
    it("persists and reflects in state", async () => {
      const { useLibraryStore } = await import("../library-store");
      await useLibraryStore.getState().hydrate();

      await useLibraryStore.getState().setPreference("alwaysResume", true);

      expect(useLibraryStore.getState().preferences.alwaysResume).toBe(true);
      const { getPreference } = await import("@/lib/storage/library-storage");
      expect(await getPreference("alwaysResume")).toBe(true);
    });
  });
});
