import { describe, it, expect } from "vitest";
import { encodeWav } from "../wav-encoder";

function mockBuffer(
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

describe("encodeWav", () => {
  it("produces RIFF/WAVE header for 16-bit", () => {
    const buf = mockBuffer(new Float32Array(1024));
    const result = encodeWav(buf, 16);
    const view = new DataView(result);
    const readStr = (off: number, len: number) =>
      Array.from({ length: len }, (_, i) =>
        String.fromCharCode(view.getUint8(off + i))
      ).join("");
    expect(readStr(0, 4)).toBe("RIFF");
    expect(readStr(8, 4)).toBe("WAVE");
    expect(readStr(12, 4)).toBe("fmt ");
    expect(readStr(36, 4)).toBe("data");
  });

  it("uses PCM format tag (1) for 16-bit", () => {
    const buf = mockBuffer(new Float32Array(100));
    const view = new DataView(encodeWav(buf, 16));
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(34, true)).toBe(16);
  });

  it("produces correct byte length for 16-bit stereo", () => {
    const numSamples = 100;
    const buf = mockBuffer(new Float32Array(numSamples));
    expect(encodeWav(buf, 16).byteLength).toBe(44 + numSamples * 2 * 2);
  });

  it("uses PCM format tag (1) for 24-bit and writes 3 bytes/sample", () => {
    const numSamples = 100;
    const buf = mockBuffer(new Float32Array(numSamples));
    const result = encodeWav(buf, 24);
    const view = new DataView(result);
    expect(result.byteLength).toBe(44 + numSamples * 2 * 3);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(34, true)).toBe(24);
  });

  it("uses IEEE_FLOAT format tag (3) for 32-bit", () => {
    const numSamples = 100;
    const buf = mockBuffer(new Float32Array(numSamples));
    const result = encodeWav(buf, 32);
    const view = new DataView(result);
    expect(result.byteLength).toBe(44 + numSamples * 2 * 4);
    expect(view.getUint16(20, true)).toBe(3);
    expect(view.getUint16(34, true)).toBe(32);
  });

  it("interleaves stereo samples L0 R0 L1 R1 for 32-bit", () => {
    const left = new Float32Array([0.5, -0.5]);
    const right = new Float32Array([1.0, -1.0]);
    const buf = mockBuffer(left, right);
    const view = new DataView(encodeWav(buf, 32));
    expect(view.getFloat32(44, true)).toBeCloseTo(0.5, 5);
    expect(view.getFloat32(48, true)).toBeCloseTo(1.0, 5);
    expect(view.getFloat32(52, true)).toBeCloseTo(-0.5, 5);
    expect(view.getFloat32(56, true)).toBeCloseTo(-1.0, 5);
  });

  it("clips and encodes 16-bit samples correctly", () => {
    const left = new Float32Array([1.0, -1.0]);
    const buf = mockBuffer(left);
    const view = new DataView(encodeWav(buf, 16));
    const l0 = view.getInt16(44, true);
    const l1 = view.getInt16(48, true);
    expect(l0).toBeGreaterThan(30000);
    expect(l1).toBeLessThan(-30000);
  });
});
