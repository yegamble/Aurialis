"use client";

/**
 * DeepMastering — top-level panel for the Deep mastering mode.
 *
 * v1 skeleton (T12): wires the Zustand `deepStore` for status / sub-status,
 * renders the placeholder for the engineer profile picker (T13) and timeline
 * (T14). T17 adds the analyze action wiring; until then this panel exposes
 * a no-op "Analyze" button so the page renders cleanly.
 *
 * Mobile (lg-and-down): renders a banner directing the user to desktop, per
 * scope decision (Deep mode is desktop-only in v1).
 */

import { useCallback } from "react";
import { useDeepStore } from "@/lib/stores/deep-store";
import { useIsLgViewport } from "@/hooks/use-is-lg-viewport";
import {
  fetchDeepResult,
  pollDeepJobStatus,
  startDeepAnalysis,
} from "@/lib/api/deep-analysis";
import type { ProfileId } from "@/types/deep-mastering";
import { EngineerProfilePicker } from "./EngineerProfilePicker";
import { DeepTimeline } from "./DeepTimeline";

export interface DeepMasteringProps {
  /**
   * Source audio file currently loaded. Required to start a deep-analysis
   * job. Pass `null` if no track is loaded yet — the Analyze button will be
   * disabled in that case.
   */
  audioFile?: File | null;
}

export function DeepMastering({ audioFile = null }: DeepMasteringProps = {}): React.ReactElement {
  const isLg = useIsLgViewport();
  const status = useDeepStore((s) => s.status);
  const subStatus = useDeepStore((s) => s.subStatus);
  const profile = useDeepStore((s) => s.profile);
  const scriptActive = useDeepStore((s) => s.scriptActive);
  const script = useDeepStore((s) => s.script);
  const setScriptActive = useDeepStore((s) => s.setScriptActive);
  const setStatus = useDeepStore((s) => s.setStatus);
  const setSubStatus = useDeepStore((s) => s.setSubStatus);
  const setScript = useDeepStore((s) => s.setScript);
  const setError = useDeepStore((s) => s.setError);
  const setProfile = useDeepStore((s) => s.setProfile);

  const runAnalyze = useCallback(
    async (profileId: ProfileId) => {
      if (!audioFile) return;
      setStatus("analyzing");
      setSubStatus(null);
      setError(null);
      try {
        const { jobId } = await startDeepAnalysis(audioFile, profileId);
        // Poll until job is done. Update sub-status on each poll.
        while (true) {
          const s = await pollDeepJobStatus(jobId);
          setSubStatus(s.subStatus);
          if (s.status === "done") break;
          if (s.status === "error") {
            throw new Error(s.error ?? "Deep analysis failed");
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
        const result = await fetchDeepResult(jobId);
        setScript(result);
        setStatus("ready");
      } catch (e) {
        setStatus("error");
        setError((e as Error).message);
      }
    },
    [audioFile, setStatus, setSubStatus, setScript, setError],
  );

  const handleApplyProfile = useCallback(
    (next: ProfileId) => {
      // Profile-switch dirty guard (T17). If any move has been edited, ask
      // before discarding edits — implemented via window.confirm to keep the
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
          disabled={!audioFile || status === "analyzing"}
          onClick={() => void runAnalyze(profile)}
          className={`rounded-md px-4 py-2 text-xs text-white transition-colors ${
            !audioFile || status === "analyzing"
              ? "bg-[rgba(255,255,255,0.1)] opacity-60 cursor-not-allowed"
              : "bg-[#0a84ff] hover:bg-[#0066cc]"
          }`}
          title={
            !audioFile
              ? "Load a track first"
              : "Analyze the loaded track with the selected profile"
          }
        >
          {status === "analyzing" ? "Analyzing…" : "Analyze"}
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

      {status === "analyzing" && (
        <ol
          data-testid="deep-progress-stages"
          className="space-y-1 text-[10px] text-[rgba(255,255,255,0.55)]"
        >
          <li
            data-active={subStatus === "sections" ? "true" : "false"}
            className={subStatus === "sections" ? "text-white" : ""}
          >
            1. Detecting sections...
          </li>
          <li
            data-active={subStatus === "stems" ? "true" : "false"}
            className={subStatus === "stems" ? "text-white" : ""}
          >
            2. Analyzing stems...
          </li>
          <li
            data-active={subStatus === "script" ? "true" : "false"}
            className={subStatus === "script" ? "text-white" : ""}
          >
            3. Generating script...
          </li>
        </ol>
      )}

      <DeepTimeline script={script} />
    </div>
  );
}
