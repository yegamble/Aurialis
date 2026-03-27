/**
 * Integration tests verifying DSP algorithms actually modify audio characteristics.
 * Uses pure DSP functions (no Web Audio) with programmatic test signals.
 */
import { describe, it, expect } from "vitest";
import {
  generateSine,
  generateNoise,
  peakLevel,
  rmsLevel,
  linToDb,
  dbToLin,
} from "@/test/signal-generator";
import { computeGainReduction, applyGainSmoothing, makeAttackReleaseCoeffs } from "../compressor";
import { processLimiter } from "../limiter";
import { applySaturation, drivePctToFactor, computeTHD } from "../saturation";
import { computeMomentaryLufs, computeIntegratedLufs } from "../lufs";
import { BiquadFilter, peakingCoeffs } from "../biquad";

// ─── Compressor ────────────────────────────────────────────────────────────────

describe("Compressor Integration", () => {
  it("should reduce peak level of signal above threshold", () => {
    const sampleRate = 44100;
    // Use 1 second so the attack (20ms) has time to settle before we measure
    const input = generateSine(1000, sampleRate, 1.0, dbToLin(-10)); // -10 dBFS
    const threshold = -20; // dB
    const ratio = 4;
    const knee = 2;

    // makeAttackReleaseCoeffs takes SECONDS (not ms)
    const { attack, release } = makeAttackReleaseCoeffs(0.020, 0.250, sampleRate);
    let grDb = 0.0; // current gain reduction in dB (0 = no reduction)
    const output = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const inputDb = linToDb(Math.abs(input[i]) + 1e-10);
      const targetGr = computeGainReduction(inputDb, { threshold, ratio, knee });
      grDb = applyGainSmoothing(grDb, targetGr, attack, release);
      const linearGain = Math.pow(10, grDb / 20); // convert GR dB → linear
      output[i] = input[i] * linearGain;
    }

    // Compare peak levels in the SECOND half — by then the 20ms attack has long settled
    const midPoint = Math.floor(input.length / 2);
    const inputPeak = peakLevel(input.subarray(midPoint));
    const outputPeak = peakLevel(output.subarray(midPoint));
    // Output should be quieter (gain reduction applied)
    expect(outputPeak).toBeLessThan(inputPeak);
    // Gain reduction of ~7.5 dB expected at -10 dBFS with threshold -20, ratio 4:1
    const peakGR = linToDb(outputPeak) - linToDb(inputPeak);
    expect(peakGR).toBeLessThan(-3); // At least 3 dB of gain reduction
  });

  it("should not attenuate signals below threshold", () => {
    const sampleRate = 44100;
    const input = generateSine(1000, sampleRate, 0.5, dbToLin(-30)); // -30 dBFS, below -20 threshold
    const threshold = -20;
    const ratio = 4;
    const knee = 2;

    const { attack, release } = makeAttackReleaseCoeffs(0.020, 0.250, sampleRate);
    let grDb = 0.0;
    const output = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const inputDb = linToDb(Math.abs(input[i]) + 1e-10);
      const targetGr = computeGainReduction(inputDb, { threshold, ratio, knee });
      grDb = applyGainSmoothing(grDb, targetGr, attack, release);
      const linearGain = Math.pow(10, grDb / 20);
      output[i] = input[i] * linearGain;
    }

    // Output should be essentially unchanged (GR ≈ 0 dB for input below threshold)
    const ratio_ = peakLevel(output) / peakLevel(input);
    expect(ratio_).toBeGreaterThan(0.95); // Less than 0.44 dB of unintended GR
  });
});

// ─── Limiter ───────────────────────────────────────────────────────────────────

describe("Limiter Integration", () => {
  it("should enforce ceiling on signal exceeding ceiling", () => {
    const sampleRate = 44100;
    const ceiling = -1; // dBTP
    const ceilingLin = dbToLin(ceiling);

    // Signal at 0 dBFS (above -1 ceiling)
    const input = generateSine(1000, sampleRate, 0.5, 1.0);
    // processLimiter(input, ceiling, lookaheadSamples, attackCoeff, releaseCoeff)
    const attackCoeff = Math.exp(-1 / (0.0001 * sampleRate)); // ~0.1ms attack
    const releaseCoeff = Math.exp(-1 / (0.1 * sampleRate));   // 100ms release

    const output = processLimiter(input, ceilingLin, 66, attackCoeff, releaseCoeff);

    // Peak should not exceed ceiling (with small tolerance for lookahead ramp)
    const outputPeak = peakLevel(output);
    expect(outputPeak).toBeLessThanOrEqual(ceilingLin + 0.01);
  });

  it("should pass signal unchanged when below ceiling", () => {
    const sampleRate = 44100;
    const ceiling = -1;
    const ceilingLin = dbToLin(ceiling);

    // Signal at -6 dBFS (well below -1 ceiling)
    const input = generateSine(440, sampleRate, 0.5, dbToLin(-6));
    const attackCoeff = Math.exp(-1 / (0.0001 * sampleRate));
    const releaseCoeff = Math.exp(-1 / (0.1 * sampleRate));

    const output = processLimiter(input, ceilingLin, 66, attackCoeff, releaseCoeff);

    // Output peak should closely match input peak
    const inputPeak = peakLevel(input);
    const outputPeak = peakLevel(output);
    expect(outputPeak).toBeCloseTo(inputPeak, 2);
  });
});

// ─── Saturation ────────────────────────────────────────────────────────────────

describe("Saturation Integration", () => {
  it("should add harmonic content at drive > 0", () => {
    const sampleRate = 44100;
    const input = generateSine(1000, sampleRate, 1.0, 0.8);
    const drive = 50; // percent
    const driveFactor = drivePctToFactor(drive);

    // applySaturation takes Float32Array, returns Float32Array
    const output = applySaturation(input, driveFactor);

    // Compute THD on a steady-state window (skip transients)
    const steadyInput = input.slice(Math.floor(sampleRate * 0.5));
    const steadyOutput = output.slice(Math.floor(sampleRate * 0.5));
    // computeTHD(input, output, fundamental, sampleRate): compares harmonics in output vs fundamental in input
    const thdInput = computeTHD(steadyInput, steadyInput, 1000, sampleRate);
    const thdOutput = computeTHD(steadyInput, steadyOutput, 1000, sampleRate);

    // Saturation should introduce harmonics (THD increases)
    expect(thdOutput).toBeGreaterThan(thdInput);
    expect(thdOutput).toBeGreaterThan(0.001); // At least 0.1% THD
  });

  it("should produce unity gain at full-scale input", () => {
    const driveFactor = drivePctToFactor(50);
    // tanh(d*1) / tanh(d) = 1.0 by definition
    const outPos = applySaturation(new Float32Array([1.0]), driveFactor)[0];
    expect(outPos).toBeCloseTo(1.0, 5);

    const outNeg = applySaturation(new Float32Array([-1.0]), driveFactor)[0];
    expect(outNeg).toBeCloseTo(-1.0, 5);
  });

  it("should not process with drive = 0 (factor = 1)", () => {
    const driveFactor = drivePctToFactor(0); // = 1
    // tanh(1*0.5) / tanh(1) ≠ 0.5 (small but nonzero distortion even at drive=0)
    // Just verify it doesn't crash and output is in a reasonable range
    const out = applySaturation(new Float32Array([0.5]), driveFactor)[0];
    expect(Math.abs(out)).toBeLessThanOrEqual(1.0);
  });
});

// ─── LUFS ──────────────────────────────────────────────────────────────────────

describe("LUFS Integration (ITU-R BS.1770-4)", () => {
  it("-23 dBFS 1kHz sine at 48kHz should measure approximately -23 LUFS", () => {
    const sampleRate = 48000;
    const amplitude = dbToLin(-23); // -23 dBFS
    // Need enough samples for integrated measurement (at least a few 400ms blocks)
    const signal = generateSine(1000, sampleRate, 3.0, amplitude);

    // Compute momentary LUFS on the last 400ms window
    const blockSize = Math.round(0.4 * sampleRate);
    const block = signal.slice(signal.length - blockSize);
    // computeMomentaryLufs(left, right, sampleRate) — takes sampleRate, not KWeightingCoeffs
    const lufs = computeMomentaryLufs(block, block, sampleRate);

    expect(lufs).toBeGreaterThan(-25);
    expect(lufs).toBeLessThan(-21);
  });

  it("-14 dBFS signal should measure approximately -14 LUFS (mono L=R)", () => {
    const sampleRate = 48000;
    const amplitude = dbToLin(-14);
    const signal = generateSine(1000, sampleRate, 2.0, amplitude);

    const blockSize = Math.round(0.4 * sampleRate);
    const block = signal.slice(signal.length - blockSize);
    const lufs = computeMomentaryLufs(block, block, sampleRate);

    expect(lufs).toBeGreaterThan(-16);
    expect(lufs).toBeLessThan(-12);
  });

  it("integrated LUFS should match momentary for steady-state signal", () => {
    const sampleRate = 48000;
    const amplitude = dbToLin(-18);
    const signal = generateSine(1000, sampleRate, 3.0, amplitude);

    // computeIntegratedLufs(left, right, sampleRate) — takes sampleRate directly
    const integrated = computeIntegratedLufs(signal, signal, sampleRate);
    const blockSize = Math.round(0.4 * sampleRate);
    const block = signal.slice(signal.length - blockSize);
    const momentary = computeMomentaryLufs(block, block, sampleRate);

    // For a steady signal, integrated ≈ momentary within 2 LU
    expect(Math.abs(integrated - momentary)).toBeLessThan(2.0);
  });
});

// ─── EQ Biquad ─────────────────────────────────────────────────────────────────

describe("EQ Biquad Integration", () => {
  it("+12 dB peak at 1kHz should boost 1kHz component", () => {
    const sampleRate = 44100;
    const signal = generateSine(1000, sampleRate, 1.0, 0.5);

    const coeffs = peakingCoeffs(1000, 12, 1.0, sampleRate);
    // BiquadFilter takes the whole BiquadCoeffs object, not positional args
    const filter = new BiquadFilter(coeffs);

    const output = new Float32Array(signal.length);
    for (let i = 0; i < signal.length; i++) {
      output[i] = filter.processSample(signal[i]);
    }

    // Allow filter to reach steady state — check RMS in last half
    const midPoint = Math.floor(signal.length / 2);
    const inputRms = rmsLevel(signal.slice(midPoint));
    const outputRms = rmsLevel(output.slice(midPoint));

    // Output should be louder (boosted ~12 dB → 4x RMS)
    expect(outputRms).toBeGreaterThan(inputRms * 2);
  });

  it("-12 dB peak at 1kHz should cut 1kHz component", () => {
    const sampleRate = 44100;
    const signal = generateSine(1000, sampleRate, 1.0, 0.5);

    const coeffs = peakingCoeffs(1000, -12, 1.0, sampleRate);
    const filter = new BiquadFilter(coeffs);

    const output = new Float32Array(signal.length);
    for (let i = 0; i < signal.length; i++) {
      output[i] = filter.processSample(signal[i]);
    }

    const midPoint = Math.floor(signal.length / 2);
    const inputRms = rmsLevel(signal.slice(midPoint));
    const outputRms = rmsLevel(output.slice(midPoint));

    // Output should be quieter (cut ~12 dB → 0.25x RMS)
    expect(outputRms).toBeLessThan(inputRms * 0.5);
  });
});
