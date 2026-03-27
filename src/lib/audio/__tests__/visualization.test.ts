import { describe, it, expect } from "vitest";
import {
  extractWaveformPeaks,
  normalizeSpectrumData,
  linearToDbfs,
} from "../visualization";

describe("extractWaveformPeaks", () => {
  it("returns correct number of bars", () => {
    const buffer = createMockBuffer(44100, 1);
    const peaks = extractWaveformPeaks(buffer, 100);
    expect(peaks).toHaveLength(100);
  });

  it("returns values between 0 and 1", () => {
    const buffer = createMockBuffer(44100, 1);
    const peaks = extractWaveformPeaks(buffer, 50);
    peaks.forEach((p) => {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    });
  });

  it("detects peak in sine wave", () => {
    const sampleRate = 44100;
    const length = sampleRate; // 1 second
    const channelData = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      channelData[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate);
    }
    const buffer = createMockBufferFromData([channelData]);
    const peaks = extractWaveformPeaks(buffer, 10);
    const maxPeak = Math.max(...peaks);
    expect(maxPeak).toBeGreaterThan(0.9);
  });

  it("handles stereo by taking max of both channels", () => {
    const length = 1000;
    const ch1 = new Float32Array(length).fill(0.3);
    const ch2 = new Float32Array(length).fill(0.7);
    const buffer = createMockBufferFromData([ch1, ch2]);
    const peaks = extractWaveformPeaks(buffer, 5);
    // All peaks should be >= 0.7 (from ch2)
    peaks.forEach((p) => expect(p).toBeGreaterThanOrEqual(0.69));
  });

  it("returns zeros for silent buffer", () => {
    const length = 1000;
    const ch = new Float32Array(length).fill(0);
    const buffer = createMockBufferFromData([ch]);
    const peaks = extractWaveformPeaks(buffer, 10);
    peaks.forEach((p) => expect(p).toBe(0));
  });
});

describe("normalizeSpectrumData", () => {
  it("returns correct number of bins", () => {
    const data = new Float32Array(1024).fill(-60);
    const result = normalizeSpectrumData(data, 32);
    expect(result).toHaveLength(32);
  });

  it("returns values between 0 and 1", () => {
    const data = new Float32Array(1024);
    for (let i = 0; i < data.length; i++) {
      data[i] = -100 + Math.random() * 100;
    }
    const result = normalizeSpectrumData(data, 64);
    result.forEach((v) => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    });
  });

  it("maps -100dB to 0 and -20dB to 1", () => {
    const data = new Float32Array(1024).fill(-100);
    const result = normalizeSpectrumData(data, 4, -100, -20);
    result.forEach((v) => expect(v).toBeCloseTo(0, 1));

    const data2 = new Float32Array(1024).fill(-20);
    const result2 = normalizeSpectrumData(data2, 4, -100, -20);
    result2.forEach((v) => expect(v).toBeCloseTo(1, 1));
  });

  it("returns zeros for empty input", () => {
    const result = normalizeSpectrumData(new Float32Array(0), 8);
    expect(result).toHaveLength(8);
    result.forEach((v) => expect(v).toBe(0));
  });
});

describe("linearToDbfs", () => {
  it("converts 1.0 to 0 dBFS", () => {
    expect(linearToDbfs(1.0)).toBeCloseTo(0, 5);
  });

  it("converts 0.5 to approximately -6 dBFS", () => {
    expect(linearToDbfs(0.5)).toBeCloseTo(-6.02, 1);
  });

  it("converts 0 to -Infinity", () => {
    expect(linearToDbfs(0)).toBe(-Infinity);
  });

  it("converts negative to -Infinity", () => {
    expect(linearToDbfs(-1)).toBe(-Infinity);
  });
});

// --- Helpers ---

function createMockBuffer(length: number, channels: number): AudioBuffer {
  const channelArrays: Float32Array[] = [];
  for (let c = 0; c < channels; c++) {
    const data = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() - 0.5) * 2;
    }
    channelArrays.push(data);
  }
  return createMockBufferFromData(channelArrays);
}

function createMockBufferFromData(channels: Float32Array[]): AudioBuffer {
  const length = channels[0].length;
  return {
    duration: length / 44100,
    length,
    numberOfChannels: channels.length,
    sampleRate: 44100,
    getChannelData: (ch: number) => channels[ch],
    copyFromChannel: () => {},
    copyToChannel: () => {},
  } as unknown as AudioBuffer;
}
