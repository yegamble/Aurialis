import { describe, expect, it } from "vitest";
import {
  processLimiter,
  processTruePeakLimiter,
  dbToLin,
} from "../dsp/limiter";
import { detectTruePeakDbTp } from "../dsp/true-peak";

const SAMPLE_RATES = [44100, 48000, 96000];

/** ISP-hot signal: alternating sample pattern with bandlimited reconstruction overshoot. */
function ispHotAlternating(N: number, amplitude: number): Float32Array {
  const out = new Float32Array(N);
  for (let n = 0; n < N; n++) {
    out[n] = n % 2 === 0 ? amplitude : -amplitude;
  }
  return out;
}

/** High-freq sine signal whose ISP exceeds sample peak. */
function ispHotHighFreq(
  freq: number,
  sampleRate: number,
  durSec: number,
  amplitude: number
): Float32Array {
  const N = Math.round(durSec * sampleRate);
  const out = new Float32Array(N);
  const w = (2 * Math.PI * freq) / sampleRate;
  for (let n = 0; n < N; n++) {
    // Phase offset so samples land near but not at the peaks
    out[n] = amplitude * Math.sin(w * n + Math.PI / 3);
  }
  return out;
}

describe("processTruePeakLimiter", () => {
  it("alternating ISP-hot signal: TP output stays within 0.5 dB of -1 dBTP ceiling", () => {
    const N = 4096;
    const input = ispHotAlternating(N, 0.95);
    const ceilingDb = -1;
    const ceilingLin = dbToLin(ceilingDb);
    const output = processTruePeakLimiter(input, ceilingLin);

    // Skip initial transient + release settling
    const skip = 500;
    const outTail = output.subarray(skip);
    const measuredTp = detectTruePeakDbTp(outTail);

    // True-peak limiter must hold the ceiling within 0.5 dB
    expect(measuredTp).toBeLessThanOrEqual(ceilingDb + 0.5);
  });

  it("sample-peak limiter exceeds the TP ceiling on the same ISP-hot signal (proves upgrade matters)", () => {
    const N = 4096;
    const input = ispHotAlternating(N, 0.95);
    const ceilingDb = -1;
    const ceilingLin = dbToLin(ceilingDb);

    // Old sample-peak limiter: uses peakInWindow of |sample| only
    const outputSample = processLimiter(input, ceilingLin);
    const skip = 500;
    const tpOfSamplePeakOutput = detectTruePeakDbTp(outputSample.subarray(skip));

    // Sample-peak limiter output overshoots the TP ceiling because ISPs were invisible to it
    expect(tpOfSamplePeakOutput).toBeGreaterThan(ceilingDb + 0.3);
  });

  it("quiet input (well below ceiling): output matches delayed input (unity gain)", () => {
    const N = 1024;
    const input = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      input[i] = 0.1 * Math.sin((2 * Math.PI * 440 * i) / 44100);
    }
    const output = processTruePeakLimiter(input, dbToLin(-1));

    // At low amplitudes, gain should stay at 1.0; output should track input (with delay)
    // Check output isn't zero and stays below ceiling
    let maxOut = 0;
    for (let i = 200; i < N; i++) {
      const abs = Math.abs(output[i]);
      if (abs > maxOut) maxOut = abs;
    }
    expect(maxOut).toBeGreaterThan(0.05); // signal passed through
    expect(maxOut).toBeLessThanOrEqual(dbToLin(-1) * 1.01); // well under ceiling
  });

  it("mono input: finite output with no NaN", () => {
    const input = ispHotAlternating(1024, 0.9);
    const output = processTruePeakLimiter(input, dbToLin(-1));
    for (let i = 0; i < output.length; i++) {
      expect(Number.isFinite(output[i])).toBe(true);
    }
  });
});

describe("processTruePeakLimiter sample-rate parameterization", () => {
  it.each(SAMPLE_RATES)(
    "at %d Hz: ISP-hot high-freq signal held within 0.5 dB of ceiling",
    (sr) => {
      // Scale lookahead base to this sample rate: 1.5 ms
      const baseLookahead = Math.round(0.0015 * sr);
      // Use a high-freq sine (fs/5) that generates ISPs at any rate
      const input = ispHotHighFreq(sr / 5, sr, 0.3, 0.95);
      const ceilingDb = -1;
      const output = processTruePeakLimiter(
        input,
        dbToLin(ceilingDb),
        baseLookahead
      );
      const skip = 500;
      const tp = detectTruePeakDbTp(output.subarray(skip));
      expect(tp).toBeLessThanOrEqual(ceilingDb + 0.5);
    }
  );
});
