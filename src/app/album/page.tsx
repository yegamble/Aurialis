"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

export default function AlbumPage(): React.ReactElement {
  const router = useRouter();
  const entries = useLibraryStore((s) => s.entries);
  const hydrate = useLibraryStore((s) => s.hydrate);
  const hydrated = useLibraryStore((s) => s.hydrated);
  const proMode = useSettingsStore((s) => s.proMode);
  const setProMode = useSettingsStore((s) => s.setProMode);
  const targetLufsOverride = useAlbumStore((s) => s.targetLufsOverride);
  const [error, setError] = useState<string | null>(null);

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

  const handleSelect = useCallback(
    (next: ShellScreen) => {
      if (next === "library" || next === "upload") {
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
          // onMasterAll deliberately not wired — backend contract pending.
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
