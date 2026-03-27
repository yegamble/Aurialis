/**
 * Programmatic test signal generator.
 * Generates Float32Array signals for DSP integration testing.
 */

/** Generate a mono sine wave */
export function generateSine(
  frequency: number,
  sampleRate: number,
  durationSeconds: number,
  amplitude = 1.0
): Float32Array {
  const length = Math.floor(sampleRate * durationSeconds);
  const buf = new Float32Array(length);
  const omega = (2 * Math.PI * frequency) / sampleRate;
  for (let i = 0; i < length; i++) {
    buf[i] = amplitude * Math.sin(omega * i);
  }
  return buf;
}

/** Generate white noise in [-amplitude, +amplitude] */
export function generateNoise(
  sampleRate: number,
  durationSeconds: number,
  amplitude = 1.0
): Float32Array {
  const length = Math.floor(sampleRate * durationSeconds);
  const buf = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    buf[i] = amplitude * (Math.random() * 2 - 1);
  }
  return buf;
}

/** Generate silence */
export function generateSilence(
  sampleRate: number,
  durationSeconds: number
): Float32Array {
  return new Float32Array(Math.floor(sampleRate * durationSeconds));
}

/** Generate a unit impulse (1 at sample 0, 0 elsewhere) */
export function generateImpulse(
  sampleRate: number,
  durationSeconds: number
): Float32Array {
  const buf = new Float32Array(Math.floor(sampleRate * durationSeconds));
  if (buf.length > 0) buf[0] = 1.0;
  return buf;
}

/** Compute peak level (max absolute value) in linear scale */
export function peakLevel(signal: Float32Array): number {
  let max = 0;
  for (let i = 0; i < signal.length; i++) {
    const abs = Math.abs(signal[i]);
    if (abs > max) max = abs;
  }
  return max;
}

/** Compute RMS level */
export function rmsLevel(signal: Float32Array): number {
  let sumSq = 0;
  for (let i = 0; i < signal.length; i++) {
    sumSq += signal[i] * signal[i];
  }
  return Math.sqrt(sumSq / signal.length);
}

/** Convert linear amplitude to dBFS */
export function linToDb(lin: number): number {
  return 20 * Math.log10(Math.max(lin, 1e-10));
}

/** Convert dBFS to linear amplitude */
export function dbToLin(db: number): number {
  return Math.pow(10, db / 20);
}

/** Count zero crossings to estimate frequency */
export function countZeroCrossings(signal: Float32Array): number {
  let count = 0;
  for (let i = 1; i < signal.length; i++) {
    if ((signal[i - 1] >= 0) !== (signal[i] >= 0)) count++;
  }
  return count;
}

/**
 * Create a mock AudioBuffer-like object for testing.
 * Returns an object with the same shape as AudioBuffer.
 */
export function makeAudioBuffer(
  channels: Float32Array[],
  sampleRate: number
): AudioBuffer {
  const length = channels[0]?.length ?? 0;
  return {
    numberOfChannels: channels.length,
    length,
    sampleRate,
    duration: length / sampleRate,
    getChannelData: (channel: number) => channels[channel] ?? new Float32Array(length),
  } as unknown as AudioBuffer;
}

/**
 * Encode a stereo signal as a minimal WAV file (16-bit PCM).
 * Useful for generating test files for Playwright tests.
 */
export function encodeWav(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number
): ArrayBuffer {
  const numChannels = 2;
  const numSamples = left.length;
  const bytesPerSample = 2;
  const dataSize = numSamples * numChannels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const write = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  write(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);           // chunk size
  view.setUint16(20, 1, true);            // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, 16, true);           // bit depth
  write(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const l = Math.max(-1, Math.min(1, left[i]));
    const r = Math.max(-1, Math.min(1, right[i]));
    view.setInt16(offset, l * 0x7fff, true); offset += 2;
    view.setInt16(offset, r * 0x7fff, true); offset += 2;
  }

  return buffer;
}
