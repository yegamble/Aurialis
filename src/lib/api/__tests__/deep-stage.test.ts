import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  deriveDeepStage,
  makeDeepStageEmitter,
  type DeepStage,
} from "../deep-stage";
import type { DeepJobStatus } from "../deep-analysis";
import { useAnalysisStageStore } from "@/lib/stores/analysis-stage-store";

const baseStatus: DeepJobStatus = {
  jobId: "j1",
  status: "queued",
  progress: 0,
  model: "modern_pop_polish",
  jobType: "deep_analysis",
  partialResult: {},
  subStatus: null,
  error: null,
};

function withPartial(
  partialResult: Record<string, unknown>,
  overrides: Partial<DeepJobStatus> = {}
): DeepJobStatus {
  return {
    ...baseStatus,
    status: "processing",
    partialResult,
    subStatus:
      "script" in partialResult
        ? "script"
        : "stems" in partialResult
          ? "stems"
          : "sections" in partialResult
            ? "sections"
            : null,
    ...overrides,
  };
}

describe("deriveDeepStage", () => {
  it("returns 'queued' when status is queued", () => {
    expect(deriveDeepStage({ ...baseStatus, status: "queued" })).toBe(
      "queued"
    );
  });

  it("returns 'queued' when processing but no partial result yet", () => {
    expect(
      deriveDeepStage({ ...baseStatus, status: "processing", progress: 5 })
    ).toBe("queued");
  });

  it("returns 'sections' when partial.sections present and stems NOT", () => {
    expect(deriveDeepStage(withPartial({ sections: [1, 2] }))).toBe(
      "sections"
    );
  });

  it("returns 'stems' when partial.stems present and script NOT", () => {
    expect(
      deriveDeepStage(withPartial({ sections: [1], stems: ["drums"] }))
    ).toBe("stems");
  });

  it("returns 'script' when partial.script present and status not done", () => {
    expect(
      deriveDeepStage(
        withPartial({ sections: [1], stems: ["drums"], script: { moves: [] } })
      )
    ).toBe("script");
  });

  it("returns 'done' when status is done", () => {
    expect(
      deriveDeepStage({ ...baseStatus, status: "done", progress: 100 })
    ).toBe("done");
  });

  it("returns 'error' when status is error", () => {
    expect(
      deriveDeepStage({ ...baseStatus, status: "error", error: "boom" })
    ).toBe("error");
  });
});

describe("makeDeepStageEmitter", () => {
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

  it("emits a single 'start' event per new stage in chronological order", () => {
    const emitter = makeDeepStageEmitter("run-1");
    emitter(withPartial({}, { status: "queued", progress: 0 }), 0);
    emitter(withPartial({ sections: [1] }, { progress: 15 }), 100);
    emitter(
      withPartial({ sections: [1], stems: ["drums"] }, { progress: 40 }),
      200
    );
    emitter(
      withPartial(
        { sections: [1], stems: ["drums"], script: {} },
        { progress: 80 }
      ),
      300
    );

    const stages = useAnalysisStageStore
      .getState()
      .runs["run-1"]!.stages.filter((s) => s.phase === "start")
      .map((s) => s.stage);
    expect(stages).toEqual(["queued", "sections", "stems", "script"]);
    expect(infoSpy).toHaveBeenCalledTimes(4);
  });

  it("does NOT re-emit when stage stays the same across polls", () => {
    const emitter = makeDeepStageEmitter("run-2");
    emitter(withPartial({}, { status: "queued" }), 0);
    emitter(withPartial({}, { status: "queued" }), 100);
    emitter(withPartial({}, { status: "queued" }), 200);

    const startEvents = useAnalysisStageStore
      .getState()
      .runs["run-2"]!.stages.filter((s) => s.phase === "start");
    expect(startEvents).toHaveLength(1);
    expect(startEvents[0]!.stage).toBe("queued");
  });

  it("emits 'end' phase for the terminal 'done' stage", () => {
    const emitter = makeDeepStageEmitter("run-3");
    emitter(withPartial({}, { status: "queued" }), 0);
    emitter({ ...baseStatus, status: "done", progress: 100 }, 500);

    const events = useAnalysisStageStore
      .getState()
      .runs["run-3"]!.stages.map((s) => `${s.stage}:${s.phase}`);
    // Expect: queued:start, done:end (no stems/sections/script in this short flow)
    expect(events).toContain("queued:start");
    expect(events).toContain("done:end");
    expect(useAnalysisStageStore.getState().runs["run-3"]!.endedAt).not.toBeNull();
  });

  it("emits 'error' phase when status flips to error", () => {
    const emitter = makeDeepStageEmitter("run-4");
    emitter(withPartial({ sections: [1] }, { progress: 15 }), 100);
    emitter(
      { ...baseStatus, status: "error", error: "backend 500" },
      200
    );

    const run = useAnalysisStageStore.getState().runs["run-4"]!;
    expect(run.error).not.toBeNull();
    expect(run.error!.stage).toBe("error");
    // The console.error includes the stage prefix
    expect(errorSpy.mock.calls.map((c) => c[0]).join("\n")).toContain(
      "[analysis:deep:error]"
    );
  });
});
