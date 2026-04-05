import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SeparationProgress } from "../SeparationProgress";

describe("SeparationProgress", () => {
  it("shows model name", () => {
    render(
      <SeparationProgress
        status="processing"
        progress={50}
        model="htdemucs_6s"
        stems={[]}
        error={null}
      />
    );
    expect(screen.getByText(/htdemucs_6s/)).toBeInTheDocument();
  });

  it("shows progress percentage", () => {
    render(
      <SeparationProgress
        status="processing"
        progress={50}
        model="htdemucs"
        stems={[]}
        error={null}
      />
    );
    expect(screen.getByText(/50%/)).toBeInTheDocument();
  });

  it("shows separating message when processing", () => {
    render(
      <SeparationProgress
        status="processing"
        progress={30}
        model="htdemucs"
        stems={[]}
        error={null}
      />
    );
    expect(screen.getByText(/separating/i)).toBeInTheDocument();
  });

  it("shows stem names when available", () => {
    render(
      <SeparationProgress
        status="done"
        progress={100}
        model="htdemucs"
        stems={[
          { name: "vocals", ready: true },
          { name: "drums", ready: true },
        ]}
        error={null}
      />
    );
    expect(screen.getByText("vocals")).toBeInTheDocument();
    expect(screen.getByText("drums")).toBeInTheDocument();
  });

  it("shows error message when error state", () => {
    render(
      <SeparationProgress
        status="error"
        progress={0}
        model="htdemucs"
        stems={[]}
        error="GPU out of memory"
      />
    );
    expect(screen.getByText(/GPU out of memory/)).toBeInTheDocument();
  });

  it("shows queued state", () => {
    render(
      <SeparationProgress
        status="queued"
        progress={0}
        model="htdemucs"
        stems={[]}
        error={null}
      />
    );
    expect(screen.getByText(/queued|waiting/i)).toBeInTheDocument();
  });
});
