"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { AlbumView, type AlbumTrackRow } from "@/components/album/AlbumView";
import type { ShellScreen } from "@/components/shell/Sidebar";
import { useLibraryStore } from "@/lib/stores/library-store";
import { useSettingsStore } from "@/lib/stores/settings-store";
import {
  useAlbumStore,
  libraryEntriesToAlbumRows,
  computeAlbumTargetLufs,
} from "@/lib/stores/album-store";
import { openLibraryEntryFromList } from "@/lib/storage/library-resume";
import { masterAlbum, type AlbumMasterProgress } from "@/lib/album/master-album";
import { createAlbumMasterDeps } from "@/lib/album/album-render";

export default function AlbumPage(): React.ReactElement {
  const router = useRouter();
  const entries = useLibraryStore((s) => s.entries);
  const hydrate = useLibraryStore((s) => s.hydrate);
  const hydrated = useLibraryStore((s) => s.hydrated);
  const proMode = useSettingsStore((s) => s.proMode);
  const setProMode = useSettingsStore((s) => s.setProMode);
  const targetLufsOverride = useAlbumStore((s) => s.targetLufsOverride);
  const [error, setError] = useState<string | null>(null);
  const [master, setMaster] = useState<AlbumMasterProgress | null>(null);
  const cancelRef = useRef(false);
  const runningRef = useRef(false);

  useEffect(() => {
    if (!hydrated) void hydrate();
  }, [hydrate, hydrated]);

  // Per-track rows use the *measured* integrated LUFS (from the master flow);
  // unanalyzed tracks surface lufs = null. The album target is the average of
  // the configured per-track targets, so deltas reflect real loudness drift.
  const tracks = useMemo<AlbumTrackRow[]>(
    () => libraryEntriesToAlbumRows(entries),
    [entries],
  );

  const targetLufs = useMemo(
    () => computeAlbumTargetLufs(entries, targetLufsOverride),
    [entries, targetLufsOverride],
  );

  const albumTitle = "Library album";
  const albumArtist = entries.length === 0 ? "Add tracks to begin" : "Your tracks";

  const handleOpenTrack = useCallback(
    async (id: string) => {
      const result = await openLibraryEntryFromList(id);
      if (!result.ok) {
        setError(
          result.reason === "no-audio"
            ? "Audio for this entry isn't available — please re-upload."
            : "Library entry not found.",
        );
        return;
      }
      router.push("/master");
    },
    [router],
  );

  const handleMasterAll = useCallback(async () => {
    if (runningRef.current) return;
    const analyzed = tracks
      .filter((t) => t.lufs !== null && Number.isFinite(t.lufs))
      .map((t) => ({ id: t.id, title: t.title }));
    if (analyzed.length === 0) return;

    runningRef.current = true;
    cancelRef.current = false;
    const deps = createAlbumMasterDeps((id) =>
      useLibraryStore.getState().entries.find((e) => e.fingerprint === id),
    );
    try {
      const result = await masterAlbum(deps, {
        tracks: analyzed,
        targetLufs,
        zipName: `${albumTitle} — mastered.zip`,
        onProgress: setMaster,
        isCancelled: () => cancelRef.current,
      });
      if (result.failed > 0 && result.succeeded === 0) {
        setError("Album mastering failed — check that each track's audio is available.");
      }
    } catch {
      setError("Album mastering failed unexpectedly.");
    } finally {
      deps.dispose();
      runningRef.current = false;
    }
  }, [tracks, targetLufs, albumTitle]);

  const handleCancelMaster = useCallback(() => {
    cancelRef.current = true;
  }, []);

  const handleSelect = useCallback(
    (next: ShellScreen) => {
      if (next === "upload") {
        router.push("/?screen=upload");
        return;
      }
      if (next === "library") {
        router.push("/");
        return;
      }
      if (next === "stems") {
        router.push("/mix");
        return;
      }
      // already on album
    },
    [router],
  );

  return (
    <>
      <AppShell
        activeScreen="album"
        onSelect={handleSelect}
        proMode={proMode}
        onProModeChange={setProMode}
      >
        <AlbumView
          title={albumTitle}
          artist={albumArtist}
          tracks={tracks}
          targetLufs={targetLufs}
          onOpenTrack={(id) => void handleOpenTrack(id)}
          onMasterAll={() => void handleMasterAll()}
          master={master}
          onCancelMaster={handleCancelMaster}
        />
      </AppShell>
      {error ? (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-red-500/90 px-5 py-3 text-sm text-white backdrop-blur-sm">
          {error}
        </div>
      ) : null}
    </>
  );
}
