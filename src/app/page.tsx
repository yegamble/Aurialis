"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { UploadScreen } from "@/components/upload/UploadScreen";
import { useAudioStore } from "@/lib/stores/audio-store";

export default function UploadPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const handleFilesUploaded = useCallback(
    (files: File[]) => {
      setError(null);
      const isSingleAudio =
        files.length === 1 && !files[0].name.endsWith(".zip");

      if (isSingleAudio) {
        // Single audio file → mastering page
        useAudioStore.getState().setFile(files[0]);
        router.push("/master");
      } else {
        // Multiple files or ZIP → mix page (stems)
        sessionStorage.setItem("pendingMixFiles", JSON.stringify(
          files.map((f) => f.name)
        ));
        // Store blob URLs so the mix page can fetch them
        const urls = files.map((f) => URL.createObjectURL(f));
        sessionStorage.setItem("pendingMixUrls", JSON.stringify(urls));
        router.push("/mix");
      }
    },
    [router]
  );

  return (
    <>
      <UploadScreen onFilesUploaded={handleFilesUploaded} />
      {error && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-red-500/90 text-white px-5 py-3 rounded-xl text-sm backdrop-blur-sm z-50">
          {error}
        </div>
      )}
    </>
  );
}
