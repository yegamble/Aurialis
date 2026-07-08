import { describe, it, expect } from "vitest";
import { deriveLibraryAlbum } from "../library-album";
import type { LibraryEntry } from "@/lib/storage/library-types";

function makeEntry(over: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    fingerprint: over.fingerprint ?? "fp",
    sha256: null,
    fileName: over.fileName ?? "song.wav",
    fileSize: 1024,
    lastModified: Date.now(),
    mimeType: "audio/wav",
    durationSec: 200,
    createdAt: Date.now(),
    lastOpenedAt: Date.now(),
    audioPersisted: true,
    script: null,
    settings: null,
    ...over,
  };
}

describe("deriveLibraryAlbum", () => {
  it("returns undefined for an empty library", () => {
    expect(deriveLibraryAlbum([])).toBeUndefined();
  });

  it("counts tracks and leaves avg/variance undefined when nothing analyzed", () => {
    const album = deriveLibraryAlbum([makeEntry(), makeEntry({ fingerprint: "b" })]);
    expect(album?.trackCount).toBe(2);
    expect(album?.avgLufs).toBeUndefined();
    expect(album?.variance).toBeUndefined();
    expect(album?.issues).toBe(0);
  });

  it("averages measured LUFS across analyzed tracks", () => {
    const album = deriveLibraryAlbum([
      makeEntry({ fingerprint: "a", measuredLufs: -10 }),
      makeEntry({ fingerprint: "b", measuredLufs: -12 }),
    ]);
    expect(album?.avgLufs).toBeCloseTo(-11);
  });

  it("computes variance as the measured LUFS range", () => {
    const album = deriveLibraryAlbum([
      makeEntry({ fingerprint: "a", measuredLufs: -9 }),
      makeEntry({ fingerprint: "b", measuredLufs: -12.4 }),
      makeEntry({ fingerprint: "c", measuredLufs: -10 }),
    ]);
    expect(album?.variance).toBeCloseTo(3.4);
  });

  it("counts issues as tracks drifting >1.5 LU from the album target", () => {
    // No per-track targets configured → target = default album target (-14).
    const album = deriveLibraryAlbum([
      makeEntry({ fingerprint: "a", measuredLufs: -14 }), // 0 drift
      makeEntry({ fingerprint: "b", measuredLufs: -12 }), // 2.0 drift → issue
      makeEntry({ fingerprint: "c", measuredLufs: -15 }), // 1.0 drift → ok
    ]);
    expect(album?.issues).toBe(1);
  });
});
