/**
 * Deep mastering types — see backend/schemas/mastering_script.schema.json
 * for the canonical JSON Schema. Hand-mirrored here; the shape-check test
 * in __tests__/deep-mastering.test.ts validates a shared fixture against
 * BOTH this TypeScript type (via `satisfies`) and the JSON Schema (via
 * ajv) so drift between them fails CI.
 */

export const SCRIPT_VERSION = 1 as const;

export const SECTION_TYPES = [
  "intro",
  "verse",
  "chorus",
  "bridge",
  "drop",
  "breakdown",
  "outro",
  "unknown",
] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

export const MOVE_PARAMS = [
  "master.inputGain",
  "master.compressor.threshold",
  "master.compressor.ratio",
  "master.compressor.attack",
  "master.compressor.release",
  "master.compressor.makeup",
  "master.eq.band1.gain",
  "master.eq.band2.gain",
  "master.eq.band3.gain",
  "master.eq.band4.gain",
  "master.eq.band5.gain",
  "master.saturation.drive",
  "master.stereoWidth.width",
  "master.aiRepair.amount",
] as const;
export type MoveParam = (typeof MOVE_PARAMS)[number];

export const PROFILE_IDS = [
  "modern_pop_polish",
  "hip_hop_low_end",
  "indie_warmth",
  "metal_wall",
  "pop_punk_air",
] as const;
export type ProfileId = (typeof PROFILE_IDS)[number];

export interface Section {
  id: string;
  type: SectionType;
  startSec: number;
  endSec: number;
  loudnessLufs: number;
  spectralCentroidHz: number;
}

export type EnvelopePoint = readonly [number, number];

export interface Move {
  id: string;
  param: MoveParam;
  startSec: number;
  endSec: number;
  envelope: EnvelopePoint[];
  reason: string;
  original: number;
  edited: boolean;
  muted: boolean;
}

export interface ProfileSectionTargets {
  loudnessLufsDelta: number;
  toneOffsetsDb: { low: number; mid: number; high: number };
  compressionDelta: { threshold: number; makeup: number };
  stereoWidth: number;
  /** Saturation drive 0–100 for this section type. */
  saturationDrive: number;
}

export interface AiRepairRecipe {
  defaultAmount: number;
  minNarrownessScore: number;
}

export interface EngineerProfile {
  id: ProfileId;
  name: string;
  description: string;
  accentColor: string;
  bySectionType: Record<SectionType, ProfileSectionTargets>;
  aiRepairRecipe: AiRepairRecipe;
}

export interface StemAnalysisReport {
  stemId: string;
  classification: string;
  confidence: number;
  narrownessScore: number;
  spectralCollapseScore: number;
  bandCorrelations: number[];
}

export interface MasteringScript {
  version: typeof SCRIPT_VERSION;
  trackId: string;
  sampleRate: number;
  duration: number;
  profile: ProfileId;
  sections: Section[];
  moves: Move[];
  stemAnalysis?: StemAnalysisReport[];
}

/** Max envelope points per second per move (script generator must enforce). */
export const MAX_ENVELOPE_POINTS_PER_SEC = 100;

/**
 * Validate semantic invariants on an envelope that JSON Schema cannot
 * express: timestamps strictly increasing, density within limits.
 * Returns null when valid, otherwise a human-readable reason string.
 */
export function validateEnvelope(points: EnvelopePoint[]): string | null {
  if (points.length < 2) return "envelope must have at least 2 points";
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const cur = points[i]!;
    if (cur[0] <= prev[0]) {
      return `envelope timestamps must be strictly increasing (index ${i}: ${cur[0]} <= ${prev[0]})`;
    }
  }
  const span = points[points.length - 1]![0] - points[0]![0];
  if (span > 0) {
    const density = points.length / span;
    if (density > MAX_ENVELOPE_POINTS_PER_SEC) {
      return `envelope density ${density.toFixed(2)} pts/sec exceeds max ${MAX_ENVELOPE_POINTS_PER_SEC}`;
    }
  }
  return null;
}

/** Validate every Move in a script. Returns first error or null. */
export function validateScriptEnvelopes(script: MasteringScript): string | null {
  for (const m of script.moves) {
    const err = validateEnvelope(m.envelope);
    if (err) return `Move ${m.id} (${m.param}): ${err}`;
  }
  return null;
}
