import { describe, it, expect } from "vitest";
import { artGradient } from "../art-tile";

describe("artGradient", () => {
  it("is deterministic for the same seed", () => {
    expect(artGradient("fp-1")).toEqual(artGradient("fp-1"));
  });

  it("produces different gradients for different seeds", () => {
    const a = artGradient("Velvet Static");
    const b = artGradient("Slow Run");
    expect(a).not.toEqual(b);
  });

  it("returns valid hsl color strings", () => {
    const g = artGradient("anything");
    expect(g.a).toMatch(/^hsl\(\d+ \d+% \d+%\)$/);
    expect(g.b).toMatch(/^hsl\(\d+ \d+% \d+%\)$/);
    expect(g.accent).toMatch(/^hsl\(\d+ \d+% \d+%\)$/);
  });
});
