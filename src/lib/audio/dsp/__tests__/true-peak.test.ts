import { describe, expect, it } from "vitest";
import { detectTruePeakDbTp, TruePeakDetector } from "../true-peak";
import { HALFBAND_4X_GROUP_DELAY_1X } from "../oversampling";

const SAMPLE_RATES = [44100, 48000, 96000];

/**
 * Construct an ISP-hot signal: an alternating square-like pattern at Nyquist
 * rate scaled by amplitude. The bandlimited reconstruction of such a signal
 * produces inter-sample peaks up to ~4/π ≈ 1.27× the sample amplitude (for
 * infinite duration — finite duration gives slightly less).
 */
function generateIspHotAlternating(N: number, amplitude: number): Float32Array {
  const out = new Float32Array(N);
  for (let n = 0; n < N; n++) {
    out[n] = n % 2 === 0 ? amplitude : -amplitude;
  }
  return out;
}

function samplePeak(signal: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < signal.length; i++) {
    const abs = Math.abs(signal[i]);
    if (abs > peak) peak = abs;
  }
  return peak;
}

describe("detectTruePeakDbTp — ISP detection", () => {
  it("smooth low-freq signal: true peak ≈ sample peak", () => {
    const N = 1024;
    const signal = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      signal[i] = 0.5 * Math.sin((2 * Math.PI * 100 * i) / 44100);
    }
    const spDb = 20 * Math.log10(samplePeak(signal));
    const tpDb = detectTruePeakDbTp(signal);
    expect(Math.abs(tpDb - spDb)).toBeLessThan(0.5);
  });

  it("alternating Nyquist-rate signal: true peak > sample peak by ≥1 dB", () => {
    // Sample peak = amplitude; true peak approaches 4/π·amplitude ≈ 1.27× for long buffers
    // → dBTP - dBFS ≈ 20·log10(4/π) ≈ 2.1 dB
    const signal = generateIspHotAlternating(512, 0.5);
    const spDb = 20 * Math.log10(samplePeak(signal));
    const tpDb = detectTruePeakDbTp(signal);
    expect(tpDb).toBeGreaterThan(spDb);
    expect(tpDb - spDb).toBeGreaterThan(1.0);
  });

  it("DC input: offline TP is close to |DC| (bounded above by ~15% overshoot from step onset)", () => {
    // The upsample filter WILL overshoot the 0→DC step at buffer start (Gibbs),
    // by ~10-15% for Kaiser β=8. This is expected and inherent to ANY linear-phase
    // FIR oversampler. The test confirms: (a) TP is at least as high as |DC|,
    // (b) overshoot is bounded to a reasonable FIR ringing amount.
    const signal = new Float32Array(1024).fill(0.3);
    const tpDb = detectTruePeakDbTp(signal);
    const expectedDc = 20 * Math.log10(0.3);
    // TP must be >= DC (never under-reports)
    expect(tpDb).toBeGreaterThanOrEqual(expectedDc - 0.01);
    // Overshoot from the startup step is bounded (<2 dB for Kaiser β=8)
    expect(tpDb - expectedDc).toBeLessThan(2.0);
  });

  it("silent signal: returns -Infinity", () => {
    const signal = new Float32Array(128);
    const tpDb = detectTruePeakDbTp(signal);
    expect(tpDb).toBe(-Infinity);
  });
});

describe("TruePeakDetector streaming", () => {
  it("running peak matches offline detection within 0.5 dB on ISP-hot signal", () => {
    const signal = generateIspHotAlternating(512, 0.5);
    const offlineDb = detectTruePeakDbTp(signal);

    const det = new TruePeakDetector();
    for (let i = 0; i < signal.length; i++) {
      det.processSample(signal[i]);
    }
    const streamedDb = det.peakDbTp;

    expect(Math.abs(streamedDb - offlineDb)).toBeLessThan(0.5);
  });

  it("reset() zeros running peak", () => {
    const det = new TruePeakDetector();
    for (let i = 0; i < 100; i++) det.processSample(0.5);
    expect(det.peak).toBeGreaterThan(0);
    det.reset();
    expect(det.peak).toBe(0);
    expect(det.peakDbTp).toBe(-Infinity);
  });

  it("mono single-sample input produces finite output (no NaN)", () => {
    const det = new TruePeakDetector();
    for (let i = 0; i < 200; i++) {
      const v = det.processSample(Math.sin(i * 0.5));
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe("Sample-rate parameterization", () => {
  it.each(SAMPLE_RATES)("at %d Hz: alternating ISP-hot signal TP > sample peak", (sr) => {
    void sr; // sample rate doesn't affect this specific test since we use raw sample patterns
    const signal = generateIspHotAlternating(512, 0.5);
    const spDb = 20 * Math.log10(samplePeak(signal));
    const tpDb = detectTruePeakDbTp(signal);
    expect(tpDb).toBeGreaterThan(spDb);
  });
});

describe("Group delay compensation constant", () => {
  it("HALFBAND_4X_GROUP_DELAY_1X is 18 (ceil(11.5 + 5.75))", () => {
    expect(HALFBAND_4X_GROUP_DELAY_1X).toBe(18);
  });
});
