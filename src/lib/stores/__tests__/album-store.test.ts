import { describe, it, expect, beforeEach } from "vitest";
import {
  useAlbumStore,
  libraryEntriesToAlbumRows,
  computeAlbumTargetLufs,
  DEFAULT_ALBUM_TARGET_LUFS,
} from "../album-store";
import { DEFAULT_PARAMS } from "@/lib/audio/presets";
import type { LibraryEntry } from "@/lib/storage/library-types";
import type { PersistedSettings } from "@/lib/storage/library-types";

function settings(targetLufs: number): PersistedSettings {
  return {
    params: { ...DEFAULT_PARAMS, targetLufs },
    simple: { genre: "pop", intensity: 50, toggles: { deharsh: false, glueComp: false } },
    tonePreset: null,
    outputPreset: null,
    savedAt: 0,
  };
}

function makeEntry(partial: Partial<LibraryEntry>): LibraryEntry {
  return {
    fingerprint: "fp",
    sha256: null,
    fileName: "song.wav",
    fileSize: 1,
    lastModified: 0,
    mimeType: "audio/wav",
    durationSec: 120,
    measuredLufs: null,
    createdAt: 0,
    lastOpenedAt: 0,
    audioPersisted: true,
    script: null,
    settings: null,
    ...partial,
  };
}

describe("libraryEntriesToAlbumRows", () => {
  it("maps the measured integrated LUFS (not the configured target) onto each row", () => {
    const rows = libraryEntriesToAlbumRows([
      makeEntry({ fingerprint: "a", fileName: "track1.wav", measuredLufs: -9.2, settings: settings(-14) }),
    ]);
    expect(rows[0]).toEqual({ id: "a", title: "track1", lufs: -9.2, durationSec: 120 });
  });

  it("yields lufs = null for tracks that have never been measured", () => {
    const rows = libraryEntriesToAlbumRows([makeEntry({ measuredLufs: null })]);
    expect(rows[0]!.lufs).toBeNull();
  });

  it("strips the file extension for the row title and uses the fingerprint as id", () => {
    const rows = libraryEntriesToAlbumRows([
      makeEntry({ fingerprint: "fp-7", fileName: "My Mix.final.flac", measuredLufs: -10 }),
    ]);
    expect(rows[0]!.id).toBe("fp-7");
    expect(rows[0]!.title).toBe("My Mix.final");
  });
});

describe("computeAlbumTargetLufs", () => {
  it("averages the configured per-track targets (the intended loudness), not the measured values", () => {
    const entries = [
      makeEntry({ fingerprint: "a", measuredLufs: -6, settings: settings(-14) }),
      makeEntry({ fingerprint: "b", measuredLufs: -20, settings: settings(-16) }),
    ];
    // Average of configured targets -14 and -16 = -15 (independent of measured -6/-20).
    expect(computeAlbumTargetLufs(entries, null)).toBe(-15);
  });

  it("uses the manual override when provided", () => {
    const entries = [makeEntry({ settings: settings(-14) })];
    expect(computeAlbumTargetLufs(entries, -9)).toBe(-9);
  });

  it("falls back to the default when no track has settings", () => {
    expect(computeAlbumTargetLufs([makeEntry({ settings: null })], null)).toBe(
      DEFAULT_ALBUM_TARGET_LUFS,
    );
  });
});

describe("useAlbumStore", () => {
  beforeEach(() => {
    useAlbumStore.setState({ targetLufsOverride: null });
  });

  it("defaults the target override to null (auto)", () => {
    expect(useAlbumStore.getState().targetLufsOverride).toBeNull();
  });

  it("setTargetLufsOverride updates the override", () => {
    useAlbumStore.getState().setTargetLufsOverride(-10);
    expect(useAlbumStore.getState().targetLufsOverride).toBe(-10);
  });
});
