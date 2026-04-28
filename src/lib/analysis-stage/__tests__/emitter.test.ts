import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  emitStage,
  newRunId,
  emitErrorTrace,
} from "../emitter";
import { useAnalysisStageStore } from "@/lib/stores/analysis-stage-store";

describe("newRunId", () => {
  it("returns a unique-ish string", () => {
    const a = newRunId();
    const b = newRunId();
    expect(typeof a).toBe("string");
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(8);
  });
});

describe("emitStage", () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let debugSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    useAnalysisStageStore.getState().reset();
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    delete (globalThis as { __ANALYSIS_VERBOSE__?: boolean })
      .__ANALYSIS_VERBOSE__;
  });

  afterEach(() => {
    // Cancel any pending prune setTimeouts scheduled by appendStage —
    // otherwise they leak open handles in the Vitest worker.
    useAnalysisStageStore.getState().reset();
    infoSpy.mockRestore();
    debugSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("calls console.info on phase=start", () => {
    emitStage({
      flow: "deep",
      runId: "run-1",
      stage: "queued",
      phase: "start",
    });
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy.mock.calls[0]![0]).toContain("[analysis:deep:queued]");
  });

  it("calls console.info on phase=end", () => {
    emitStage({
      flow: "smart-split",
      runId: "run-1",
      stage: "done",
      phase: "end",
    });
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy.mock.calls[0]![0]).toContain(
      "[analysis:smart-split:done]"
    );
  });

  it("does NOT write console.error on phase=error (emitErrorTrace owns that)", () => {
    emitStage({
      flow: "deep",
      runId: "run-1",
      stage: "stems",
      phase: "error",
      note: "backend 500",
    });
    expect(errorSpy).not.toHaveBeenCalled();
    // The store still records the error event so emitErrorTrace can find it.
  });

  it("does NOT call console.debug on phase=tick when verbose flag off", () => {
    emitStage({
      flow: "deep",
      runId: "run-1",
      stage: "queued",
      phase: "tick",
    });
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it("calls console.debug on phase=tick when verbose flag on", () => {
    (globalThis as { __ANALYSIS_VERBOSE__?: boolean }).__ANALYSIS_VERBOSE__ =
      true;
    emitStage({
      flow: "deep",
      runId: "run-1",
      stage: "queued",
      phase: "tick",
    });
    expect(debugSpy).toHaveBeenCalledTimes(1);
  });

  it("appends the event to the store", () => {
    emitStage({
      flow: "deep",
      runId: "run-X",
      stage: "queued",
      phase: "start",
    });
    const run = useAnalysisStageStore.getState().runs["run-X"];
    expect(run).toBeDefined();
    expect(run!.stages).toHaveLength(1);
    expect(run!.stages[0]!.stage).toBe("queued");
  });
});

describe("emitErrorTrace", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    useAnalysisStageStore.getState().reset();
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    useAnalysisStageStore.getState().reset();
    errorSpy.mockRestore();
  });

  it("dumps the chronological stage trace as a single console.error JSON line", () => {
    const runId = "run-trace";
    emitStage({
      flow: "deep",
      runId,
      stage: "queued",
      phase: "start",
      at: 1000,
    });
    emitStage({
      flow: "deep",
      runId,
      stage: "queued",
      phase: "end",
      at: 1100,
    });
    emitStage({
      flow: "deep",
      runId,
      stage: "stems",
      phase: "start",
      at: 1100,
    });

    errorSpy.mockClear();
    emitErrorTrace(runId, "backend 500");

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const arg = errorSpy.mock.calls[0]![0] as string;
    expect(arg).toContain("[analysis:deep:error]");
    // The full stages array must appear so devs can copy/paste a single line
    // and reconstruct the timeline.
    expect(arg).toContain('"stage":"queued"');
    expect(arg).toContain('"stage":"stems"');
    expect(arg).toContain("backend 500");
  });
});
