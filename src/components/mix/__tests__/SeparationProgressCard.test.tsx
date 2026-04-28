import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SeparationProgressCard } from "../SeparationProgressCard";
import type { SeparationErrorDetails } from "@/lib/api/separation";

const noop = (): void => {};

describe("SeparationProgressCard", () => {
  it("renders nothing when status is idle", () => {
    const { container } = render(
      <SeparationProgressCard
        status="idle"
        activeStage={null}
        progress={0}
        elapsedSec={0}
        errorDetails={null}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders 'Separating…' card with progress and stages while analyzing", () => {
    render(
      <SeparationProgressCard
        status="analyzing"
        activeStage="separating-stems"
        progress={55}
        elapsedSec={42}
        errorDetails={null}
      />
    );
    expect(
      screen.getByTestId("separation-progress-card")
    ).toBeInTheDocument();
    expect(screen.getByTestId("separation-progress-elapsed")).toHaveTextContent(
      "0:42"
    );
    expect(
      screen.getByTestId("separation-progress-stage-separating-stems")
    ).toHaveAttribute("data-active", "true");
    expect(
      screen.getByTestId("separation-progress-stage-finalizing")
    ).toHaveAttribute("data-active", "false");
  });

  it("renders stage durations when provided", () => {
    render(
      <SeparationProgressCard
        status="analyzing"
        activeStage="finalizing"
        progress={92}
        elapsedSec={120}
        errorDetails={null}
        stageDurationsMs={{ "separating-stems": 60000, finalizing: 1500 }}
      />
    );
    expect(
      screen.getByTestId("separation-progress-stage-separating-stems-duration")
    ).toHaveTextContent("1m00s");
    expect(
      screen.getByTestId("separation-progress-stage-finalizing-duration")
    ).toHaveTextContent("1.5s");
  });

  it("renders failed-at-stage on error", () => {
    const details: SeparationErrorDetails = {
      message: "Demucs OOM",
      status: "backend-error",
      raw: "{}",
      at: "2026-04-28T15:00:00.000Z",
    };
    render(
      <SeparationProgressCard
        status="error"
        activeStage={null}
        progress={0}
        elapsedSec={5}
        errorDetails={details}
        failedAtStageLabel="Separating stems"
      />
    );
    expect(
      screen.getByTestId("separation-progress-error-message")
    ).toHaveTextContent("Failed at: Separating stems");
    expect(
      screen.getByTestId("separation-progress-error-detail-message")
    ).toHaveTextContent("Demucs OOM");
  });

  it("Show details reveals stage trace when set", () => {
    const details: SeparationErrorDetails = {
      message: "Boom",
      status: "500",
      raw: "{}",
      at: "2026-04-28T15:00:00.000Z",
    };
    render(
      <SeparationProgressCard
        status="error"
        activeStage={null}
        progress={0}
        elapsedSec={5}
        errorDetails={details}
        failedAtStageLabel="Separating stems"
        stageTraceText="queued +0.0s\nseparating-stems +1.0s (failed)"
      />
    );
    expect(screen.queryByTestId("separation-progress-stage-trace")).toBeNull();
    fireEvent.click(
      screen.getByTestId("separation-progress-details-toggle")
    );
    expect(
      screen.getByTestId("separation-progress-stage-trace")
    ).toHaveTextContent(/separating-stems/);
  });

  it("Cancel button calls onCancel", () => {
    const onCancel = vi.fn();
    render(
      <SeparationProgressCard
        status="analyzing"
        activeStage="separating-stems"
        progress={50}
        elapsedSec={10}
        errorDetails={null}
        onCancel={onCancel}
      />
    );
    fireEvent.click(screen.getByTestId("separation-progress-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("Retry button calls onRetry", () => {
    const onRetry = vi.fn();
    const details: SeparationErrorDetails = {
      message: "Boom",
      status: "500",
      raw: "{}",
      at: "2026-04-28T15:00:00.000Z",
    };
    render(
      <SeparationProgressCard
        status="error"
        activeStage={null}
        progress={0}
        elapsedSec={2}
        errorDetails={details}
        onRetry={onRetry}
      />
    );
    fireEvent.click(screen.getByTestId("separation-progress-retry"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("hides Cancel button when onCancel omitted", () => {
    render(
      <SeparationProgressCard
        status="analyzing"
        activeStage={null}
        progress={0}
        elapsedSec={0}
        errorDetails={null}
      />
    );
    expect(screen.queryByTestId("separation-progress-cancel")).toBeNull();
  });

  it("hides Retry button when onRetry omitted", () => {
    render(
      <SeparationProgressCard
        status="error"
        activeStage={null}
        progress={0}
        elapsedSec={1}
        errorDetails={{
          message: "X",
          status: "500",
          raw: "{}",
          at: "2026-04-28T15:00:00.000Z",
        }}
      />
    );
    expect(screen.queryByTestId("separation-progress-retry")).toBeNull();
  });
});
