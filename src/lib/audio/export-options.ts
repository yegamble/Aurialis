import type { ExportOptions } from "./export";
import type { MasteringScript } from "@/types/deep-mastering";

export interface DeepScriptSelection {
  script: MasteringScript | null;
  scriptActive: boolean;
}

/**
 * Assemble exportWav() options from the UI export settings and the active deep
 * mastering script, so an exported WAV matches the live preview. The script is
 * applied only when `scriptActive`, exactly as the real-time engine gates it
 * (engine._scriptActive) — otherwise the WAV would silently diverge from what
 * the user hears.
 */
export function buildExportOptions(
  settings: Pick<
    ExportOptions,
    "sampleRate" | "bitDepth" | "dither" | "format" | "mp3Bitrate"
  >,
  deep: DeepScriptSelection,
): ExportOptions {
  return {
    sampleRate: settings.sampleRate,
    bitDepth: settings.bitDepth,
    dither: settings.dither,
    format: settings.format,
    mp3Bitrate: settings.mp3Bitrate,
    script: deep.scriptActive ? deep.script : null,
  };
}
