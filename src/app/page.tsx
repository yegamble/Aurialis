"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { UploadScreen } from "@/components/upload/UploadScreen";
import { LibraryList } from "@/components/library/LibraryList";
import { ResumeOrFreshDialog } from "@/components/library/ResumeOrFreshDialog";
import { useAudioStore } from "@/lib/stores/audio-store";
import { useLibraryStore } from "@/lib/stores/library-store";
import {
  findLibraryEntryForFile,
  openLibraryEntryFromList,
  resumeFromLibraryEntry,
  startFreshFromUpload,
} from "@/lib/storage/library-resume";
import type { LibraryEntry } from "@/lib/storage/library-types";

export default function UploadPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pendingResume, setPendingResume] = useState<{ file: File; entry: LibraryEntry } | null>(null);

  // Hydrate the library on mount.
  const hydrate = useLibraryStore((s) => s.hydrate);
  const hydrated = useLibraryStore((s) => s.hydrated);
  useEffect(() => {
    if (!hydrated) void hydrate();
  }, [hydrate, hydrated]);

  const proceedToMaster = useCallback(() => {
    router.push("/master");
  }, [router]);

  const handleFilesUploaded = useCallback(
    async (files: File[]) => {
      setError(null);
      const isSingleAudio = files.length === 1 && !files[0].name.endsWith(".zip");

      if (!isSingleAudio) {
        // Multi-file / ZIP → existing mix flow.
        sessionStorage.setItem(
          "pendingMixFiles",
          JSON.stringify(files.map((f) => f.name))
        );
        const urls = files.map((f) => URL.createObjectURL(f));
        sessionStorage.setItem("pendingMixUrls", JSON.stringify(urls));
        router.push("/mix");
        return;
      }

      const file = files[0]!;
      const entry = findLibraryEntryForFile(file);

      if (!entry) {
        // Unknown file → existing path.
        useAudioStore.getState().setFile(file);
        proceedToMaster();
        return;
      }

      // Known file. Resume silently when alwaysResume is set; otherwise prompt.
      const alwaysResume = useLibraryStore.getState().preferences.alwaysResume;
      if (alwaysResume) {
        await resumeFromLibraryEntry(entry, file);
        proceedToMaster();
        return;
      }

      setPendingResume({ file, entry });
    },
    [router, proceedToMaster]
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

      // Start fresh — confirm before destructive intent.
      const confirmed =
        typeof window !== "undefined"
          ? window.confirm(
              "This will overwrite the saved analysis and mastering settings for this song on the next Analyze. Continue?"
            )
          : true;
      if (!confirmed) {
        // User cancelled — re-open the dialog so they can decide again.
        setPendingResume(pending);
        return;
      }
      startFreshFromUpload(pending.file);
      proceedToMaster();
    },
    [pendingResume, proceedToMaster]
  );

  const handleOpenLibraryEntry = useCallback(
    async (fingerprint: string) => {
      const result = await openLibraryEntryFromList(fingerprint);
      if (!result.ok) {
        setError(
          result.reason === "no-audio"
            ? "Audio for this entry isn't available — please re-upload the file."
            : "Library entry not found."
        );
        return;
      }
      proceedToMaster();
    },
    [proceedToMaster]
  );

  return (
    <>
      <UploadScreen onFilesUploaded={handleFilesUploaded} />
      <LibraryList onOpenEntry={handleOpenLibraryEntry} />
      <ResumeOrFreshDialog
        open={pendingResume !== null}
        entry={pendingResume?.entry ?? null}
        onChoice={handleDialogChoice}
        onDismiss={() => setPendingResume(null)}
      />
      {error && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-red-500/90 text-white px-5 py-3 rounded-xl text-sm backdrop-blur-sm z-50">
          {error}
        </div>
      )}
    </>
  );
}
