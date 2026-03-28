import { describe, it, expect } from "vitest";
import { computeAutoMasterParams, type AutoMasterResult } from "../auto-master";
import type { AnalysisResult } from "../analysis";

function makeAnalysis(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    integratedLufs: -18,
    peakDb: -3,
    dynamicRange: 10,
    bassRatio: 0.33,
    midRatio: 0.34,
    highRatio: 0.33,
    ...overrides,
  };
}

describe("computeAutoMasterParams", () => {
  it("returns intensity <= 40 for already-loud audio (LUFS > -12)", () => {
    const result = computeAutoMasterParams(makeAnalysis({ integratedLufs: -10 }));
    expect(result.intensity).toBeLessThanOrEqual(40);
  });

  it("returns intensity >= 60 for quiet audio (LUFS < -20)", () => {
    const result = computeAutoMasterParams(makeAnalysis({ integratedLufs: -24 }));
    expect(result.intensity).toBeGreaterThanOrEqual(60);
  });

  it("returns intensity around 50 for normal-level audio (-18 LUFS)", () => {
    const result = computeAutoMasterParams(makeAnalysis({ integratedLufs: -18 }));
    expect(result.intensity).toBeGreaterThanOrEqual(40);
    expect(result.intensity).toBeLessThanOrEqual(70);
  });

  it("detects bass-heavy material and reduces eq80", () => {
    const result = computeAutoMasterParams(
      makeAnalysis({ bassRatio: 0.55, midRatio: 0.25, highRatio: 0.20 })
    );
    expect(result.params.eq80).toBeLessThan(0);
  });

  it("detects bright material and reduces eq12k", () => {
    const result = computeAutoMasterParams(
      makeAnalysis({ bassRatio: 0.20, midRatio: 0.25, highRatio: 0.55 })
    );
    expect(result.params.eq12k).toBeLessThan(0);
  });

  it("detects high dynamic range and suggests classical/jazz genre", () => {
    const result = computeAutoMasterParams(makeAnalysis({ dynamicRange: 18 }));
    expect(["classical", "jazz"]).toContain(result.genre);
  });

  it("detects low dynamic range and suggests pop/electronic genre", () => {
    const result = computeAutoMasterParams(makeAnalysis({ dynamicRange: 5 }));
    expect(["pop", "electronic", "rock"]).toContain(result.genre);
  });

  it("returns valid AudioParams with all required fields", () => {
    const result = computeAutoMasterParams(makeAnalysis());
    const required = ["threshold", "ratio", "attack", "release", "makeup",
      "eq80", "eq250", "eq1k", "eq4k", "eq12k", "satDrive",
      "stereoWidth", "ceiling", "targetLufs"];
    for (const field of required) {
      expect(result.params[field as keyof typeof result.params], `${field} should be defined`).toBeDefined();
    }
  });

  it("returns intensity between 0 and 100", () => {
    const result = computeAutoMasterParams(makeAnalysis());
    expect(result.intensity).toBeGreaterThanOrEqual(0);
    expect(result.intensity).toBeLessThanOrEqual(100);
  });
});
