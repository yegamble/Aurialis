/**
 * Schema tests for parametric-EQ fields added to AudioParams.
 * Guards: every genre preset resolves to legal per-band freq / Q / type / mode,
 * and DEFAULT_PARAMS reproduces the pre-P3 EQ topology exactly.
 */

import { describe, it, expect } from "vitest";
import { DEFAULT_PARAMS, GENRE_PRESETS } from "../presets";
import type { AudioParams, EqBandType, EqBandMode } from "@/types/mastering";

const BANDS = [1, 2, 3, 4, 5] as const;
const TYPES: readonly EqBandType[] = [
  "bell",
  "lowShelf",
  "highShelf",
  "highPass",
  "lowPass",
];
const MODES: readonly EqBandMode[] = ["stereo", "ms"];

function bandKey<S extends string>(n: number, suffix: S): keyof AudioParams {
  return `eqBand${n}${suffix}` as keyof AudioParams;
}

describe("AudioParams — parametric EQ schema", () => {
  it("DEFAULT_PARAMS has master parametricEqEnabled = 1 (on by default)", () => {
    expect(DEFAULT_PARAMS.parametricEqEnabled).toBe(1);
  });

  it.each(BANDS)(
    "DEFAULT_PARAMS band %i has all six per-band fields set",
    (n) => {
      const p = DEFAULT_PARAMS as unknown as Record<string, unknown>;
      expect(typeof p[`eqBand${n}Enabled`]).toBe("number");
      expect(typeof p[`eqBand${n}Freq`]).toBe("number");
      expect(typeof p[`eqBand${n}Q`]).toBe("number");
      expect(typeof p[`eqBand${n}Type`]).toBe("string");
      expect(typeof p[`eqBand${n}Mode`]).toBe("string");
      expect(typeof p[`eqBand${n}MsBalance`]).toBe("number");
    },
  );

  it("DEFAULT_PARAMS reproduces the legacy 5-band EQ topology", () => {
    const p = DEFAULT_PARAMS;
    // Band 1: low-shelf @ 80 Hz
    expect(p.eqBand1Freq).toBe(80);
    expect(p.eqBand1Type).toBe("lowShelf");
    // Band 2: bell @ 250 Hz, Q=1
    expect(p.eqBand2Freq).toBe(250);
    expect(p.eqBand2Type).toBe("bell");
    expect(p.eqBand2Q).toBeCloseTo(1.0, 6);
    // Band 3: bell @ 1 kHz
    expect(p.eqBand3Freq).toBe(1000);
    expect(p.eqBand3Type).toBe("bell");
    expect(p.eqBand3Q).toBeCloseTo(1.0, 6);
    // Band 4: bell @ 4 kHz
    expect(p.eqBand4Freq).toBe(4000);
    expect(p.eqBand4Type).toBe("bell");
    expect(p.eqBand4Q).toBeCloseTo(1.0, 6);
    // Band 5: high-shelf @ 12 kHz
    expect(p.eqBand5Freq).toBe(12000);
    expect(p.eqBand5Type).toBe("highShelf");
  });

  it("DEFAULT_PARAMS has all bands enabled by default", () => {
    for (const n of BANDS) {
      const p = DEFAULT_PARAMS as unknown as Record<string, number>;
      expect(p[`eqBand${n}Enabled`]).toBe(1);
    }
  });

  it("DEFAULT_PARAMS has all bands in stereo mode with msBalance=0", () => {
    for (const n of BANDS) {
      const p = DEFAULT_PARAMS as unknown as Record<string, unknown>;
      expect(p[`eqBand${n}Mode`]).toBe("stereo");
      expect(p[`eqBand${n}MsBalance`]).toBe(0);
    }
  });

  it("legacy eq80..eq12k fields preserved on DEFAULT_PARAMS (= 0)", () => {
    expect(DEFAULT_PARAMS.eq80).toBe(0);
    expect(DEFAULT_PARAMS.eq250).toBe(0);
    expect(DEFAULT_PARAMS.eq1k).toBe(0);
    expect(DEFAULT_PARAMS.eq4k).toBe(0);
    expect(DEFAULT_PARAMS.eq12k).toBe(0);
  });
});

describe("GENRE_PRESETS — parametric EQ invariants", () => {
  const names = Object.keys(GENRE_PRESETS) as (keyof typeof GENRE_PRESETS)[];

  it.each(names)("%s preset resolves band fields in legal ranges", (name) => {
    const preset = GENRE_PRESETS[name] as unknown as Record<string, unknown>;
    for (const n of BANDS) {
      const freq = preset[`eqBand${n}Freq`] as number;
      const q = preset[`eqBand${n}Q`] as number;
      const type = preset[`eqBand${n}Type`] as EqBandType;
      const mode = preset[`eqBand${n}Mode`] as EqBandMode;
      const msBalance = preset[`eqBand${n}MsBalance`] as number;
      expect(freq).toBeGreaterThanOrEqual(20);
      expect(freq).toBeLessThanOrEqual(20000);
      expect(q).toBeGreaterThanOrEqual(0.1);
      expect(q).toBeLessThanOrEqual(10);
      expect(TYPES).toContain(type);
      expect(MODES).toContain(mode);
      expect(msBalance).toBeGreaterThanOrEqual(-1);
      expect(msBalance).toBeLessThanOrEqual(1);
    }
  });

  it.each(names)(
    "%s preset keeps legacy eq80..eq12k gain fields present",
    (name) => {
      const p = GENRE_PRESETS[name];
      expect(typeof p.eq80).toBe("number");
      expect(typeof p.eq250).toBe("number");
      expect(typeof p.eq1k).toBe("number");
      expect(typeof p.eq4k).toBe("number");
      expect(typeof p.eq12k).toBe("number");
    },
  );
});

describe("EqBandType / EqBandMode unions", () => {
  it("bandKey helper produces typed keys (compile-time check)", () => {
    // This test only needs to exist for the type annotation above to be exercised.
    const k = bandKey(1, "Freq");
    expect(typeof k).toBe("string");
  });
});
