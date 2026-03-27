import {
  SUPPORTED_FORMATS,
  SUPPORTED_EXTENSIONS,
  MAX_FILE_SIZE,
  WARN_FILE_SIZE,
  type AudioFileMetadata,
} from "@/types/audio";

export class AudioLoadError extends Error {
  constructor(
    message: string,
    public code: "UNSUPPORTED_FORMAT" | "FILE_TOO_LARGE" | "DECODE_ERROR"
  ) {
    super(message);
    this.name = "AudioLoadError";
  }
}

export function validateFile(file: File): { valid: boolean; warning?: string } {
  const ext = "." + file.name.split(".").pop()?.toLowerCase();
  const isValidType = SUPPORTED_FORMATS.includes(file.type as never);
  const isValidExt = SUPPORTED_EXTENSIONS.includes(ext as never);

  if (!isValidType && !isValidExt) {
    throw new AudioLoadError(
      `Unsupported format: ${file.type || ext}. Supported: WAV, MP3, FLAC, OGG, AAC, M4A`,
      "UNSUPPORTED_FORMAT"
    );
  }

  if (file.size > MAX_FILE_SIZE) {
    throw new AudioLoadError(
      `File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB. Maximum: 200MB`,
      "FILE_TOO_LARGE"
    );
  }

  const warning =
    file.size > WARN_FILE_SIZE
      ? `Large file (${(file.size / 1024 / 1024).toFixed(1)}MB) — loading may take a moment`
      : undefined;

  return { valid: true, warning };
}

export async function loadAudioFile(
  file: File,
  audioContext: AudioContext
): Promise<{ buffer: AudioBuffer; metadata: AudioFileMetadata }> {
  validateFile(file);

  const arrayBuffer = await file.arrayBuffer();
  let buffer: AudioBuffer;

  try {
    buffer = await audioContext.decodeAudioData(arrayBuffer);
  } catch {
    throw new AudioLoadError(
      "Failed to decode audio file. The file may be corrupted or in an unsupported format.",
      "DECODE_ERROR"
    );
  }

  const metadata = extractMetadata(file, buffer, arrayBuffer);

  return { buffer, metadata };
}

function extractMetadata(
  file: File,
  buffer: AudioBuffer,
  arrayBuffer: ArrayBuffer
): AudioFileMetadata {
  return {
    name: file.name,
    type: file.type,
    size: file.size,
    sampleRate: buffer.sampleRate,
    channels: buffer.numberOfChannels,
    duration: buffer.duration,
    bitDepth: extractBitDepth(arrayBuffer, file),
  };
}

function extractBitDepth(
  arrayBuffer: ArrayBuffer,
  file: File
): number | null {
  // WAV files: read bit depth from header at byte offset 34
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "wav" && arrayBuffer.byteLength > 36) {
    const view = new DataView(arrayBuffer);
    // Verify RIFF header
    const riff =
      view.getUint8(0) === 0x52 && // R
      view.getUint8(1) === 0x49 && // I
      view.getUint8(2) === 0x46 && // F
      view.getUint8(3) === 0x46; // F
    if (riff) {
      return view.getUint16(34, true);
    }
  }
  return null;
}
