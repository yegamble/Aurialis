/**
 * Plain JavaScript WAV generator — no TypeScript/build tools needed.
 * Generates the same 1kHz sine wave as generate-test-wav.ts.
 * Run with: node e2e/fixtures/generate-test-wav.mjs
 */
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, "test-audio.wav");

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
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20);                                    // PCM
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
  buf.writeInt16LE(pcm, offset);  offset += 2; // left
  buf.writeInt16LE(pcm, offset);  offset += 2; // right
}

const dir = dirname(OUT_PATH);
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
writeFileSync(OUT_PATH, buf);
console.log(`Generated ${OUT_PATH} (${buf.length} bytes)`);

// ---------- Synthetic narrow-guitar fixture (TS-003) ----------
//
// Generates a stereo signal where a 2.5 kHz "guitar"-like carrier is nearly
// identical on L and R (very low side-band energy), simulating Suno-style
// AI-music narrowness in the 1.5–4 kHz band. The AI Repair detector should
// flag this as narrow; the script generator should schedule at least one
// AI Repair Move covering the active section (TS-003 step 2).
const NARROW_OUT = join(__dirname, "suno-narrow-guitar.wav");
const narrowDuration = 4; // seconds
const narrowSamples = sampleRate * narrowDuration;
const narrowDataSize = narrowSamples * numChannels * bytesPerSample;
const narrowBuf = Buffer.alloc(44 + narrowDataSize);

narrowBuf.write("RIFF", 0, "ascii");
narrowBuf.writeUInt32LE(36 + narrowDataSize, 4);
narrowBuf.write("WAVE", 8, "ascii");
narrowBuf.write("fmt ", 12, "ascii");
narrowBuf.writeUInt32LE(16, 16);
narrowBuf.writeUInt16LE(1, 20);
narrowBuf.writeUInt16LE(numChannels, 22);
narrowBuf.writeUInt32LE(sampleRate, 24);
narrowBuf.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28);
narrowBuf.writeUInt16LE(numChannels * bytesPerSample, 32);
narrowBuf.writeUInt16LE(bitsPerSample, 34);
narrowBuf.write("data", 36, "ascii");
narrowBuf.writeUInt32LE(narrowDataSize, 40);

const narrowAmp = Math.pow(10, -10 / 20);
const carrier = (2 * Math.PI * 2500) / sampleRate;
const beating = (2 * Math.PI * 100) / sampleRate; // amplitude tremolo
let nOffset = 44;
for (let i = 0; i < narrowSamples; i++) {
  const env = 0.6 + 0.4 * Math.sin(beating * i);
  const sample = narrowAmp * env * Math.sin(carrier * i);
  // Near-mono: tiny phase offset on R so M/S correlation is near 1.0
  // but not pure mono (so the test can measure "narrowness").
  const sampleR = narrowAmp * env * Math.sin(carrier * i + 0.005);
  const pcmL = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)));
  const pcmR = Math.max(-32768, Math.min(32767, Math.round(sampleR * 32767)));
  narrowBuf.writeInt16LE(pcmL, nOffset); nOffset += 2;
  narrowBuf.writeInt16LE(pcmR, nOffset); nOffset += 2;
}
writeFileSync(NARROW_OUT, narrowBuf);
console.log(`Generated ${NARROW_OUT} (${narrowBuf.length} bytes)`);
