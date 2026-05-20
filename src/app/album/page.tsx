"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { AlbumView, type AlbumTrackRow } from "@/components/album/AlbumView";
import type { ShellScreen } from "@/components/shell/Sidebar";
import { useLibraryStore } from "@/lib/stores/library-store";
import { useSettingsStore } from "@/lib/stores/settings-store";
import { openLibraryEntryFromList } from "@/lib/storage/library-resume";

const DEFAULT_TARGET_LUFS = -14;
const STRIP_EXT = /\.[^.]+$/;

export default function AlbumPage(): React.ReactElement {
  const router = useRouter();
  const entries = useLibraryStore((s) => s.entries);
  const hydrate = useLibraryStore((s) => s.hydrate);
  const hydrated = useLibraryStore((s) => s.hydrated);
  const proMode = useSettingsStore((s) => s.proMode);
  const setProMode = useSettingsStore((s) => s.setProMode);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hydrated) void hydrate();
  }, [hydrate, hydrated]);

  const tracks = useMemo<AlbumTrackRow[]>(
    () =>
      entries.map((e) => ({
        id: e.fingerprint,
        title: e.fileName.replace(STRIP_EXT, ""),
        // Phase 4 UI shell: use the entry's targetLufs as a stand-in for the
        // measured LUFS. The actual measurement requires re-analyzing the
        // audio, which lands with the backend integration in a follow-up.
        lufs: e.settings?.params.targetLufs ?? null,
        durationSec: e.durationSec,
      })),
    [entries],
  );

  const targetLufs = useMemo(() => {
    const withLufs = tracks.filter((t) => t.lufs !== null) as Array<
      AlbumTrackRow & { lufs: number }
    >;
    if (withLufs.length === 0) return DEFAULT_TARGET_LUFS;
    const sum = withLufs.reduce((s, t) => s + t.lufs, 0);
    return sum / withLufs.length;
  }, [tracks]);

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
