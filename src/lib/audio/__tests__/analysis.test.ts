import { describe, it, expect } from "vitest";
import { analyzeAudio, type AnalysisResult } from "../analysis";

/** Creates a minimal AudioBuffer-like mock */
function makeBuffer(
  left: Float32Array,
  right: Float32Array = left,
  sampleRate = 44100
): AudioBuffer {
  return {
    numberOfChannels: 2,
    length: left.length,
    sampleRate,
    duration: left.length / sampleRate,
    getChannelData: (ch: number) => (ch === 0 ? left : right),
    copyFromChannel: () => {},
    copyToChannel: () => {},
  } as unknown as AudioBuffer;
}

describe("analyzeAudio", () => {
  it("returns -Infinity LUFS for silence", () => {
    const silence = new Float32Array(44100); // 1s silence
    const buf = makeBuffer(silence);
    const result = analyzeAudio(buf);
    expect(result.integratedLufs).toBe(-Infinity);
  });

  it("measures approximately -23 LUFS for a -23 dBFS sine", () => {
    const sampleRate = 44100;
    const amplitude = Math.pow(10, -23 / 20);
    const samples = sampleRate * 3; // 3 seconds for gated integration
    const left = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      left[i] = amplitude * Math.sin((2 * Math.PI * 1000 * i) / sampleRate);
    }
    const buf = makeBuffer(left, left, sampleRate);
    const result = analyzeAudio(buf);
    expect(result.integratedLufs).toBeGreaterThan(-24);
    expect(result.integratedLufs).toBeLessThan(-22);
  });

  it("returns correct peak level", () => {
    const signal = new Float32Array([0, 0.5, -0.8, 0.3, 0]);
    const buf = makeBuffer(signal);
    const result = analyzeAudio(buf);
    expect(result.peakDb).toBeCloseTo(20 * Math.log10(0.8), 1);
  });

  it("computes positive dynamic range for music-like signal", () => {
    const sampleRate = 44100;
    const samples = sampleRate;
    const left = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      left[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
    }
    const buf = makeBuffer(left, left, sampleRate);
    const result = analyzeAudio(buf);
    expect(result.dynamicRange).toBeGreaterThanOrEqual(0);
  });

  it("detects bass-heavy signal via spectral balance", () => {
    const sampleRate = 44100;
    const samples = sampleRate;
    // Pure 80Hz tone — bass-heavy
    const left = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      left[i] = 0.8 * Math.sin((2 * Math.PI * 80 * i) / sampleRate);
    }
    const buf = makeBuffer(left, left, sampleRate);
    const result = analyzeAudio(buf);
    expect(result.bassRatio).toBeGreaterThan(result.midRatio);
  });

  it("detects bright signal via spectral balance", () => {
    const sampleRate = 44100;
    const samples = sampleRate;
    // Pure 8kHz tone — treble-heavy
    const left = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      left[i] = 0.8 * Math.sin((2 * Math.PI * 8000 * i) / sampleRate);
    }
    const buf = makeBuffer(left, left, sampleRate);
    const result = analyzeAudio(buf);
    expect(result.highRatio).toBeGreaterThan(result.bassRatio);
  });
});
