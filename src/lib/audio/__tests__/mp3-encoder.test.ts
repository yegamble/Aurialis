import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the wasm encoder so no real WASM is loaded in jsdom.
const configure = vi.fn();
const encode = vi.fn(() => new Uint8Array([1, 2, 3]));
const finalize = vi.fn(() => new Uint8Array([9]));
const createMp3Encoder = vi.fn(async () => ({ configure, encode, finalize }));

vi.mock("wasm-media-encoders", () => ({
  createMp3Encoder: () => createMp3Encoder(),
}));

import { encodeMp3 } from "../mp3-encoder";

function mockBuffer(numSamples = 4096, sampleRate = 44100, channels = 2): AudioBuffer {
  return {
    numberOfChannels: channels,
    length: numSamples,
    sampleRate,
    duration: numSamples / sampleRate,
    getChannelData: () => new Float32Array(numSamples),
  } as unknown as AudioBuffer;
}

describe("encodeMp3", () => {
  beforeEach(() => {
    configure.mockClear();
    encode.mockClear();
    finalize.mockClear();
    createMp3Encoder.mockClear();
  });

  it("configures the encoder with the buffer's sample rate, channel count and bitrate", async () => {
    await encodeMp3(mockBuffer(4096, 48000, 2), 256);
    expect(configure).toHaveBeenCalledWith(
      expect.objectContaining({ sampleRate: 48000, channels: 2, bitrate: 256 }),
    );
  });

  it("defaults to 320 kbps when no bitrate is given", async () => {
    await encodeMp3(mockBuffer(2048, 44100, 2));
    expect(configure).toHaveBeenCalledWith(
      expect.objectContaining({ bitrate: 320 }),
    );
  });

  it("encodes stereo as two channels and appends the finalize tail", async () => {
    const out = await encodeMp3(mockBuffer(2048, 44100, 2));
    // encode called with a 2-element channel array (stereo)
    expect(encode.mock.calls[0][0]).toHaveLength(2);
    expect(finalize).toHaveBeenCalledTimes(1);
    // encode (1,2,3) + finalize (9) → 4 bytes total
    expect(new Uint8Array(out)).toEqual(new Uint8Array([1, 2, 3, 9]));
  });

  it("encodes mono as a single channel", async () => {
    await encodeMp3(mockBuffer(2048, 44100, 1));
    expect(configure).toHaveBeenCalledWith(
      expect.objectContaining({ channels: 1 }),
    );
    expect(encode.mock.calls[0][0]).toHaveLength(1);
  });

  it("returns an ArrayBuffer", async () => {
    const out = await encodeMp3(mockBuffer());
    expect(out).toBeInstanceOf(ArrayBuffer);
  });
});
