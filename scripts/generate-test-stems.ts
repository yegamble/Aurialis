/**
 * Generate test WAV stem fixtures for E2E tests.
 * Creates short sine wave WAV files at different frequencies + a ZIP.
 *
 * Run: pnpm tsx scripts/generate-test-stems.ts
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const OUTPUT_DIR = join(import.meta.dirname, "..", "e2e", "fixtures", "stems");
const ZIP_PATH = join(import.meta.dirname, "..", "e2e", "fixtures", "stems.zip");

const SAMPLE_RATE = 44100;
const DURATION = 1; // 1 second
const BIT_DEPTH = 16;

interface StemDef {
  name: string;
  frequency: number;
  type: "sine" | "noise";
}

const STEMS: StemDef[] = [
  { name: "bass.wav", frequency: 80, type: "sine" },
  { name: "vocals.wav", frequency: 1000, type: "sine" },
  { name: "drums.wav", frequency: 0, type: "noise" },
  { name: "guitar.wav", frequency: 440, type: "sine" },
];

function generateSamples(def: StemDef): Float32Array {
  const samples = new Float32Array(SAMPLE_RATE * DURATION);
  for (let i = 0; i < samples.length; i++) {
    if (def.type === "noise") {
      // White noise with envelope (simulates drum hit)
      const t = i / SAMPLE_RATE;
      const envelope = Math.exp(-t * 8);
      samples[i] = (Math.random() * 2 - 1) * 0.6 * envelope;
    } else {
      samples[i] = 0.5 * Math.sin((2 * Math.PI * def.frequency * i) / SAMPLE_RATE);
    }
  }
  return samples;
}

function encodeWav(samples: Float32Array, sampleRate: number, bitDepth: number): Buffer {
  const numChannels = 1;
  const bytesPerSample = bitDepth / 8;
  const dataSize = samples.length * bytesPerSample;
  const headerSize = 44;
  const buffer = Buffer.alloc(headerSize + dataSize);

  // RIFF header
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);

  // fmt chunk
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // chunk size
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28);
  buffer.writeUInt16LE(numChannels * bytesPerSample, 32);
  buffer.writeUInt16LE(bitDepth, 34);

  // data chunk
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Write samples
  const maxVal = (1 << (bitDepth - 1)) - 1;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    const intVal = Math.round(clamped * maxVal);
    buffer.writeInt16LE(intVal, headerSize + i * bytesPerSample);
  }

  return buffer;
}

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log("Generating test stem WAV files...");

  const wavBuffers: Array<{ name: string; data: Buffer }> = [];

  for (const stem of STEMS) {
    const samples = generateSamples(stem);
    const wavData = encodeWav(samples, SAMPLE_RATE, BIT_DEPTH);
    const path = join(OUTPUT_DIR, stem.name);
    writeFileSync(path, wavData);
    wavBuffers.push({ name: stem.name, data: wavData });
    console.log(`  Created ${stem.name} (${wavData.length} bytes)`);
  }

  // Generate ZIP using JSZip
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  for (const { name, data } of wavBuffers) {
    zip.file(name, data);
  }
  const zipData = await zip.generateAsync({ type: "nodebuffer" });
  writeFileSync(ZIP_PATH, zipData);
  console.log(`  Created stems.zip (${zipData.length} bytes)`);

  console.log("Done!");
}

main().catch(console.error);
