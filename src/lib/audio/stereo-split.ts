/**
 * Stereo Sub-Split — separates a stereo stem into left-panned and
 * right-panned content using Mid/Side decoding.
 *
 * Used after Demucs separation to split panned instruments (e.g., left
 * rhythm guitar vs right rhythm guitar, stereo synth layers).
 */

export interface PanAnalysis {
  hasPannedContent: boolean;
  sideEnergyRatio: number;
}

export interface StereoSplitResult {
  left: Float32Array;
  right: Float32Array;
  hasPannedContent: boolean;
}

/** Threshold: if side energy > 20% of total, there's meaningful stereo content. */
const PAN_THRESHOLD = 0.2;

/**
 * Analyze a stereo buffer for panned content using M/S energy ratio.
 * High side energy = significant stereo spread = panned instruments.
 */
export function analyzePanContent(buffer: AudioBuffer): PanAnalysis {
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1
    ? buffer.getChannelData(1)
    : left;

  let midEnergy = 0;
  let sideEnergy = 0;

  for (let i = 0; i < left.length; i++) {
    const mid = (left[i] + right[i]) * 0.5;
    const side = (left[i] - right[i]) * 0.5;
    midEnergy += mid * mid;
    sideEnergy += side * side;
  }

  const totalEnergy = midEnergy + sideEnergy;
  const sideEnergyRatio = totalEnergy > 0 ? sideEnergy / totalEnergy : 0;

  return {
    hasPannedContent: sideEnergyRatio > PAN_THRESHOLD,
    sideEnergyRatio,
  };
}

/**
 * Split a stereo buffer into left-panned and right-panned content.
 *
 * Algorithm:
 * 1. M/S encode: mid = (L+R)/2, side = (L-R)/2
 * 2. Left sub-stem = mid + side (reconstructs original left channel)
 * 3. Right sub-stem = mid - side (reconstructs original right channel)
 *
 * This effectively isolates content based on its stereo position.
 * For a hard-panned left guitar, it appears in the left sub-stem.
 * For a centered vocal, it appears equally in both (and can be removed
 * by the mixer's mute/solo controls).
 */
export function stereoSplit(buffer: AudioBuffer): StereoSplitResult {
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1
    ? buffer.getChannelData(1)
    : left;

  const { hasPannedContent } = analyzePanContent(buffer);

  const leftOut = new Float32Array(left.length);
  const rightOut = new Float32Array(left.length);

  for (let i = 0; i < left.length; i++) {
    // M/S encode
    const mid = (left[i] + right[i]) * 0.5;
    const side = (left[i] - right[i]) * 0.5;

    // Reconstruct left-panned and right-panned content
    // Left sub-stem emphasizes left channel: mid + side = L
    // Right sub-stem emphasizes right channel: mid - side = R
    leftOut[i] = mid + side;
    rightOut[i] = mid - side;
  }

  return { left: leftOut, right: rightOut, hasPannedContent };
}
