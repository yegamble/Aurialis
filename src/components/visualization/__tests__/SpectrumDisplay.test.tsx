import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SpectrumDisplay } from "../SpectrumDisplay";

// happy-dom's 2D canvas context is stub-ish; drawing does not throw. We assert
// the component mounts and that the `pro` prop is reflected on the container so
// Pro Mode's denser grid is observable (density itself is unit-tested in
// spectrum-density.test.ts).
const data = Array.from({ length: 64 }, (_, i) => i / 64);

describe("SpectrumDisplay", () => {
  it("mounts and defaults to standard (non-pro) density", () => {
    render(<SpectrumDisplay data={data} />);
    expect(screen.getByTestId("spectrum-display")).toHaveAttribute(
      "data-pro",
      "false"
    );
  });

  it("reflects Pro Mode on the container when pro is set", () => {
    render(<SpectrumDisplay data={data} pro />);
    expect(screen.getByTestId("spectrum-display")).toHaveAttribute(
      "data-pro",
      "true"
    );
  });

  it("does not throw with an empty data set", () => {
    expect(() => render(<SpectrumDisplay data={[]} pro />)).not.toThrow();
  });
});
