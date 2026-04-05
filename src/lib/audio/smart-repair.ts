/**
 * Smart Repair DSP — post-separation artifact repair pipeline.
 *
 * Four algorithms:
 * 1. Spectral de-bleed: frequency-aware gating per stem type
 * 2. Compression expansion: detect + invert master bus compressor envelope
 * 3. Transient restoration: re-sharpen attacks softened by separation
 * 4. Phase coherence: verify stems sum back to original
 */

import type { StemClassification } from "@/types/mixer";

// --- Frequency masks per stem type (passband in Hz) ---

interface FreqMask {
  lowCut: number;  // High-pass below this frequency
  highCut: number; // Low-pass above this frequency
}

const STEM_FREQ_MASKS: Partial<Record<StemClassification, FreqMask>> = {
  vocals: { lowCut: 100, highCut: 8000 },
  bass: { lowCut: 20, highCut: 400 },
  drums: { lowCut: 30, highCut: 12000 },
  guitar: { lowCut: 80, highCut: 6000 },
  keys: { lowCut: 60, highCut: 8000 },
  synth: { lowCut: 40, highCut: 10000 },
  strings: { lowCut: 100, highCut: 8000 },
  other: { lowCut: 20, highCut: 20000 },
};

const DEBLEED_ATTENUATION_DB = -15; // How much to attenuate out-of-band content

// --- 1. Spectral De-bleed ---

/**
 * Apply spectral de-bleed gating to suppress frequency content
 * that doesn't belong to this stem type.
 *
 * Uses windowed DFT with overlap-add reconstruction.
 */
/**
 * Apply spectral de-bleed using a biquad-style IIR approach instead of DFT.
 * Much faster than frame-by-frame DFT: O(N) instead of O(N*frameSize).
 *
 * Applies a simple 2nd-order high-pass (to remove bleed below lowCut)
 * and low-pass (to remove bleed above highCut) filter in series.
 */
export function applyDebleed(
  samples: Float32Array,
  sampleRate: number,
  stemType: StemClassification
): Float32Array {
  const mask = STEM_FREQ_MASKS[stemType] ?? STEM_FREQ_MASKS.other!;
  const attenLin = Math.pow(10, DEBLEED_ATTENUATION_DB / 20);
  const output = new Float32Array(samples.length);

  // Apply high-pass filter (attenuate below lowCut)
  // Simple one-pole high-pass: y[n] = alpha * (y[n-1] + x[n] - x[n-1])
  const hpAlpha = 1 / (1 + (2 * Math.PI * mask.lowCut) / sampleRate);
  let hpPrev = 0;
  let hpPrevIn = 0;

  for (let i = 0; i < samples.length; i++) {
    const hpOut = hpAlpha * (hpPrev + samples[i] - hpPrevIn);
    // Blend: inside passband = full signal, outside = attenuated
    output[i] = hpOut + (samples[i] - hpOut) * attenLin;
    hpPrev = hpOut;
    hpPrevIn = samples[i];
  }

  // Apply low-pass filter (attenuate above highCut)
  // Simple one-pole low-pass: y[n] = alpha * x[n] + (1-alpha) * y[n-1]
  const lpAlpha = (2 * Math.PI * mask.highCut) /
    (sampleRate + 2 * Math.PI * mask.highCut);
  let lpPrev = 0;
  const lpInput = new Float32Array(output); // copy intermediate result

  for (let i = 0; i < lpInput.length; i++) {
    const lpOut = lpAlpha * lpInput[i] + (1 - lpAlpha) * lpPrev;
    // Blend: inside passband = full signal, outside = attenuated
    output[i] = lpOut + (lpInput[i] - lpOut) * attenLin;
    lpPrev = lpOut;
  }

  return output;
}

// --- 2. Compression Expansion ---

/**
 * Detect and invert the master bus compressor's gain envelope.
 * Compares the stem's RMS envelope against the mix's envelope —
 * correlated dips indicate compression pumping.
 *
 * Clamps expansion to 1:4 max to avoid artifacts.
 */
export function applyExpansion(
  stemSamples: Float32Array,
  mixSamples: Float32Array,
  sampleRate: number
): Float32Array {
  const windowSamples = Math.floor(sampleRate * 0.01); // 10ms windows
  const numWindows = Math.floor(
    Math.min(stemSamples.length, mixSamples.length) / windowSamples
  );
  if (numWindows < 2) return new Float32Array(stemSamples);

  // Compute mix envelope (RMS per window)
  const mixEnv: number[] = [];
  for (let w = 0; w < numWindows; w++) {
    let sum = 0;
    const start = w * windowSamples;
    for (let i = start; i < start + windowSamples; i++) {
      sum += mixSamples[i] * mixSamples[i];
    }
    mixEnv.push(Math.sqrt(sum / windowSamples));
  }

  // Find average mix level (reference)
  const avgMixLevel =
    mixEnv.reduce((a, b) => a + b, 0) / mixEnv.length;

  if (avgMixLevel < 0.001) {
    // Silent mix — no expansion possible
    return new Float32Array(stemSamples);
  }

  // Compute expansion gain per window
  const expansionGains: number[] = [];
  const maxExpansionDb = 12; // 1:4 max expansion
  const maxExpansionLin = Math.pow(10, maxExpansionDb / 20);

  for (let w = 0; w < numWindows; w++) {
    const ratio = mixEnv[w] / avgMixLevel;
    if (ratio < 0.01) {
      expansionGains.push(1); // Avoid division by near-zero
    } else if (ratio < 1) {
      // Dip detected — apply inverse gain (expand)
      const invGain = 1 / ratio;
      expansionGains.push(Math.min(invGain, maxExpansionLin));
    } else {
      expansionGains.push(1); // No expansion needed above average
    }
  }

  // Smooth the expansion envelope (avoid sudden jumps)
  const smoothed = [...expansionGains];
  const smoothingWindow = 3;
  for (let i = smoothingWindow; i < smoothed.length - smoothingWindow; i++) {
    let sum = 0;
    for (let j = -smoothingWindow; j <= smoothingWindow; j++) {
      sum += expansionGains[i + j];
    }
    smoothed[i] = sum / (2 * smoothingWindow + 1);
  }

  // Apply expansion gain to stem samples
  const output = new Float32Array(stemSamples.length);
  for (let w = 0; w < numWindows; w++) {
    const start = w * windowSamples;
    const gain = smoothed[w];
    for (let i = start; i < start + windowSamples && i < stemSamples.length; i++) {
      output[i] = stemSamples[i] * gain;
    }
  }

  // Handle remaining samples
  for (let i = numWindows * windowSamples; i < stemSamples.length; i++) {
    output[i] = stemSamples[i];
  }

  // Normalize to prevent clipping
  let maxAbs = 0;
  for (let i = 0; i < output.length; i++) {
    const abs = Math.abs(output[i]);
    if (abs > maxAbs) maxAbs = abs;
  }
  if (maxAbs > 1.0) {
    const scale = 1.0 / maxAbs;
    for (let i = 0; i < output.length; i++) {
      output[i] *= scale;
    }
  }

  return output;
}

// --- 3. Transient Restoration ---

/** Stem types that benefit from transient restoration. */
const TRANSIENT_STEMS: StemClassification[] = [
  "drums", "guitar", "keys", "synth",
];

/**
 * Re-sharpen attack transients that Demucs softened during separation.
 * Only applies to percussive/plucked stem types — not vocals or strings.
 */
export function applyTransientRestore(
  samples: Float32Array,
  sampleRate: number,
  stemType: StemClassification
): Float32Array {
  if (!TRANSIENT_STEMS.includes(stemType)) {
    return new Float32Array(samples);
  }

  const windowSamples = Math.floor(sampleRate * 0.01); // 10ms
  const numWindows = Math.floor(samples.length / windowSamples);
  if (numWindows < 2) return new Float32Array(samples);

  // Compute RMS per window
  const rmsValues: number[] = [];
  for (let w = 0; w < numWindows; w++) {
    let sum = 0;
    const start = w * windowSamples;
    for (let i = start; i < start + windowSamples; i++) {
      sum += samples[i] * samples[i];
    }
    rmsValues.push(Math.sqrt(sum / windowSamples));
  }

  // Detect transients: windows where RMS jumps > 2x from previous
  const output = new Float32Array(samples);
  const boostDb = 3; // dB boost on transient attack
  const boostLin = Math.pow(10, boostDb / 20);
  const attackSamples = Math.floor(sampleRate * 0.003); // 3ms boost window

  for (let w = 1; w < numWindows; w++) {
    const prev = rmsValues[w - 1];
    const curr = rmsValues[w];
    if (prev > 0 && curr / prev > 2) {
      // Transient detected — boost the first few ms
      const start = w * windowSamples;
      for (let i = start; i < start + attackSamples && i < output.length; i++) {
        const t = (i - start) / attackSamples;
        // Fade from boost to unity over the attack window
        const gain = boostLin + (1 - boostLin) * t;
        output[i] *= gain;
      }
    }
  }

  return output;
}

// --- 4. Phase Coherence ---

/**
 * Check phase coherence between repaired stems and original mix.
 * Returns a score 0-100% based on windowed correlation.
 */
export function checkPhaseCoherence(
  stems: Float32Array[],
  originalMix: Float32Array,
  sampleRate: number
): number {
  if (stems.length === 0) return 0;

  // Sum all stems
  const len = originalMix.length;
  const stemSum = new Float32Array(len);
  for (const stem of stems) {
    for (let i = 0; i < Math.min(stem.length, len); i++) {
      stemSum[i] += stem[i];
    }
  }

  // Compute windowed correlation
  const windowSamples = Math.floor(sampleRate * 0.05); // 50ms windows
  const numWindows = Math.floor(len / windowSamples);
  if (numWindows === 0) return 0;

  let coherentWindows = 0;

  for (let w = 0; w < numWindows; w++) {
    const start = w * windowSamples;

    // Pearson correlation for this window
    let sumA = 0;
    let sumB = 0;
    let sumAA = 0;
    let sumBB = 0;
    let sumAB = 0;

    for (let i = start; i < start + windowSamples && i < len; i++) {
      const a = originalMix[i];
      const b = stemSum[i];
      sumA += a;
      sumB += b;
      sumAA += a * a;
      sumBB += b * b;
      sumAB += a * b;
    }

    const n = windowSamples;
    const denomA = n * sumAA - sumA * sumA;
    const denomB = n * sumBB - sumB * sumB;
    const denom = Math.sqrt(denomA * denomB);

    if (denom > 0) {
      const correlation = (n * sumAB - sumA * sumB) / denom;
      if (correlation > 0.9) {
        coherentWindows++;
      }
    }
  }

  return Math.round((coherentWindows / numWindows) * 100);
}

// --- Full pipeline ---

export interface SmartRepairOptions {
  stemType: StemClassification;
  sampleRate: number;
  mixSamples?: Float32Array; // Original mix for expansion + phase check
}

/**
 * Apply the full Smart Repair pipeline to a stem's samples.
 */
export function applySmartRepair(
  samples: Float32Array,
  options: SmartRepairOptions
): Float32Array {
  let repaired = applyDebleed(samples, options.sampleRate, options.stemType);

  if (options.mixSamples) {
    repaired = applyExpansion(repaired, options.mixSamples, options.sampleRate);
  }

  repaired = applyTransientRestore(
    repaired,
    options.sampleRate,
    options.stemType
  );

  return repaired;
}
