import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useAnalysisStageStore } from "../analysis-stage-store";
import type { AnalysisStageEvent } from "@/lib/analysis-stage/types";

function event(overrides: Partial<AnalysisStageEvent>): AnalysisStageEvent {
  return {
    flow: "deep",
    runId: "run-1",
    stage: "queued",
    phase: "start",
    at: Date.now(),
    ...overrides,
  };
}

describe("analysis-stage-store", () => {
  beforeEach(() => {
    useAnalysisStageStore.getState().reset();
  });

  describe("appendStage", () => {
    it("creates a run on first event", () => {
      const e = event({ phase: "start", at: 1000, stage: "queued" });
      useAnalysisStageStore.getState().appendStage(e);
      const run = useAnalysisStageStore.getState().runs["run-1"];
      expect(run).toBeDefined();
      expect(run!.flow).toBe("deep");
      expect(run!.startedAt).toBe(1000);
      expect(run!.endedAt).toBeNull();
      expect(run!.stages).toHaveLength(1);
      expect(run!.activeStage).toBe("queued");
    });

    it("appends events in chronological order", () => {
      const s = useAnalysisStageStore.getState();
      s.appendStage(event({ phase: "start", at: 1000, stage: "queued" }));
      s.appendStage(event({ phase: "end", at: 1100, stage: "queued" }));
      s.appendStage(event({ phase: "start", at: 1200, stage: "stems" }));
      const run = useAnalysisStageStore.getState().runs["run-1"]!;
      expect(run.stages.map((x) => `${x.stage}:${x.phase}`)).toEqual([
        "queued:start",
        "queued:end",
        "stems:start",
      ]);
    });

    it("activeStage follows the latest start without a matching end", () => {
      const s = useAnalysisStageStore.getState();
      s.appendStage(event({ phase: "start", at: 1000, stage: "queued" }));
      expect(useAnalysisStageStore.getState().runs["run-1"]!.activeStage).toBe(
        "queued"
      );
      s.appendStage(event({ phase: "end", at: 1100, stage: "queued" }));
      expect(useAnalysisStageStore.getState().runs["run-1"]!.activeStage).toBe(
        null
      );
      s.appendStage(event({ phase: "start", at: 1200, stage: "stems" }));
      expect(useAnalysisStageStore.getState().runs["run-1"]!.activeStage).toBe(
        "stems"
      );
    });

    it("error phase sets endedAt and stores error info", () => {
      const s = useAnalysisStageStore.getState();
      s.appendStage(event({ phase: "start", at: 1000, stage: "stems" }));
      s.appendStage(
        event({
          phase: "error",
          at: 5000,
          stage: "stems",
          note: "backend 500",
        })
      );
      const run = useAnalysisStageStore.getState().runs["run-1"]!;
      expect(run.endedAt).toBe(5000);
      expect(run.error).toEqual({
        stage: "stems",
        message: "backend 500",
        raw: "backend 500",
      });
    });

    it("end phase on terminal stage sets endedAt", () => {
      const s = useAnalysisStageStore.getState();
      s.appendStage(event({ phase: "start", at: 1000, stage: "queued" }));
      s.appendStage(event({ phase: "end", at: 5000, stage: "done" }));
      const run = useAnalysisStageStore.getState().runs["run-1"]!;
      expect(run.endedAt).toBe(5000);
      expect(run.error).toBeNull();
    });
  });

  describe("clearRun", () => {
    it("removes a run immediately", () => {
      const s = useAnalysisStageStore.getState();
      s.appendStage(event({ phase: "start", at: 1000 }));
      s.clearRun("run-1");
      expect(useAnalysisStageStore.getState().runs["run-1"]).toBeUndefined();
    });
  });

  describe("auto-prune", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("prunes a successful run 60s after endedAt", () => {
      const s = useAnalysisStageStore.getState();
      s.appendStage(event({ phase: "start", at: 1000, stage: "queued" }));
      s.appendStage(event({ phase: "end", at: 5000, stage: "done" }));
      // 59s — still present
      vi.advanceTimersByTime(59_000);
      expect(
        useAnalysisStageStore.getState().runs["run-1"]
      ).toBeDefined();
      // 61s total — pruned
      vi.advanceTimersByTime(2_000);
      expect(
        useAnalysisStageStore.getState().runs["run-1"]
      ).toBeUndefined();
    });

    it("prunes a failed run 10 minutes after endedAt", () => {
      const s = useAnalysisStageStore.getState();
      s.appendStage(event({ phase: "start", at: 1000, stage: "stems" }));
      s.appendStage(
        event({ phase: "error", at: 5000, stage: "stems", note: "boom" })
      );
      // 9 min — still present
      vi.advanceTimersByTime(9 * 60_000);
      expect(
        useAnalysisStageStore.getState().runs["run-1"]
      ).toBeDefined();
      // 10 min 1s total — pruned
      vi.advanceTimersByTime(60_001);
      expect(
        useAnalysisStageStore.getState().runs["run-1"]
      ).toBeUndefined();
    });
  });

  describe("multiple runs", () => {
    it("isolates state between runs", () => {
      const s = useAnalysisStageStore.getState();
      s.appendStage(event({ runId: "run-1", phase: "start", stage: "a" }));
      s.appendStage(event({ runId: "run-2", phase: "start", stage: "b" }));
      const runs = useAnalysisStageStore.getState().runs;
      expect(runs["run-1"]!.activeStage).toBe("a");
      expect(runs["run-2"]!.activeStage).toBe("b");
    });
  });
});
