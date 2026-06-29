import { describe, it, expect } from "vitest";
import { formatAutoMixStageLabel } from "../auto-mix-label";

describe("formatAutoMixStageLabel", () => {
  it("renders stem stages as 'stem N of M' (not the raw 'stem N/M')", () => {
    expect(formatAutoMixStageLabel("stem-1/3")).toBe("Analyzing stem 1 of 3");
    expect(formatAutoMixStageLabel("stem-2/2")).toBe("Analyzing stem 2 of 2");
    expect(formatAutoMixStageLabel("stem-10/12")).toBe("Analyzing stem 10 of 12");
  });

  it("maps the mix-build stages", () => {
    expect(formatAutoMixStageLabel("generate-mix")).toBe("Generating mix…");
    expect(formatAutoMixStageLabel("apply")).toBe("Applying mix…");
  });

  it("falls back to a generic label for null / unknown stages", () => {
    expect(formatAutoMixStageLabel(null)).toBe("Analyzing…");
    expect(formatAutoMixStageLabel("something-else")).toBe("Analyzing…");
  });
});
