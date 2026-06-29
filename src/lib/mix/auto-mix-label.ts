/**
 * Format an analysis-stage name into a human Auto-Mix progress label.
 *
 * The stage harness emits stem stages as `stem-N/M` (1-based). The spec (TS-007)
 * wants this surfaced as "Analyzing stem N of M" — not the raw "stem N/M".
 */
export function formatAutoMixStageLabel(activeStage: string | null): string {
  if (activeStage && activeStage.startsWith("stem-")) {
    // "stem-1/3" → "Analyzing stem 1 of 3"
    return `Analyzing ${activeStage.replace("stem-", "stem ").replace("/", " of ")}`;
  }
  if (activeStage === "generate-mix") return "Generating mix…";
  if (activeStage === "apply") return "Applying mix…";
  return "Analyzing…";
}
