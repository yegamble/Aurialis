/**
 * Parity test: worklet-inlined HALFBAND_TAPS arrays match the canonical
 * `oversampling.ts` export exactly.
 *
 * Tests 5 and 6 will extend this file's `WORKLET_PATHS` array once those tasks
 * inline the same coefficients in saturation-processor.js and metering-processor.js.
 *
 * Includes a negative-control subtest that corrupts a tmp copy and asserts the
 * parity check detects the mismatch — guards against regex bugs silently
 * passing when no matches are found.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { HALFBAND_TAPS } from "../oversampling";

const WORKLETS_DIR = resolve(__dirname, "../../../../../public/worklets");

/** Worklets expected to contain the canonical HALFBAND_TAPS. */
const WORKLET_PATHS: string[] = [
  join(WORKLETS_DIR, "limiter-processor.js"),
  join(WORKLETS_DIR, "saturation-processor.js"),
  join(WORKLETS_DIR, "metering-processor.js"),
];

/**
 * Extract the HALFBAND_TAPS coefficient array from a worklet file. Returns null
 * if not found; returns parsed float list otherwise.
 *
 * Parser matches `new Float32Array([ ... ])` for the identifier `HALFBAND_TAPS`.
 */
function extractHalfbandTaps(fileContent: string): number[] | null {
  const regex =
    /HALFBAND_TAPS\s*=\s*new\s+Float32Array\s*\(\s*\[([\s\S]*?)\]\s*\)/;
  const match = fileContent.match(regex);
  if (!match) return null;
  const inner = match[1];
  // Extract all numeric literals (handles negative signs, decimals, scientific notation)
  const nums = inner.match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g);
  if (!nums) return null;
  return nums.map(Number);
}

describe("halfband-parity — worklet HALFBAND_TAPS match canonical", () => {
  it("canonical HALFBAND_TAPS has the expected length (47)", () => {
    expect(HALFBAND_TAPS.length).toBe(47);
  });

  it.each(WORKLET_PATHS)("worklet %s contains matching HALFBAND_TAPS", (path) => {
    const content = readFileSync(path, "utf8");
    const taps = extractHalfbandTaps(content);
    expect(taps, `HALFBAND_TAPS not found in ${path}`).not.toBeNull();
    const tapArr = taps as number[];
    // Exact count assertion — guards against regex silently matching nothing
    expect(
      tapArr.length,
      `expected ${HALFBAND_TAPS.length} taps, got ${tapArr.length} in ${path}`
    ).toBe(HALFBAND_TAPS.length);
    // Element-wise exact equality (within float32 representation tolerance)
    for (let i = 0; i < HALFBAND_TAPS.length; i++) {
      expect(
        Math.abs(tapArr[i] - HALFBAND_TAPS[i]),
        `mismatch at index ${i} in ${path}`
      ).toBeLessThan(1e-7);
    }
  });

  it("negative control: a corrupted worklet copy fails the parity check", () => {
    const sourcePath = WORKLET_PATHS[0];
    const source = readFileSync(sourcePath, "utf8");

    const tmp = mkdtempSync(join(tmpdir(), "halfband-parity-"));
    const corruptPath = join(tmp, "corrupted.js");

    // Corrupt one coefficient with a visibly different value (must exceed Float32 precision)
    const corrupted = source.replace(
      "0.3160629362213828,",
      "0.4200000000000000,"
    );
    writeFileSync(corruptPath, corrupted, "utf8");

    try {
      const taps = extractHalfbandTaps(readFileSync(corruptPath, "utf8"));
      expect(taps).not.toBeNull();
      const tapArr = taps as number[];

      let mismatchFound = false;
      for (let i = 0; i < HALFBAND_TAPS.length; i++) {
        if (Math.abs(tapArr[i] - HALFBAND_TAPS[i]) > 1e-7) {
          mismatchFound = true;
          break;
        }
      }
      expect(mismatchFound).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("regex extractor fails loudly on missing HALFBAND_TAPS (no false positives)", () => {
    const missing = "const foo = [1, 2, 3];\nconst bar = new Float32Array([4, 5]);";
    expect(extractHalfbandTaps(missing)).toBeNull();
  });
});
