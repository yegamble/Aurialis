import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS } from "../presets";
import {
  applySimpleToggles,
  applyTonePreset,
  matchesOutputPreset,
} from "../ui-presets";

describe("applySimpleToggles", () => {
  it("applies quick-toggle offsets without touching unrelated params", () => {
    const result = applySimpleToggles(DEFAULT_PARAMS, {
      warm: true,
      loud: true,
      cleanup: false,
      bright: false,
      wide: false,
      deharsh: false,
      glueComp: false,
    });

    expect(result.eq250).toBe(DEFAULT_PARAMS.eq250 + 2);
    expect(result.satDrive).toBe(DEFAULT_PARAMS.satDrive + 15);
    expect(result.makeup).toBe(DEFAULT_PARAMS.makeup + 3);
    expect(result.ceiling).toBe(DEFAULT_PARAMS.ceiling + 0.5);
    expect(result.threshold).toBe(DEFAULT_PARAMS.threshold);
  });
});

describe("applyTonePreset", () => {
  it("can apply and then remove a tone preset without leaving residue", () => {
    const warmed = applyTonePreset(DEFAULT_PARAMS, null, "Tape Warmth");
    const reset = applyTonePreset(warmed, "Tape Warmth", null);

    expect(warmed.eq250).toBe(DEFAULT_PARAMS.eq250 + 2);
    expect(warmed.satDrive).toBe(DEFAULT_PARAMS.satDrive + 15);
    expect(reset).toEqual(DEFAULT_PARAMS);
  });

  it("switches cleanly between tone presets", () => {
    const withWarmth = applyTonePreset(DEFAULT_PARAMS, null, "Tape Warmth");
    const withAir = applyTonePreset(withWarmth, "Tape Warmth", "Add Air");

    expect(withAir.eq250).toBe(DEFAULT_PARAMS.eq250);
    expect(withAir.satDrive).toBe(DEFAULT_PARAMS.satDrive);
    expect(withAir.eq4k).toBe(DEFAULT_PARAMS.eq4k + 1.5);
    expect(withAir.eq12k).toBe(DEFAULT_PARAMS.eq12k + 3);
  });
});

describe("matchesOutputPreset", () => {
  it("recognizes matching platform targets", () => {
    expect(matchesOutputPreset({ targetLufs: -16, ceiling: -1 }, "Apple Music")).toBe(true);
    expect(matchesOutputPreset({ targetLufs: -9, ceiling: -0.1 }, "CD")).toBe(true);
  });

  it("rejects mismatched target settings", () => {
    expect(matchesOutputPreset({ targetLufs: -14, ceiling: -0.5 }, "Spotify")).toBe(false);
    expect(matchesOutputPreset({ targetLufs: -14, ceiling: -1 }, "CD")).toBe(false);
  });
});
