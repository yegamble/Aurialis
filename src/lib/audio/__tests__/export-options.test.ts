import { describe, it, expect } from "vitest";
import { buildExportOptions } from "../export-options";
import type { MasteringScript } from "@/types/deep-mastering";

const settings = { sampleRate: 48000, bitDepth: 24 as const, dither: "tpdf" as const };

const script: MasteringScript = {
  version: 1,
  trackId: "t1",
  sampleRate: 48000,
  duration: 30,
  profile: "modern_pop_polish",
  sections: [],
  moves: [],
};

describe("buildExportOptions", () => {
  it("includes the deep script when scriptActive (export == preview)", () => {
    expect(buildExportOptions(settings, { script, scriptActive: true }).script).toBe(script);
  });

  it("drops the script (null) when scriptActive is false", () => {
    expect(buildExportOptions(settings, { script, scriptActive: false }).script).toBeNull();
  });

  it("passes a null script through unchanged", () => {
    expect(buildExportOptions(settings, { script: null, scriptActive: true }).script).toBeNull();
  });

  it("forwards sampleRate / bitDepth / dither", () => {
    const o = buildExportOptions(settings, { script: null, scriptActive: true });
    expect(o).toMatchObject({ sampleRate: 48000, bitDepth: 24, dither: "tpdf" });
  });
});
