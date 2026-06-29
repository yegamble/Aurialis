import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "fake-indexeddb/auto";
import { useDeepStore } from "../deep-store";
import { useAudioStore } from "../audio-store";
import { useLibraryStore } from "../library-store";
import type { MasteringScript, Move } from "@/types/deep-mastering";

const buildMove = (overrides: Partial<Move> = {}): Move => ({
  id: "m1",
  param: "master.compressor.threshold",
  startSec: 0,
  endSec: 10,
  envelope: [
    [0, -24],
    [10, -18],
  ],
  reason: "test",
  original: -24,
  edited: false,
  muted: false,
  ...overrides,
});

const buildScript = (moves: Move[] = [buildMove()]): MasteringScript => ({
  version: 1,
  trackId: "t1",
  sampleRate: 48000,
  duration: 30,
  profile: "modern_pop_polish",
  sections: [],
  moves,
});

describe("deepStore", () => {
  beforeEach(() => {
    useDeepStore.getState().reset();
  });

  it("starts in idle state with no script", () => {
    const s = useDeepStore.getState();
    expect(s.status).toBe("idle");
    expect(s.script).toBeNull();
    expect(s.subStatus).toBeNull();
    expect(s.scriptActive).toBe(true);
  });

  it("setStatus updates status", () => {
    useDeepStore.getState().setStatus("analyzing");
    expect(useDeepStore.getState().status).toBe("analyzing");
  });

  it("setSubStatus updates subStatus", () => {
    useDeepStore.getState().setSubStatus("sections");
    expect(useDeepStore.getState().subStatus).toBe("sections");
  });

  it("setProfile updates profile id", () => {
    useDeepStore.getState().setProfile("metal_wall");
    expect(useDeepStore.getState().profile).toBe("metal_wall");
  });

  it("setScript replaces script", () => {
    const script = buildScript();
    useDeepStore.getState().setScript(script);
    expect(useDeepStore.getState().script).toEqual(script);
  });

  it("applyMoveEdit patches move and flips edited", () => {
    useDeepStore.getState().setScript(buildScript());
    useDeepStore.getState().applyMoveEdit("m1", { muted: true });
    const move = useDeepStore.getState().script!.moves[0]!;
    expect(move.muted).toBe(true);
    expect(move.edited).toBe(true);
    expect(move.original).toBe(-24); // original preserved
  });

  it("applyMoveEdit on missing moveId is a no-op", () => {
    useDeepStore.getState().setScript(buildScript());
    useDeepStore.getState().applyMoveEdit("nonexistent", { muted: true });
    expect(useDeepStore.getState().script!.moves[0]!.muted).toBe(false);
  });

  it("hasEditedMoves is false when none edited", () => {
    useDeepStore.getState().setScript(buildScript());
    expect(useDeepStore.getState().hasEditedMoves()).toBe(false);
  });

  it("hasEditedMoves is true after edit", () => {
    useDeepStore.getState().setScript(buildScript());
    useDeepStore.getState().applyMoveEdit("m1", { muted: true });
    expect(useDeepStore.getState().hasEditedMoves()).toBe(true);
  });

  it("resetMove restores original value and clears edited flag", () => {
    useDeepStore.getState().setScript(buildScript());
    useDeepStore
      .getState()
      .applyMoveEdit("m1", { muted: true });
    expect(useDeepStore.getState().script!.moves[0]!.edited).toBe(true);
    useDeepStore.getState().resetMove("m1");
    const m = useDeepStore.getState().script!.moves[0]!;
    expect(m.edited).toBe(false);
    expect(m.muted).toBe(false);
  });

  it("setScriptActive toggles A/B without disturbing script", () => {
    const script = buildScript();
    useDeepStore.getState().setScript(script);
    useDeepStore.getState().setScriptActive(false);
    expect(useDeepStore.getState().scriptActive).toBe(false);
    expect(useDeepStore.getState().script).toEqual(script);
  });

  it("reset clears all state including transient flags", () => {
    useDeepStore.getState().setScript(buildScript());
    useDeepStore.getState().setStatus("ready");
    useDeepStore.getState().setSubStatus("script");
    useDeepStore.getState().setLoadedFromLibrary(true);
    useDeepStore.getState().setSuppressLibraryAutoUpdate(true);
    useDeepStore.getState().reset();
    const s = useDeepStore.getState();
    expect(s.script).toBeNull();
    expect(s.status).toBe("idle");
    expect(s.subStatus).toBeNull();
    expect(s.scriptActive).toBe(true);
    expect(s.loadedFromLibrary).toBe(false);
    expect(s.suppressLibraryAutoUpdate).toBe(false);
  });
});

describe("deepStore — library persistence side-effect", () => {
  async function setupClean(): Promise<void> {
    useDeepStore.getState().reset();
    useAudioStore.getState().reset();
    const { createStore, clear } = await import("idb-keyval");
    await clear(createStore("aurialis-library-entries-v1", "kv"));
    await clear(createStore("aurialis-library-prefs-v1", "kv"));
    await useLibraryStore.getState().hydrate();
  }

  beforeEach(async () => {
    await setupClean();
  });

  it("setScript with file present + script → adds an entry to the library", async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4, 5])], "song.wav", {
      type: "audio/wav",
      lastModified: 1700000000000,
    });
    useAudioStore.getState().setFile(file);

    useDeepStore.getState().setScript(buildScript());
    // Side-effect is fire-and-forget; flush microtasks so the addEntry promise resolves.
    await new Promise((r) => setTimeout(r, 50));

    const entries = useLibraryStore.getState().entries;
    expect(entries.length).toBe(1);
    expect(entries[0]!.fileName).toBe("song.wav");
    expect(entries[0]!.script).not.toBeNull();
  });

  it("persists the decoded duration from the audio store", async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4, 5])], "song.wav", {
      type: "audio/wav",
      lastModified: 1700000000000,
    });
    useAudioStore.getState().setFile(file);
    useAudioStore.getState().setDuration(123.5);

    useDeepStore.getState().setScript(buildScript());
    await new Promise((r) => setTimeout(r, 50));

    const entries = useLibraryStore.getState().entries;
    expect(entries.length).toBe(1);
    expect(entries[0]!.durationSec).toBeCloseTo(123.5);
  });

  it("setScript(null) does not write to library", async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4, 5])], "song.wav", {
      type: "audio/wav",
    });
    useAudioStore.getState().setFile(file);

    useDeepStore.getState().setScript(null);
    await new Promise((r) => setTimeout(r, 50));

    expect(useLibraryStore.getState().entries.length).toBe(0);
  });

  it("setScript with skipPersist=true does not write to library", async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4, 5])], "song.wav", {
      type: "audio/wav",
    });
    useAudioStore.getState().setFile(file);

    useDeepStore.getState().setScript(buildScript(), { skipPersist: true });
    await new Promise((r) => setTimeout(r, 50));

    expect(useLibraryStore.getState().entries.length).toBe(0);
  });

  it("setScript while suppressLibraryAutoUpdate=true does not write to library", async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4, 5])], "song.wav", {
      type: "audio/wav",
    });
    useAudioStore.getState().setFile(file);
    useDeepStore.getState().setSuppressLibraryAutoUpdate(true);

    useDeepStore.getState().setScript(buildScript());
    await new Promise((r) => setTimeout(r, 50));

    expect(useLibraryStore.getState().entries.length).toBe(0);
  });

  it("re-analyzing the same file updates the existing entry, no duplicate", async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4, 5])], "song.wav", {
      type: "audio/wav",
      lastModified: 1700000000000,
    });
    useAudioStore.getState().setFile(file);

    useDeepStore.getState().setScript(buildScript([buildMove({ id: "m1" })]));
    await new Promise((r) => setTimeout(r, 50));
    expect(useLibraryStore.getState().entries.length).toBe(1);

    useDeepStore.getState().setScript(buildScript([buildMove({ id: "m2", reason: "v2" })]));
    await new Promise((r) => setTimeout(r, 50));

    const entries = useLibraryStore.getState().entries;
    expect(entries.length).toBe(1);
    expect(entries[0]!.script!.moves[0]!.id).toBe("m2");
  });

  it("setScript with no file in audio-store is a no-op for persistence", async () => {
    // No setFile call.
    useDeepStore.getState().setScript(buildScript());
    await new Promise((r) => setTimeout(r, 50));

    expect(useLibraryStore.getState().entries.length).toBe(0);
  });
});

// Regression guard for the "persist deep analysis" headline goal: a freshly
// analyzed track must keep its audio so re-opening it from the library loads
// the song instead of erroring with "please re-upload". This requires OPFS to
// be available AND the persist side-effect to actually pass the audio bytes.
describe("deepStore — persists audio to OPFS so a library entry reloads without re-upload", () => {
  // Minimal in-memory OPFS shim (mirrors library-store.test.ts).
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
            buf = view.buffer.slice(
              view.byteOffset,
              view.byteOffset + view.byteLength,
            ) as ArrayBuffer;
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
        file = new MemoryFileHandle(name);
        this.files.set(name, file);
      }
      return file;
    }
    async removeEntry(name: string): Promise<void> {
      this.files.delete(name);
    }
    async *entries(): AsyncIterableIterator<[string, MemoryFileHandle | MemoryDirHandle]> {
      for (const [k, v] of this.files) yield [k, v];
      for (const [k, v] of this.dirs) yield [k, v];
    }
  }

  let origStorage: PropertyDescriptor | undefined;

  beforeEach(async () => {
    origStorage = Object.getOwnPropertyDescriptor(globalThis.navigator, "storage");
    const opfsRoot = new MemoryDirHandle();
    Object.defineProperty(globalThis.navigator, "storage", {
      configurable: true,
      value: { getDirectory: async () => opfsRoot },
    });

    useDeepStore.getState().reset();
    useAudioStore.getState().reset();
    const { createStore, clear } = await import("idb-keyval");
    await clear(createStore("aurialis-library-entries-v1", "kv"));
    await clear(createStore("aurialis-library-prefs-v1", "kv"));
    await useLibraryStore.getState().hydrate();
  });

  afterEach(() => {
    if (origStorage) {
      Object.defineProperty(globalThis.navigator, "storage", origStorage);
    } else {
      delete (globalThis.navigator as { storage?: unknown }).storage;
    }
  });

  it("setScript with a file present writes the audio to OPFS and reloads it", async () => {
    const bytes = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]);
    const file = new File([bytes], "song.wav", {
      type: "audio/wav",
      lastModified: 1700000000000,
    });
    useAudioStore.getState().setFile(file);

    useDeepStore.getState().setScript(buildScript());
    // Fire-and-forget persist; flush microtasks so addEntry + OPFS write resolve.
    await new Promise((r) => setTimeout(r, 50));

    const entries = useLibraryStore.getState().entries;
    expect(entries.length).toBe(1);
    // The headline guarantee: audio was persisted, not just metadata.
    expect(entries[0]!.audioPersisted).toBe(true);

    const { getAudioFile } = await import("@/lib/storage/library-storage");
    const reloaded = await getAudioFile(entries[0]!.fingerprint);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.name).toBe("song.wav");
    const reloadedBytes = new Uint8Array(await reloaded!.arrayBuffer());
    expect(Array.from(reloadedBytes)).toEqual(Array.from(bytes));
  });
});

// Suppress unused import warning when vi isn't used elsewhere.
void vi;
