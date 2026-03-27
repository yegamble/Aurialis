/**
 * Oversampling utilities: upsample, downsample, and oversample helper.
 * Uses a windowed-sinc FIR low-pass filter for anti-aliasing.
 */

/**
 * Build a windowed-sinc FIR low-pass filter kernel.
 * @param cutoff  Normalized cutoff frequency (0 to 0.5, where 0.5 = Nyquist)
 * @param length  Filter length (odd number recommended)
 */
function makeSincFilter(cutoff: number, length: number): Float32Array {
  const h = new Float32Array(length);
  const M = length - 1;
  const half = M / 2;
  let sum = 0;
  for (let n = 0; n < length; n++) {
    const t = n - half;
    // Sinc function
    let sinc: number;
    if (t === 0) {
      sinc = 2 * cutoff;
    } else {
      sinc = Math.sin(2 * Math.PI * cutoff * t) / (Math.PI * t);
    }
    // Blackman window for good stopband attenuation
    const w =
      0.42 -
      0.5 * Math.cos((2 * Math.PI * n) / M) +
      0.08 * Math.cos((4 * Math.PI * n) / M);
    h[n] = sinc * w;
    sum += h[n];
  }
  // Normalize to unity gain at DC
  for (let n = 0; n < length; n++) h[n] /= sum;
  return h;
}

/**
 * Apply FIR filter to a signal.
 */
function applyFir(signal: Float32Array, h: Float32Array): Float32Array {
  const out = new Float32Array(signal.length);
  const M = h.length;
  for (let i = 0; i < signal.length; i++) {
    let acc = 0;
    for (let k = 0; k < M; k++) {
      const j = i - k;
      if (j >= 0) acc += h[k] * signal[j];
    }
    out[i] = acc;
  }
  return out;
}

/**
 * Upsample by inserting `factor-1` zeros between samples, then LP-filter.
 * @param signal  Input samples
 * @param factor  Oversampling factor (e.g., 4)
 */
export function upsample(signal: Float32Array, factor: number): Float32Array {
  const upLen = signal.length * factor;
  const upsampled = new Float32Array(upLen);

  // Insert input samples at positions 0, factor, 2*factor, ...
  for (let i = 0; i < signal.length; i++) {
    upsampled[i * factor] = signal[i] * factor; // scale to compensate for zero insertion
  }

  // Low-pass filter at Nyquist/factor (normalized: 0.5/factor)
  const cutoff = 0.5 / factor;
  const filterLen = 64 * factor + 1; // enough taps for good stopband rejection
  const h = makeSincFilter(cutoff, filterLen);
  return applyFir(upsampled, h);
}

/**
 * Downsample by applying LP-filter then decimating by `factor`.
 * @param signal  Input samples (length must be divisible by factor)
 * @param factor  Downsampling factor (e.g., 4)
 */
export function downsample(signal: Float32Array, factor: number): Float32Array {
  const cutoff = 0.5 / factor;
  const filterLen = 64 * factor + 1;
  const h = makeSincFilter(cutoff, filterLen);
  const filtered = applyFir(signal, h);

  const outLen = Math.floor(signal.length / factor);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    out[i] = filtered[i * factor];
  }
  return out;
}

/**
 * Apply a processing function at `factor`x the sample rate (oversampling).
 * Returns output at the original sample rate.
 *
 * @param signal     Input samples at original sample rate
 * @param factor     Oversampling factor (4 for standard quality)
 * @param processFn  Processing function operating on upsampled signal
 */
export function oversample(
  signal: Float32Array,
  factor: number,
  processFn: (upsampled: Float32Array) => Float32Array
): Float32Array {
  const upsampled = upsample(signal, factor);
  const processed = processFn(upsampled);
  return downsample(processed, factor);
}
