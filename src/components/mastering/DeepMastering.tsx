"use client";

/**
 * DeepMastering — top-level panel for the Deep mastering mode.
 *
 * Mobile (lg-and-down): renders a banner directing the user to desktop, per
 * scope decision (Deep mode is desktop-only in v1).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useDeepStore } from "@/lib/stores/deep-store";
import { useIsLgViewport } from "@/hooks/use-is-lg-viewport";
import {
  cancelDeepAnalysis,
  DeepAnalysisError,
  fetchDeepResult,
  startDeepAnalysis,
  type DeepErrorDetails,
} from "@/lib/api/deep-analysis";
import { pollUntilDone } from "@/lib/api/deep-analysis-polling";
import {
  computeDeepStageView,
  emitUploadStart,
  makeDeepStageEmitter,
} from "@/lib/api/deep-stage";
import { emitStage, emitErrorTrace, newRunId } from "@/lib/analysis-stage/emitter";
import { useAnalysisStageStore } from "@/lib/stores/analysis-stage-store";
import type { ProfileId } from "@/types/deep-mastering";
import { EngineerProfilePicker } from "./EngineerProfilePicker";
import { DeepTimeline } from "./DeepTimeline";
import { DeepProgressCard } from "./DeepProgressCard";

export interface DeepMasteringProps {
  /**
   * Source audio file currently loaded. Required to start a deep-analysis
   * job. Pass `null` if no track is loaded yet — the Analyze button will be
   * disabled in that case.
   */
  audioFile?: File | null;
}

function buildClientErrorDetails(e: unknown): DeepErrorDetails {
  if (e instanceof DeepAnalysisError) return e.details;
  const msg = e instanceof Error ? e.message : String(e);
  return {
    message: msg,
    status: "client",
    raw: msg,
    at: new Date().toISOString(),
  };
}

export function DeepMastering({ audioFile = null }: DeepMasteringProps = {}): React.ReactElement {
  const isLg = useIsLgViewport();
  const status = useDeepStore((s) => s.status);
  const subStatus = useDeepStore((s) => s.subStatus);
  const progress = useDeepStore((s) => s.progress);
  const profile = useDeepStore((s) => s.profile);
  const scriptActive = useDeepStore((s) => s.scriptActive);
  const script = useDeepStore((s) => s.script);
  const errorDetails = useDeepStore((s) => s.errorDetails);
  const startedAt = useDeepStore((s) => s.startedAt);
  const setScriptActive = useDeepStore((s) => s.setScriptActive);
  const setStatus = useDeepStore((s) => s.setStatus);
  const setSubStatus = useDeepStore((s) => s.setSubStatus);
  const setProgress = useDeepStore((s) => s.setProgress);
  const setStartedAt = useDeepStore((s) => s.setStartedAt);
  const setScript = useDeepStore((s) => s.setScript);
  const setError = useDeepStore((s) => s.setError);
  const setProfile = useDeepStore((s) => s.setProfile);
  const runId = useDeepStore((s) => s.runId);
  const setRunId = useDeepStore((s) => s.setRunId);

  const abortRef = useRef<AbortController | null>(null);
  const cancellingRef = useRef(false);
  const activeJobIdRef = useRef<string | null>(null);
  const lastProfileRef = useRef<ProfileId>(profile);

  // Drive an "elapsed" tick from `now` so we don't have to setState directly
  // in the effect body. `now` only advances while a job is active.
  const [now, setNow] = useState(() => Date.now());
  const isActive = status === "analyzing" || status === "cancelling";
  useEffect(() => {
    if (!isActive) return;
    // 1s cadence — elapsedSec floors to whole seconds anyway, so faster
    // ticks would just churn React without visible UX change.
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isActive]);
  const elapsedSec =
    isActive && startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;

  // Subscribe to the harness store for the current run; recompute view-derived
  // props on each store change. `now` ticks during active runs (1s cadence
  // above), causing the in-progress stage's duration label to update live.
  const run = useAnalysisStageStore((s) => (runId ? s.runs[runId] : undefined));
  const stageView = computeDeepStageView(run, now);

  // Abort any in-flight job on unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort(
        new DOMException("component unmounted", "AbortError")
      );
    };
  }, []);

  const runAnalyze = useCallback(
    async (profileId: ProfileId) => {
      if (!audioFile) return;
      // Cancel any prior in-flight run before starting
      abortRef.current?.abort(
        new DOMException("superseded", "AbortError")
      );
      const ctl = new AbortController();
      abortRef.current = ctl;
      cancellingRef.current = false;
      activeJobIdRef.current = null;
      lastProfileRef.current = profileId;

      const id = newRunId();
      setRunId(id);
      setStatus("analyzing");
      setSubStatus(null);
      setProgress(0);
      setStartedAt(Date.now());
      setError(null);
      emitUploadStart(id);

      try {
        const { jobId } = await startDeepAnalysis(
          audioFile,
          profileId,
          ctl.signal
        );
        activeJobIdRef.current = jobId;

        const stageEmitter = makeDeepStageEmitter(id);
        const result = await pollUntilDone({
          jobId,
          signal: ctl.signal,
          isCancelling: () => cancellingRef.current,
          onPoll: (s, elapsedMs) => {
            setSubStatus(s.subStatus);
            setProgress(s.progress);
            stageEmitter(s, elapsedMs);
          },
        });

        if (result.kind === "cancelled") {
          // Backend honored the cancel — reset to idle
          setStatus("idle");
          setSubStatus(null);
          setProgress(0);
          setStartedAt(null);
          return;
        }

        // result.kind === "done"
        const script = await fetchDeepResult(jobId, ctl.signal);
        setScript(script);
        setStatus("ready");
      } catch (e) {
        // Component unmount or new analyze run superseded — silent
        if (e instanceof DOMException && e.name === "AbortError") {
          return;
        }
        const details = buildClientErrorDetails(e);
        // Emit error to the harness BEFORE flipping store state so the
        // chronological trace lands ahead of any UI re-render.
        emitStage({
          flow: "deep",
          runId: id,
          stage: "error",
          phase: "error",
          note: details.message,
        });
        emitErrorTrace(id, details.message);
        setStatus("error");
        setError(details);
      }
    },
    [
      audioFile,
      setStatus,
      setSubStatus,
      setProgress,
      setStartedAt,
      setScript,
      setError,
      setRunId,
    ]
  );

  const handleCancel = useCallback(() => {
    if (status !== "analyzing") return;
    cancellingRef.current = true;
    setStatus("cancelling");
    const jobId = activeJobIdRef.current;
    if (jobId) {
      // Fire DELETE in background; result handled by polling loop.
      void cancelDeepAnalysis(jobId).catch(() => {
        // Ignore — polling loop's hard-bound will surface a cancel-timeout
        // if the backend never honors. 404 returns { ok: false, status: 404 }
        // (no throw). 5xx throws but we swallow here; user already sees
        // "Cancelling…" and the polling loop will report the real error.
      });
    }
  }, [status, setStatus]);

  const handleRetry = useCallback(() => {
    setError(null);
    // Read the current store profile rather than the ref so a profile change
    // since the last analyze (URL hydration, external setProfile, etc.) is
    // honored. Falls back to the ref if the store is somehow uninitialized.
    const current = useDeepStore.getState().profile ?? lastProfileRef.current;
    void runAnalyze(current);
  }, [runAnalyze, setError]);

  const handleApplyProfile = useCallback(
    (next: ProfileId) => {
      // Profile-switch dirty guard. If any move has been edited, ask before
      // discarding edits — implemented via window.confirm to keep the
      // dependency surface small.
      const current = useDeepStore.getState();
      const dirtyCount = current.script?.moves.filter((m) => m.edited).length ?? 0;
      if (dirtyCount > 0) {
        const ok = typeof window !== "undefined" && typeof window.confirm === "function"
          ? window.confirm(
              `Switching to "${next}" will discard your edits to ${dirtyCount} move${dirtyCount === 1 ? "" : "s"}. Continue?`,
            )
          : true;
        if (!ok) return;
      }
      setProfile(next);
      void runAnalyze(next);
    },
    [setProfile, runAnalyze],
  );

  if (!isLg) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center text-[rgba(255,255,255,0.7)]">
        <p className="text-sm">
          Deep mode requires a larger screen. Please open Aurialis on a
          desktop to use AI-powered deep mastering.
        </p>
      </div>
    );
  }

  const analyzeButtonDisabled =
    !audioFile || status === "analyzing" || status === "cancelling";

  return (
    <div
      data-testid="deep-mastering-panel"
      className="flex flex-col gap-4 text-[rgba(255,255,255,0.85)]"
    >
      <header className="flex flex-col gap-1">
        <h2 className="text-sm uppercase tracking-wider text-[rgba(255,255,255,0.5)]">
          Deep Mastering
        </h2>
        <p className="text-xs text-[rgba(255,255,255,0.5)]">
          AI proposes time-varying mastering moves. Choose a profile, click
          Analyze, then accept / edit / mute individual moves on the timeline.
        </p>
      </header>

      <section
        data-testid="deep-profile-picker-placeholder"
        className="rounded-lg border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] p-3"
      >
        <div className="text-xs text-[rgba(255,255,255,0.6)] mb-2">
          Active profile: <span data-testid="deep-current-profile">{profile}</span>
        </div>
        <EngineerProfilePicker onApply={handleApplyProfile} />
      </section>

      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="deep-analyze-button"
          disabled={analyzeButtonDisabled}
          onClick={() => void runAnalyze(profile)}
          className={`rounded-md px-4 py-2 text-xs text-white transition-colors ${
            analyzeButtonDisabled
              ? "bg-[rgba(255,255,255,0.1)] opacity-60 cursor-not-allowed"
              : "bg-[#0a84ff] hover:bg-[#0066cc]"
          }`}
          title={
            !audioFile
              ? "Load a track first"
              : "Analyze the loaded track with the selected profile"
          }
        >
          {status === "analyzing"
            ? "Analyzing…"
            : status === "cancelling"
              ? "Cancelling…"
              : "Analyze"}
        </button>
        <button
          type="button"
          data-testid="deep-script-active-toggle"
          aria-pressed={scriptActive}
          onClick={() => setScriptActive(!scriptActive)}
          className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
            scriptActive
              ? "bg-[#0a84ff] text-white"
              : "bg-[rgba(255,255,255,0.06)] text-[rgba(255,255,255,0.6)]"
          }`}
          title="A/B compare: toggle the script on/off without restarting playback"
        >
          {scriptActive ? "Script: ON (A)" : "Script: OFF (B)"}
        </button>
      </div>

      <p
        data-testid="deep-status"
        className="text-[10px] text-[rgba(255,255,255,0.5)]"
      >
        Status: {status}
        {subStatus ? ` · ${subStatus}` : ""}
      </p>

      <DeepProgressCard
        status={status}
        subStatus={subStatus}
        progress={progress}
        elapsedSec={elapsedSec}
        errorDetails={errorDetails}
        onRetry={handleRetry}
        onCancel={handleCancel}
        failedAtStageLabel={stageView.failedAtStageLabel}
        stageDurationsMs={stageView.stageDurationsMs}
        stageTraceText={stageView.stageTraceText}
      />

      <DeepTimeline script={script} />
    </div>
  );
}
