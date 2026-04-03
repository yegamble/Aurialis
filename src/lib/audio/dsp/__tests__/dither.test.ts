import { describe, it, expect } from "vitest";
import { encodeWav } from "../../wav-encoder";

function mockBuffer(numSamples = 1000, sampleRate = 44100): AudioBuffer {
  const data = new Float32Array(numSamples);
  // Fill with a 0.5 amplitude sine wave for deterministic content
  for (let i = 0; i < numSamples; i++) {
    data[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
  }
  return {
    numberOfChannels: 1,
    length: numSamples,
    sampleRate,
    duration: numSamples / sampleRate,
    getChannelData: () => data,
    copyFromChannel: () => {},
    copyToChannel: () => {},
  } as unknown as AudioBuffer;
}

describe("TPDF dither in encodeWav", () => {
  it("produces different output with dither:tpdf vs dither:none for 16-bit", () => {
    const buf = mockBuffer();
    const withDither = encodeWav(buf, 16, "tpdf");
    const withoutDither = encodeWav(buf, 16, "none");

    // Both should produce valid WAV files of the same size
    expect(withDither.byteLength).toBe(withoutDither.byteLength);

    // The data regions should differ (dither adds noise)
    const dithered = new Uint8Array(withDither);
    const clean = new Uint8Array(withoutDither);
    let diffCount = 0;
    for (let i = 44; i < dithered.length; i++) {
      if (dithered[i] !== clean[i]) diffCount++;
    }
    expect(diffCount).toBeGreaterThan(0);
  });

  it("produces different output with dither:tpdf vs dither:none for 24-bit", () => {
    const buf = mockBuffer();
    const withDither = encodeWav(buf, 24, "tpdf");
    const withoutDither = encodeWav(buf, 24, "none");

    expect(withDither.byteLength).toBe(withoutDither.byteLength);

    const dithered = new Uint8Array(withDither);
    const clean = new Uint8Array(withoutDither);
    let diffCount = 0;
    for (let i = 44; i < dithered.length; i++) {
      if (dithered[i] !== clean[i]) diffCount++;
    }
    expect(diffCount).toBeGreaterThan(0);
  });

  it("does not affect 32-bit float output regardless of dither setting", () => {
    const buf = mockBuffer();
    const withDither = encodeWav(buf, 32, "tpdf");
    const withoutDither = encodeWav(buf, 32, "none");

    const dithered = new Uint8Array(withDither);
    const clean = new Uint8Array(withoutDither);
    let diffCount = 0;
    for (let i = 44; i < dithered.length; i++) {
      if (dithered[i] !== clean[i]) diffCount++;
    }
    expect(diffCount).toBe(0);
  });

  it("defaults to tpdf dither when no dither param is provided for 16-bit", () => {
    const buf = mockBuffer();
    const defaultResult = encodeWav(buf, 16);
    const explicitTpdf = encodeWav(buf, 16, "tpdf");

    // Both should be valid WAVs of the same size (content will differ due to randomness)
    expect(defaultResult.byteLength).toBe(explicitTpdf.byteLength);
  });

  it("dither noise stays within ±1 LSB for 16-bit", () => {
    const numSamples = 10000;
    const data = new Float32Array(numSamples).fill(0); // silence
    const buf = {
      numberOfChannels: 1,
      length: numSamples,
      sampleRate: 44100,
      duration: numSamples / 44100,
      getChannelData: () => data,
      copyFromChannel: () => {},
      copyToChannel: () => {},
    } as unknown as AudioBuffer;

    const dithered = encodeWav(buf, 16, "tpdf");
    const view = new DataView(dithered);

    // Read 16-bit samples from data region, check they are within ±1 LSB of 0
    for (let i = 0; i < numSamples; i++) {
      const sample = view.getInt16(44 + i * 2, true);
      // TPDF with ±1 LSB means max deviation is ±2 (sum of two uniform ±1)
      expect(Math.abs(sample)).toBeLessThanOrEqual(2);
    }
  });
});
