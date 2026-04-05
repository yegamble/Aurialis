import { describe, it, expect, vi, afterEach } from "vitest";
import { renderOffline } from "../renderer";
import { DEFAULT_PARAMS } from "../presets";
import type { AudioParams } from "@/types/mastering";

/** Generate a sine wave Float32Array */
function sine(amplitude: number, freq: number, numSamples: number, sampleRate: number): Float32Array {
  const out = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  }
  return out;
}

/** Create a mock AudioBuffer with per-channel data */
function mockBuffer(channels: Float32Array[], sampleRate = 44100): AudioBuffer {
  return {
    numberOfChannels: channels.length,
    length: channels[0].length,
    sampleRate,
    duration: channels[0].length / sampleRate,
    getChannelData: (ch: number) => channels[ch],
    copyFromChannel: () => {},
    copyToChannel: () => {},
  } as unknown as AudioBuffer;
}

function rms(data: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / data.length);
}

function peak(data: Float32Array): number {
  let p = 0;
  for (let i = 0; i < data.length; i++) {
    const abs = Math.abs(data[i]);
    if (abs > p) p = abs;
  }
  return p;
}

// Store original OfflineAudioContext to restore after each test
const OriginalOAC = globalThis.OfflineAudioContext;

/**
 * Override OfflineAudioContext.startRendering to return a buffer with the given channels,
 * simulating the EQ passthrough (flat EQ = signal unchanged). This lets us test that
 * the inline DSP stages after rendering actually process the audio.
 */
function mockStartRenderingWithSignal(channels: Float32Array[]) {
  const sampleRate = 44100;
  const CustomOAC = class {
    numberOfChannels: number;
    length: number;
    sampleRate: number;
    destination = {};
    audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
    constructor(numCh: number, length: number, sr: number) {
      this.numberOfChannels = numCh;
      this.length = length;
      this.sampleRate = sr;
    }
    createGain() {
      return {
        gain: { value: 1, linearRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
    }
    createBiquadFilter() {
      return {
        type: "lowpass",
        frequency: { value: 350 },
        gain: { value: 0 },
        Q: { value: 1 },
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
    }
    createBufferSource() {
      return {
        buffer: null,
        connect: vi.fn(),
        start: vi.fn(),
      };
    }
    async startRendering() {
      // Return the passed-in channels as the rendered buffer
      // Clone so we can compare input vs output
      const rendered = channels.map((ch) => new Float32Array(ch));
      return {
        duration: rendered[0].length / sampleRate,
        length: rendered[0].length,
        numberOfChannels: rendered.length,
        sampleRate,
        getChannelData: (ch: number) => rendered[ch],
      };
    }
  };
  Object.defineProperty(globalThis, "OfflineAudioContext", {
    value: CustomOAC,
    writable: true,
  });
}

afterEach(() => {
  Object.defineProperty(globalThis, "OfflineAudioContext", {
    value: OriginalOAC,
    writable: true,
  });
});

describe("renderOffline", () => {
  it("returns a non-null AudioBuffer", async () => {
    const src = mockBuffer([sine(0.5, 440, 44100, 44100), sine(0.5, 440, 44100, 44100)]);
    const result = await renderOffline(src, DEFAULT_PARAMS, 44100);
    expect(result).not.toBeNull();
  });

  it("output has the requested sample rate", async () => {
    const src = mockBuffer([sine(0.5, 440, 44100, 44100), sine(0.5, 440, 44100, 44100)]);
    const result = await renderOffline(src, DEFAULT_PARAMS, 44100);
    expect(result.sampleRate).toBe(44100);
  });

  it("output length matches source duration at target sample rate", async () => {
    const src = mockBuffer([sine(0.5, 440, 44100, 44100), sine(0.5, 440, 44100, 44100)]);
    const result = await renderOffline(src, DEFAULT_PARAMS, 44100);
    expect(result.length).toBe(44100);
  });

  it("output has 2 channels", async () => {
    const src = mockBuffer([sine(0.5, 440, 44100, 44100), sine(0.5, 440, 44100, 44100)]);
    const result = await renderOffline(src, DEFAULT_PARAMS, 44100);
    expect(result.numberOfChannels).toBe(2);
  });

  describe("compressor", () => {
    it("applies gain reduction when signal exceeds threshold", async () => {
      const chL = sine(0.9, 440, 44100, 44100);
      const chR = sine(0.9, 440, 44100, 44100);
      mockStartRenderingWithSignal([chL, chR]);

      const src = mockBuffer([chL, chR]);
      const inputRms = rms(chL);

      const params: AudioParams = {
        ...DEFAULT_PARAMS,
        threshold: -20,
        ratio: 8,
        attack: 1,
        release: 50,
        makeup: 0,
      };
      const result = await renderOffline(src, params, 44100);
      const outputRms = rms(result.getChannelData(0));

      // Heavy compression on loud signal: output RMS should be notably lower
      expect(outputRms).toBeLessThan(inputRms * 0.85);
      // But not silent — signal should still be present
      expect(outputRms).toBeGreaterThan(0.01);
    });

    it("applies makeup gain", async () => {
      const chL = sine(0.3, 440, 44100, 44100);
      const chR = sine(0.3, 440, 44100, 44100);
      mockStartRenderingWithSignal([chL, chR]);

      const src = mockBuffer([chL, chR]);
      const inputRms = rms(chL);

      const params: AudioParams = {
        ...DEFAULT_PARAMS,
        threshold: 0, // Signal below threshold — no compression
        ratio: 1,
        makeup: 6, // +6 dB
      };
      const result = await renderOffline(src, params, 44100);
      const outputRms = rms(result.getChannelData(0));

      // +6 dB ≈ 2x amplitude, allow tolerance
      expect(outputRms).toBeGreaterThan(inputRms * 1.5);
    });
  });

  describe("saturation", () => {
    it("changes waveform when satDrive > 0", async () => {
      const chL = sine(0.8, 440, 44100, 44100);
      const chR = sine(0.8, 440, 44100, 44100);
      mockStartRenderingWithSignal([chL, chR]);

      const src = mockBuffer([chL, chR]);

      const params: AudioParams = {
        ...DEFAULT_PARAMS,
        satDrive: 80, // Heavy saturation
      };
      const result = await renderOffline(src, params, 44100);
      const outputL = result.getChannelData(0);

      // Saturation should change the waveform shape
      let diffEnergy = 0;
      for (let i = 0; i < outputL.length; i++) {
        const d = outputL[i] - chL[i];
        diffEnergy += d * d;
      }
      expect(diffEnergy / outputL.length).toBeGreaterThan(0.001);
    });
  });

  describe("stereo width", () => {
    it("collapses to mono when stereoWidth = 0", async () => {
      // Different L and R channels to verify mono collapse
      const chL = sine(0.7, 440, 44100, 44100);
      const chR = sine(0.7, 660, 44100, 44100); // Different frequency
      mockStartRenderingWithSignal([chL, chR]);

      const src = mockBuffer([chL, chR]);

      const params: AudioParams = {
        ...DEFAULT_PARAMS,
        stereoWidth: 0, // Full mono
      };
      const result = await renderOffline(src, params, 44100);
      const outL = result.getChannelData(0);
      const outR = result.getChannelData(1);

      // Mono: L and R should be identical (or very close)
      let maxDiff = 0;
      for (let i = 0; i < outL.length; i++) {
        const diff = Math.abs(outL[i] - outR[i]);
        if (diff > maxDiff) maxDiff = diff;
      }
      expect(maxDiff).toBeLessThan(0.01);
    });
  });

  describe("limiter", () => {
    it("enforces ceiling on output peaks", async () => {
      const chL = sine(0.9, 440, 44100, 44100);
      const chR = sine(0.9, 440, 44100, 44100);
      mockStartRenderingWithSignal([chL, chR]);

      const src = mockBuffer([chL, chR]);

      const params: AudioParams = {
        ...DEFAULT_PARAMS,
        threshold: 0, // No compression
        ratio: 1,
        ceiling: -6, // -6 dBFS ≈ 0.501 linear
      };
      const result = await renderOffline(src, params, 44100);
      const outL = result.getChannelData(0);
      const outR = result.getChannelData(1);

      const ceilingLin = Math.pow(10, -6 / 20); // ~0.501
      // Allow small overshoot from limiter attack time
      expect(peak(outL)).toBeLessThan(ceilingLin * 1.15);
      expect(peak(outR)).toBeLessThan(ceilingLin * 1.15);
    });
  });
});
