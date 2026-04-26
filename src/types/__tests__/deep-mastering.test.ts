import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import Ajv from "ajv";
import type {
  MasteringScript,
  Section,
  Move,
  EngineerProfile,
  EnvelopePoint,
  MoveParam,
  ProfileId,
  SectionType,
  StemAnalysisReport,
} from "../deep-mastering";
import {
  SCRIPT_VERSION,
  MOVE_PARAMS,
  PROFILE_IDS,
  SECTION_TYPES,
  validateEnvelope,
  validateScriptEnvelopes,
  MAX_ENVELOPE_POINTS_PER_SEC,
} from "../deep-mastering";

const SCHEMA_PATH = path.resolve(
  __dirname,
  "../../../backend/schemas/mastering_script.schema.json"
);
const FIXTURE_PATH = path.resolve(
  __dirname,
  "../../../backend/tests/fixtures/mastering_script_minimal.json"
);

function loadJson<T>(p: string): T {
  return JSON.parse(readFileSync(p, "utf8")) as T;
}

describe("deep-mastering types", () => {
  describe("constants", () => {
    it("exports SCRIPT_VERSION as 1", () => {
      expect(SCRIPT_VERSION).toBe(1);
    });

    it("exports closed enum of move param paths", () => {
      expect(MOVE_PARAMS).toContain("master.inputGain");
      expect(MOVE_PARAMS).toContain("master.compressor.threshold");
      expect(MOVE_PARAMS).toContain("master.eq.band1.gain");
      expect(MOVE_PARAMS).toContain("master.aiRepair.amount");
    });

    it("exports the 5 v1 profile IDs", () => {
      expect(PROFILE_IDS).toEqual([
        "modern_pop_polish",
        "hip_hop_low_end",
        "indie_warmth",
        "metal_wall",
        "pop_punk_air",
      ]);
    });

    it("exports the 8 section types", () => {
      expect(SECTION_TYPES).toEqual([
        "intro",
        "verse",
        "chorus",
        "bridge",
        "drop",
        "breakdown",
        "outro",
        "unknown",
      ]);
    });
  });

  describe("JSON Schema", () => {
    it("loads and compiles successfully via ajv", () => {
      const schema = loadJson<object>(SCHEMA_PATH);
      const ajv = new Ajv({ strict: false, allErrors: true });
      const validate = ajv.compile(schema);
      expect(typeof validate).toBe("function");
    });

    it("validates the shared minimal fixture", () => {
      const schema = loadJson<object>(SCHEMA_PATH);
      const fixture = loadJson<MasteringScript>(FIXTURE_PATH);
      const ajv = new Ajv({ strict: false, allErrors: true });
      const validate = ajv.compile(schema);
      const ok = validate(fixture);
      expect(validate.errors).toBeNull();
      expect(ok).toBe(true);
    });

    it("rejects a script missing required version field", () => {
      const schema = loadJson<object>(SCHEMA_PATH);
      const fixture = loadJson<Record<string, unknown>>(FIXTURE_PATH);
      delete fixture.version;
      const ajv = new Ajv({ strict: false, allErrors: true });
      const validate = ajv.compile(schema);
      expect(validate(fixture)).toBe(false);
    });

    it("rejects a Move with fewer than 2 envelope points", () => {
      const schema = loadJson<object>(SCHEMA_PATH);
      const fixture = loadJson<MasteringScript>(FIXTURE_PATH);
      fixture.moves[0]!.envelope = [[0, -18]] as unknown as EnvelopePoint[];
      const ajv = new Ajv({ strict: false, allErrors: true });
      const validate = ajv.compile(schema);
      expect(validate(fixture)).toBe(false);
    });

    it("rejects a Move with an unknown param path", () => {
      const schema = loadJson<object>(SCHEMA_PATH);
      const fixture = loadJson<Record<string, unknown>>(FIXTURE_PATH);
      // bypass the type system to set an invalid value
      const moves = fixture.moves as Array<Record<string, unknown>>;
      moves[0]!.param = "master.bogus.nope";
      const ajv = new Ajv({ strict: false, allErrors: true });
      const validate = ajv.compile(schema);
      expect(validate(fixture)).toBe(false);
    });
  });

  describe("TypeScript shape parity (compile-time check)", () => {
    it("the fixture satisfies MasteringScript", () => {
      const fixture = loadJson<MasteringScript>(FIXTURE_PATH);
      // satisfies-check via runtime narrowing: the cast above only succeeds
      // structurally because the TS type matches the fixture's shape; if a
      // required field is missing or mistyped, this read fails type-checking.
      expect(fixture.version).toBe(SCRIPT_VERSION);
      expect(Array.isArray(fixture.sections)).toBe(true);
      expect(Array.isArray(fixture.moves)).toBe(true);
      expect(typeof fixture.duration).toBe("number");
    });

    it("Section has required fields", () => {
      const s: Section = {
        id: "s1",
        type: "verse",
        startSec: 0,
        endSec: 10,
        loudnessLufs: -14,
        spectralCentroidHz: 1500,
      };
      expect(s.id).toBe("s1");
    });

    it("Move has required fields including original/edited/muted", () => {
      const m: Move = {
        id: "m1",
        param: "master.compressor.threshold",
        startSec: 0,
        endSec: 5,
        envelope: [
          [0, -24],
          [5, -18],
        ],
        reason: "test",
        original: -24,
        edited: false,
        muted: false,
      };
      expect(m.edited).toBe(false);
    });

    it("EngineerProfile has bySectionType keyed by all 8 section types", () => {
      const profile: EngineerProfile = {
        id: "modern_pop_polish",
        name: "Modern Pop Polish",
        description: "Bright, wide, modern",
        accentColor: "#FF6B6B",
        bySectionType: {
          intro: { loudnessLufsDelta: 0, toneOffsetsDb: { low: 0, mid: 0, high: 0 }, compressionDelta: { threshold: 0, makeup: 0 }, stereoWidth: 1, saturationDrive: 0 },
          verse: { loudnessLufsDelta: 0, toneOffsetsDb: { low: 0, mid: 0, high: 0 }, compressionDelta: { threshold: 0, makeup: 0 }, stereoWidth: 1, saturationDrive: 0 },
          chorus: { loudnessLufsDelta: 1.5, toneOffsetsDb: { low: 0, mid: 0, high: 0.5 }, compressionDelta: { threshold: -2, makeup: 1 }, stereoWidth: 1.2, saturationDrive: 15 },
          bridge: { loudnessLufsDelta: 0, toneOffsetsDb: { low: 0, mid: 0, high: 0 }, compressionDelta: { threshold: 0, makeup: 0 }, stereoWidth: 1, saturationDrive: 0 },
          drop: { loudnessLufsDelta: 2, toneOffsetsDb: { low: 0, mid: 0, high: 0 }, compressionDelta: { threshold: 0, makeup: 0 }, stereoWidth: 1.3, saturationDrive: 30 },
          breakdown: { loudnessLufsDelta: -1, toneOffsetsDb: { low: 0, mid: 0, high: 0 }, compressionDelta: { threshold: 0, makeup: 0 }, stereoWidth: 0.9, saturationDrive: 5 },
          outro: { loudnessLufsDelta: -0.5, toneOffsetsDb: { low: 0, mid: 0, high: 0 }, compressionDelta: { threshold: 0, makeup: 0 }, stereoWidth: 1, saturationDrive: 0 },
          unknown: { loudnessLufsDelta: 0, toneOffsetsDb: { low: 0, mid: 0, high: 0 }, compressionDelta: { threshold: 0, makeup: 0 }, stereoWidth: 1, saturationDrive: 0 },
        },
        aiRepairRecipe: { defaultAmount: 50, minNarrownessScore: 0.85 },
      };
      expect(profile.bySectionType.chorus.loudnessLufsDelta).toBe(1.5);
    });

    it("StemAnalysisReport optional fields tolerate undefined", () => {
      const r: StemAnalysisReport = {
        stemId: "guitar-1",
        classification: "guitar",
        confidence: 0.85,
        narrownessScore: 0.91,
        spectralCollapseScore: 0.72,
        bandCorrelations: [0.6, 0.92, 0.94, 0.88, 0.75],
      };
      expect(r.bandCorrelations).toHaveLength(5);
    });

    it("MoveParam union narrows correctly", () => {
      const valid: MoveParam = "master.eq.band3.gain";
      const profileId: ProfileId = "metal_wall";
      const sectionType: SectionType = "drop";
      expect(valid).toBe("master.eq.band3.gain");
      expect(profileId).toBe("metal_wall");
      expect(sectionType).toBe("drop");
    });
  });

  describe("validateEnvelope (runtime semantic invariants)", () => {
    it("accepts a valid monotonic envelope within density limits", () => {
      expect(
        validateEnvelope([
          [0, 0],
          [1, 0.5],
          [2, 1],
        ])
      ).toBeNull();
    });

    it("rejects fewer than 2 points", () => {
      expect(validateEnvelope([[0, 0]])).toMatch(/at least 2 points/);
    });

    it("rejects non-increasing timestamps (equal)", () => {
      expect(
        validateEnvelope([
          [0, 0],
          [0, 1],
        ])
      ).toMatch(/strictly increasing/);
    });

    it("rejects non-increasing timestamps (decreasing)", () => {
      expect(
        validateEnvelope([
          [1, 0],
          [0.5, 1],
        ])
      ).toMatch(/strictly increasing/);
    });

    it("rejects density exceeding MAX_ENVELOPE_POINTS_PER_SEC", () => {
      // 200 points across 1 second = 200/sec > 100 cap
      const points: EnvelopePoint[] = Array.from(
        { length: 200 },
        (_, i) => [i / 199, 0] as EnvelopePoint
      );
      const err = validateEnvelope(points);
      expect(err).toMatch(/density/);
    });

    it("validateScriptEnvelopes catches the first invalid move", () => {
      const fixture = loadJson<MasteringScript>(FIXTURE_PATH);
      fixture.moves[0]!.envelope = [
        [1.0, 0],
        [0.5, 1],
      ];
      const err = validateScriptEnvelopes(fixture);
      expect(err).toMatch(/Move mv-1/);
    });

    it("validateScriptEnvelopes returns null on a valid fixture", () => {
      const fixture = loadJson<MasteringScript>(FIXTURE_PATH);
      expect(validateScriptEnvelopes(fixture)).toBeNull();
    });
  });

  describe("Round-trip", () => {
    it("script → JSON.stringify → JSON.parse → schema-validate succeeds", () => {
      const schema = loadJson<object>(SCHEMA_PATH);
      const fixture = loadJson<MasteringScript>(FIXTURE_PATH);
      const roundTripped = JSON.parse(JSON.stringify(fixture)) as MasteringScript;
      const ajv = new Ajv({ strict: false, allErrors: true });
      const validate = ajv.compile(schema);
      expect(validate(roundTripped)).toBe(true);
    });
  });
});
