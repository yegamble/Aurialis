import { describe, it, expect } from "vitest";
import { spectrumDensity } from "../spectrum-density";

describe("spectrumDensity", () => {
  it("standard mode has no gridlines and the sparse label set", () => {
    const { labels, gridlines } = spectrumDensity(false);
    expect(gridlines).toBe(false);
    expect(labels).toEqual(["20", "100", "1k", "5k", "10k", "20k"]);
  });

  it("pro mode enables gridlines", () => {
    expect(spectrumDensity(true).gridlines).toBe(true);
  });

  it("pro mode is strictly denser than standard (more labels)", () => {
    expect(spectrumDensity(true).labels.length).toBeGreaterThan(
      spectrumDensity(false).labels.length
    );
  });

  it("pro labels are ordered low → high and stay within the audible band", () => {
    const { labels } = spectrumDensity(true);
    expect(labels[0]).toBe("20");
    expect(labels[labels.length - 1]).toBe("20k");
  });
});
