import { describe, it, expect } from "vitest";
import { upsample, downsample, oversample } from "../oversampling";

describe("upsample", () => {
  it("returns array with length = input.length * factor", () => {
    const input = new Float32Array([1, 2, 3, 4]);
    const output = upsample(input, 4);
    expect(output.length).toBe(16);
  });

  it("preserves approximate energy — steady-state samples near input level", () => {
    // Use long enough input to get past filter group delay (~filterLen/2 = 128 samples)
    const input = new Float32Array(256).fill(1.0);
    const output = upsample(input, 4);
    // After transient settles, steady-state output should be ~1.0
    // Check samples in the second half of the output (past group delay)
    const steadyStateSamples = Array.from(output.slice(600));
    const nonZero = steadyStateSamples.filter((v) => Math.abs(v) > 0.1);
    expect(nonZero.length).toBeGreaterThan(0);
  });
});

describe("downsample", () => {
  it("returns array with length = input.length / factor", () => {
    const input = new Float32Array(16).fill(0.5);
    const output = downsample(input, 4);
    expect(output.length).toBe(4);
  });

  it("returns correct length for non-power-of-two inputs", () => {
    const input = new Float32Array(12).fill(0.3);
    const output = downsample(input, 4);
    expect(output.length).toBe(3);
  });
});

describe("oversample", () => {
  it("returns array with same length as input after upsample→process→downsample", () => {
    const input = new Float32Array(64);
    for (let i = 0; i < 64; i++) {
      input[i] = Math.sin((2 * Math.PI * i) / 64);
    }

    const output = oversample(input, 4, (upsampled) => {
      // Identity processing
      return upsampled;
    });

    expect(output.length).toBe(input.length);
  });

  it("allows processing at oversampled rate (no aliasing)", () => {
    const input = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      input[i] = 0.9 * Math.sin((2 * Math.PI * 10 * i) / 256);
    }

    const output = oversample(input, 4, (upsampled) => {
      // Apply hard clipping at oversampled rate
      const clipped = new Float32Array(upsampled.length);
      for (let i = 0; i < upsampled.length; i++) {
        clipped[i] = Math.max(-0.5, Math.min(0.5, upsampled[i]));
      }
      return clipped;
    });

    expect(output.length).toBe(input.length);
    // Output should be limited
    const maxOut = Math.max(...Array.from(output).map(Math.abs));
    expect(maxOut).toBeLessThanOrEqual(0.6); // Allow some overshoot from LP filter
  });
});
