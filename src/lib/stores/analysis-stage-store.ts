import { create } from "zustand";
import type {
  AnalysisRun,
  AnalysisStageEvent,
} from "@/lib/analysis-stage/types";

const PRUNE_SUCCESS_MS = 60_000;
const PRUNE_ERROR_MS = 10 * 60_000;

interface AnalysisStageState {
  /** All known runs keyed by runId. */
  runs: Record<string, AnalysisRun>;
  /** Append an event into its run's log; creates the run if needed. */
  appendStage: (event: AnalysisStageEvent) => void;
  /** Remove a run immediately (e.g. user dismissed the error card). */
  clearRun: (runId: string) => void;
  /** Wipe everything — used by tests. */
  reset: () => void;
}

const pruneTimers = new Map<string, ReturnType<typeof setTimeout>>();

function schedulePrune(
  runId: string,
  ms: number,
  prune: (runId: string) => void
): void {
  const existing = pruneTimers.get(runId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    pruneTimers.delete(runId);
    prune(runId);
  }, ms);
  pruneTimers.set(runId, timer);
}

function cancelPrune(runId: string): void {
  const existing = pruneTimers.get(runId);
  if (existing) {
    clearTimeout(existing);
    pruneTimers.delete(runId);
  }
}

export const useAnalysisStageStore = create<AnalysisStageState>((set, get) => {
  const removeRun = (runId: string): void => {
    set((state) => {
      if (!state.runs[runId]) return state;
      const next = { ...state.runs };
      delete next[runId];
      return { runs: next };
    });
  };

  return {
    runs: {},

    appendStage: (event) => {
      set((state) => {
        const prev = state.runs[event.runId];
        const run: AnalysisRun = prev
          ? { ...prev, stages: [...prev.stages, event] }
          : {
              runId: event.runId,
              flow: event.flow,
              startedAt: event.at,
              endedAt: null,
              stages: [event],
              activeStage: null,
              error: null,
            };

        if (event.phase === "start") {
          run.activeStage = event.stage;
        } else if (event.phase === "end") {
          if (run.activeStage === event.stage) run.activeStage = null;
          run.endedAt = event.at;
        } else if (event.phase === "error") {
          run.activeStage = null;
          run.endedAt = event.at;
          run.error = {
            stage: event.stage,
            message: event.note ?? "Unknown error",
            raw: event.note ?? "",
          };
        }

        return { runs: { ...state.runs, [event.runId]: run } };
      });

      // Schedule auto-prune outside the set() callback so timers are observable.
      const run = get().runs[event.runId];
      if (run && run.endedAt !== null) {
        const ttl = run.error ? PRUNE_ERROR_MS : PRUNE_SUCCESS_MS;
        schedulePrune(event.runId, ttl, removeRun);
      }
    },

    clearRun: (runId) => {
      cancelPrune(runId);
      removeRun(runId);
    },

    reset: () => {
      for (const timer of pruneTimers.values()) clearTimeout(timer);
      pruneTimers.clear();
      set({ runs: {} });
    },
  };
});
