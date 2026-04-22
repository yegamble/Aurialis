import { describe, expect, it } from "vitest";
import {
  HALFBAND_TAPS,
  HALFBAND_GROUP_DELAY_SAMPLES,
  upsample2x,
  downsample2x,
  upsample4x,
  downsample4x,
  Halfband2xUpsampler,
  Halfband2xDownsampler,
  Oversampler4x,
} from "../oversampling";

const SAMPLE_RATES = [44100, 48000, 96000];

function sumFloat(arr: Float32Array | number[]): number {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s;
}

function dbMag(x: number, ref: number): number {
  if (x <= 0) return -Infinity;
  return 20 * Math.log10(x / ref);
}

function dftMagAt(signal: Float32Array, omega: number): number {
  let re = 0;
  let im = 0;
  for (let n = 0; n < signal.length; n++) {
    re += signal[n] * Math.cos(omega * n);
    im += signal[n] * Math.sin(omega * n);
  }
  return Math.sqrt(re * re + im * im) * (2 / signal.length);
}

function generateSine(
  freq: number,
  sampleRate: number,
  durSec: number,
  amplitude = 1
): Float32Array {
  const N = Math.round(durSec * sampleRate);
  const out = new Float32Array(N);
  const w = (2 * Math.PI * freq) / sampleRate;
  for (let n = 0; n < N; n++) out[n] = amplitude * Math.sin(w * n);
  return out;
}

describe("HALFBAND_TAPS constant", () => {
  it("has 47 taps", () => {
    expect(HALFBAND_TAPS.length).toBe(47);
  });

  it("has DC gain of 1.0 (sum within 1e-6)", () => {
    const sum = sumFloat(HALFBAND_TAPS);
    expect(Math.abs(sum - 1.0)).toBeLessThan(1e-6);
  });

  it("is symmetric", () => {
    const n = HALFBAND_TAPS.length;
    for (let i = 0; i < Math.floor(n / 2); i++) {
      expect(HALFBAND_TAPS[i]).toBeCloseTo(HALFBAND_TAPS[n - 1 - i], 12);
    }
  });

  it("has halfband property: even-distance non-center taps are zero", () => {
    const center = (HALFBAND_TAPS.length - 1) / 2;
    for (let i = 0; i < HALFBAND_TAPS.length; i++) {
      const k = i - center;
      if (k !== 0 && k % 2 === 0) {
        expect(HALFBAND_TAPS[i]).toBe(0);
      }
    }
  });

  it("has HALFBAND_GROUP_DELAY_SAMPLES === 23 (= (N-1)/2 at fast rate)", () => {
    expect(HALFBAND_GROUP_DELAY_SAMPLES).toBe(23);
  });
});

describe("upsample2x / downsample2x (pure functions)", () => {
  it("upsample2x doubles length", () => {
    const input = new Float32Array(100);
    for (let i = 0; i < 100; i++) input[i] = Math.random() - 0.5;
    const out = upsample2x(input);
    expect(out.length).toBe(200);
  });

  it("downsample2x halves length", () => {
    const input = new Float32Array(200);
    const out = downsample2x(input);
    expect(out.length).toBe(100);
  });

  it("DC passthrough: constant input yields constant output through up2x then down2x", () => {
    const N = 400;
    const input = new Float32Array(N);
    for (let i = 0; i < N; i++) input[i] = 0.5;
    const round = downsample2x(upsample2x(input));

    // Total transient for up2x+down2x at 1x rate ~ HALFBAND_GROUP_DELAY_SAMPLES samples
    // (23 at fast → 11.5 at slow per stage; 2 stages = 23 samples + margin)
    const skip = HALFBAND_GROUP_DELAY_SAMPLES + 24;
    for (let i = skip; i < round.length - skip; i++) {
      expect(Math.abs(round[i] - 0.5)).toBeLessThan(1e-3);
    }
  });
});

describe("upsample4x / downsample4x round-trip", () => {
  for (const sr of SAMPLE_RATES) {
    it(`preserves 1 kHz sine amplitude within 0.3 dB at ${sr} Hz`, () => {
      const input = generateSine(1000, sr, 0.1);
      const upsampled = upsample4x(input);
      expect(upsampled.length).toBe(input.length * 4);
      const round = downsample4x(upsampled);
      expect(round.length).toBe(input.length);

      const skip = 50;
      const inSlice = input.subarray(skip, input.length - skip);
      const outSlice = round.subarray(skip, round.length - skip);
      const inMag = dftMagAt(inSlice, (2 * Math.PI * 1000) / sr);
      const outMag = dftMagAt(outSlice, (2 * Math.PI * 1000) / sr);
      const dbDiff = dbMag(outMag, inMag);
      expect(Math.abs(dbDiff)).toBeLessThan(0.3);
    });
  }

  it("DC passthrough through up4x → down4x", () => {
    const N = 400;
    const input = new Float32Array(N);
    for (let i = 0; i < N; i++) input[i] = 0.3;
    const round = downsample4x(upsample4x(input));
    const skip = 50;
    for (let i = skip; i < round.length - skip; i++) {
      expect(Math.abs(round[i] - 0.3)).toBeLessThan(1e-3);
    }
  });

  it("upsample4x produces 4× length", () => {
    const input = new Float32Array(32);
    const out = upsample4x(input);
    expect(out.length).toBe(128);
  });
});

describe("Stopband rejection", () => {
  it("halfband filter strongly attenuates stopband (transition above π/2)", () => {
    // DFT-based magnitude response check on the taps themselves:
    // At ω = 0: magnitude = 1 (DC gain)
    // At ω = π/2: magnitude = 0.5 (halfband property)
    // At ω = π (Nyquist): magnitude should be very small (< -50 dB)
    const hRaw = Array.from(HALFBAND_TAPS);
    function magAtOmega(omega: number): number {
      let re = 0;
      let im = 0;
      for (let n = 0; n < hRaw.length; n++) {
        re += hRaw[n] * Math.cos(omega * n);
        im += hRaw[n] * Math.sin(omega * n);
      }
      return Math.sqrt(re * re + im * im);
    }
    const magDc = magAtOmega(0);
    const magNyq = magAtOmega(Math.PI);
    const magMid = magAtOmega(Math.PI / 2);

    expect(magDc).toBeCloseTo(1.0, 5);
    expect(magMid).toBeCloseTo(0.5, 3);
    expect(20 * Math.log10(magNyq / magDc)).toBeLessThan(-50);
  });
});

describe("Passband flatness (44.1 kHz)", () => {
  const sr = 44100;
  const testFreqs = [100, 1000, 10000, 18000];
  it.each(testFreqs)(
    "%d Hz preserved within 0.5 dB through up4x→down4x (47-tap halfband gives ≤0.1 dB)",
    (freq) => {
      const input = generateSine(freq, sr, 0.1);
      const round = downsample4x(upsample4x(input));
      const skip = 80;
      const inMag = dftMagAt(
        input.subarray(skip, input.length - skip),
        (2 * Math.PI * freq) / sr
      );
      const outMag = dftMagAt(
        round.subarray(skip, round.length - skip),
        (2 * Math.PI * freq) / sr
      );
      const dbDiff = dbMag(outMag, inMag);
      expect(Math.abs(dbDiff)).toBeLessThan(0.5);
    }
  );
});

describe("Streamed oversampler classes", () => {
  it("Halfband2xUpsampler streamed matches upsample2x batch (after warmup)", () => {
    const N = 512;
    const input = new Float32Array(N);
    for (let i = 0; i < N; i++)
      input[i] = Math.sin((2 * Math.PI * 1000 * i) / 44100);

    const batch = upsample2x(input);

    const upsampler = new Halfband2xUpsampler();
    const streamed = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const pair = upsampler.processSample(input[i]);
      streamed[i * 2] = pair[0];
      streamed[i * 2 + 1] = pair[1];
    }

    const skip = 80;
    const end = Math.min(batch.length, streamed.length) - skip;
    for (let i = skip; i < end; i++) {
      expect(Math.abs(streamed[i] - batch[i])).toBeLessThan(1e-4);
    }
  });

  it("Halfband2xDownsampler streamed matches downsample2x batch (after warmup)", () => {
    const N = 512;
    const input = new Float32Array(N);
    for (let i = 0; i < N; i++)
      input[i] = Math.sin((2 * Math.PI * 1000 * i) / 88200);

    const batch = downsample2x(input);

    const downsampler = new Halfband2xDownsampler();
    const streamed: number[] = [];
    for (let i = 0; i < N; i += 2) {
      const y = downsampler.processPair(input[i], input[i + 1]);
      streamed.push(y);
    }

    const skip = 40;
    const end = Math.min(batch.length, streamed.length) - skip;
    for (let i = skip; i < end; i++) {
      expect(Math.abs(streamed[i] - batch[i])).toBeLessThan(1e-4);
    }
  });

  it("Oversampler4x: silence in → zero out (no NaN) during warmup", () => {
    const os = new Oversampler4x();
    for (let i = 0; i < 100; i++) {
      const upSamples = os.upsample(0);
      expect(upSamples.length).toBe(4);
      for (const s of upSamples) {
        expect(Number.isFinite(s)).toBe(true);
        expect(s).toBe(0);
      }
    }
  });

  it("Oversampler4x: up then down preserves DC after warmup", () => {
    const os = new Oversampler4x();
    const inputs: number[] = [];
    const outputs: number[] = [];
    for (let i = 0; i < 400; i++) {
      inputs.push(0.25);
      const up = os.upsample(0.25);
      const y = os.downsample(up[0], up[1], up[2], up[3]);
      outputs.push(y);
    }
    const skip = 80;
    for (let i = skip; i < outputs.length - 10; i++) {
      expect(Math.abs(outputs[i] - 0.25)).toBeLessThan(1e-3);
    }
  });
});

describe("Pure-fn edge cases", () => {
  it("empty input returns empty output (up2x)", () => {
    const out = upsample2x(new Float32Array(0));
    expect(out.length).toBe(0);
  });

  it("single-sample input does not crash (up2x)", () => {
    const out = upsample2x(new Float32Array([1]));
    expect(out.length).toBe(2);
    for (const s of out) expect(Number.isFinite(s)).toBe(true);
  });
});
