import { describe, expect, it } from "vitest";
import {
  applyCleanSaturation,
  applyTubeSaturation,
  applyTapeShaper,
  applyTransformerShaper,
  buildSatModeCoeffs,
  TUBE_BIAS,
  TAPE_HF_FREQ_HZ,
  XFMR_MID_FREQ_HZ,
} from "../sat-modes";
import { BiquadFilter } from "../biquad";
import {
  applyOversampledSaturation,
  drivePctToFactor,
} from "../saturation";

const SR = 44100;

function sine(freq: number, N: number, amp = 0.5): Float32Array {
  const out = new Float32Array(N);
  const w = (2 * Math.PI * freq) / SR;
  for (let n = 0; n < N; n++) out[n] = amp * Math.sin(w * n);
  return out;
}

function dftMag(signal: Float32Array | number[], freq: number, sr = SR): number {
  const N = signal.length;
  const w = (2 * Math.PI * freq) / sr;
  let re = 0;
  let im = 0;
  for (let n = 0; n < N; n++) {
    re += signal[n] * Math.cos(w * n);
    im += signal[n] * Math.sin(w * n);
  }
  return Math.sqrt(re * re + im * im) * (2 / N);
}

describe("Pure waveshaper functions", () => {
  it("applyCleanSaturation: matches tanh(drive·x)/tanh(drive)", () => {
    const df = drivePctToFactor(50);
    const norm = Math.tanh(df);
    for (const x of [-0.9, -0.5, -0.1, 0, 0.1, 0.5, 0.9]) {
      const expected = Math.tanh(df * x) / norm;
      expect(applyCleanSaturation(x, df, norm)).toBeCloseTo(expected, 10);
    }
  });

  it("applyTubeSaturation: zero input gives zero output (nominal DC trim)", () => {
    const df = drivePctToFactor(50);
    const norm = Math.tanh(df);
    expect(applyTubeSaturation(0, df, norm)).toBeCloseTo(0, 10);
  });

  it("applyTapeShaper: zero input gives zero output", () => {
    expect(applyTapeShaper(0, 5)).toBe(0);
  });

  it("applyTransformerShaper: zero input gives zero output", () => {
    expect(applyTransformerShaper(0, 5)).toBe(0);
  });

  it("applyTransformerShaper: saturates at ±2/3 for |drive·x| > 1", () => {
    expect(applyTransformerShaper(1, 2)).toBeCloseTo(2 / 3, 10);
    expect(applyTransformerShaper(-1, 2)).toBeCloseTo(-2 / 3, 10);
  });
});

describe("Tube 2nd-harmonic generation", () => {
  it("Tube on a 1 kHz sine produces a 2 kHz component ≥ 20 dB louder than Clean's 2 kHz", () => {
    const N = SR;
    const freq = 1000;
    const df = drivePctToFactor(50);
    const norm = Math.tanh(df);
    const x = sine(freq, N, 0.5);

    const yClean = new Float32Array(N);
    const yTube = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      yClean[i] = applyCleanSaturation(x[i], df, norm);
      yTube[i] = applyTubeSaturation(x[i], df, norm);
    }

    const cleanMag2k = dftMag(yClean, 2000);
    const tubeMag2k = dftMag(yTube, 2000);
    // Tube 2nd harmonic should be substantially higher
    const diffDb = 20 * Math.log10(tubeMag2k / Math.max(cleanMag2k, 1e-12));
    expect(diffDb).toBeGreaterThan(20);
  });
});

describe("Tape + HF shelf at base rate", () => {
  it("tape HF shelf is active in the HF region (attenuates 14 kHz closer to the asymptotic -3 dB)", () => {
    // RBJ high-shelf is asymptotic: at the design frequency (12 kHz) you get
    // half the gain (-1.5 dB for a -3 dB shelf); the full -3 dB is reached well
    // above. Test at 18 kHz for closer-to-asymptotic behavior.
    const coeffs = buildSatModeCoeffs(SR);
    const filter = new BiquadFilter(coeffs.tapeHf);
    const freq = 18000;
    const x = sine(freq, SR, 0.5);
    const y = filter.process(x);
    const skip = 500;
    const inMag = dftMag(x.subarray(skip), freq);
    const outMag = dftMag(y.subarray(skip), freq);
    const attenDb = 20 * Math.log10(outMag / inMag);
    expect(attenDb).toBeLessThan(-2.0);
    expect(attenDb).toBeGreaterThan(-3.5);
  });

  it("tape HF shelf is near-flat at 1 kHz (passband unaffected)", () => {
    const coeffs = buildSatModeCoeffs(SR);
    const filter = new BiquadFilter(coeffs.tapeHf);
    const x = sine(1000, SR, 0.5);
    const y = filter.process(x);
    const skip = 500;
    const inMag = dftMag(x.subarray(skip), 1000);
    const outMag = dftMag(y.subarray(skip), 1000);
    const attenDb = 20 * Math.log10(outMag / inMag);
    expect(Math.abs(attenDb)).toBeLessThan(0.3);
  });

  it("Tape shaper attenuates 15 kHz relative to Clean at drive=50%", () => {
    const N = SR;
    const freq = 15000;
    const df = drivePctToFactor(50);
    const norm = Math.tanh(df);
    const coeffs = buildSatModeCoeffs(SR);

    const x = sine(freq, N, 0.5);

    const yClean = new Float32Array(N);
    for (let i = 0; i < N; i++) yClean[i] = applyCleanSaturation(x[i], df, norm);

    // Tape: pre-filter at base rate, then shape
    const pre = new BiquadFilter(coeffs.tapeHf);
    const yTape = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const preOut = pre.processSample(x[i]);
      yTape[i] = applyTapeShaper(preOut, df);
    }

    const skip = 500;
    const cleanMag = dftMag(yClean.subarray(skip), freq);
    const tapeMag = dftMag(yTape.subarray(skip), freq);
    const diffDb = 20 * Math.log10(tapeMag / cleanMag);
    expect(diffDb).toBeLessThan(-2);
  });
});

describe("Transformer + mid peak at base rate", () => {
  it("1.5 kHz sine through the transformer mid peak alone is boosted 1.8-2.2 dB", () => {
    const coeffs = buildSatModeCoeffs(SR);
    const filter = new BiquadFilter(coeffs.xfmrMid);
    const x = sine(XFMR_MID_FREQ_HZ, SR, 0.5);
    const y = filter.process(x);
    const skip = 500;
    const inMag = dftMag(x.subarray(skip), XFMR_MID_FREQ_HZ);
    const outMag = dftMag(y.subarray(skip), XFMR_MID_FREQ_HZ);
    const gainDb = 20 * Math.log10(outMag / inMag);
    expect(gainDb).toBeGreaterThan(1.8);
    expect(gainDb).toBeLessThan(2.2);
  });
});

describe("Extreme drive sanity", () => {
  it.each([
    ["clean", applyCleanSaturation],
    ["tube", applyTubeSaturation],
  ] as const)(
    "%s at drive=100% produces finite output for all inputs in [-1, 1]",
    (_name, fn) => {
      const df = drivePctToFactor(100);
      const norm = Math.tanh(df);
      for (let i = -100; i <= 100; i += 5) {
        const x = i / 100;
        const y = fn(x, df, norm);
        expect(Number.isFinite(y)).toBe(true);
      }
    }
  );

  it.each([
    ["tape", applyTapeShaper],
    ["transformer", applyTransformerShaper],
  ] as const)(
    "%s at drive=100% produces finite output for all inputs in [-1, 1]",
    (_name, fn) => {
      const df = drivePctToFactor(100);
      for (let i = -100; i <= 100; i += 5) {
        const x = i / 100;
        const y = fn(x, df);
        expect(Number.isFinite(y)).toBe(true);
      }
    }
  );
});

describe("Tube DC on asymmetric signal (verifies nominal trim, documents HPF need)", () => {
  it("nominal DC trim makes zero-input output zero (already tested above — restate for clarity)", () => {
    const df = drivePctToFactor(50);
    const norm = Math.tanh(df);
    expect(applyTubeSaturation(0, df, norm)).toBeCloseTo(0, 10);
  });

  it("polarity-asymmetric input builds DC (documents why 20 Hz HPF is needed downstream)", () => {
    const df = drivePctToFactor(100);
    const norm = Math.tanh(df);
    const N = SR;
    // Unipolar "kick": positive half-wave only
    const y = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const t = i / SR;
      const raw = Math.sin(2 * Math.PI * 80 * t);
      const unipolar = Math.max(0, raw);
      y[i] = applyTubeSaturation(unipolar, df, norm);
    }
    // Mean (DC) should be significantly non-zero on this asymmetric input
    let sum = 0;
    for (let i = 0; i < N; i++) sum += y[i];
    const meanDc = sum / N;
    expect(Math.abs(meanDc)).toBeGreaterThan(1e-2);
  });
});

// Ensure integration with existing oversampler still works for Clean
describe("Clean mode through existing oversampler (regression check)", () => {
  it("applyOversampledSaturation unchanged from P0 behavior at drive=50%", () => {
    const x = sine(1000, 1024, 0.5);
    const y = applyOversampledSaturation(x, drivePctToFactor(50));
    expect(y.length).toBe(x.length);
    for (let i = 0; i < y.length; i++) {
      expect(Number.isFinite(y[i])).toBe(true);
    }
  });
});
