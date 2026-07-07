"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { UploadScreen } from "@/components/upload/UploadScreen";
import { ImportPanel } from "@/components/upload/ImportPanel";
import { LibraryView } from "@/components/library/LibraryView";
import { deriveLibraryAlbum } from "@/components/library/library-album";
import { AppShell } from "@/components/shell/AppShell";
import type { ShellScreen, SidebarTrack } from "@/components/shell/Sidebar";
import { libraryEntriesToSidebarTracks } from "@/components/shell/sidebar-tracks";
import { ResumeOrFreshDialog } from "@/components/library/ResumeOrFreshDialog";
import { useAudioStore } from "@/lib/stores/audio-store";
import { useLibraryStore } from "@/lib/stores/library-store";
import { useSettingsStore } from "@/lib/stores/settings-store";
import {
  findLibraryEntryForFile,
  openLibraryEntryFromList,
  resumeFromLibraryEntry,
  startFreshFromUpload,
} from "@/lib/storage/library-resume";
import type { LibraryEntry } from "@/lib/storage/library-types";

type LocalScreen = Extract<ShellScreen, "library" | "upload">;

function LibraryImportPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const entries = useLibraryStore((s) => s.entries);
  const activeFingerprint = useLibraryStore((s) => s.activeFingerprint);
  const removeEntry = useLibraryStore((s) => s.removeEntry);
  const hydrate = useLibraryStore((s) => s.hydrate);
  const hydrated = useLibraryStore((s) => s.hydrated);

  const [error, setError] = useState<string | null>(null);
  const [pendingResume, setPendingResume] = useState<{ file: File; entry: LibraryEntry } | null>(
    null,
  );
  const [confirmFp, setConfirmFp] = useState<string | null>(null);
  // `/?screen=upload` (sidebar Import from any route) forces the import screen.
  // Capture the intent SYNCHRONOUSLY in the initial state so it survives the
  // param-strip effect below racing hydration — reading it only after hydration
  // could lose it to the strip and leave us on the Library screen.
  const [screen, setScreen] = useState<LocalScreen>(
    searchParams.get("screen") === "upload" ? "upload" : "library",
  );
  const [initialized, setInitialized] = useState(false);
  const proMode = useSettingsStore((s) => s.proMode);
  const setProMode = useSettingsStore((s) => s.setProMode);

  useEffect(() => {
    if (!hydrated) void hydrate();
  }, [hydrate, hydrated]);

  // After hydration, open a first-run empty library straight into upload. The
  // explicit `?screen=upload` intent was already captured in the initial state.
  // Setting state during render (with a guard) is the recommended React 18+
  // pattern for derived initial state and avoids the cascading effect that
  // react-hooks/set-state-in-effect warns about.
  if (hydrated && !initialized) {
    setInitialized(true);
    if (screen !== "upload" && entries.length === 0) setScreen("upload");
  }

  // Consume the one-shot `screen` query param and strip it from the URL so a
  // reload/back doesn't re-force the import screen. The useSearchParams value
  // captured above still reflects the original intent for the guard.
  useEffect(() => {
    if (searchParams.get("screen") && typeof window !== "undefined") {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [searchParams]);

  const proceedToMaster = useCallback(() => {
    router.push("/master");
  }, [router]);

  const handleFilesUploaded = useCallback(
    async (files: File[]) => {
      setError(null);
      const isSingleAudio = files.length === 1 && !files[0].name.endsWith(".zip");

      if (!isSingleAudio) {
        sessionStorage.setItem(
          "pendingMixFiles",
          JSON.stringify(files.map((f) => f.name)),
        );
        const urls = files.map((f) => URL.createObjectURL(f));
        sessionStorage.setItem("pendingMixUrls", JSON.stringify(urls));
        router.push("/mix");
        return;
      }

      const file = files[0]!;
      const entry = findLibraryEntryForFile(file);

      if (!entry) {
        useAudioStore.getState().setFile(file);
        proceedToMaster();
        return;
      }

      const alwaysResume = useLibraryStore.getState().preferences.alwaysResume;
      if (alwaysResume) {
        await resumeFromLibraryEntry(entry, file);
        proceedToMaster();
        return;
      }
      setPendingResume({ file, entry });
    },
    [router, proceedToMaster],
  );

  const handleDialogChoice = useCallback(
    async (choice: "resume" | "fresh", dontAskAgain: boolean) => {
      const pending = pendingResume;
      if (!pending) return;
      setPendingResume(null);

      if (dontAskAgain && choice === "resume") {
        await useLibraryStore.getState().setPreference("alwaysResume", true);
      }

      if (choice === "resume") {
        await resumeFromLibraryEntry(pending.entry, pending.file);
        proceedToMaster();
        return;
      }

      const confirmed =
        typeof window !== "undefined"
          ? window.confirm(
              "This will overwrite the saved analysis and mastering settings for this song on the next Analyze. Continue?",
            )
          : true;
      if (!confirmed) {
        setPendingResume(pending);
        return;
      }
      startFreshFromUpload(pending.file);
      proceedToMaster();
    },
    [pendingResume, proceedToMaster],
  );

  const handleOpenLibraryEntry = useCallback(
    async (fingerprint: string) => {
      const result = await openLibraryEntryFromList(fingerprint);
      if (!result.ok) {
        setError(
          result.reason === "no-audio"
            ? "Audio for this entry isn't available — please re-upload the file."
            : "Library entry not found.",
        );
        return;
      }
      proceedToMaster();
    },
    [proceedToMaster],
  );

  const handleRequestDelete = useCallback((fingerprint: string) => {
    setConfirmFp(fingerprint);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!confirmFp) return;
    const fp = confirmFp;
    setConfirmFp(null);
    await removeEntry(fp);
  }, [confirmFp, removeEntry]);

  const handleSidebarSelect = useCallback(
    (next: ShellScreen) => {
      if (next === "stems") {
        router.push("/mix");
        return;
      }
      if (next === "album") {
        router.push("/album");
        return;
      }
      if (next === "library" || next === "upload") {
        setScreen(next);
      }
    },
    [router],
  );

  const album = useMemo(() => deriveLibraryAlbum(entries), [entries]);

  const sidebarTracks = useMemo<SidebarTrack[]>(
    () => libraryEntriesToSidebarTracks(entries),
    [entries],
  );

  return (
    <>
      <AppShell
        activeScreen={screen}
        onSelect={handleSidebarSelect}
        tracks={sidebarTracks}
        activeTrackId={activeFingerprint}
        onSelectTrack={(id) => void handleOpenLibraryEntry(id)}
        proMode={proMode}
        onProModeChange={setProMode}
      >
        {screen === "library" ? (
          <LibraryView
            entries={entries}
            onOpenEntry={handleOpenLibraryEntry}
            onRequestDelete={handleRequestDelete}
            onUpload={() => setScreen("upload")}
            onImportFiles={(files) => void handleFilesUploaded(files)}
            album={album}
            onOpenAlbum={() => router.push("/album")}
          />
        ) : entries.length > 0 ? (
          <ImportPanel
            onFilesUploaded={handleFilesUploaded}
            onCancel={() => setScreen("library")}
          />
        ) : (
          <div className="relative h-full">
            <UploadScreen onFilesUploaded={handleFilesUploaded} />
          </div>
        )}
      </AppShell>

      <ResumeOrFreshDialog
        open={pendingResume !== null}
        entry={pendingResume?.entry ?? null}
        onChoice={handleDialogChoice}
        onDismiss={() => setPendingResume(null)}
      />

      {confirmFp ? (
        <div
          role="alertdialog"
          aria-modal="true"
          data-testid="library-delete-confirm"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        >
          <div className="max-w-sm rounded-xl border border-[rgba(255,255,255,0.08)] bg-[#0a0a0a] p-5">
            <p className="mb-1 text-sm text-white">Delete this song from your library?</p>
            <p className="mb-4 text-xs text-[rgba(255,255,255,0.5)]">
              The saved analysis and audio will be permanently removed from this browser.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmFp(null)}
                className="flex-1 rounded-md bg-[rgba(255,255,255,0.06)] px-3 py-2 text-sm text-[rgba(255,255,255,0.85)] hover:bg-[rgba(255,255,255,0.1)]"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="library-delete-confirm-button"
                onClick={() => void handleConfirmDelete()}
                className="flex-1 rounded-md bg-red-500/90 px-3 py-2 text-sm text-white hover:bg-red-500"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-red-500/90 px-5 py-3 text-sm text-white backdrop-blur-sm">
          {error}
        </div>
      ) : null}
    </>
  );
}

export default function UploadPage() {
  // useSearchParams (read in LibraryImportPage for `?screen=upload`) requires a
  // Suspense boundary for static rendering under the App Router.
  return (
    <Suspense fallback={null}>
      <LibraryImportPage />
    </Suspense>
  );
}
