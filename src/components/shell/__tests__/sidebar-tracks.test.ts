import { describe, it, expect } from "vitest";
import type { LibraryEntry } from "@/lib/storage/library-types";
import {
  libraryEntriesToSidebarTracks,
  MAX_SIDEBAR_TRACKS,
} from "../sidebar-tracks";

function makeEntry(over: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    fingerprint: over.fingerprint ?? "fp-1",
    sha256: null,
    fileName: over.fileName ?? "song.wav",
    fileSize: 1024,
    lastModified: 1,
    mimeType: "audio/wav",
    durationSec: 200,
    createdAt: 1,
    lastOpenedAt: 1,
    audioPersisted: true,
    script: over.script ?? null,
    settings: null,
    ...over,
  };
}

describe("libraryEntriesToSidebarTracks", () => {
  it("maps id, extension-stripped title, and art seed from the fingerprint", () => {
    const [track] = libraryEntriesToSidebarTracks([
      makeEntry({ fingerprint: "fp-a", fileName: "Velvet Static.wav" }),
    ]);
    expect(track).toMatchObject({
      id: "fp-a",
      title: "Velvet Static",
      artSeed: "fp-a",
    });
  });

  it("flags analyzed only when the entry has a saved script", () => {
    const tracks = libraryEntriesToSidebarTracks([
      makeEntry({ fingerprint: "a", script: { version: 1 } as never }),
      makeEntry({ fingerprint: "b", script: null }),
    ]);
    expect(tracks[0]!.analyzed).toBe(true);
    expect(tracks[1]!.analyzed).toBe(false);
  });

  it("caps the list at MAX_SIDEBAR_TRACKS", () => {
    const many = Array.from({ length: MAX_SIDEBAR_TRACKS + 5 }, (_, i) =>
      makeEntry({ fingerprint: `fp-${i}`, fileName: `t${i}.wav` }),
    );
    expect(libraryEntriesToSidebarTracks(many)).toHaveLength(MAX_SIDEBAR_TRACKS);
  });

  it("returns an empty list for an empty library", () => {
    expect(libraryEntriesToSidebarTracks([])).toEqual([]);
  });
});
