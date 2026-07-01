/**
 * Density profile for {@link SpectrumDisplay}.
 *
 * Pro Mode asks for a denser spectrum readout: more frequency reference points
 * and vertical gridlines behind the curve. Standard mode keeps the sparse,
 * clean set. Kept pure (no canvas) so the density decision is unit-testable.
 */

export interface SpectrumDensity {
  /** Frequency labels drawn along the x-axis, low → high. */
  labels: string[];
  /** Draw vertical gridlines at each label position. */
  gridlines: boolean;
}

const STANDARD_LABELS = ["20", "100", "1k", "5k", "10k", "20k"];
const PRO_LABELS = [
  "20",
  "50",
  "100",
  "200",
  "500",
  "1k",
  "2k",
  "5k",
  "10k",
  "20k",
];

/**
 * Resolve the label set + gridline flag for the given mode. Pro is strictly
 * denser than standard (more labels + gridlines).
 */
export function spectrumDensity(pro: boolean): SpectrumDensity {
  return pro
    ? { labels: PRO_LABELS, gridlines: true }
    : { labels: STANDARD_LABELS, gridlines: false };
}
