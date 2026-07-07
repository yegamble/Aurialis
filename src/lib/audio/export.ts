/**
 * Export orchestrator — render → encode → download.
 */

import type { AudioParams } from "@/lib/stores/audio-store";
import { renderOffline } from "./renderer";
import { encodeWav, type BitDepth, type DitherType } from "./wav-encoder";
import type { Mp3Bitrate } from "./mp3-encoder";
import type { MasteringScript } from "@/types/deep-mastering";

/**
 * Container formats the exporter can render to. WAV is the lossless PCM path;
 * MP3 routes through the LAME/WASM encoder. FLAC is intentionally absent — see
 * the plan's F1 deferral (no maintained browser FLAC encoder integrated cleanly).
 */
export type ExportFormat = "wav" | "mp3";

export interface ExportOptions {
  /** Target sample rate in Hz (e.g. 44100, 48000, 96000, 192000) */
  sampleRate: number;
  /** Bit depth for WAV encoding */
  bitDepth: BitDepth;
  /** Dither type for integer encoding (default: "tpdf") */
  dither?: DitherType;
  /** Suggested filename for the download (without extension) */
  filename?: string;
  /**
   * Active deep mastering script. When provided, the renderer applies its
   * envelope-driven moves per 128-sample block so the WAV matches real-time
   * playback bit-for-bit at section boundaries.
   */
  script?: MasteringScript | null;
  /** Output container format (default: "wav"). */
  format?: ExportFormat;
  /** Constant bitrate for MP3 export in kbps (default 320). Ignored for WAV. */
  mp3Bitrate?: Mp3Bitrate;
}

/**
 * Render the source audio with the given params, encode as WAV, and trigger
 * a browser download.
 *
 * @param sourceBuffer  Decoded input AudioBuffer
 * @param params        Current mastering parameters
 * @param options       Export settings
 */
export async function exportWav(
  sourceBuffer: AudioBuffer,
  params: AudioParams,
  options: ExportOptions
): Promise<void> {
  // 1. Render offline
  const rendered = await renderOffline(
    sourceBuffer,
    params,
    options.sampleRate,
    options.script ?? null,
  );

  // 2. Encode to the chosen container format
  const format = options.format ?? "wav";
  let data: ArrayBuffer;
  let mimeType: string;
  let extension: string;
  if (format === "mp3") {
    const { encodeMp3 } = await import("./mp3-encoder");
    data = await encodeMp3(rendered, options.mp3Bitrate ?? 320);
    mimeType = "audio/mpeg";
    extension = "mp3";
  } else {
    data = encodeWav(rendered, options.bitDepth, options.dither);
    mimeType = "audio/wav";
    extension = "wav";
  }

  // 3. Trigger browser download
  const blob = new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${options.filename ?? "mastered"}.${extension}`;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
