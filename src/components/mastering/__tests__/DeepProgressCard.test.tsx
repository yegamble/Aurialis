import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DeepProgressCard } from "../DeepProgressCard";
import type { DeepErrorDetails } from "@/lib/api/deep-analysis";

const noop = () => {};

describe("DeepProgressCard", () => {
  it("renders nothing when status is idle", () => {
    const { container } = render(
      <DeepProgressCard
        status="idle"
        subStatus={null}
        progress={0}
        elapsedSec={0}
        errorDetails={null}
        onRetry={noop}
        onCancel={noop}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when status is ready", () => {
    const { container } = render(
      <DeepProgressCard
        status="ready"
        subStatus={null}
        progress={100}
        elapsedSec={42}
        errorDetails={null}
        onRetry={noop}
        onCancel={noop}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders progress card in analyzing state with progress bar, stages, timer, and Cancel button", () => {
    render(
      <DeepProgressCard
        status="analyzing"
        subStatus="sections"
        progress={42}
        elapsedSec={75}
        errorDetails={null}
        onRetry={noop}
        onCancel={noop}
      />
    );
    const card = screen.getByTestId("deep-progress-card");
    expect(card).toBeInTheDocument();
    expect(card).toHaveAttribute("role", "status");
    expect(card).toHaveAttribute("aria-live", "polite");

    // Elapsed renders as mm:ss (1:15 for 75s)
    expect(screen.getByTestId("deep-progress-elapsed")).toHaveTextContent("1:15");

    // Progress bar reflects 42%
    const bar = screen.getByTestId("deep-progress-bar-fill");
    expect(bar).toHaveStyle({ width: "42%" });

    // Stage list shows three items, sections is active
    const sections = screen.getByTestId("deep-progress-stage-sections");
    expect(sections).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("deep-progress-stage-stems")).toHaveAttribute(
      "data-active",
      "false"
    );
    expect(screen.getByTestId("deep-progress-stage-script")).toHaveAttribute(
      "data-active",
      "false"
    );

    // Cancel button is enabled
    const cancel = screen.getByTestId("deep-progress-cancel");
    expect(cancel).toBeEnabled();
  });

  it("highlights the stems stage when subStatus is stems", () => {
    render(
      <DeepProgressCard
        status="analyzing"
        subStatus="stems"
        progress={75}
        elapsedSec={120}
        errorDetails={null}
        onRetry={noop}
        onCancel={noop}
      />
    );
    expect(screen.getByTestId("deep-progress-stage-stems")).toHaveAttribute(
      "data-active",
      "true"
    );
  });

  it("renders cancelling state with explanatory text and disabled Cancel button", () => {
    render(
      <DeepProgressCard
        status="cancelling"
        subStatus="stems"
        progress={75}
        elapsedSec={45}
        errorDetails={null}
        onRetry={noop}
        onCancel={noop}
      />
    );
    expect(screen.getByTestId("deep-progress-card")).toBeInTheDocument();
    expect(screen.getByTestId("deep-progress-cancelling-note")).toHaveTextContent(
      /up to 30 seconds/i
    );
    const cancel = screen.getByTestId("deep-progress-cancel");
    expect(cancel).toBeDisabled();
  });

  it("renders error state with message and Retry button", () => {
    const details: DeepErrorDetails = {
      message: "Couldn't reach the analysis service",
      url: "https://api.test/analyze/deep",
      status: "network error",
      raw: "TypeError: Failed to fetch",
      at: "2026-04-27T19:00:00.000Z",
    };
    render(
      <DeepProgressCard
        status="error"
        subStatus={null}
        progress={0}
        elapsedSec={3}
        errorDetails={details}
        onRetry={noop}
        onCancel={noop}
      />
    );
    expect(screen.getByTestId("deep-progress-error")).toBeInTheDocument();
    expect(screen.getByTestId("deep-progress-error-message")).toHaveTextContent(
      details.message
    );
    expect(screen.getByTestId("deep-progress-retry")).toBeEnabled();
  });

  describe("failed-at-stage label", () => {
    it("renders 'Failed at: <label>' when failedAtStageLabel is set", () => {
      const details: DeepErrorDetails = {
        message: "Backend 500",
        status: "500",
        raw: "{}",
        at: "2026-04-28T15:00:00.000Z",
      };
      render(
        <DeepProgressCard
          status="error"
          subStatus={null}
          progress={0}
          elapsedSec={5}
          errorDetails={details}
          onRetry={noop}
          onCancel={noop}
          failedAtStageLabel="Analyzing stems"
        />
      );
      expect(
        screen.getByTestId("deep-progress-error-message")
      ).toHaveTextContent("Failed at: Analyzing stems");
      // Original message still rendered as a sub-line so the user keeps the
      // technical detail.
      expect(
        screen.getByTestId("deep-progress-error-detail-message")
      ).toHaveTextContent("Backend 500");
    });

    it("falls back to the error message when failedAtStageLabel is null", () => {
      const details: DeepErrorDetails = {
        message: "Backend 500",
        status: "500",
        raw: "{}",
        at: "2026-04-28T15:00:00.000Z",
      };
      render(
        <DeepProgressCard
          status="error"
          subStatus={null}
          progress={0}
          elapsedSec={5}
          errorDetails={details}
          onRetry={noop}
          onCancel={noop}
          failedAtStageLabel={null}
        />
      );
      expect(
        screen.getByTestId("deep-progress-error-message")
      ).toHaveTextContent("Backend 500");
      // No sub-line when there's no separate failed-at headline.
      expect(
        screen.queryByTestId("deep-progress-error-detail-message")
      ).toBeNull();
    });
  });

  describe("per-stage durations", () => {
    it("renders duration suffix only for stages with > 0 ms duration", () => {
      render(
        <DeepProgressCard
          status="analyzing"
          subStatus="stems"
          progress={50}
          elapsedSec={45}
          errorDetails={null}
          onRetry={noop}
          onCancel={noop}
          stageDurationsMs={{ sections: 4200, stems: 12000 }}
        />
      );
      expect(
        screen.getByTestId("deep-progress-stage-sections-duration")
      ).toHaveTextContent("4.2s");
      expect(
        screen.getByTestId("deep-progress-stage-stems-duration")
      ).toHaveTextContent("12.0s");
      // script has no duration → no suffix element rendered
      expect(
        screen.queryByTestId("deep-progress-stage-script-duration")
      ).toBeNull();
    });
  });

  describe("stage trace in error details", () => {
    it("renders stageTraceText below the technical details when expanded", () => {
      const details: DeepErrorDetails = {
        message: "Boom",
        status: "500",
        raw: "{}",
        at: "2026-04-28T15:00:00.000Z",
      };
      render(
        <DeepProgressCard
          status="error"
          subStatus={null}
          progress={0}
          elapsedSec={5}
          errorDetails={details}
          onRetry={noop}
          onCancel={noop}
          failedAtStageLabel="Analyzing stems"
          stageTraceText="queued +0.0s\nsections +1.2s\nstems +5.4s (failed)"
        />
      );
      // Hidden by default
      expect(screen.queryByTestId("deep-progress-stage-trace")).toBeNull();
      fireEvent.click(screen.getByTestId("deep-progress-details-toggle"));
      expect(
        screen.getByTestId("deep-progress-stage-trace")
      ).toHaveTextContent(/queued/);
      expect(
        screen.getByTestId("deep-progress-stage-trace")
      ).toHaveTextContent(/stems/);
    });
  });

  it("error state without details still renders a fallback message", () => {
    render(
      <DeepProgressCard
        status="error"
        subStatus={null}
        progress={0}
        elapsedSec={0}
        errorDetails={null}
        onRetry={noop}
        onCancel={noop}
      />
    );
    expect(screen.getByTestId("deep-progress-error-message")).toBeInTheDocument();
  });

  it("Show details toggle reveals technical details with URL, status, traceId, raw", () => {
    const details: DeepErrorDetails = {
      message: "Job not found",
      url: "https://api.test/jobs/x/status",
      status: "404",
      jobId: "x",
      traceId: "0123456789abcdef0123456789abcdef",
      raw: '{"detail":"Job not found"}',
      at: "2026-04-27T19:00:00.000Z",
    };
    render(
      <DeepProgressCard
        status="error"
        subStatus={null}
        progress={0}
        elapsedSec={2}
        errorDetails={details}
        onRetry={noop}
        onCancel={noop}
      />
    );

    // Details hidden initially
    expect(screen.queryByTestId("deep-progress-error-details")).toBeNull();

    fireEvent.click(screen.getByTestId("deep-progress-details-toggle"));

    const detailsBox = screen.getByTestId("deep-progress-error-details");
    expect(detailsBox).toBeInTheDocument();
    expect(detailsBox).toHaveTextContent("https://api.test/jobs/x/status");
    expect(detailsBox).toHaveTextContent("404");
    expect(detailsBox).toHaveTextContent(details.traceId!);
    expect(detailsBox).toHaveTextContent("Job not found");
  });

  it("Show details renders '(none captured)' when traceId absent", () => {
    const details: DeepErrorDetails = {
      message: "Boom",
      status: "network error",
      raw: "stack",
      at: "2026-04-27T19:00:00.000Z",
    };
    render(
      <DeepProgressCard
        status="error"
        subStatus={null}
        progress={0}
        elapsedSec={0}
        errorDetails={details}
        onRetry={noop}
        onCancel={noop}
      />
    );
    fireEvent.click(screen.getByTestId("deep-progress-details-toggle"));
    expect(
      screen.getByTestId("deep-progress-error-details")
    ).toHaveTextContent(/none captured/i);
  });

  it("Cancel button click invokes onCancel", () => {
    const onCancel = vi.fn();
    render(
      <DeepProgressCard
        status="analyzing"
        subStatus="sections"
        progress={10}
        elapsedSec={5}
        errorDetails={null}
        onRetry={noop}
        onCancel={onCancel}
      />
    );
    fireEvent.click(screen.getByTestId("deep-progress-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("Retry button click invokes onRetry", () => {
    const onRetry = vi.fn();
    const details: DeepErrorDetails = {
      message: "Boom",
      status: "500",
      raw: "stack",
      at: "2026-04-27T19:00:00.000Z",
    };
    render(
      <DeepProgressCard
        status="error"
        subStatus={null}
        progress={0}
        elapsedSec={0}
        errorDetails={details}
        onRetry={onRetry}
        onCancel={noop}
      />
    );
    fireEvent.click(screen.getByTestId("deep-progress-retry"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("formats elapsed seconds as mm:ss with zero-padded seconds", () => {
    const { rerender } = render(
      <DeepProgressCard
        status="analyzing"
        subStatus={null}
        progress={0}
        elapsedSec={0}
        errorDetails={null}
        onRetry={noop}
        onCancel={noop}
      />
    );
    expect(screen.getByTestId("deep-progress-elapsed")).toHaveTextContent("0:00");

    rerender(
      <DeepProgressCard
        status="analyzing"
        subStatus={null}
        progress={0}
        elapsedSec={9}
        errorDetails={null}
        onRetry={noop}
        onCancel={noop}
      />
    );
    expect(screen.getByTestId("deep-progress-elapsed")).toHaveTextContent("0:09");

    rerender(
      <DeepProgressCard
        status="analyzing"
        subStatus={null}
        progress={0}
        elapsedSec={605}
        errorDetails={null}
        onRetry={noop}
        onCancel={noop}
      />
    );
    expect(screen.getByTestId("deep-progress-elapsed")).toHaveTextContent("10:05");
  });

  it("clamps progress >100 and <0 to the [0,100] range", () => {
    const { rerender } = render(
      <DeepProgressCard
        status="analyzing"
        subStatus={null}
        progress={150}
        elapsedSec={0}
        errorDetails={null}
        onRetry={noop}
        onCancel={noop}
      />
    );
    expect(screen.getByTestId("deep-progress-bar-fill")).toHaveStyle({
      width: "100%",
    });

    rerender(
      <DeepProgressCard
        status="analyzing"
        subStatus={null}
        progress={-20}
        elapsedSec={0}
        errorDetails={null}
        onRetry={noop}
        onCancel={noop}
      />
    );
    expect(screen.getByTestId("deep-progress-bar-fill")).toHaveStyle({
      width: "0%",
    });
  });
});
