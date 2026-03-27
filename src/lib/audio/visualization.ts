/**
 * Extract a static waveform overview from an AudioBuffer.
 * Returns an array of peak values (0-1) for rendering the waveform display.
 */
export function extractWaveformPeaks(
  buffer: AudioBuffer,
  targetBars: number = 200
): number[] {
  const channelData = buffer.getChannelData(0);
  const secondChannel =
    buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;

  const samplesPerBar = Math.floor(channelData.length / targetBars);
  const peaks: number[] = [];

  for (let i = 0; i < targetBars; i++) {
    const start = i * samplesPerBar;
    const end = Math.min(start + samplesPerBar, channelData.length);

    let peak = 0;
    for (let j = start; j < end; j++) {
      const val = Math.abs(channelData[j]);
      if (val > peak) peak = val;

      if (secondChannel) {
        const val2 = Math.abs(secondChannel[j]);
        if (val2 > peak) peak = val2;
      }
    }

    peaks.push(peak);
  }

  return peaks;
}

/**
 * Convert raw Float32Array frequency data (dB) from AnalyserNode into
 * normalized 0-1 values suitable for display, with logarithmic frequency mapping.
 */
export function normalizeSpectrumData(
  frequencyData: Float32Array,
  targetBins: number = 64,
  minDb: number = -100,
  maxDb: number = -20
): number[] {
  if (frequencyData.length === 0) return new Array(targetBins).fill(0);

  const result: number[] = [];
  const nyquist = frequencyData.length;

  for (let i = 0; i < targetBins; i++) {
    // Logarithmic frequency mapping: more resolution at low frequencies
    const t = i / (targetBins - 1);
    const freqIndex = Math.floor(Math.pow(t, 2) * (nyquist - 1));
    const clampedIndex = Math.min(freqIndex, frequencyData.length - 1);

    const db = frequencyData[clampedIndex];
    // Normalize from dB range to 0-1
    const normalized = (db - minDb) / (maxDb - minDb);
    result.push(Math.max(0, Math.min(1, normalized)));
  }

  return result;
}

/**
 * Convert raw peak amplitude (0-1 linear) to dBFS.
 */
export function linearToDbfs(linear: number): number {
  if (linear <= 0) return -Infinity;
  return 20 * Math.log10(linear);
}
