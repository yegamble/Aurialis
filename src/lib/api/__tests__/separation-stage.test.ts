import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  deriveSeparationStage,
  makeSeparationStageEmitter,
  separationStageLabel,
  computeSeparationStageView,
} from "../separation-stage";
import type { JobStatus } from "../separation";
import { useAnalysisStageStore } from "@/lib/stores/analysis-stage-store";

const baseStatus: JobStatus = {
  jobId: "j1",
  status: "queued",
  progress: 0,
  model: "htdemucs",
  stems: [],
  error: null,
};

describe("deriveSeparationStage", () => {
  it("'queued' when status is queued", () => {
    expect(deriveSeparationStage(baseStatus)).toBe("queued");
  });
  it("'separating-stems' when processing and progress < 90", () => {
    expect(
      deriveSeparationStage({ ...baseStatus, status: "processing", progress: 50 })
    ).toBe("separating-stems");
  });
  it("'finalizing' when progress >= 90 and not done", () => {
    expect(
      deriveSeparationStage({ ...baseStatus, status: "processing", progress: 95 })
    ).toBe("finalizing");
  });
  it("'done' when status is done", () => {
    expect(
      deriveSeparationStage({ ...baseStatus, status: "done", progress: 100 })
    ).toBe("done");
  });
  it("'error' when status is error", () => {
    expect(
      deriveSeparationStage({ ...baseStatus, status: "error", error: "boom" })
    ).toBe("error");
  });
});

describe("separationStageLabel", () => {
  it("returns human-readable labels", () => {
    expect(separationStageLabel("separating-stems")).toBe("Separating stems");
    expect(separationStageLabel("finalizing")).toBe("Finalizing");
    expect(separationStageLabel("downloading")).toBe("Downloading stems");
  });
});

describe("makeSeparationStageEmitter", () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    useAnalysisStageStore.getState().reset();
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    // Cancel any pending prune setTimeouts to avoid leaking handles.
    useAnalysisStageStore.getState().reset();
    infoSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("emits one start per stage transition", () => {
    const emitter = makeSeparationStageEmitter("run-1");
    emitter({ ...baseStatus, status: "queued" }, 0);
    emitter({ ...baseStatus, status: "processing", progress: 50 }, 100);
    emitter({ ...baseStatus, status: "processing", progress: 95 }, 200);

    const stages = useAnalysisStageStore
      .getState()
      .runs["run-1"]!.stages.filter((s) => s.phase === "start")
      .map((s) => s.stage);
    expect(stages).toEqual(["queued", "separating-stems", "finalizing"]);
  });

  it("emits 'end' on done", () => {
    const emitter = makeSeparationStageEmitter("run-2");
    emitter({ ...baseStatus, status: "queued" }, 0);
    emitter({ ...baseStatus, status: "done", progress: 100 }, 1000);
    const events = useAnalysisStageStore
      .getState()
      .runs["run-2"]!.stages.map((s) => `${s.stage}:${s.phase}`);
    expect(events).toContain("done:end");
  });

  it("emits 'error' on backend error", () => {
    const emitter = makeSeparationStageEmitter("run-3");
    emitter({ ...baseStatus, status: "processing", progress: 30 }, 0);
    emitter(
      { ...baseStatus, status: "error", error: "Demucs OOM" },
      500
    );
    const run = useAnalysisStageStore.getState().runs["run-3"]!;
    expect(run.error).not.toBeNull();
    expect(errorSpy.mock.calls.map((c) => c[0]).join("\n")).toContain(
      "[analysis:smart-split:error]"
    );
  });
});

describe("computeSeparationStageView", () => {
  beforeEach(() => {
    useAnalysisStageStore.getState().reset();
  });

  it("returns empty values for missing run", () => {
    const view = computeSeparationStageView(undefined);
    expect(view.stageDurationsMs).toEqual({});
    expect(view.failedAtStageLabel).toBeNull();
    expect(view.stageTraceText).toBeNull();
  });

  it("computes per-stage durations and failed-at label", () => {
    const s = useAnalysisStageStore.getState();
    s.appendStage({
      flow: "smart-split",
      runId: "rA",
      stage: "queued",
      phase: "start",
      at: 1000,
    });
    s.appendStage({
      flow: "smart-split",
      runId: "rA",
      stage: "separating-stems",
      phase: "start",
      at: 2000,
    });
    s.appendStage({
      flow: "smart-split",
      runId: "rA",
      stage: "error",
      phase: "error",
      at: 5000,
      note: "Demucs OOM",
    });
    const run = useAnalysisStageStore.getState().runs["rA"]!;
    const view = computeSeparationStageView(run, 5500);
    // separating-stems started at 2000, ended at error event 5000 (next event)
    expect(view.stageDurationsMs["separating-stems"]).toBe(3000);
    // failed during separating-stems → label reflects that since it's the
    // last start before the error
    expect(view.failedAtStageLabel).toBe("Separating stems");
    expect(view.stageTraceText).toContain("queued");
    expect(view.stageTraceText).toContain("Demucs OOM");
  });
});
