"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { UploadScreen } from "@/components/upload/UploadScreen";
import { useAudioStore } from "@/lib/stores/audio-store";
import { validateFile, AudioLoadError } from "@/lib/audio/loader";

export default function UploadPage() {
  const router = useRouter();
  const setFile = useAudioStore((s) => s.setFile);
  const [error, setError] = useState<string | null>(null);

  const handleFileUploaded = useCallback(
    (file: File) => {
      setError(null);
      try {
        const result = validateFile(file);
        if (result.warning) {
          // Could show warning toast - for now just log
          console.warn(result.warning);
        }
      } catch (e) {
        if (e instanceof AudioLoadError) {
          setError(e.message);
          return;
        }
        setError("Failed to process file");
        return;
      }

      setFile(file);
      router.push("/master");
    },
    [setFile, router]
  );

  return (
    <>
      <UploadScreen onFileUploaded={handleFileUploaded} />
      {error && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-red-500/90 text-white px-5 py-3 rounded-xl text-sm backdrop-blur-sm z-50">
          {error}
        </div>
      )}
    </>
  );
}
