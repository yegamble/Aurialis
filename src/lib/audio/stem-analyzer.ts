/**
 * Stem Analyzer — classifies audio stems by instrument type using DSP heuristics.
 * Computes features directly from Float32Array samples (no AnalyserNode).
 */

import type {
  StemClassification,
  StemFeatures,
  BandEnergy,
  AnalyzedStem,
} from "@/types/mixer";

// --- Feature extraction functions (exported for testing) ---

/** Compute RMS energy in dBFS. */
export function computeRMS(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sum / samples.length);
  return rms > 0 ? 20 * Math.log10(rms) : -120;
}

/** Compute crest factor (peak-to-RMS ratio) in dB. */
export function computeCrestFactor(samples: Float32Array): number {
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i]);
    if (abs > peak) peak = abs;
    sum += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sum / samples.length);
  if (rms === 0) return 0;
  return 20 * Math.log10(peak / rms);
}

/**
 * Compute DFT magnitudes for a single windowed frame.
 * Uses a smaller DFT size (512) for speed — O(N²) but N is small.
 */
function computeFrameMagnitudes(
  samples: Float32Array,
  start: number,
  frameSize: number
): Float32Array {
  const halfN = frameSize / 2;
  const mags = new Float32Array(halfN);
  for (let k = 0; k < halfN; k++) {
    let re = 0;
    let im = 0;
    for (let n = 0; n < frameSize; n++) {
      const window =
        0.5 * (1 - Math.cos((2 * Math.PI * n) / (frameSize - 1)));
      const s = samples[start + n] * window;
      const angle = (-2 * Math.PI * k * n) / frameSize;
      re += s * Math.cos(angle);
      im += s * Math.sin(angle);
    }
    mags[k] = Math.sqrt(re * re + im * im);
  }
  return mags;
}

/** Compute spectral centroid in Hz. Samples up to 8 evenly-spaced frames. */
export function computeSpectralCentroid(
  samples: Float32Array,
  sampleRate: number
): number {
  const frameSize = 512;
  const maxFrames = 8;
  const totalFrames = Math.floor((samples.length - frameSize) / frameSize) + 1;
  const step = Math.max(1, Math.floor(totalFrames / maxFrames));

  let totalWeightedFreq = 0;
  let totalMagnitude = 0;

  for (
    let f = 0, start = 0;
    f < maxFrames && start + frameSize <= samples.length;
    f++, start += step * frameSize
  ) {
    const mags = computeFrameMagnitudes(samples, start, frameSize);
    for (let k = 0; k < mags.length; k++) {
      const freq = (k * sampleRate) / frameSize;
      totalWeightedFreq += freq * mags[k];
      totalMagnitude += mags[k];
    }
  }

  return totalMagnitude > 0 ? totalWeightedFreq / totalMagnitude : 0;
}

/**
 * Compute spectral rolloff — frequency below which 85% of spectral energy exists.
 */
function computeSpectralRolloff(
  samples: Float32Array,
  sampleRate: number
): number {
  const frameSize = 512;
  if (samples.length < frameSize) return sampleRate / 2;

  const mags = computeFrameMagnitudes(samples, 0, frameSize);

  let totalEnergy = 0;
  for (let k = 0; k < mags.length; k++) {
    totalEnergy += mags[k] * mags[k];
  }

  const threshold = totalEnergy * 0.85;
  let cumulative = 0;

  for (let k = 0; k < mags.length; k++) {
    cumulative += mags[k] * mags[k];
    if (cumulative >= threshold) {
      return (k * sampleRate) / frameSize;
    }
  }

  return sampleRate / 2;
}

/**
 * Compute transient density — ratio of frames with energy spikes.
 * Uses short-window RMS (~10ms) and counts frames where RMS jumps > threshold.
 */
export function computeTransientDensity(
  samples: Float32Array,
  sampleRate: number
): number {
  const windowSamples = Math.floor(sampleRate * 0.01); // 10ms windows
  const numWindows = Math.floor(samples.length / windowSamples);
  if (numWindows < 2) return 0;

  const rmsValues: number[] = [];
  for (let w = 0; w < numWindows; w++) {
    let sum = 0;
    const start = w * windowSamples;
    for (let i = start; i < start + windowSamples; i++) {
      sum += samples[i] * samples[i];
    }
    rmsValues.push(Math.sqrt(sum / windowSamples));
  }

  // Count transients: frames where RMS increases by > 3x from previous frame
  let transients = 0;
  for (let i = 1; i < rmsValues.length; i++) {
    const prev = rmsValues[i - 1];
    const curr = rmsValues[i];
    if (prev > 0 && curr / prev > 3) {
      transients++;
    }
  }

  return transients / numWindows;
}

/** Compute frequency band energy distribution. Returns normalized proportions. */
export function computeBandEnergy(
  samples: Float32Array,
  sampleRate: number
): BandEnergy {
  const frameSize = 512;
  if (samples.length < frameSize) {
    return { sub: 0.2, low: 0.2, mid: 0.2, high: 0.2, air: 0.2 };
  }

  const bands = [
    { name: "sub", lo: 20, hi: 60 },
    { name: "low", lo: 60, hi: 300 },
    { name: "mid", lo: 300, hi: 2000 },
    { name: "high", lo: 2000, hi: 8000 },
    { name: "air", lo: 8000, hi: 20000 },
  ];

  const bandEnergy = { sub: 0, low: 0, mid: 0, high: 0, air: 0 };
  const mags = computeFrameMagnitudes(samples, 0, frameSize);

  for (let k = 0; k < mags.length; k++) {
    const energy = mags[k] * mags[k];
    const freq = (k * sampleRate) / frameSize;

    for (const band of bands) {
      if (freq >= band.lo && freq < band.hi) {
        bandEnergy[band.name as keyof BandEnergy] += energy;
        break;
      }
    }
  }

  const total =
    bandEnergy.sub +
    bandEnergy.low +
    bandEnergy.mid +
    bandEnergy.high +
    bandEnergy.air;

  if (total > 0) {
    bandEnergy.sub /= total;
    bandEnergy.low /= total;
    bandEnergy.mid /= total;
    bandEnergy.high /= total;
    bandEnergy.air /= total;
  }

  return bandEnergy;
}

/** Compute zero-crossing rate (proportion of sign changes per sample). */
export function computeZeroCrossingRate(samples: Float32Array): number {
  let crossings = 0;
  for (let i = 1; i < samples.length; i++) {
    if (
      (samples[i] >= 0 && samples[i - 1] < 0) ||
      (samples[i] < 0 && samples[i - 1] >= 0)
    ) {
      crossings++;
    }
  }
  return crossings / samples.length;
}

// --- Filename-based classification ---

const FILENAME_PATTERNS: Array<{ pattern: RegExp; classification: StemClassification }> = [
  { pattern: /\b(vocal|vox|voice|sing|lead\s*voc)/i, classification: "vocals" },
  { pattern: /\b(drum|kick|snare|hihat|hi-hat|tom|cymbal|perc|overhead|oh_)/i, classification: "drums" },
  { pattern: /\b(bass|sub[_\s]?bass|bass[_\s]?di)/i, classification: "bass" },
  { pattern: /\b(guitar|gtr|acoustic[_\s]?guitar)/i, classification: "guitar" },
  { pattern: /\b(key|piano|organ|rhodes|wurli|clav)/i, classification: "keys" },
  { pattern: /\b(synth|pad|lead[_\s]?synth|arp)/i, classification: "synth" },
  { pattern: /\b(string|violin|viola|cello|orchestra)/i, classification: "strings" },
  { pattern: /\b(fx|sfx|effect|ambient|noise|riser|whoosh)/i, classification: "fx" },
];

/** Classify stem from filename. Returns null if no match. */
export function classifyFromFilename(filename: string): StemClassification | null {
  for (const { pattern, classification } of FILENAME_PATTERNS) {
    if (pattern.test(filename)) return classification;
  }
  return null;
}

// --- DSP-based classification ---

function classifyFromFeatures(features: StemFeatures): {
  classification: StemClassification;
  confidence: number;
} {
  const scores: Partial<Record<StemClassification, number>> = {};

  // Drums: high transient density + high crest factor + spread energy
  scores.drums =
    (features.transientDensity > 0.02 ? 4 : features.transientDensity > 0.01 ? 2 : 0) +
    (features.crestFactor > 6 ? 3 : features.crestFactor > 4 ? 1 : 0) +
    (features.bandEnergy.mid > 0.2 ? 1 : 0);

  // Bass: most energy below 300Hz + low spectral centroid
  const lowEnergy = features.bandEnergy.sub + features.bandEnergy.low;
  scores.bass =
    (lowEnergy > 0.5 ? 4 : lowEnergy > 0.3 ? 2 : 0) +
    (features.spectralCentroid < 400 ? 3 : features.spectralCentroid < 600 ? 1 : 0);

  // Vocals: mid-range energy + moderate transients + centroid in vocal range
  scores.vocals =
    (features.bandEnergy.mid > 0.3 ? 2 : 0) +
    (features.spectralCentroid > 800 && features.spectralCentroid < 4000 ? 3 : 0) +
    (features.transientDensity > 0.02 && features.transientDensity < 0.2 ? 1 : 0);

  // Guitar: mid-range + moderate centroid
  scores.guitar =
    (features.bandEnergy.mid > 0.3 ? 1.5 : 0) +
    (features.spectralCentroid > 400 && features.spectralCentroid < 3000 ? 2 : 0) +
    (features.transientDensity > 0.01 && features.transientDensity < 0.15 ? 1 : 0);

  // Keys: sustained + mid-high energy
  scores.keys =
    (features.transientDensity < 0.1 ? 1.5 : 0) +
    (features.bandEnergy.mid + features.bandEnergy.high > 0.5 ? 1.5 : 0);

  // Synth: could be anything, low confidence fallback
  scores.synth =
    (features.transientDensity < 0.05 ? 1 : 0) +
    (features.zeroCrossingRate > 0.1 ? 1 : 0);

  // Strings: sustained + mid-high
  scores.strings =
    (features.transientDensity < 0.05 ? 2 : 0) +
    (features.bandEnergy.mid + features.bandEnergy.high > 0.5 ? 1.5 : 0) +
    (features.crestFactor < 6 ? 1 : 0);

  // FX: high variance (hard to detect, low priority)
  scores.fx = features.zeroCrossingRate > 0.2 ? 1 : 0;

  // Find best match
  let best: StemClassification = "other";
  let bestScore = 0;

  for (const [cls, score] of Object.entries(scores)) {
    if (score !== undefined && score > bestScore) {
      bestScore = score;
      best = cls as StemClassification;
    }
  }

  // Normalize confidence to 0-1 (max reasonable score ~10)
  const confidence = Math.min(1, bestScore / 8);

  return { classification: best, confidence };
}

// --- Main analysis function ---

/** Analyze a stem and return classification + features. */
export function analyzeStem(
  buffer: AudioBuffer,
  filename: string
): AnalyzedStem {
  const samples = buffer.getChannelData(0);
  const sr = buffer.sampleRate;

  const features: StemFeatures = {
    spectralCentroid: computeSpectralCentroid(samples, sr),
    spectralRolloff: computeSpectralRolloff(samples, sr),
    transientDensity: computeTransientDensity(samples, sr),
    rmsEnergy: computeRMS(samples),
    crestFactor: computeCrestFactor(samples),
    bandEnergy: computeBandEnergy(samples, sr),
    zeroCrossingRate: computeZeroCrossingRate(samples),
  };

  // Filename takes priority if it matches
  const filenameClass = classifyFromFilename(filename);
  if (filenameClass) {
    return {
      stemId: "",
      classification: filenameClass,
      confidence: 0.9, // High confidence for filename match
      features,
    };
  }

  // Fall back to DSP classification
  const { classification, confidence } = classifyFromFeatures(features);

  return {
    stemId: "",
    classification,
    confidence,
    features,
  };
}
