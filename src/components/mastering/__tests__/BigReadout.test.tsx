import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BigReadout } from "../BigReadout";

describe("BigReadout", () => {
  it("renders label, value, and sub when provided", () => {
    render(<BigReadout label="LUFS-I" value="-8.7" sub="Target −9.5" />);
    expect(screen.getByTestId("big-readout-label")).toHaveTextContent("LUFS-I");
    expect(screen.getByTestId("big-readout-value")).toHaveTextContent("-8.7");
    expect(screen.getByTestId("big-readout-sub")).toHaveTextContent("Target −9.5");
  });

  it("omits the sub element when no sub is provided", () => {
    render(<BigReadout label="LRA" value="5.1" />);
    expect(screen.queryByTestId("big-readout-sub")).not.toBeInTheDocument();
  });

  it("renders em-dash placeholder when value is undefined or null", () => {
    render(<BigReadout label="Corr" value={null} />);
    expect(screen.getByTestId("big-readout-value")).toHaveTextContent("—");
  });

  it("marks warn=true with data-warn attribute and red text class", () => {
    render(<BigReadout label="dBTP" value="-0.2" warn />);
    const value = screen.getByTestId("big-readout-value");
    expect(value).toHaveAttribute("data-warn", "true");
    expect(value.className).toMatch(/text-(red|destructive)/);
  });

  it("marks emphasized=true with data-emphasized", () => {
    render(<BigReadout label="LUFS-I" value="-8.7" emphasized />);
    expect(screen.getByTestId("big-readout")).toHaveAttribute("data-emphasized", "true");
  });

  it("uses tabular-nums for numerical alignment", () => {
    render(<BigReadout label="LUFS-I" value="-8.7" />);
    expect(screen.getByTestId("big-readout-value").className).toMatch(/tabular-nums/);
  });
});
