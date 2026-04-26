import { describe, it, expect } from "vitest";
import {
  SCRIPT_RENDER_BLOCK_SIZE,
  applyMoveOverride,
  envelopeValueAt,
  offlineSupportedMoves,
  resolveParamsAtTime,
} from "../script-renderer";
import { DEFAULT_PARAMS } from "@/lib/audio/presets";
import type { MasteringScript, Move } from "@/types/deep-mastering";

function makeMove(overrides: Partial<Move> = {}): Move {
  return {
    id: overrides.id ?? "m1",
    param: overrides.param ?? "master.compressor.threshold",
    startSec: overrides.startSec ?? 0,
    endSec: overrides.endSec ?? 1,
    envelope:
      overrides.envelope ?? [
        [0, -24],
        [1, -18],
      ],
    reason: overrides.reason ?? "",
    original: overrides.original ?? -24,
    edited: overrides.edited ?? false,
    muted: overrides.muted ?? false,
  };
}

function makeScript(moves: Move[]): MasteringScript {
  return {
    version: 1,
    trackId: "test",
    sampleRate: 48000,
    duration: 30,
    profile: "modern_pop_polish",
    sections: [],
    moves,
  };
}

describe("script-renderer", () => {
  describe("constants", () => {
    it("block size matches AudioWorklet quantum", () => {
      expect(SCRIPT_RENDER_BLOCK_SIZE).toBe(128);
    });
  });

  describe("envelopeValueAt", () => {
    const env = [
      [0, -24],
      [1, -18],
      [2, -12],
    ] as const;
    it("returns first value when time before envelope start", () => {
      expect(envelopeValueAt(env, -1)).toBe(-24);
    });
    it("returns last value when time after envelope end", () => {
      expect(envelopeValueAt(env, 5)).toBe(-12);
    });
    it("interpolates linearly between adjacent points", () => {
      expect(envelopeValueAt(env, 0.5)).toBeCloseTo(-21, 9);
      expect(envelopeValueAt(env, 1.5)).toBeCloseTo(-15, 9);
    });
    it("returns null for malformed (single-point) envelope", () => {
      expect(envelopeValueAt([[0, 1]], 0.5)).toBeNull();
    });
  });

  describe("applyMoveOverride", () => {
    it("maps master.compressor.threshold to threshold field", () => {
      const out = applyMoveOverride(DEFAULT_PARAMS, "master.compressor.threshold", -10);
      expect(out.threshold).toBe(-10);
    });
    it("maps master.eq.band1.gain to eq80 (legacy)", () => {
      const out = applyMoveOverride(DEFAULT_PARAMS, "master.eq.band1.gain", 4);
      expect(out.eq80).toBe(4);
    });
    it("maps master.eq.band5.gain to eq12k (legacy)", () => {
      const out = applyMoveOverride(DEFAULT_PARAMS, "master.eq.band5.gain", -2);
      expect(out.eq12k).toBe(-2);
    });
    it("maps master.saturation.drive to satDrive", () => {
      const out = applyMoveOverride(DEFAULT_PARAMS, "master.saturation.drive", 30);
      expect(out.satDrive).toBe(30);
    });
    it("returns the same object reference for unsupported MoveParam", () => {
      const out = applyMoveOverride(DEFAULT_PARAMS, "master.aiRepair.amount", 50);
      expect(out).toBe(DEFAULT_PARAMS);
    });
  });

  describe("resolveParamsAtTime", () => {
    it("returns base params when script is null", () => {
      expect(resolveParamsAtTime(DEFAULT_PARAMS, null, 0)).toBe(DEFAULT_PARAMS);
    });

    it("applies a single move's envelope value to the matching field", () => {
      const script = makeScript([
        makeMove({
          param: "master.compressor.threshold",
          envelope: [
            [0, -24],
            [1, -18],
          ],
        }),
      ]);
      const out = resolveParamsAtTime(DEFAULT_PARAMS, script, 0.5);
      expect(out.threshold).toBeCloseTo(-21, 9);
    });

    it("ignores muted moves", () => {
      const script = makeScript([
        makeMove({
          param: "master.compressor.threshold",
          envelope: [
            [0, -10],
            [1, -10],
          ],
          muted: true,
        }),
      ]);
      const out = resolveParamsAtTime(DEFAULT_PARAMS, script, 0.5);
      expect(out.threshold).toBe(DEFAULT_PARAMS.threshold);
    });

    it("overlays multiple moves on different fields", () => {
      const script = makeScript([
        makeMove({
          id: "a",
          param: "master.compressor.threshold",
          envelope: [
            [0, -20],
            [1, -20],
          ],
        }),
        makeMove({
          id: "b",
          param: "master.saturation.drive",
          envelope: [
            [0, 25],
            [1, 25],
          ],
        }),
      ]);
      const out = resolveParamsAtTime(DEFAULT_PARAMS, script, 0.5);
      expect(out.threshold).toBe(-20);
      expect(out.satDrive).toBe(25);
    });

    it("clamps to first/last point at envelope edges", () => {
      const script = makeScript([
        makeMove({
          param: "master.compressor.threshold",
          envelope: [
            [10, -20],
            [20, -10],
          ],
        }),
      ]);
      // Before envelope: clamped to first value.
      expect(resolveParamsAtTime(DEFAULT_PARAMS, script, 0).threshold).toBe(-20);
      // After envelope: clamped to last value.
      expect(resolveParamsAtTime(DEFAULT_PARAMS, script, 30).threshold).toBe(-10);
    });
  });

  describe("offlineSupportedMoves", () => {
    it("filters out unsupported MoveParams", () => {
      const script = makeScript([
        makeMove({ id: "a", param: "master.compressor.threshold" }),
        makeMove({ id: "b", param: "master.aiRepair.amount" }),
        makeMove({ id: "c", param: "master.compressor.attack" }),
        makeMove({ id: "d", param: "master.saturation.drive" }),
      ]);
      const out = offlineSupportedMoves(script);
      expect(out.map((m) => m.id)).toEqual(["a", "d"]);
    });
  });
});
