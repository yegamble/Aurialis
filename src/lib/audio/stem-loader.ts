/**
 * Stem loader — loads multiple audio files or extracts stems from a ZIP.
 * Validates each file, decodes to AudioBuffer, generates waveform peaks.
 */

import JSZip from "jszip";
import { SUPPORTED_EXTENSIONS } from "@/types/audio";

const AUDIO_EXTENSIONS = SUPPORTED_EXTENSIONS.map((ext) => ext.toLowerCase());

const ZIP_MIME_TYPES = ["application/zip", "application/x-zip-compressed"];

export interface LoadedStem {
  name: string;
  buffer: AudioBuffer;
  waveformPeaks: number[];
}

export interface StemLoadFailure {
  name: string;
  reason: string;
}

export interface StemLoadResult {
  stems: LoadedStem[];
  failures: StemLoadFailure[];
}

/** Check if a file is a ZIP archive by extension or MIME type. */
export function isZipFile(file: File): boolean {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "zip") return true;
  return ZIP_MIME_TYPES.includes(file.type);
}

/** Check if a filename has a supported audio extension. */
function isAudioFilename(name: string): boolean {
  const ext = "." + name.split(".").pop()?.toLowerCase();
  return AUDIO_EXTENSIONS.includes(ext as (typeof AUDIO_EXTENSIONS)[number]);
}

/** Extract the filename from a path (strip directory components). */
function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1];
}

/**
 * Generate waveform peaks from an AudioBuffer by downsampling.
 * Returns absolute peak values normalized to 0-1.
 */
export function generateWaveformPeaks(
  buffer: AudioBuffer,
  pointCount = 500
): number[] {
  const channelData = buffer.getChannelData(0);
  const samplesPerPoint = Math.floor(channelData.length / pointCount);
  const peaks: number[] = [];

  for (let i = 0; i < pointCount; i++) {
    const start = i * samplesPerPoint;
    const end = Math.min(start + samplesPerPoint, channelData.length);
    let max = 0;
    for (let j = start; j < end; j++) {
      const abs = Math.abs(channelData[j]);
      if (abs > max) max = abs;
    }
    peaks.push(max);
  }

  return peaks;
}

/**
 * Load multiple audio files as stems.
 * Skips non-audio files and reports files that fail to decode.
 */
export async function loadStemsFromFiles(
  files: File[],
  ctx: AudioContext
): Promise<StemLoadResult> {
  const stems: LoadedStem[] = [];
  const failures: StemLoadFailure[] = [];

  for (const file of files) {
    if (!isAudioFilename(file.name)) continue;

    try {
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      const waveformPeaks = generateWaveformPeaks(audioBuffer);

      stems.push({
        name: file.name,
        buffer: audioBuffer,
        waveformPeaks,
      });
    } catch (e) {
      failures.push({
        name: file.name,
        reason: e instanceof Error ? e.message : "Failed to decode",
      });
    }
  }

  return { stems, failures };
}

/**
 * Extract and load audio stems from a ZIP file.
 * Skips directories and non-audio files.
 * Throws if no audio files are found in the ZIP.
 */
export async function loadStemsFromZip(
  zipFile: File,
  ctx: AudioContext
): Promise<StemLoadResult> {
  const zipData = await zipFile.arrayBuffer();
  const zip = new JSZip();
  const loaded = await zip.loadAsync(zipData);

  interface ZipEntry {
    path: string;
    entry: JSZip.JSZipObject;
  }
  const audioEntries: ZipEntry[] = [];

  loaded.forEach((relativePath: string, entry: JSZip.JSZipObject) => {
    if (entry.dir) return;
    const name = basename(relativePath);
    if (isAudioFilename(name)) {
      audioEntries.push({ path: relativePath, entry });
    }
  });

  if (audioEntries.length === 0) {
    throw new Error("No audio files found in ZIP");
  }

  const stems: LoadedStem[] = [];
  const failures: StemLoadFailure[] = [];

  for (const { path, entry } of audioEntries) {
    try {
      const arrayBuffer = await entry.async("arraybuffer");
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      const waveformPeaks = generateWaveformPeaks(audioBuffer);

      stems.push({
        name: basename(path),
        buffer: audioBuffer,
        waveformPeaks,
      });
    } catch (e) {
      failures.push({
        name: basename(path),
        reason: e instanceof Error ? e.message : "Failed to decode",
      });
    }
  }

  return { stems, failures };
}
