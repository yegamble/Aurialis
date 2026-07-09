import { describe, it, expect } from "vitest";
import {
  envelopeBreakpoints,
  normalizedLevels,
} from "../deep-timeline-envelope";
import type { Move } from "@/types/deep-mastering";

function move(overrides: Partial<Move> = {}): Move {
  return {
    id: "m1",
    param: "master.inputGain",
    startSec: 0,
    endSec: 30,
    envelope: [[0, 0]],
    reason: "r",
    original: 0,
    edited: false,
    muted: false,
    ...overrides,
  };
}

describe("envelopeBreakpoints", () => {
  it("keeps the first point and every value change, skipping flat runs", () => {
    const points = envelopeBreakpoints(
      move({
        envelope: [
          [0, 0],
          [10, 0], // flat — skipped
          [15, 2], // change — kept
          [20, 2], // flat — skipped
          [25, -1], // change — kept
        ],
      }),
    );
    expect(points).toEqual([
      { t: 0, v: 0 },
      { t: 15, v: 2 },
      { t: 25, v: -1 },
    ]);
  });

  it("returns a single breakpoint for a flat envelope", () => {
    const points = envelopeBreakpoints(
      move({
        envelope: [
          [0, 1.5],
          [30, 1.5],
        ],
      }),
    );
    expect(points).toEqual([{ t: 0, v: 1.5 }]);
  });

  it("falls back to startSec/original for an empty or malformed envelope", () => {
    expect(
      envelopeBreakpoints(move({ envelope: [], startSec: 3, original: 0.5 })),
    ).toEqual([{ t: 3, v: 0.5 }]);
    expect(
      envelopeBreakpoints(
        move({
          envelope: [[Number.NaN, 1]] as unknown as Move["envelope"],
          startSec: 0,
          original: 2,
        }),
      ),
    ).toEqual([{ t: 0, v: 2 }]);
  });
});

describe("normalizedLevels", () => {
  it("maps min→0 and max→1", () => {
    const levels = normalizedLevels([
      { t: 0, v: -1 },
      { t: 10, v: 0 },
      { t: 20, v: 3 },
    ]);
    expect(levels[0]).toBe(0);
    expect(levels[1]).toBeCloseTo(0.25);
    expect(levels[2]).toBe(1);
  });

  it("centers a flat envelope at 0.5", () => {
    expect(normalizedLevels([{ t: 0, v: 2 }])).toEqual([0.5]);
    expect(
      normalizedLevels([
        { t: 0, v: 2 },
        { t: 5, v: 2 },
      ]),
    ).toEqual([0.5, 0.5]);
  });
});
