/**
 * Tests for library-storage.ts — IndexedDB + OPFS persistence layer.
 *
 * Uses fake-indexeddb for IDB (initialized in beforeEach) and a simple
 * in-memory FileSystemDirectoryHandle shim for OPFS — patched onto
 * navigator.storage for the duration of each test.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";

import type { LibraryEntry } from "../library-types";

// In-memory OPFS shim ---------------------------------------------------------

class MemoryFileHandle {
  constructor(public name: string, private bytes: ArrayBuffer) {}
  async getFile(): Promise<File> {
    return new File([this.bytes], this.name, { type: "audio/wav" });
  }
  async createWritable() {
    let buf: ArrayBuffer = new ArrayBuffer(0);
    return {
      write: async (data: BufferSource | Blob) => {
        if (data instanceof Blob) {
          buf = await data.arrayBuffer();
        } else if (data instanceof ArrayBuffer) {
          buf = data;
        } else {
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
      const err = new Error("InvalidStateError: directory not empty");
      err.name = "InvalidStateError";
      throw err;
    }
    const err = new Error(`NotFoundError: ${name}`);
    err.name = "NotFoundError";
    throw err;
  }

  async *entries(): AsyncIterableIterator<[string, MemoryFileHandle | MemoryDirHandle]> {
    for (const [k, v] of this.files) yield [k, v];
    for (const [k, v] of this.dirs) yield [k, v];
  }

  async *values(): AsyncIterableIterator<MemoryFileHandle | MemoryDirHandle> {
    for (const v of this.files.values()) yield v;
    for (const v of this.dirs.values()) yield v;
  }
}

// Test setup ------------------------------------------------------------------

let opfsRoot: MemoryDirHandle;

function installOpfs(): void {
  opfsRoot = new MemoryDirHandle("root");
  Object.defineProperty(globalThis.navigator, "storage", {
    configurable: true,
    value: {
      getDirectory: async () => opfsRoot,
    },
  });
}

function uninstallOpfs(): void {
  Object.defineProperty(globalThis.navigator, "storage", {
    configurable: true,
    value: undefined,
  });
}

async function clearIDB(): Promise<void> {
  // Don't deleteDatabase — fake-indexeddb blocks if any connection is open
  // (e.g., from a prior test's cached idb-keyval handle). Use clear() instead.
  const { createStore, clear } = await import("idb-keyval");
  await clear(createStore("aurialis-library-entries-v1", "kv"));
  await clear(createStore("aurialis-library-prefs-v1", "kv"));
}

const baseEntry = (fingerprint: string, overrides: Partial<LibraryEntry> = {}): LibraryEntry => ({
  fingerprint,
  sha256: null,
  fileName: "track.wav",
  fileSize: 1024,
  lastModified: 1700000000000,
  mimeType: "audio/wav",
  durationSec: 30,
  createdAt: 1700000000000,
  lastOpenedAt: 1700000000000,
  audioPersisted: false,
  script: null,
  settings: null,
  ...overrides,
});

const audioBlob = (bytes = new Uint8Array([1, 2, 3, 4, 5])): Blob =>
  new Blob([bytes], { type: "audio/wav" });

describe("library-storage", () => {
  beforeEach(async () => {
    await clearIDB();
    installOpfs();
    vi.resetModules();
  });

  afterEach(() => {
    uninstallOpfs();
  });

  describe("putEntry / getEntry round-trip", () => {
    it("preserves all fields including nested script", async () => {
      const { putEntry, getEntry } = await import("../library-storage");
      const entry = baseEntry("fp-1", {
        audioPersisted: true,
        script: {
          version: 1,
          trackId: "track-1",
          sampleRate: 44100,
          duration: 30,
          profile: "modern_pop_polish",
          sections: [
            { id: "sec-1", type: "intro", startSec: 0, endSec: 5, loudnessLufs: -20, spectralCentroidHz: 1000 },
          ],
          moves: [
            {
              id: "mv-1",
              param: "master.compressor.threshold",
              startSec: 0,
              endSec: 5,
              envelope: [[0, -18], [5, -18]],
              reason: "test",
              original: -18,
              edited: false,
              muted: false,
            },
          ],
        },
      });

      await putEntry(entry, audioBlob());
      const loaded = await getEntry("fp-1");

      expect(loaded).toEqual(entry);
    });
  });

  describe("getAudioBlob / getAudioFile", () => {
    it("returns the exact bytes that were written", async () => {
      const { putEntry, getAudioBlob } = await import("../library-storage");
      const bytes = new Uint8Array([10, 20, 30, 40, 50, 60]);
      await putEntry(baseEntry("fp-2", { audioPersisted: true }), new Blob([bytes], { type: "audio/wav" }));

      const blob = await getAudioBlob("fp-2");
      expect(blob).not.toBeNull();
      const out = new Uint8Array(await blob!.arrayBuffer());
      expect(Array.from(out)).toEqual(Array.from(bytes));
    });

    it("getAudioFile reconstructs File with original name, type, lastModified", async () => {
      const { putEntry, getAudioFile } = await import("../library-storage");
      await putEntry(
        baseEntry("fp-3", {
          audioPersisted: true,
          fileName: "song.mp3",
          mimeType: "audio/mpeg",
          lastModified: 1234567890123,
        }),
        new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mpeg" })
      );

      const file = await getAudioFile("fp-3");
      expect(file).not.toBeNull();
      expect(file!.name).toBe("song.mp3");
      expect(file!.type).toBe("audio/mpeg");
      expect(file!.lastModified).toBe(1234567890123);
    });

    it("returns null when no audio was persisted", async () => {
      const { putEntry, getAudioBlob, getAudioFile } = await import("../library-storage");
      await putEntry(baseEntry("fp-4"));
      expect(await getAudioBlob("fp-4")).toBeNull();
      expect(await getAudioFile("fp-4")).toBeNull();
    });
  });

  describe("removeEntry", () => {
    it("deletes both IDB row and OPFS file", async () => {
      const { putEntry, getEntry, getAudioBlob, removeEntry } = await import("../library-storage");
      await putEntry(baseEntry("fp-5", { audioPersisted: true }), audioBlob());
      expect(await getEntry("fp-5")).not.toBeNull();
      expect(await getAudioBlob("fp-5")).not.toBeNull();

      await removeEntry("fp-5");

      expect(await getEntry("fp-5")).toBeNull();
      expect(await getAudioBlob("fp-5")).toBeNull();
    });

    it("is idempotent for unknown fingerprint", async () => {
      const { removeEntry } = await import("../library-storage");
      await expect(removeEntry("does-not-exist")).resolves.toBeUndefined();
    });
  });

  describe("two-phase write atomicity", () => {
    it("on IDB throw after OPFS write, deletes the OPFS file (no orphan)", async () => {
      // Use vi.doMock to inject a one-shot failure into idb-keyval's set, then
      // dynamic-import library-storage so it picks up the mocked module.
      const real = await vi.importActual<typeof import("idb-keyval")>("idb-keyval");
      let injected = false;
      vi.doMock("idb-keyval", () => ({
        ...real,
        set: (key: IDBValidKey, value: unknown, store?: unknown) => {
          if (!injected) {
            injected = true;
            return Promise.reject(new Error("simulated IDB failure"));
          }
          return real.set(key, value, store as Parameters<typeof real.set>[2]);
        },
      }));

      try {
        const { putEntry, getAudioBlob } = await import("../library-storage");
        await expect(
          putEntry(baseEntry("fp-6", { audioPersisted: true }), audioBlob())
        ).rejects.toThrow(/simulated IDB failure/);

        // OPFS file must have been compensated.
        expect(await getAudioBlob("fp-6")).toBeNull();
      } finally {
        vi.doUnmock("idb-keyval");
      }
    });
  });

  describe("listEntries", () => {
    it("returns all entries sorted by lastOpenedAt desc", async () => {
      const { putEntry, listEntries } = await import("../library-storage");
      await putEntry(baseEntry("fp-a", { lastOpenedAt: 100 }));
      await putEntry(baseEntry("fp-b", { lastOpenedAt: 300 }));
      await putEntry(baseEntry("fp-c", { lastOpenedAt: 200 }));

      const entries = await listEntries();
      expect(entries.map((e) => e.fingerprint)).toEqual(["fp-b", "fp-c", "fp-a"]);
    });

    it("does NOT return preferences as pseudo-entries", async () => {
      const { putEntry, setPreference, listEntries } = await import("../library-storage");
      await putEntry(baseEntry("fp-real"));
      await setPreference("alwaysResume", true);

      const entries = await listEntries();
      expect(entries.length).toBe(1);
      expect(entries[0]!.fingerprint).toBe("fp-real");
    });
  });

  describe("preferences", () => {
    it("setPreference + getPreference round-trip", async () => {
      const { setPreference, getPreference } = await import("../library-storage");
      await setPreference("alwaysResume", true);
      expect(await getPreference("alwaysResume")).toBe(true);
    });

    it("getPreference returns undefined for unset key", async () => {
      const { getPreference } = await import("../library-storage");
      expect(await getPreference("nonexistent")).toBeUndefined();
    });
  });

  describe("reconcileOrphans", () => {
    it("removes OPFS files with no matching IDB row, leaves matched files alone", async () => {
      const { putEntry, reconcileOrphans, getAudioBlob } = await import("../library-storage");

      // Create one valid entry with audio.
      await putEntry(baseEntry("fp-valid", { audioPersisted: true }), audioBlob());

      // Manually drop an orphan OPFS file using the same naming scheme the
      // module uses: encodeURIComponent(fingerprint) + ".bin".
      const orphanName = `${encodeURIComponent("fp-orphan")}.bin`;
      const root = opfsRoot;
      const lib = await root.getDirectoryHandle("library", { create: true });
      const orphan = await lib.getFileHandle(orphanName, { create: true });
      const writable = await orphan.createWritable();
      await writable.write(new Blob([new Uint8Array([99])]));
      await writable.close();

      // Verify orphan exists.
      const beforeFiles: string[] = [];
      for await (const [name] of lib.entries()) beforeFiles.push(name);
      expect(beforeFiles).toContain(orphanName);

      const removed = await reconcileOrphans();
      expect(removed).toBeGreaterThan(0);

      // Orphan gone, valid still present.
      const afterFiles: string[] = [];
      for await (const [name] of lib.entries()) afterFiles.push(name);
      expect(afterFiles).not.toContain(orphanName);
      expect(await getAudioBlob("fp-valid")).not.toBeNull();
    });
  });

  describe("OPFS-unavailable mode", () => {
    beforeEach(() => {
      uninstallOpfs();
    });

    it("putEntry still succeeds, getAudioBlob returns null", async () => {
      const { putEntry, getEntry, getAudioBlob } = await import("../library-storage");
      const entry = baseEntry("fp-meta", { audioPersisted: false });
      await putEntry(entry, audioBlob());

      const loaded = await getEntry("fp-meta");
      expect(loaded).not.toBeNull();
      expect(loaded!.audioPersisted).toBe(false);
      expect(await getAudioBlob("fp-meta")).toBeNull();
    });

    it("isOpfsAvailable() reports false", async () => {
      const { isOpfsAvailable } = await import("../library-storage");
      expect(isOpfsAvailable()).toBe(false);
    });
  });
});
