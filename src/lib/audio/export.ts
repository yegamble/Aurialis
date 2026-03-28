/**
 * Export orchestrator — render → encode → download.
 */

import type { AudioParams } from "@/lib/stores/audio-store";
import { renderOffline } from "./renderer";
import { encodeWav, type BitDepth } from "./wav-encoder";

export interface ExportOptions {
  /** Target sample rate in Hz (e.g. 44100, 48000, 96000) */
  sampleRate: number;
  /** Bit depth for WAV encoding */
  bitDepth: BitDepth;
  /** Suggested filename for the download (without extension) */
  filename?: string;
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
  const rendered = await renderOffline(sourceBuffer, params, options.sampleRate);

  // 2. Encode to WAV
  const wavData = encodeWav(rendered, options.bitDepth);

  // 3. Trigger browser download
  const blob = new Blob([wavData], { type: "audio/wav" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${options.filename ?? "mastered"}.wav`;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
