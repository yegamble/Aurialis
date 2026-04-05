import { describe, it, expect, vi } from "vitest";
import {
  stereoSplit,
  analyzePanContent,
  type StereoSplitResult,
} from "../stereo-split";

function makeStereoBuffer(
  leftGen: (i: number, sr: number) => number,
  rightGen: (i: number, sr: number) => number,
  duration = 1,
  sampleRate = 44100
): AudioBuffer {
  const length = Math.floor(duration * sampleRate);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    left[i] = leftGen(i, sampleRate);
    right[i] = rightGen(i, sampleRate);
  }
  return {
    duration,
    sampleRate,
    numberOfChannels: 2,
    length,
    getChannelData: vi.fn((ch: number) => (ch === 0 ? left : right)),
    copyFromChannel: vi.fn(),
    copyToChannel: vi.fn(),
  } as unknown as AudioBuffer;
}

// Sine generators
const sine = (freq: number, amp: number) => (i: number, sr: number) =>
  amp * Math.sin((2 * Math.PI * freq * i) / sr);
const silence = () => 0;

describe("stereo-split", () => {
  describe("analyzePanContent", () => {
    it("detects mono content (no panning)", () => {
      // Same signal in both channels = mono (center)
      const buffer = makeStereoBuffer(sine(440, 0.5), sine(440, 0.5));
      const result = analyzePanContent(buffer);
      expect(result.hasPannedContent).toBe(false);
      expect(result.sideEnergyRatio).toBeLessThan(0.05);
    });

    it("detects hard-panned content", () => {
      // Signal only in left channel = fully panned
      const buffer = makeStereoBuffer(sine(440, 0.5), silence);
      const result = analyzePanContent(buffer);
      expect(result.hasPannedContent).toBe(true);
      expect(result.sideEnergyRatio).toBeGreaterThan(0.2);
    });

    it("detects stereo spread (different signals L/R)", () => {
      // Different frequencies in each channel = wide stereo
      const buffer = makeStereoBuffer(sine(440, 0.5), sine(880, 0.5));
      const result = analyzePanContent(buffer);
      expect(result.hasPannedContent).toBe(true);
    });
  });

  describe("stereoSplit", () => {
    it("returns left and right Float32Arrays", () => {
      const buffer = makeStereoBuffer(sine(440, 0.5), sine(880, 0.5));
      const result = stereoSplit(buffer);
      expect(result.left).toBeInstanceOf(Float32Array);
      expect(result.right).toBeInstanceOf(Float32Array);
      expect(result.left.length).toBe(buffer.length);
      expect(result.right.length).toBe(buffer.length);
    });

    it("isolates left-panned content in left array", () => {
      // Signal in left only, silence in right
      const buffer = makeStereoBuffer(sine(440, 0.5), silence);
      const result = stereoSplit(buffer);

      // Left array should have most energy
      const leftRms = Math.sqrt(
        result.left.reduce((s, v) => s + v * v, 0) / result.left.length
      );
      const rightRms = Math.sqrt(
        result.right.reduce((s, v) => s + v * v, 0) / result.right.length
      );
      expect(leftRms).toBeGreaterThan(rightRms * 2);
    });

    it("isolates right-panned content in right array", () => {
      // Silence in left, signal in right
      const buffer = makeStereoBuffer(silence, sine(440, 0.5));
      const result = stereoSplit(buffer);

      const leftRms = Math.sqrt(
        result.left.reduce((s, v) => s + v * v, 0) / result.left.length
      );
      const rightRms = Math.sqrt(
        result.right.reduce((s, v) => s + v * v, 0) / result.right.length
      );
      expect(rightRms).toBeGreaterThan(leftRms * 2);
    });

    it("splits different L/R signals into separate arrays", () => {
      // 440Hz left, 880Hz right — distinct content
      const buffer = makeStereoBuffer(sine(440, 0.5), sine(880, 0.5));
      const result = stereoSplit(buffer);

      // Both should have significant energy
      const leftRms = Math.sqrt(
        result.left.reduce((s, v) => s + v * v, 0) / result.left.length
      );
      const rightRms = Math.sqrt(
        result.right.reduce((s, v) => s + v * v, 0) / result.right.length
      );
      expect(leftRms).toBeGreaterThan(0.1);
      expect(rightRms).toBeGreaterThan(0.1);
    });

    it("returns hasPannedContent flag", () => {
      const buffer = makeStereoBuffer(sine(440, 0.5), sine(880, 0.5));
      const result = stereoSplit(buffer);
      expect(typeof result.hasPannedContent).toBe("boolean");
    });

    it("handles mono buffer gracefully (no split needed)", () => {
      const buffer = makeStereoBuffer(sine(440, 0.5), sine(440, 0.5));
      const result = stereoSplit(buffer);
      expect(result.hasPannedContent).toBe(false);
    });
  });
});
