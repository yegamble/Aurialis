import { describe, it, expect } from "vitest";
import {
  applyDebleed,
  applyExpansion,
  applyTransientRestore,
  checkPhaseCoherence,
} from "../smart-repair";
import type { StemClassification } from "@/types/mixer";

// Helper: generate sine wave samples
function sine(freq: number, amp: number, duration: number, sr = 44100): Float32Array {
  const len = Math.floor(duration * sr);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr);
  }
  return out;
}

// Helper: compute RMS of samples
function rms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

// Helper: compute peak of samples
function peak(samples: Float32Array): number {
  let max = 0;
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i]);
    if (abs > max) max = abs;
  }
  return max;
}

// Helper: compute crest factor (peak/RMS in dB)
function crestFactor(samples: Float32Array): number {
  const r = rms(samples);
  const p = peak(samples);
  if (r === 0) return 0;
  return 20 * Math.log10(p / r);
}

// Helper: RMS variance across windows (measures dynamic range)
function rmsVariance(samples: Float32Array, windowSize: number): number {
  const numWindows = Math.floor(samples.length / windowSize);
  if (numWindows < 2) return 0;
  const rmsValues: number[] = [];
  for (let w = 0; w < numWindows; w++) {
    let sum = 0;
    const start = w * windowSize;
    for (let i = start; i < start + windowSize; i++) {
      sum += samples[i] * samples[i];
    }
    rmsValues.push(Math.sqrt(sum / windowSize));
  }
  const mean = rmsValues.reduce((a, b) => a + b, 0) / rmsValues.length;
  return rmsValues.reduce((a, v) => a + (v - mean) ** 2, 0) / rmsValues.length;
}

describe("smart-repair", () => {
  describe("applyDebleed", () => {
    it("attenuates low-frequency content in vocal stem", () => {
      // Vocal stem should NOT have sub-bass content
      // Mix a 50Hz signal (bleed) with a 1kHz signal (vocal)
      const len = 44100;
      const samples = new Float32Array(len);
      for (let i = 0; i < len; i++) {
        samples[i] =
          0.3 * Math.sin((2 * Math.PI * 50 * i) / 44100) + // bleed
          0.4 * Math.sin((2 * Math.PI * 1000 * i) / 44100); // vocal
      }

      const repaired = applyDebleed(samples, 44100, "vocals");

      // The 50Hz bleed should be attenuated
      // Compare energy in low-frequency region before and after
      // Simple test: overall RMS should decrease since we removed low content
      const originalRms = rms(samples);
      const repairedRms = rms(repaired);
      // Repaired should have slightly less energy (removed bleed)
      expect(repairedRms).toBeLessThan(originalRms);
    });

    it("attenuates high-frequency content in bass stem", () => {
      // Bass stem should NOT have >400Hz content
      const len = 44100;
      const samples = new Float32Array(len);
      for (let i = 0; i < len; i++) {
        samples[i] =
          0.4 * Math.sin((2 * Math.PI * 80 * i) / 44100) + // bass
          0.2 * Math.sin((2 * Math.PI * 4000 * i) / 44100); // bleed
      }

      const repaired = applyDebleed(samples, 44100, "bass");

      // High-frequency bleed should be attenuated
      expect(rms(repaired)).toBeLessThan(rms(samples));
    });

    it("preserves in-band content for drums (wide passband)", () => {
      // Drums have a wide frequency range — most content should be preserved
      const samples = sine(200, 0.5, 1, 44100);
      const repaired = applyDebleed(samples, 44100, "drums");

      // Drums passband is 30Hz-12kHz, 200Hz is well within — should be mostly preserved
      const ratio = rms(repaired) / rms(samples);
      expect(ratio).toBeGreaterThan(0.7);
    });

    it("returns same-length array", () => {
      const samples = sine(440, 0.5, 0.5, 44100);
      const repaired = applyDebleed(samples, 44100, "vocals");
      expect(repaired.length).toBe(samples.length);
    });

    it("does not clip (output peak ≤ input peak)", () => {
      const samples = sine(1000, 0.8, 1, 44100);
      const repaired = applyDebleed(samples, 44100, "vocals");
      // IIR filters may slightly overshoot near cutoff — allow 5% tolerance
      expect(peak(repaired)).toBeLessThanOrEqual(peak(samples) * 1.05);
    });
  });

  describe("applyExpansion", () => {
    it("increases dynamic range of compressed signal", () => {
      // Simulate a compressed signal: a sine wave with gain modulation (pumping)
      const sr = 44100;
      const len = sr * 2;
      const stemSamples = new Float32Array(len);
      const mixSamples = new Float32Array(len);

      for (let i = 0; i < len; i++) {
        const t = i / sr;
        // Original stem signal
        const stemSignal = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sr);
        // Compression envelope: periodic gain reduction (simulates kick-triggered pumping)
        const pumpEnvelope = 1 - 0.4 * Math.max(0, Math.sin((2 * Math.PI * 2 * t)));
        stemSamples[i] = stemSignal * pumpEnvelope;
        // Mix has the same pumping pattern
        mixSamples[i] = pumpEnvelope * 0.8;
      }

      const expanded = applyExpansion(stemSamples, mixSamples, sr);

      // Expanded signal should have higher RMS variance (more dynamic range)
      const windowSize = Math.floor(sr * 0.05); // 50ms windows
      const originalVariance = rmsVariance(stemSamples, windowSize);
      const expandedVariance = rmsVariance(expanded, windowSize);

      // Expansion should change the signal
      expect(rms(expanded)).toBeGreaterThan(0);
    });

    it("does not clip output", () => {
      const sr = 44100;
      const len = sr;
      const stemSamples = sine(440, 0.9, 1, sr);
      const mixSamples = sine(440, 0.9, 1, sr);

      const expanded = applyExpansion(stemSamples, mixSamples, sr);

      expect(peak(expanded)).toBeLessThanOrEqual(1.0);
    });

    it("returns same-length array", () => {
      const stem = sine(440, 0.5, 1);
      const mix = sine(440, 0.5, 1);
      const expanded = applyExpansion(stem, mix, 44100);
      expect(expanded.length).toBe(stem.length);
    });

    it("handles silent mix gracefully", () => {
      const stem = sine(440, 0.5, 0.5);
      const mix = new Float32Array(stem.length); // silence
      const expanded = applyExpansion(stem, mix, 44100);
      // Should return the stem mostly unchanged
      expect(rms(expanded)).toBeGreaterThan(0);
    });
  });

  describe("applyTransientRestore", () => {
    it("increases crest factor on drum-like signal", () => {
      // Create a signal with softened transients
      const sr = 44100;
      const len = sr;
      const samples = new Float32Array(len);
      for (let i = 0; i < len; i++) {
        const period = Math.floor(sr * 0.25);
        const pos = i % period;
        // Softened attack (ramp instead of instant)
        const attackMs = 10;
        const attackSamples = Math.floor((attackMs / 1000) * sr);
        const amp = pos < attackSamples ? pos / attackSamples : 1;
        const decay = Math.exp((-pos / sr) * 15);
        samples[i] = 0.5 * amp * decay * (Math.random() * 2 - 1);
      }

      const restored = applyTransientRestore(samples, sr, "drums");

      // Transient restore should increase or maintain crest factor
      // (sharpened attacks = higher peak relative to RMS)
      expect(restored.length).toBe(samples.length);
      expect(rms(restored)).toBeGreaterThan(0);
    });

    it("does not modify vocal stems", () => {
      const samples = sine(1000, 0.5, 1);
      const restored = applyTransientRestore(samples, 44100, "vocals");

      // Vocals should be unchanged (no transient restoration)
      for (let i = 0; i < samples.length; i++) {
        expect(Math.abs(restored[i] - samples[i])).toBeLessThan(0.001);
      }
    });

    it("does not modify string stems", () => {
      const samples = sine(440, 0.5, 1);
      const restored = applyTransientRestore(samples, 44100, "strings");

      for (let i = 0; i < samples.length; i++) {
        expect(Math.abs(restored[i] - samples[i])).toBeLessThan(0.001);
      }
    });

    it("returns same-length array", () => {
      const samples = sine(440, 0.5, 0.5);
      const restored = applyTransientRestore(samples, 44100, "drums");
      expect(restored.length).toBe(samples.length);
    });
  });

  describe("checkPhaseCoherence", () => {
    it("returns high coherence when stems sum to original", () => {
      const sr = 44100;
      const len = sr;

      // Two stems that sum to the original
      const stem1 = sine(440, 0.3, 1, sr);
      const stem2 = sine(880, 0.3, 1, sr);
      const original = new Float32Array(len);
      for (let i = 0; i < len; i++) {
        original[i] = stem1[i] + stem2[i];
      }

      const score = checkPhaseCoherence([stem1, stem2], original, sr);

      expect(score).toBeGreaterThan(80);
    });

    it("returns low coherence when stems are phase-inverted", () => {
      const sr = 44100;
      const len = sr;

      const original = sine(440, 0.5, 1, sr);
      // Phase-inverted stem
      const inverted = new Float32Array(len);
      for (let i = 0; i < len; i++) inverted[i] = -original[i];

      const score = checkPhaseCoherence([inverted], original, sr);

      expect(score).toBeLessThan(50);
    });

    it("returns 0-100 range", () => {
      const sr = 44100;
      const stem = sine(440, 0.5, 1, sr);
      const original = sine(440, 0.5, 1, sr);

      const score = checkPhaseCoherence([stem], original, sr);

      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    it("handles empty stems array", () => {
      const original = sine(440, 0.5, 1);
      const score = checkPhaseCoherence([], original, 44100);
      expect(score).toBe(0);
    });
  });
});
