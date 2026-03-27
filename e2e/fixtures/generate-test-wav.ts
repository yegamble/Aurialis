/**
 * Generates a minimal WAV test file for E2E tests.
 * 1kHz sine wave, -12 dBFS, 44.1kHz, 16-bit stereo, 2 seconds.
 * Uses only Node.js built-ins — no browser APIs needed.
 */
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, "test-audio.wav");

export function generateTestWav(outPath = OUT_PATH): void {
  const sampleRate = 44100;
  const numChannels = 2;
  const bitsPerSample = 16;
  const durationSecs = 2;
  const frequency = 1000;
  const amplitude = Math.pow(10, -12 / 20); // -12 dBFS

  const numSamples = sampleRate * durationSecs;
  const bytesPerSample = bitsPerSample / 8;
  const dataSize = numSamples * numChannels * bytesPerSample;
  const buf = Buffer.alloc(44 + dataSize);

  // RIFF header
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);                                  // chunk size
  buf.writeUInt16LE(1, 20);                                   // PCM
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28);
  buf.writeUInt16LE(numChannels * bytesPerSample, 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataSize, 40);

  const omega = (2 * Math.PI * frequency) / sampleRate;
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const sample = amplitude * Math.sin(omega * i);
    const pcm = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)));
    buf.writeInt16LE(pcm, offset);     offset += 2; // left
    buf.writeInt16LE(pcm, offset);     offset += 2; // right
  }

  const dir = dirname(outPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(outPath, buf);
}
