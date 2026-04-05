"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { UploadScreen } from "@/components/upload/UploadScreen";

export default function UploadPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const handleFileUploaded = useCallback(
    (file: File) => {
      setError(null);
      // All uploads go to /mix — single files get separated, multi/ZIP go to mixer directly
      // Store the file temporarily for the mix page to pick up
      sessionStorage.setItem("pendingUpload", "true");

      // Create a temporary URL so the mix page can access the file
      const url = URL.createObjectURL(file);
      sessionStorage.setItem("pendingFile", url);
      sessionStorage.setItem("pendingFileName", file.name);
      sessionStorage.setItem("pendingFileType", file.type);

      router.push("/mix");
    },
    [router]
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
