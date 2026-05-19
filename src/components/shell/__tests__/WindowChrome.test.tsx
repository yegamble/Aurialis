import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WindowChrome } from "../WindowChrome";

describe("WindowChrome", () => {
  it("renders three traffic-light controls", () => {
    render(<WindowChrome />);
    expect(screen.getByTestId("window-traffic-close")).toBeInTheDocument();
    expect(screen.getByTestId("window-traffic-minimize")).toBeInTheDocument();
    expect(screen.getByTestId("window-traffic-maximize")).toBeInTheDocument();
  });

  it("renders default title 'Aurialis'", () => {
    render(<WindowChrome />);
    expect(screen.getByTestId("window-chrome-title")).toHaveTextContent("Aurialis");
  });

  it("renders custom title when provided", () => {
    render(<WindowChrome title="Aurialis · Master" />);
    expect(screen.getByTestId("window-chrome-title")).toHaveTextContent("Aurialis · Master");
  });

  it("uses banner landmark", () => {
    render(<WindowChrome />);
    expect(screen.getByRole("banner")).toBeInTheDocument();
  });
});
