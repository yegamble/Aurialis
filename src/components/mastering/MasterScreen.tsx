"use client";

import { AnimatePresence, motion } from "motion/react";
import { SimpleMastering } from "./SimpleMastering";
import { AdvancedMastering } from "./AdvancedMastering";
import { DeepMastering } from "./DeepMastering";
import type { MasterMode } from "./MasterToolbar";
import type { GenreName } from "@/lib/audio/presets";
import type { ToggleName, AudioParams } from "@/types/mastering";
import type { OutputPresetName, TonePresetName } from "@/lib/audio/ui-presets";

/** Status of the one-click auto-master run, surfaced under Simple mode. */
export type AutoMasterStatus =
  | { kind: "idle" }
  | { kind: "analyzing" }
  | { kind: "error"; message: string; stage: string };

export interface MasterScreenProps {
  mode: MasterMode;
  /** Desktop wraps the active mode in an AnimatePresence slide; mobile plain. */
  animated?: boolean;
  /** Suffix for the auto-master status test ids ("" desktop, "-mobile" mobile). */
  testIdSuffix?: string;
  audioFile: File;

  // Simple mode
  intensity: number;
  onIntensityChange: (val: number) => void;
  genre: GenreName;
  onGenreChange: (genre: GenreName) => void;
  toggles: Record<ToggleName, boolean>;
  onToggle: (key: ToggleName) => void;
  onAutoMaster: () => void;
  autoMasterStatus: AutoMasterStatus;
  autoMasterActiveStage: string;

  // Advanced mode
  params: AudioParams;
  onAdvancedParamChange: <K extends keyof AudioParams>(
    key: K,
    val: AudioParams[K]
  ) => void;
  tonePreset: TonePresetName | null;
  onTonePresetChange: (preset: TonePresetName) => void;
  outputPreset: OutputPresetName | null;
  onOutputPresetChange: (preset: OutputPresetName) => void;
}

/**
 * The mastering controls body for the active {@link MasterMode}. Extracted from
 * the (previously duplicated) inline mode-switch in `/master` so the desktop
 * inspector and the mobile "Show … Controls" drawer render from one source.
 */
export function MasterScreen({
  mode,
  animated = false,
  testIdSuffix = "",
  audioFile,
  intensity,
  onIntensityChange,
  genre,
  onGenreChange,
  toggles,
  onToggle,
  onAutoMaster,
  autoMasterStatus,
  autoMasterActiveStage,
  params,
  onAdvancedParamChange,
  tonePreset,
  onTonePresetChange,
  outputPreset,
  onOutputPresetChange,
}: MasterScreenProps) {
  const body =
    mode === "simple" ? (
      <>
        <SimpleMastering
          intensity={intensity}
          onIntensityChange={onIntensityChange}
          genre={genre}
          onGenreChange={onGenreChange}
          toggles={toggles}
          onToggle={onToggle}
          onAutoMaster={onAutoMaster}
        />
        {autoMasterStatus.kind === "analyzing" ? (
          <div
            data-testid={`auto-master-progress${testIdSuffix}`}
            role="status"
            aria-live="polite"
            className="mt-2 rounded-md border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] px-3 py-2 text-[10px] text-[rgba(255,255,255,0.7)]"
          >
            Analyzing… {autoMasterActiveStage}
          </div>
        ) : autoMasterStatus.kind === "error" ? (
          <div
            data-testid={`auto-master-error${testIdSuffix}`}
            role="alert"
            className="mt-2 rounded-md border border-red-500/60 bg-red-500/5 px-3 py-2 text-[10px] text-red-300"
          >
            Failed at: {autoMasterStatus.stage} — {autoMasterStatus.message}
          </div>
        ) : null}
      </>
    ) : mode === "advanced" ? (
      <AdvancedMastering
        params={{ ...params }}
        onParamChange={onAdvancedParamChange}
        dynamics={{ deharsh: toggles.deharsh, glueComp: toggles.glueComp }}
        onDynamicsToggle={onToggle}
        tonePreset={tonePreset}
        onTonePresetChange={onTonePresetChange}
        outputPreset={outputPreset}
        onOutputPresetChange={onOutputPresetChange}
      />
    ) : (
      <DeepMastering audioFile={audioFile} />
    );

  if (!animated) return body;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={mode}
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -10 }}
        transition={{ duration: 0.2 }}
      >
        {body}
      </motion.div>
    </AnimatePresence>
  );
}
