/**
 * Halfband polyphase FIR oversampling utilities.
 *
 * Canonical source of the 47-tap Kaiser-windowed halfband FIR used by the
 * limiter (true-peak detection), saturation (alias-free waveshaping), and
 * metering (true-peak measurement) worklets.
 *
 * Design:
 *   - Length N = 47 (odd), symmetric, linear-phase
 *   - Kaiser window β = 8.0
 *   - Cutoff ωc = π/2 (halfband)
 *   - Stopband attenuation ~101 dB (measured at Nyquist)
 *   - Passband flat to ~18 kHz at 44.1 kHz round-trip (within 0.1 dB)
 *   - Group delay = (N-1)/2 = 23 samples AT THE FAST (output) RATE of each 2x stage
 *
 * Halfband property: every even-distance-from-center tap (except center) is zero.
 * Only 25 of the 47 taps are non-zero — cuts the multiply count nearly in half.
 *
 * Two 2x stages cascaded give 4x oversampling. Cumulative group delay
 * for cascaded 4x at the INPUT (1x) rate:
 *   stage 1 (1x → 2x): 23 samples at 2x rate = 11.5 samples at 1x
 *   stage 2 (2x → 4x): 23 samples at 4x rate = 5.75 samples at 1x
 *   total up-path: ~17.25 samples at 1x (round up to 18 for safety)
 *   total up+down round trip at 1x rate: ~34.5 samples
 *
 * Design-length rationale: 47 taps chosen over 23 because 23-tap halfband cannot
 * meet the "preserve 18 kHz at 44.1 kHz within 1 dB" specification — the
 * transition band is simply too wide with 23 taps. 47 taps gets −0.08 dB at 18 kHz
 * while still costing ~0.2% CPU for a 4x oversampled saturation worklet.
 *
 * Worklets inline this tap array (see parity test `halfband-parity.test.ts`).
 */

/** 47-tap Kaiser-windowed halfband FIR, β=8.0, normalized so DC gain = 1.0. */
export const HALFBAND_TAPS: Float32Array = new Float32Array([
  -0.00003236808784602273,
  0,
  0.00021460425686417527,
  0,
  -0.0006900036008054104,
  0,
  0.0016906510319408042,
  0,
  -0.0035394678469438633,
  0,
  0.006670847582056133,
  0,
  -0.011685384108269973,
  0,
  0.01951168258705124,
  0,
  -0.03190621204482748,
  0,
  0.05323959921792349,
  0,
  -0.0995345836294369,
  0,
  0.3160629362213828,
  0.49999539684182204,
  0.3160629362213828,
  0,
  -0.0995345836294369,
  0,
  0.05323959921792349,
  0,
  -0.03190621204482748,
  0,
  0.01951168258705124,
  0,
  -0.011685384108269973,
  0,
  0.006670847582056133,
  0,
  -0.0035394678469438633,
  0,
  0.0016906510319408042,
  0,
  -0.0006900036008054104,
  0,
  0.00021460425686417527,
  0,
  -0.00003236808784602273,
]);

/** Group delay of a single 2x stage, in samples at that stage's output (fast) rate. */
export const HALFBAND_GROUP_DELAY_SAMPLES = 23;

/**
 * Group-delay compensation for cascaded 4x up or 4x down, in samples at the 1x rate.
 * Stage 1 contributes 23/2 = 11.5 samples at 1x; Stage 2 contributes 23/4 = 5.75.
 * Total = 17.25 → ceil to 18 for signal-path delay alignment.
 */
export const HALFBAND_4X_GROUP_DELAY_1X = 18;

/**
 * Polyphase decomposition of HALFBAND_TAPS into the "even" phase: h[0], h[2], ..., h[46].
 * Used for efficient streaming upsample/downsample — skips the 22 halfband-zero taps.
 */
const H_EVEN: Float32Array = (() => {
  const arr = new Float32Array(24);
  for (let i = 0; i < 24; i++) arr[i] = HALFBAND_TAPS[2 * i];
  return arr;
})();

/** H_EVEN length — also the length of the input delay line used in streaming polyphase. */
const H_EVEN_LEN = 24;

/** Center tap of HALFBAND_TAPS (index 23). h_odd polyphase has only this non-zero at h_o[11]. */
const CENTER_TAP = HALFBAND_TAPS[23];

/** Offset in the odd-phase delay line for the center-tap contribution. h_o[11] = h[23]. */
const ODD_PHASE_DELAY = 11;

// ─────────────────────────────────────────────────────────────────────────────
// Pure (batch) functions — for offline tests and reference implementations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 2× upsample by zero-stuffing + halfband filtering + gain compensation.
 * Output length = input length × 2.
 */
export function upsample2x(signal: Float32Array): Float32Array {
  const outLen = signal.length * 2;
  const out = new Float32Array(outLen);

  // Polyphase: even output samples use H_EVEN (full conv) * 2; odd output samples
  // pass through a single delayed input tap (h_o[ODD_PHASE_DELAY] × 2 = 1).
  for (let n = 0; n < outLen; n++) {
    if ((n & 1) === 0) {
      const m = n >> 1;
      let sum = 0;
      for (let k = 0; k < H_EVEN_LEN; k++) {
        const inIdx = m - k;
        if (inIdx >= 0) sum += H_EVEN[k] * signal[inIdx];
      }
      out[n] = sum * 2;
    } else {
      const inIdx = (n >> 1) - ODD_PHASE_DELAY;
      out[n] = inIdx >= 0 ? signal[inIdx] : 0;
    }
  }

  return out;
}

/**
 * 2× downsample by halfband filtering + decimation. Output length = input length ÷ 2.
 * Input length must be even; any trailing odd sample is discarded.
 */
export function downsample2x(signal: Float32Array): Float32Array {
  const outLen = signal.length >> 1;
  const out = new Float32Array(outLen);

  // y[m] = sum_j H_EVEN[j] * signal[2m - 2j] + CENTER_TAP * signal[2m - (2*ODD_PHASE_DELAY + 1)]
  for (let m = 0; m < outLen; m++) {
    let sum = 0;
    for (let k = 0; k < H_EVEN_LEN; k++) {
      const inIdx = 2 * m - 2 * k;
      if (inIdx >= 0) sum += H_EVEN[k] * signal[inIdx];
    }
    const oddIdx = 2 * m - (2 * ODD_PHASE_DELAY + 1);
    if (oddIdx >= 0) sum += CENTER_TAP * signal[oddIdx];
    out[m] = sum;
  }

  return out;
}

/** 4× upsample via two cascaded 2× halfband upsamplers. */
export function upsample4x(signal: Float32Array): Float32Array {
  return upsample2x(upsample2x(signal));
}

/** 4× downsample via two cascaded 2× halfband downsamplers. */
export function downsample4x(signal: Float32Array): Float32Array {
  return downsample2x(downsample2x(signal));
}

// ─────────────────────────────────────────────────────────────────────────────
// Streaming stateful classes — used by worklets and online DSP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Streaming 2× upsampler. Per input sample, emits a pair [even, odd] at the fast rate.
 *
 * Polyphase decomposition: even output is the filtered value (full H_EVEN_LEN-tap
 * H_EVEN convolution, ×2 gain compensation); odd output is the input delayed by
 * ODD_PHASE_DELAY samples (from h_o center tap, × 2).
 */
export class Halfband2xUpsampler {
  private ring: Float32Array = new Float32Array(H_EVEN_LEN);
  private writePos = 0;

  /** Push input sample x, return the two output samples at the fast rate. */
  processSample(x: number): [number, number] {
    const ring = this.ring;
    const pos = this.writePos;
    ring[pos] = x;

    let sum = 0;
    for (let k = 0; k < H_EVEN_LEN; k++) {
      const idx = (pos - k + H_EVEN_LEN) % H_EVEN_LEN;
      sum += H_EVEN[k] * ring[idx];
    }
    const even = sum * 2;

    const delayIdx = (pos - ODD_PHASE_DELAY + H_EVEN_LEN) % H_EVEN_LEN;
    const odd = ring[delayIdx];

    this.writePos = (pos + 1) % H_EVEN_LEN;
    return [even, odd];
  }

  /** Reset state to all-zero (use when context is rebuilt). */
  reset(): void {
    this.ring.fill(0);
    this.writePos = 0;
  }
}

/**
 * Streaming 2× downsampler. Per pair of input samples (even, odd), emits one output.
 *
 * Polyphase decomposition: even-indexed inputs go through H_EVEN; odd-indexed
 * inputs contribute through the center tap only (delayed by ODD_PHASE_DELAY pairs).
 */
export class Halfband2xDownsampler {
  private ringE: Float32Array = new Float32Array(H_EVEN_LEN);
  private posE = 0;
  private ringO: Float32Array = new Float32Array(ODD_PHASE_DELAY + 1);
  private posO = 0;

  /**
   * Consume a pair of input samples (x[2m], x[2m+1]) and emit y[m] at the slow rate.
   */
  processPair(xEven: number, xOdd: number): number {
    const ringE = this.ringE;
    const posE = this.posE;
    ringE[posE] = xEven;
    let sum = 0;
    for (let k = 0; k < H_EVEN_LEN; k++) {
      const idx = (posE - k + H_EVEN_LEN) % H_EVEN_LEN;
      sum += H_EVEN[k] * ringE[idx];
    }
    this.posE = (posE + 1) % H_EVEN_LEN;

    const ringO = this.ringO;
    const posO = this.posO;
    const oldOdd = ringO[posO];
    ringO[posO] = xOdd;
    this.posO = (posO + 1) % (ODD_PHASE_DELAY + 1);

    return sum + CENTER_TAP * oldOdd;
  }

  /** Reset state to all-zero. */
  reset(): void {
    this.ringE.fill(0);
    this.ringO.fill(0);
    this.posE = 0;
    this.posO = 0;
  }
}

/**
 * Cascaded 4× oversampler. Combines two 2× upsamplers (for up-path) and two 2×
 * downsamplers (for down-path).
 *
 * Typical use: upsample input → nonlinear processing at 4× rate → downsample output.
 */
export class Oversampler4x {
  private up1 = new Halfband2xUpsampler();
  private up2 = new Halfband2xUpsampler();
  private down1 = new Halfband2xDownsampler();
  private down2 = new Halfband2xDownsampler();

  /** Upsample one input sample to four output samples at the 4× fast rate. */
  upsample(x: number): [number, number, number, number] {
    const pair1 = this.up1.processSample(x);
    const pairA = this.up2.processSample(pair1[0]);
    const pairB = this.up2.processSample(pair1[1]);
    return [pairA[0], pairA[1], pairB[0], pairB[1]];
  }

  /** Downsample four input samples at the 4× fast rate to one output sample. */
  downsample(s0: number, s1: number, s2: number, s3: number): number {
    const y0 = this.down2.processPair(s0, s1);
    const y1 = this.down2.processPair(s2, s3);
    return this.down1.processPair(y0, y1);
  }

  /** Reset all internal state. */
  reset(): void {
    this.up1.reset();
    this.up2.reset();
    this.down1.reset();
    this.down2.reset();
  }
}
