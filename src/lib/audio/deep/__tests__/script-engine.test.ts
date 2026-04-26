import { describe, it, expect, vi } from "vitest";
import {
  applyMove,
  applyScript,
  clearScript,
  computeContextOffset,
  translateEnvelope,
} from "../script-engine";
import type { ProcessingChain } from "../../chain";
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

function makeMockChain(applyResult: boolean = true): ProcessingChain {
  return {
    applyMoveEnvelope: vi.fn().mockReturnValue(applyResult),
    clearMoveEnvelope: vi.fn().mockReturnValue(applyResult),
  } as unknown as ProcessingChain;
}

describe("script-engine", () => {
  describe("computeContextOffset", () => {
    it("offset = contextTimeAtPlayStart when starting from track 0", () => {
      expect(computeContextOffset(17.4, 0)).toBe(17.4);
    });
    it("subtracts startedFromTrackTime when resuming mid-track", () => {
      expect(computeContextOffset(17.4, 5)).toBeCloseTo(12.4, 9);
    });
  });

  describe("translateEnvelope", () => {
    it("shifts every timestamp by offset, leaves values untouched", () => {
      const out = translateEnvelope(
        [
          [0, -24],
          [1, -18],
          [2, -12],
        ],
        12
      );
      expect(out).toEqual([
        [12, -24],
        [13, -18],
        [14, -12],
      ]);
    });
    it("returns empty array for empty envelope", () => {
      expect(translateEnvelope([], 5)).toEqual([]);
    });
  });

  describe("applyMove", () => {
    it("posts a translated envelope to the chain", () => {
      const chain = makeMockChain();
      const move = makeMove({
        envelope: [
          [0, -24],
          [1, -18],
        ],
      });
      const ok = applyMove(chain, move, 17, 0);
      expect(ok).toBe(true);
      expect(chain.applyMoveEnvelope).toHaveBeenCalledWith(
        "master.compressor.threshold",
        [
          [17, -24],
          [18, -18],
        ]
      );
    });

    it("clears the envelope when the move is muted", () => {
      const chain = makeMockChain();
      const move = makeMove({ muted: true });
      const ok = applyMove(chain, move, 17, 0);
      expect(ok).toBe(true);
      expect(chain.clearMoveEnvelope).toHaveBeenCalledWith(
        "master.compressor.threshold"
      );
      expect(chain.applyMoveEnvelope).not.toHaveBeenCalled();
    });

    it("returns false when the chain rejects the param (no scheduling target)", () => {
      const chain = makeMockChain(false);
      const move = makeMove({ param: "master.compressor.attack" });
      expect(applyMove(chain, move, 0, 0)).toBe(false);
    });
  });

  describe("applyScript", () => {
    it("posts each move and returns the count of accepted envelopes", () => {
      const chain = makeMockChain();
      const script = makeScript([
        makeMove({ id: "a", param: "master.compressor.threshold" }),
        makeMove({ id: "b", param: "master.saturation.drive" }),
      ]);
      const posted = applyScript(chain, script, 10, 0);
      expect(posted).toBe(2);
      expect(chain.applyMoveEnvelope).toHaveBeenCalledTimes(2);
    });

    it("counts only moves the chain accepts", () => {
      const chain = {
        applyMoveEnvelope: vi
          .fn()
          .mockReturnValueOnce(true)
          .mockReturnValueOnce(false),
        clearMoveEnvelope: vi.fn().mockReturnValue(true),
      } as unknown as ProcessingChain;
      const script = makeScript([
        makeMove({ id: "a" }),
        makeMove({ id: "b" }),
      ]);
      expect(applyScript(chain, script, 0, 0)).toBe(1);
    });
  });

  describe("clearScript", () => {
    it("calls clearMoveEnvelope for every move's param", () => {
      const chain = makeMockChain();
      const script = makeScript([
        makeMove({ id: "a", param: "master.compressor.threshold" }),
        makeMove({ id: "b", param: "master.saturation.drive" }),
      ]);
      clearScript(chain, script);
      expect(chain.clearMoveEnvelope).toHaveBeenCalledTimes(2);
      expect(chain.clearMoveEnvelope).toHaveBeenCalledWith(
        "master.compressor.threshold"
      );
      expect(chain.clearMoveEnvelope).toHaveBeenCalledWith(
        "master.saturation.drive"
      );
    });
  });
});
