import { describe, it, expect } from "vitest";
import { renderOffline } from "../renderer";
import { DEFAULT_PARAMS } from "../presets";

function mockBuffer(numSamples = 44100, sampleRate = 44100): AudioBuffer {
  const ch = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    ch[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
  }
  return {
    numberOfChannels: 2,
    length: numSamples,
    sampleRate,
    duration: numSamples / sampleRate,
    getChannelData: () => ch,
    copyFromChannel: () => {},
    copyToChannel: () => {},
  } as unknown as AudioBuffer;
}

describe("renderOffline", () => {
  it("returns a non-null AudioBuffer", async () => {
    const src = mockBuffer();
    const result = await renderOffline(src, DEFAULT_PARAMS, 44100);
    expect(result).not.toBeNull();
  });

  it("output has the requested sample rate", async () => {
    const src = mockBuffer();
    const result = await renderOffline(src, DEFAULT_PARAMS, 44100);
    expect(result.sampleRate).toBe(44100);
  });

  it("output length matches source duration at target sample rate", async () => {
    const src = mockBuffer(44100, 44100); // 1s at 44.1 kHz
    const result = await renderOffline(src, DEFAULT_PARAMS, 44100);
    expect(result.length).toBe(44100);
  });

  it("output has 2 channels", async () => {
    const src = mockBuffer();
    const result = await renderOffline(src, DEFAULT_PARAMS, 44100);
    expect(result.numberOfChannels).toBe(2);
  });
});
