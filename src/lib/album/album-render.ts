/**
 * Browser-side adapter that turns the pure {@link masterAlbum} orchestration
 * into real work: it loads each track's audio from OPFS, rebuilds its persisted
 * mastering chain (params + optional deep script) with the album loudness
 * target overridden, renders through the existing offline renderer, encodes a
 * 24-bit WAV, zips the results, and triggers the download.
 *
 * The chain reconstruction mirrors `resumeFromLibraryEntry`
 * (src/lib/storage/library-resume.ts): persisted `settings.params` and
 * `script` are applied verbatim — here we only override `targetLufs` so the
 * whole album lands on one target.
 */

import JSZip from "jszip";
import type { AudioParams } from "@/lib/stores/audio-store";
import { DEFAULT_PARAMS } from "@/lib/audio/presets";
import { renderOffline } from "@/lib/audio/renderer";
import { encodeWav } from "@/lib/audio/wav-encoder";
import { loadAudioFile } from "@/lib/audio/loader";
import { getAudioFile } from "@/lib/storage/library-storage";
import type { LibraryEntry } from "@/lib/storage/library-types";
import type { MasterAlbumDeps, RenderedTrack } from "./master-album";
import { normalizeToAlbumTarget, DEFAULT_CEILING_DBTP } from "./normalize";

/** WAV export settings for the album batch (matches the master export defaults). */
const BATCH_BIT_DEPTH = 24;
const BATCH_DITHER = "tpdf" as const;

type EntryResolver = (id: string) => LibraryEntry | undefined;

interface AlbumMasterDeps extends MasterAlbumDeps {
  /** Release the AudioContext created for decoding. */
  dispose: () => void;
}

/**
 * Build the real {@link MasterAlbumDeps} for a browser run. `resolveEntry`
 * supplies the persisted chain for a track id (typically from the library
 * store). Call `dispose()` when the run finishes to close the AudioContext.
 */
export function createAlbumMasterDeps(resolveEntry: EntryResolver): AlbumMasterDeps {
  let ctx: AudioContext | null = null;
  const ensureCtx = (): AudioContext => {
    if (!ctx) ctx = new AudioContext();
    return ctx;
  };

  return {
    async renderTrack(track, targetLufs): Promise<ArrayBuffer> {
      const entry = resolveEntry(track.id);
      if (!entry) throw new Error("Library entry not found");

      const file = await getAudioFile(track.id);
      if (!file) throw new Error("Audio unavailable — re-upload this track");

      const { buffer } = await loadAudioFile(file, ensureCtx());

      // Rebuild the persisted chain, overriding only the album target.
      const params: AudioParams = {
        ...(entry.settings?.params ?? DEFAULT_PARAMS),
        targetLufs,
      };

      const rendered = await renderOffline(
        buffer,
        params,
        buffer.sampleRate,
        entry.script,
      );

      // The offline renderer applies the chain but does NOT re-gain to
      // params.targetLufs, so each track would land at its own loudness. Re-gain
      // the rendered buffer onto the album target here — peak-guarded by the
      // entry's persisted ceiling — mutating its channel data in place before
      // encoding. Non-finite measurements (silence) leave the buffer untouched.
      const channels = Array.from(
        { length: rendered.numberOfChannels },
        (_, c) => rendered.getChannelData(c),
      );
      const ceiling = entry.settings?.params.ceiling ?? DEFAULT_CEILING_DBTP;
      normalizeToAlbumTarget(channels, rendered.sampleRate, targetLufs, ceiling);

      return encodeWav(rendered, BATCH_BIT_DEPTH, BATCH_DITHER);
    },

    async buildZip(files: RenderedTrack[]): Promise<Blob> {
      const zip = new JSZip();
      for (const f of files) {
        zip.file(f.name, f.data);
      }
      return zip.generateAsync({ type: "blob" });
    },

    download(blob: Blob, filename: string): void {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    },

    dispose(): void {
      if (ctx) {
        void ctx.close();
        ctx = null;
      }
    },
  };
}
