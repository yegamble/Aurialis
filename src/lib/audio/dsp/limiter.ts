/**
 * Limiter DSP — lookahead gain reduction and true peak utilities.
 */

/** Convert linear amplitude to dBFS. */
export function linToDb(linear: number): number {
  if (linear <= 0) return -Infinity;
  return 20 * Math.log10(linear);
}

/** Convert dBFS to linear amplitude. */
export function dbToLin(db: number): number {
  return Math.pow(10, db / 20);
}

/**
 * Circular lookahead buffer.
 * Delays audio by `size` samples and tracks peak in window.
 */
export class LookaheadBuffer {
  private buffer: Float32Array;
  private writePos = 0;
  readonly size: number;

  constructor(size: number) {
    this.size = size;
    this.buffer = new Float32Array(size);
  }

  /**
   * Push a new sample. Returns the delayed sample (from `size` samples ago).
   */
  push(sample: number): number {
    const delayed = this.buffer[this.writePos];
    this.buffer[this.writePos] = sample;
    this.writePos = (this.writePos + 1) % this.size;
    return delayed;
  }

  /** Return the maximum absolute value currently in the buffer. */
  peakInWindow(): number {
    let peak = 0;
    for (let i = 0; i < this.size; i++) {
      const abs = Math.abs(this.buffer[i]);
      if (abs > peak) peak = abs;
    }
    return peak;
  }

  /** Peek at delayed sample without advancing. */
  peek(): number {
    return this.buffer[this.writePos];
  }
}

/**
 * Compute the gain multiplier needed to enforce the ceiling.
 *
 * @param peakLevel  Peak absolute amplitude in the lookahead window (linear)
 * @param ceiling    Maximum allowed peak amplitude (linear)
 * @returns          Gain multiplier ≤ 1.0
 */
export function computeLookaheadGain(
  peakLevel: number,
  ceiling: number
): number {
  if (peakLevel <= ceiling) return 1.0;
  return ceiling / peakLevel;
}

/**
 * Process a buffer through a brick-wall lookahead limiter.
 * Returns the gain-reduced output at the same length as input.
 *
 * @param input       Input samples
 * @param ceiling     Maximum allowed peak in linear scale
 * @param lookaheadSamples  Number of lookahead samples (66 = ~1.5ms at 44.1kHz)
 * @param attackCoeff    Attack smoothing coefficient (close to 0 = fast)
 * @param releaseCoeff   Release smoothing coefficient (close to 1 = slow)
 */
export function processLimiter(
  input: Float32Array,
  ceiling: number,
  lookaheadSamples = 66,
  attackCoeff = 0.001,
  releaseCoeff = 0.9999
): Float32Array {
  const buf = new LookaheadBuffer(lookaheadSamples);
  const output = new Float32Array(input.length);
  let currentGain = 1.0;

  // Pre-fill the lookahead buffer
  for (let i = 0; i < Math.min(lookaheadSamples - 1, input.length); i++) {
    buf.push(input[i]);
  }

  for (let i = 0; i < input.length; i++) {
    const lookAheadIdx = i + lookaheadSamples - 1;
    if (lookAheadIdx < input.length) {
      buf.push(input[lookAheadIdx]);
    } else {
      buf.push(0);
    }

    const peakInWindow = buf.peakInWindow();
    const targetGain = computeLookaheadGain(peakInWindow, ceiling);

    // Smooth gain: fast attack, slow release
    if (targetGain < currentGain) {
      currentGain = attackCoeff * currentGain + (1 - attackCoeff) * targetGain;
    } else {
      currentGain = releaseCoeff * currentGain + (1 - releaseCoeff) * targetGain;
    }

    output[i] = input[i] * currentGain;
  }

  return output;
}
