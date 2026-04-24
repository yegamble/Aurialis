/**
 * renderOffline × ParametricEqDSP — validates the inline EQ step that replaced
 * the BiquadFilterNode chain inside OfflineAudioContext (P3).
 *
 * Unlike `renderer.test.ts`, these tests inject a real signal via the
 * OfflineAudioContext mock (startRendering returns our test buffer) and then
 * compare the rendered output against ParametricEqDSP applied to the same
 * input — they must agree bit-for-bit (inside the renderer's tolerance).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderOffline } from "../renderer";
import { DEFAULT_PARAMS, GENRE_PRESETS } from "../presets";
import {
  ParametricEqDSP,
  bandsFromAudioParams,
} from "../dsp/parametric-eq";
import type { AudioParams } from "@/types/mastering";

function sine(amp: number, freq: number, n: number, sr: number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr);
  return out;
}

function mockBuffer(channels: Float32Array[], sr = 44100): AudioBuffer {
  return {
    numberOfChannels: channels.length,
    length: channels[0].length,
    sampleRate: sr,
    duration: channels[0].length / sr,
    getChannelData: (ch: number) => channels[ch],
    copyFromChannel: () => {},
    copyToChannel: () => {},
  } as unknown as AudioBuffer;
}

const OriginalOAC = globalThis.OfflineAudioContext;

function installPassthroughOAC(channels: Float32Array[]): void {
  const sr = 44100;
  const CustomOAC = class {
    numberOfChannels: number;
    length: number;
    sampleRate: number;
    destination = {};
    audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
    constructor(numCh: number, len: number, sampleRate: number) {
      this.numberOfChannels = numCh;
      this.length = len;
      this.sampleRate = sampleRate;
    }
    createGain() {
      return {
        gain: { value: 1, linearRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
    }
    createBufferSource() {
      return { buffer: null, connect: vi.fn(), start: vi.fn() };
    }
    async startRendering() {
      const rendered = channels.map((c) => new Float32Array(c));
      return {
        duration: rendered[0].length / sr,
        length: rendered[0].length,
        numberOfChannels: rendered.length,
        sampleRate: sr,
        getChannelData: (ch: number) => rendered[ch],
      };
    }
  };
  Object.defineProperty(globalThis, "OfflineAudioContext", {
    value: CustomOAC,
    writable: true,
  });
}

afterEach(() => {
  Object.defineProperty(globalThis, "OfflineAudioContext", {
    value: OriginalOAC,
    writable: true,
  });
});

/**
 * Compute the reference output: apply ParametricEqDSP directly to the same
 * signal, then mimic the default mastering chain passthrough (compressor/
 * saturation/limiter are neutral at DEFAULT_PARAMS, so their DSPs are ~idle).
 * For parity we only compare the EQ stage against the reference.
 */
function applyDspRef(
  L: Float32Array,
  R: Float32Array,
  params: AudioParams,
  sr: number,
): { L: Float32Array; R: Float32Array } {
  const dsp = new ParametricEqDSP(sr);
  const outL = new Float32Array(L);
  const outR = new Float32Array(R);
  dsp.processStereo(outL, outR, bandsFromAudioParams(params), {
    left: outL,
    right: outR,
  });
  return { L: outL, R: outR };
}

describe("renderOffline — parametric EQ", () => {
  it("parametricEqEnabled=0 leaves the rendered buffer bit-exact to the OAC output", async () => {
    const L = sine(0.4, 100, 44100, 44100);
    const R = sine(0.4, 100, 44100, 44100);
    installPassthroughOAC([L, R]);

    const src = mockBuffer([L.slice(), R.slice()]);
    // Non-trivial gains that would produce an audible effect if EQ ran.
    const params: AudioParams = {
      ...DEFAULT_PARAMS,
      parametricEqEnabled: 0,
      eq80: 12,
      eq1k: -12,
      threshold: 0,
      ratio: 1,
      ceiling: 0,
    };
    const result = await renderOffline(src, params, 44100);
    const outL = result.getChannelData(0);

    // With EQ bypassed and compressor/limiter at unity, the rendered output
    // should match the injected signal to the precision of the limiter
    // fixed-point attack (a few samples of transient, then steady state).
    // Check a steady-state window well past any transient.
    const startIdx = 1024;
    let maxDiff = 0;
    for (let i = startIdx; i < L.length - 1024; i++) {
      const d = Math.abs(outL[i] - L[i]);
      if (d > maxDiff) maxDiff = d;
    }
    expect(maxDiff).toBeLessThan(1e-4);
  });

  it("applies a bell boost when eq250 is set", async () => {
    const L = sine(0.3, 250, 44100, 44100);
    const R = sine(0.3, 250, 44100, 44100);
    installPassthroughOAC([L, R]);
    const src = mockBuffer([L.slice(), R.slice()]);

    const flat: AudioParams = {
      ...DEFAULT_PARAMS,
      threshold: 0,
      ratio: 1,
      ceiling: 0,
    };
    const boosted: AudioParams = { ...flat, eq250: 9 };

    const flatOut = (await renderOffline(src, flat, 44100)).getChannelData(0);
    // Re-install a fresh passthrough OAC for the second render (startRendering
    // returns cloned buffers each call, but the signal source is shared).
    installPassthroughOAC([L, R]);
    const src2 = mockBuffer([L.slice(), R.slice()]);
    const boostedOut = (await renderOffline(src2, boosted, 44100)).getChannelData(0);

    // Steady-state RMS of the boosted output must exceed flat by > 3 dB.
    const startIdx = 8192;
    let flatE = 0;
    let boostE = 0;
    for (let i = startIdx; i < flatOut.length; i++) {
      flatE += flatOut[i] * flatOut[i];
      boostE += boostedOut[i] * boostedOut[i];
    }
    const flatRms = Math.sqrt(flatE / (flatOut.length - startIdx));
    const boostRms = Math.sqrt(boostE / (boostedOut.length - startIdx));
    const dB = 20 * Math.log10(boostRms / flatRms);
    expect(dB).toBeGreaterThan(3);
  });

  it("DEFAULT_PARAMS leaves a signal numerically equivalent to the DSP reference EQ path", async () => {
    const L = sine(0.25, 440, 44100, 44100);
    const R = sine(0.25, 440, 44100, 44100);
    installPassthroughOAC([L, R]);
    const src = mockBuffer([L.slice(), R.slice()]);

    // Keep compressor/limiter off so we compare only the EQ stage.
    const params: AudioParams = {
      ...DEFAULT_PARAMS,
      threshold: 0,
      ratio: 1,
      ceiling: 0,
    };
    const result = await renderOffline(src, params, 44100);
    const ref = applyDspRef(L, R, params, 44100);

    // Skip a small startup window (limiter has a short lookahead delay).
    const startIdx = 2048;
    let maxDiff = 0;
    for (let i = startIdx; i < L.length - 2048; i++) {
      const d = Math.abs(result.getChannelData(0)[i] - ref.L[i]);
      if (d > maxDiff) maxDiff = d;
    }
    expect(maxDiff).toBeLessThan(5e-4);
  });

  it.each([
    "rnb" as const,
    "classical" as const,
    "podcast" as const,
  ])("%s genre preset produces a finite, non-silent rendered buffer", async (genre) => {
    const L = sine(0.2, 500, 22050, 44100);
    const R = sine(0.2, 500, 22050, 44100);
    installPassthroughOAC([L, R]);
    const src = mockBuffer([L.slice(), R.slice()]);

    const preset = GENRE_PRESETS[genre];
    const result = await renderOffline(src, preset, 44100);
    const out = result.getChannelData(0);

    // Finite (no NaN, no Inf) and not all-zero.
    let nonZero = 0;
    for (let i = 0; i < out.length; i++) {
      expect(Number.isFinite(out[i])).toBe(true);
      if (Math.abs(out[i]) > 1e-4) nonZero++;
    }
    expect(nonZero).toBeGreaterThan(out.length / 4);
  });
});
