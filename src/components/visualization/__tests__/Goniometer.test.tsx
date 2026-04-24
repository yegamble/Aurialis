import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Goniometer } from "../Goniometer";

/**
 * Phase 4a Task 6: Goniometer component basic smoke tests.
 *
 * happy-dom lacks a real AudioContext, so we pass in a mock AnalyserNode-like
 * object that satisfies the `AnalyserNode` subset the component uses
 * (`fftSize` + `getFloatTimeDomainData`).
 */

function mockAnalyser(fill: (buf: Float32Array) => void): AnalyserNode {
  return {
    fftSize: 2048,
    smoothingTimeConstant: 0,
    getFloatTimeDomainData: (buf: Float32Array) => fill(buf),
    // Other AnalyserNode members are not exercised.
  } as unknown as AnalyserNode;
}

describe("Goniometer (Phase 4a Task 6)", () => {
  it("renders a canvas with the goniometer test-id", () => {
    render(<Goniometer left={null} right={null} />);
    expect(screen.getByTestId("goniometer-canvas")).toBeInTheDocument();
  });

  it("renders idle state when analysers are null (no throw)", () => {
    expect(() =>
      render(<Goniometer left={null} right={null} />)
    ).not.toThrow();
  });

  it("mounts without throwing when both analysers are provided", () => {
    const leftA = mockAnalyser((buf) => {
      for (let i = 0; i < buf.length; i++) buf[i] = 0.1;
    });
    const rightA = mockAnalyser((buf) => {
      for (let i = 0; i < buf.length; i++) buf[i] = 0.1;
    });

    // happy-dom's canvas 2D context is stub-ish; we only assert that the
    // component mounts successfully and the canvas is present. Real drawing
    // is verified via browser automation (TS-005).
    expect(() =>
      render(<Goniometer left={leftA} right={rightA} />)
    ).not.toThrow();
    expect(screen.getByTestId("goniometer-canvas")).toBeInTheDocument();
  });

  it("supports custom size prop", () => {
    render(<Goniometer left={null} right={null} size={64} />);
    const canvas = screen.getByTestId("goniometer-canvas") as HTMLCanvasElement;
    expect(canvas.width).toBe(64);
    expect(canvas.height).toBe(64);
  });
});
