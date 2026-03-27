import { describe, it, expect } from "vitest";
import {
  generateSine,
  generateNoise,
  generateSilence,
  generateImpulse,
  peakLevel,
  rmsLevel,
  linToDb,
  dbToLin,
  countZeroCrossings,
  makeAudioBuffer,
  encodeWav,
} from "../signal-generator";

describe("generateSine", () => {
  it("should produce the correct number of samples", () => {
    const sig = generateSine(1000, 44100, 1.0);
    expect(sig.length).toBe(44100);
  });

  it("should peak at the given amplitude", () => {
    const sig = generateSine(440, 44100, 1.0, 0.5);
    expect(peakLevel(sig)).toBeCloseTo(0.5, 2);
  });

  it("should have correct frequency via zero crossings", () => {
    // 1kHz sine at 44100Hz for 1 second → ~2000 zero crossings
    const sig = generateSine(1000, 44100, 1.0);
    const crossings = countZeroCrossings(sig);
    expect(crossings).toBeGreaterThan(1900);
    expect(crossings).toBeLessThan(2100);
  });

  it("should have ~0.707 RMS for amplitude 1.0 sine", () => {
    const sig = generateSine(100, 44100, 1.0, 1.0);
    expect(rmsLevel(sig)).toBeCloseTo(Math.SQRT1_2, 2);
  });
});

describe("generateNoise", () => {
  it("should produce the correct number of samples", () => {
    const sig = generateNoise(44100, 0.5);
    expect(sig.length).toBe(22050);
  });

  it("should stay within [-amplitude, +amplitude]", () => {
    const sig = generateNoise(44100, 1.0, 0.8);
    for (const s of sig) {
      expect(Math.abs(s)).toBeLessThanOrEqual(0.8 + 1e-10);
    }
  });
});

describe("generateSilence", () => {
  it("should produce all-zero samples", () => {
    const sig = generateSilence(44100, 0.1);
    expect(sig.every((s) => s === 0)).toBe(true);
  });
});

describe("generateImpulse", () => {
  it("should have 1 at index 0 and 0 elsewhere", () => {
    const sig = generateImpulse(44100, 0.01);
    expect(sig[0]).toBe(1.0);
    expect(sig.slice(1).every((s) => s === 0)).toBe(true);
  });
});

describe("peakLevel / rmsLevel / linToDb / dbToLin", () => {
  it("peakLevel returns max absolute value", () => {
    const sig = new Float32Array([0.1, -0.5, 0.3, -0.9, 0.2]);
    expect(peakLevel(sig)).toBeCloseTo(0.9, 5);
  });

  it("rmsLevel for constant 0.5 signal = 0.5", () => {
    const sig = new Float32Array(100).fill(0.5);
    expect(rmsLevel(sig)).toBeCloseTo(0.5, 5);
  });

  it("linToDb(1.0) = 0 dBFS", () => {
    expect(linToDb(1.0)).toBeCloseTo(0, 5);
  });

  it("linToDb(0.5) ≈ -6 dBFS", () => {
    expect(linToDb(0.5)).toBeCloseTo(-6.02, 1);
  });

  it("dbToLin(0) = 1.0", () => {
    expect(dbToLin(0)).toBeCloseTo(1.0, 5);
  });

  it("dbToLin(-20) ≈ 0.1", () => {
    expect(dbToLin(-20)).toBeCloseTo(0.1, 3);
  });

  it("linToDb and dbToLin are inverses", () => {
    expect(linToDb(dbToLin(-12))).toBeCloseTo(-12, 3);
  });
});

describe("makeAudioBuffer", () => {
  it("should return AudioBuffer-like with correct properties", () => {
    const ch = [generateSine(440, 44100, 1.0), generateSine(440, 44100, 1.0)];
    const buf = makeAudioBuffer(ch, 44100);
    expect(buf.numberOfChannels).toBe(2);
    expect(buf.length).toBe(44100);
    expect(buf.sampleRate).toBe(44100);
    expect(buf.duration).toBeCloseTo(1.0, 3);
    expect(buf.getChannelData(0)).toBe(ch[0]);
  });
});

describe("encodeWav", () => {
  it("should produce a buffer with correct RIFF header", () => {
    const sig = generateSine(440, 44100, 0.1);
    const wav = encodeWav(sig, sig, 44100);
    const view = new DataView(wav);
    // Check "RIFF" marker
    expect(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))).toBe("RIFF");
    // Check "WAVE"
    expect(String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11))).toBe("WAVE");
    // Check sample rate
    expect(view.getUint32(24, true)).toBe(44100);
  });

  it("should produce the correct file size", () => {
    const numSamples = 4410; // 0.1s
    const sig = new Float32Array(numSamples);
    const wav = encodeWav(sig, sig, 44100);
    // 44 header + numSamples * 2 channels * 2 bytes
    expect(wav.byteLength).toBe(44 + numSamples * 2 * 2);
  });
});
