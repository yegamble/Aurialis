/**
 * Tests for library-resume — Resume / Start fresh hydration sequences.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";

import type { LibraryEntry } from "../library-types";
import type { MasteringScript } from "@/types/deep-mastering";

// In-memory OPFS shim (mirror of library-storage.test.ts) --------------------

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
  async getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<MemoryDirHandle> {
    let dir = this.dirs.get(name);
    if (!dir) {
      if (!opts?.create) {
        const err = new Error("NotFoundError");
        err.name = "NotFoundError";
        throw err;
      }
      dir = new MemoryDirHandle();
      this.dirs.set(name, dir);
    }
    return dir;
  }
  async getFileHandle(name: string, opts?: { create?: boolean }): Promise<MemoryFileHandle> {
    let file = this.files.get(name);
    if (!file) {
      if (!opts?.create) {
        const err = new Error("NotFoundError");
        err.name = "NotFoundError";
        throw err;
      }
      file = new MemoryFileHandle(name, new ArrayBuffer(0));
      this.files.set(name, file);
    }
    return file;
  }
  async removeEntry(name: string): Promise<void> {
    if (!this.files.delete(name)) {
      const err = new Error("NotFoundError");
      err.name = "NotFoundError";
      throw err;
    }
  }
  async *entries(): AsyncIterableIterator<[string, MemoryFileHandle | MemoryDirHandle]> {
    for (const [k, v] of this.files) yield [k, v];
  }
}

function installOpfs(): MemoryDirHandle {
  const root = new MemoryDirHandle();
  Object.defineProperty(globalThis.navigator, "storage", {
    configurable: true,
    value: { getDirectory: async () => root },
  });
  return root;
}

function buildScript(profile: MasteringScript["profile"] = "modern_pop_polish"): MasteringScript {
  return {
    version: 1,
    trackId: "t1",
    sampleRate: 48000,
    duration: 30,
    profile,
    sections: [],
    moves: [],
  };
}

const sampleSettings: LibraryEntry["settings"] = {
  params: { eq80: 0 } as unknown as LibraryEntry["settings"]["params"],
  simple: { genre: "pop", intensity: 50, toggles: { deharsh: false, glueComp: false } },
  tonePreset: null,
  outputPreset: null,
  savedAt: 0,
};

describe("library-resume", () => {
  beforeEach(async () => {
    vi.resetModules();
    installOpfs();
    const { createStore, clear } = await import("idb-keyval");
    await clear(createStore("aurialis-library-entries-v1", "kv"));
    await clear(createStore("aurialis-library-prefs-v1", "kv"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("findLibraryEntryForFile", () => {
    it("returns null when no match", async () => {
      const { findLibraryEntryForFile } = await import("../library-resume");
      const { useLibraryStore } = await import("@/lib/stores/library-store");
      await useLibraryStore.getState().hydrate();

      const file = new File([new Uint8Array([1, 2, 3])], "x.wav", { lastModified: 1 });
      expect(findLibraryEntryForFile(file)).toBeNull();
    });

    it("returns the entry when cheap fingerprint matches", async () => {
      const { findLibraryEntryForFile } = await import("../library-resume");
      const { useLibraryStore } = await import("@/lib/stores/library-store");
      await useLibraryStore.getState().hydrate();

      const file = new File([new Uint8Array([1, 2, 3, 4, 5])], "song.wav", { lastModified: 100 });
      await useLibraryStore.getState().addEntry(file, {
        audioBlob: new Blob([new Uint8Array([1, 2, 3, 4, 5])]),
      });

      const same = new File([new Uint8Array([1, 2, 3, 4, 5])], "song.wav", { lastModified: 100 });
      const found = findLibraryEntryForFile(same);
      expect(found).not.toBeNull();
      expect(found!.fileName).toBe("song.wav");
    });
  });

  describe("resumeFromLibraryEntry", () => {
    it("populates audio file, deep script, profile, and loadedFromLibrary in correct order", async () => {
      const { resumeFromLibraryEntry } = await import("../library-resume");
      const { useLibraryStore } = await import("@/lib/stores/library-store");
      const { useAudioStore } = await import("@/lib/stores/audio-store");
      const { useDeepStore } = await import("@/lib/stores/deep-store");
      await useLibraryStore.getState().hydrate();
      useAudioStore.getState().reset();
      useDeepStore.getState().reset();

      const file = new File([new Uint8Array([1, 2, 3])], "song.wav", { lastModified: 1 });
      const entry: LibraryEntry = {
        fingerprint: "fp-test",
        sha256: null,
        fileName: "song.wav",
        fileSize: 3,
        lastModified: 1,
        mimeType: "audio/wav",
        durationSec: 30,
        createdAt: 0,
        lastOpenedAt: 0,
        audioPersisted: true,
        script: buildScript("metal_wall"),
        settings: sampleSettings,
      };
      // Seed the entry into store (and storage).
      await useLibraryStore.getState().addEntry(
        new File([new Uint8Array([1, 2, 3])], "song.wav", { lastModified: 1 }),
        { audioBlob: new Blob([new Uint8Array([1, 2, 3])]), script: entry.script, settings: entry.settings }
      );
      const seeded = useLibraryStore.getState().entries[0]!;

      // Track call order — setFile must come AFTER setScript & setParams.
      const callOrder: string[] = [];
      const audioStore = useAudioStore.getState();
      const deepStore = useDeepStore.getState();
      const setFileSpy = vi.spyOn(audioStore, "setFile").mockImplementation((f) => {
        callOrder.push("setFile");
        useAudioStore.setState({ file: f, isLoaded: false });
      });
      const setParamsSpy = vi.spyOn(audioStore, "setParams").mockImplementation((p) => {
        callOrder.push("setParams");
        useAudioStore.setState((s) => ({ params: { ...s.params, ...p } }));
      });
      const setScriptSpy = vi.spyOn(deepStore, "setScript").mockImplementation((s) => {
        callOrder.push("setScript");
        useDeepStore.setState({ script: s });
      });

      // Note: spies install on a SNAPSHOT of getState — but library-resume calls
      // getState() inside, which returns the LIVE store. To exercise ordering,
      // monkey-patch the live store's actions directly:
      useAudioStore.setState({
        setFile: setFileSpy as typeof audioStore.setFile,
        setParams: setParamsSpy as typeof audioStore.setParams,
      });
      useDeepStore.setState({
        setScript: setScriptSpy as typeof deepStore.setScript,
      });

      await resumeFromLibraryEntry(seeded, file);

      // Order assertion — setParams + setScript must run before setFile.
      const fileIdx = callOrder.indexOf("setFile");
      const paramsIdx = callOrder.indexOf("setParams");
      const scriptIdx = callOrder.indexOf("setScript");
      expect(paramsIdx).toBeGreaterThanOrEqual(0);
      expect(scriptIdx).toBeGreaterThanOrEqual(0);
      expect(fileIdx).toBeGreaterThan(paramsIdx);
      expect(fileIdx).toBeGreaterThan(scriptIdx);

      expect(useDeepStore.getState().loadedFromLibrary).toBe(true);
      expect(useDeepStore.getState().suppressLibraryAutoUpdate).toBe(false);
    });
  });

  describe("openLibraryEntryFromList", () => {
    it("reconstructs a File from OPFS and runs the resume sequence", async () => {
      const { openLibraryEntryFromList } = await import("../library-resume");
      const { useLibraryStore } = await import("@/lib/stores/library-store");
      const { useAudioStore } = await import("@/lib/stores/audio-store");
      const { useDeepStore } = await import("@/lib/stores/deep-store");
      await useLibraryStore.getState().hydrate();
      useAudioStore.getState().reset();
      useDeepStore.getState().reset();

      const file = new File([new Uint8Array([10, 20, 30])], "track.wav", {
        type: "audio/wav",
        lastModified: 999,
      });
      await useLibraryStore.getState().addEntry(file, {
        audioBlob: new Blob([new Uint8Array([10, 20, 30])], { type: "audio/wav" }),
        script: buildScript(),
      });
      const fp = useLibraryStore.getState().entries[0]!.fingerprint;

      const result = await openLibraryEntryFromList(fp);
      expect(result.ok).toBe(true);

      const loaded = useAudioStore.getState().file;
      expect(loaded).not.toBeNull();
      expect(loaded!.name).toBe("track.wav");
      expect(loaded!.type).toBe("audio/wav");
      expect(loaded!.lastModified).toBe(999);
      expect(useDeepStore.getState().loadedFromLibrary).toBe(true);
    });

    it("returns not-found for unknown fingerprint", async () => {
      const { openLibraryEntryFromList } = await import("../library-resume");
      const { useLibraryStore } = await import("@/lib/stores/library-store");
      await useLibraryStore.getState().hydrate();

      const result = await openLibraryEntryFromList("nope");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("not-found");
    });
  });

  describe("startFreshFromUpload", () => {
    it("loads the audio, clears script, sets suppression flag", async () => {
      const { startFreshFromUpload } = await import("../library-resume");
      const { useAudioStore } = await import("@/lib/stores/audio-store");
      const { useDeepStore } = await import("@/lib/stores/deep-store");
      useAudioStore.getState().reset();
      useDeepStore.getState().reset();
      // Seed prior state to ensure it gets cleared.
      useDeepStore.getState().setScript(buildScript());
      useDeepStore.getState().setLoadedFromLibrary(true);

      const file = new File([new Uint8Array([1, 2])], "fresh.wav", { lastModified: 5 });
      startFreshFromUpload(file);

      expect(useAudioStore.getState().file).toBe(file);
      expect(useDeepStore.getState().script).toBeNull();
      expect(useDeepStore.getState().loadedFromLibrary).toBe(false);
      expect(useDeepStore.getState().suppressLibraryAutoUpdate).toBe(true);
    });
  });
});
