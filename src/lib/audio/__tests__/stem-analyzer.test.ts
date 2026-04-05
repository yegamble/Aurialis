import { describe, it, expect, vi } from "vitest";
import {
  analyzeStem,
  classifyFromFilename,
  computeRMS,
  computeCrestFactor,
  computeSpectralCentroid,
  computeTransientDensity,
  computeBandEnergy,
  computeZeroCrossingRate,
} from "../stem-analyzer";
import type { StemClassification } from "@/types/mixer";

// Helper to create a mock AudioBuffer with specific content
function makeBuffer(
  generator: (i: number, sampleRate: number) => number,
  duration = 1,
  sampleRate = 44100,
  channels = 1
): AudioBuffer {
  const length = Math.floor(duration * sampleRate);
  const data = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    data[i] = generator(i, sampleRate);
  }
  return {
    duration,
    sampleRate,
    numberOfChannels: channels,
    length,
    getChannelData: vi.fn().mockReturnValue(data),
  } as unknown as AudioBuffer;
}

// Generator functions for synthetic test signals
const sineWave = (freq: number, amp = 0.5) => (i: number, sr: number) =>
  amp * Math.sin((2 * Math.PI * freq * i) / sr);

const whiteNoise = (amp = 0.5) => () => (Math.random() * 2 - 1) * amp;

// Low-frequency content (bass)
const bassSignal = sineWave(80, 0.7);

// Mid-frequency content (vocals-like)
const vocalSignal = sineWave(1000, 0.4);

// High transient density (drum-like: short bursts of noise)
function drumSignal(i: number, sr: number): number {
  const period = Math.floor(sr * 0.25); // hit every 250ms
  const pos = i % period;
  const attackSamples = Math.floor(sr * 0.005);
  if (pos < attackSamples) {
    return (Math.random() * 2 - 1) * 0.8;
  }
  const decay = Math.exp((-pos / sr) * 20);
  return (Math.random() * 2 - 1) * 0.3 * decay;
}

// Guitar-like mid-range signal
const guitarSignal = sineWave(440, 0.4);

describe("stem-analyzer", () => {
  describe("computeRMS", () => {
    it("returns RMS in dBFS for a sine wave", () => {
      const buffer = makeBuffer(sineWave(440, 0.5));
      const data = buffer.getChannelData(0);
      const rms = computeRMS(data);
      // Sine at 0.5 amplitude: RMS = 0.5 / sqrt(2) ≈ 0.354 → ~-9 dBFS
      expect(rms).toBeGreaterThan(-12);
      expect(rms).toBeLessThan(-6);
    });

    it("returns very low dBFS for silence", () => {
      const buffer = makeBuffer(() => 0);
      const data = buffer.getChannelData(0);
      const rms = computeRMS(data);
      expect(rms).toBeLessThan(-90);
    });
  });

  describe("computeCrestFactor", () => {
    it("returns ~3 dB for a sine wave (peak/RMS)", () => {
      const buffer = makeBuffer(sineWave(440, 0.8));
      const data = buffer.getChannelData(0);
      const cf = computeCrestFactor(data);
      // Sine: peak/RMS = sqrt(2) ≈ 1.414 → 3.01 dB
      expect(cf).toBeGreaterThan(2);
      expect(cf).toBeLessThan(4);
    });

    it("returns higher crest factor for transient-heavy signals", () => {
      const buffer = makeBuffer(drumSignal, 2);
      const data = buffer.getChannelData(0);
      const cf = computeCrestFactor(data);
      // Drums have high peaks relative to RMS
      expect(cf).toBeGreaterThan(3);
    });
  });

  describe("computeSpectralCentroid", () => {
    it("returns low centroid for bass signal", () => {
      const buffer = makeBuffer(bassSignal, 1, 44100);
      const data = buffer.getChannelData(0);
      const centroid = computeSpectralCentroid(data, 44100);
      expect(centroid).toBeLessThan(500);
    });

    it("returns higher centroid for vocal-range signal", () => {
      const buffer = makeBuffer(vocalSignal, 1, 44100);
      const data = buffer.getChannelData(0);
      const centroid = computeSpectralCentroid(data, 44100);
      expect(centroid).toBeGreaterThan(500);
    });
  });

  describe("computeTransientDensity", () => {
    it("returns high density for drum signal", () => {
      const buffer = makeBuffer(drumSignal, 2, 44100);
      const data = buffer.getChannelData(0);
      const density = computeTransientDensity(data, 44100);
      // Drum signal has ~4 hits/sec = transients in 3-5% of 10ms windows
      expect(density).toBeGreaterThan(0.02);
    });

    it("returns low density for sustained sine", () => {
      const buffer = makeBuffer(sineWave(440, 0.5), 2, 44100);
      const data = buffer.getChannelData(0);
      const density = computeTransientDensity(data, 44100);
      expect(density).toBeLessThan(0.1);
    });
  });

  describe("computeBandEnergy", () => {
    it("concentrates energy in sub/low for bass", () => {
      const buffer = makeBuffer(bassSignal, 1, 44100);
      const data = buffer.getChannelData(0);
      const energy = computeBandEnergy(data, 44100);
      const lowEnergy = energy.sub + energy.low;
      expect(lowEnergy).toBeGreaterThan(0.5);
    });

    it("concentrates energy in mid for vocal signal", () => {
      const buffer = makeBuffer(vocalSignal, 1, 44100);
      const data = buffer.getChannelData(0);
      const energy = computeBandEnergy(data, 44100);
      expect(energy.mid).toBeGreaterThan(0.3);
    });

    it("all bands sum approximately to 1", () => {
      const buffer = makeBuffer(whiteNoise(0.3), 1, 44100);
      const data = buffer.getChannelData(0);
      const energy = computeBandEnergy(data, 44100);
      const total = energy.sub + energy.low + energy.mid + energy.high + energy.air;
      expect(total).toBeGreaterThan(0.8);
      expect(total).toBeLessThan(1.2);
    });
  });

  describe("computeZeroCrossingRate", () => {
    it("returns low rate for low-frequency signal", () => {
      const buffer = makeBuffer(sineWave(80, 0.5), 1, 44100);
      const data = buffer.getChannelData(0);
      const zcr = computeZeroCrossingRate(data);
      expect(zcr).toBeLessThan(0.01);
    });

    it("returns higher rate for high-frequency signal", () => {
      const buffer = makeBuffer(sineWave(4000, 0.5), 1, 44100);
      const data = buffer.getChannelData(0);
      const zcr = computeZeroCrossingRate(data);
      expect(zcr).toBeGreaterThan(0.1);
    });
  });

  describe("classifyFromFilename", () => {
    it.each<[string, StemClassification]>([
      ["vocals.wav", "vocals"],
      ["Lead Vocal.wav", "vocals"],
      ["vox_dry.mp3", "vocals"],
      ["drums.wav", "drums"],
      ["drum_bus.wav", "drums"],
      ["kick.wav", "drums"],
      ["snare_top.wav", "drums"],
      ["hihat.flac", "drums"],
      ["percussion.wav", "drums"],
      ["bass.wav", "bass"],
      ["bass_DI.wav", "bass"],
      ["sub_bass.wav", "bass"],
      ["guitar.wav", "guitar"],
      ["gtr_clean.wav", "guitar"],
      ["acoustic_guitar.wav", "guitar"],
      ["keys.wav", "keys"],
      ["piano.wav", "keys"],
      ["organ.wav", "keys"],
      ["synth_lead.wav", "synth"],
      ["pad.wav", "synth"],
      ["strings.wav", "strings"],
      ["violin.wav", "strings"],
      ["cello_section.wav", "strings"],
      ["fx.wav", "fx"],
      ["sfx_whoosh.wav", "fx"],
    ])("classifies '%s' as '%s'", (filename, expected) => {
      expect(classifyFromFilename(filename)).toBe(expected);
    });

    it("returns null for unrecognized filenames", () => {
      expect(classifyFromFilename("track_04.wav")).toBeNull();
      expect(classifyFromFilename("audio.wav")).toBeNull();
    });
  });

  describe("analyzeStem (integration)", () => {
    it("classifies a bass signal correctly", () => {
      const buffer = makeBuffer(bassSignal, 2, 44100);
      const result = analyzeStem(buffer, "bass_guitar.wav");

      expect(result.classification).toBe("bass");
      expect(result.confidence).toBeGreaterThan(0.5);
      expect(result.features.rmsEnergy).toBeDefined();
    });

    it("classifies from filename when available", () => {
      // Even with a mid-range signal, filename "vocals.wav" should win
      const buffer = makeBuffer(sineWave(440, 0.3), 1, 44100);
      const result = analyzeStem(buffer, "vocals.wav");

      expect(result.classification).toBe("vocals");
      expect(result.confidence).toBeGreaterThan(0.7);
    });

    it("returns all feature fields", () => {
      const buffer = makeBuffer(sineWave(440, 0.3), 1, 44100);
      const result = analyzeStem(buffer, "test.wav");

      expect(result.features.spectralCentroid).toBeDefined();
      expect(result.features.spectralRolloff).toBeDefined();
      expect(result.features.transientDensity).toBeDefined();
      expect(result.features.rmsEnergy).toBeDefined();
      expect(result.features.crestFactor).toBeDefined();
      expect(result.features.bandEnergy).toBeDefined();
      expect(result.features.zeroCrossingRate).toBeDefined();
    });

    it("classifies drum-like signal with high transients", () => {
      const buffer = makeBuffer(drumSignal, 2, 44100);
      const result = analyzeStem(buffer, "track_01.wav");

      // Without filename hint, should detect drums from DSP
      expect(result.classification).toBe("drums");
    });
  });
});
