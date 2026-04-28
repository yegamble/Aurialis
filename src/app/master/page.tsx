"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import {
  ArrowLeft,
  Play,
  Pause,
  SkipBack,
  Headphones,
  Music,
} from "lucide-react";
import { WaveformDisplay } from "@/components/visualization/WaveformDisplay";
import { SpectrumDisplay } from "@/components/visualization/SpectrumDisplay";
import { LevelMeter } from "@/components/visualization/LevelMeter";
import { Goniometer } from "@/components/visualization/Goniometer";
import { SimpleMastering } from "@/components/mastering/SimpleMastering";
import { AdvancedMastering } from "@/components/mastering/AdvancedMastering";
import { DeepMastering } from "@/components/mastering/DeepMastering";
import { ABToggle } from "@/components/mastering/ABToggle";
import { ExportPanel } from "@/components/export/ExportPanel";
import { useAudioStore } from "@/lib/stores/audio-store";
import { useUIStore } from "@/lib/stores/ui-store";
import { useDeepStore } from "@/lib/stores/deep-store";
import { useLibraryStore } from "@/lib/stores/library-store";
import { useAudioEngine } from "@/hooks/useAudioEngine";
import { useVisualization } from "@/hooks/useVisualization";
import { useIsLgViewport } from "@/hooks/use-is-lg-viewport";
import { applyIntensity, PLATFORM_PRESETS, type GenreName } from "@/lib/audio/presets";
import { analyzeAudio } from "@/lib/audio/analysis";
import { computeAutoMasterParams } from "@/lib/audio/auto-master";
import {
  emitStage,
  emitErrorTrace,
  newRunId,
} from "@/lib/analysis-stage/emitter";
import { useAnalysisStageStore } from "@/lib/stores/analysis-stage-store";
import { exportWav } from "@/lib/audio/export";
import type { ExportSettings } from "@/components/export/ExportPanel";
import type { ToggleName, AudioParams } from "@/types/mastering";
import {
  applySimpleToggles,
  applyTonePreset,
  matchesOutputPreset,
  OUTPUT_PRESET_PLATFORM_MAP,
  type OutputPresetName,
  type TonePresetName,
} from "@/lib/audio/ui-presets";

const INITIAL_TOGGLES: Record<ToggleName, boolean> = {
  cleanup: false,
  warm: false,
  bright: false,
  wide: false,
  loud: false,
  deharsh: false,
  glueComp: false,
};

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function formatMbGr(db: number): string {
  if (!Number.isFinite(db) || db === 0) return "0.0";
  return db.toFixed(1);
}

function mbGrColorClass(db: number): string {
  const g = -db;
  if (g >= 6) return "text-red-400";
  if (g >= 3) return "text-amber-400";
  return "";
}

export default function MasterPage() {
  const router = useRouter();
  const file = useAudioStore((s) => s.file);
  const { mode, setMode } = useUIStore();
  const isLgViewport = useIsLgViewport();

  // Real audio engine
  const {
    isPlaying,
    isLoaded,
    currentTime,
    duration,
    isBypassed,
    play,
    pause,
    stop,
    seek,
    loadFile,
    toggleBypass,
    engine,
  } = useAudioEngine();

  // Real visualization data
  const { waveformPeaks, spectrumData, peakLevels } = useVisualization(engine);

  // Simple mode state
  const params = useAudioStore((s) => s.params);
  const setParam = useAudioStore((s) => s.setParam);
  const setParams = useAudioStore((s) => s.setParams);
  const metering = useAudioStore((s) => s.metering);

  // Library bridge — used to persist + restore mastering settings per song.
  const loadedFromLibrary = useDeepStore((s) => s.loadedFromLibrary);
  const suppressLibraryAutoUpdate = useDeepStore((s) => s.suppressLibraryAutoUpdate);
  const activeFingerprint = useLibraryStore((s) => s.activeFingerprint);
  const updateLibrarySettings = useLibraryStore((s) => s.updateSettings);

  // Export state
  const [isExporting, setIsExporting] = useState(false);

  // Simple mode: genre, intensity (0-100), and toggles. Hydrated from the
  // library entry on mount when loadedFromLibrary is set.
  const initialSimple = (() => {
    if (loadedFromLibrary && activeFingerprint) {
      const entry = useLibraryStore.getState().entries.find((e) => e.fingerprint === activeFingerprint);
      const s = entry?.settings;
      if (s) {
        return {
          genre: s.simple.genre,
          intensity: s.simple.intensity,
          toggles: { ...INITIAL_TOGGLES, ...s.simple.toggles },
          tonePreset: s.tonePreset,
          outputPreset: s.outputPreset,
        };
      }
    }
    return {
      genre: "pop" as GenreName,
      intensity: 50,
      toggles: { ...INITIAL_TOGGLES },
      tonePreset: null as TonePresetName | null,
      outputPreset: null as OutputPresetName | null,
    };
  })();

  const [genre, setGenre] = useState<GenreName>(initialSimple.genre);
  const [intensity, setIntensity] = useState(initialSimple.intensity);
  const [toggles, setToggles] = useState(initialSimple.toggles);
  const [tonePreset, setTonePreset] = useState<TonePresetName | null>(initialSimple.tonePreset);
  const [outputPreset, setOutputPreset] = useState<OutputPresetName | null>(
    initialSimple.outputPreset
  );

  // Re-compute params whenever genre/intensity/toggles change
  const recomputeParams = (
    g: GenreName,
    intVal: number,
    activeToggles: typeof toggles
  ) => {
    const base = applyIntensity(g, intVal);
    setTonePreset(null);
    setParams(applySimpleToggles(base, activeToggles));
  };

  // Sync store params with the genre/intensity system on mount — UNLESS we
  // were loaded from library (in which case the store already holds restored
  // params and recomputing would clobber them with derived defaults).
  useEffect(() => {
    if (loadedFromLibrary) return;
    recomputeParams(genre, intensity, toggles);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-save mastering settings to the library entry whenever any tracked
  // slice changes. Skipped during Start-fresh (suppress flag) and when no
  // active library entry exists yet (e.g., fresh upload pre-Analyze).
  useEffect(() => {
    if (!activeFingerprint || suppressLibraryAutoUpdate) return;
    updateLibrarySettings(activeFingerprint, {
      params,
      simple: { genre, intensity, toggles },
      tonePreset,
      outputPreset,
      savedAt: Date.now(),
    });
  }, [
    activeFingerprint,
    suppressLibraryAutoUpdate,
    updateLibrarySettings,
    params,
    genre,
    intensity,
    toggles,
    tonePreset,
    outputPreset,
  ]);

  const handleGenreChange = (newGenre: GenreName) => {
    setGenre(newGenre);
    recomputeParams(newGenre, intensity, toggles);
  };

  const handleIntensityChange = (val: number) => {
    setIntensity(val);
    recomputeParams(genre, val, toggles);
  };

  const handleToggle = (key: ToggleName) => {
    const newToggles = { ...toggles, [key]: !toggles[key] };
    setToggles(newToggles);
    recomputeParams(genre, intensity, newToggles);
  };

  const handleAdvancedParamChange = <K extends keyof AudioParams>(
    key: K,
    value: AudioParams[K]
  ) => {
    setTonePreset(null);
    setParam(key, value);
  };

  const handleTonePresetChange = (preset: TonePresetName) => {
    const nextPreset = tonePreset === preset ? null : preset;
    setParams(applyTonePreset(params, tonePreset, nextPreset));
    setTonePreset(nextPreset);
  };

  const handleExport = async (settings: ExportSettings) => {
    const audioBuffer = engine?.audioBuffer;
    if (!audioBuffer || isExporting) return;
    setIsExporting(true);
    try {
      await exportWav(audioBuffer, params, {
        sampleRate: settings.sampleRate,
        bitDepth: settings.bitDepth,
        dither: settings.dither,
      });
    } finally {
      setIsExporting(false);
    }
  };

  const [autoMasterStatus, setAutoMasterStatus] = useState<
    | { kind: "idle" }
    | { kind: "analyzing" }
    | { kind: "error"; message: string; stage: string }
  >({ kind: "idle" });
  const [autoMasterRunId, setAutoMasterRunId] = useState<string | null>(null);

  // Subscribe to the harness store for the active mastering-auto run so the
  // inline progress indicator can show which phase is currently running.
  const autoMasterRun = useAnalysisStageStore((s) =>
    autoMasterRunId ? s.runs[autoMasterRunId] : undefined
  );
  const autoMasterActiveStage = autoMasterRun?.activeStage ?? "loudness";

  const handleAutoMaster = async (): Promise<void> => {
    const audioBuffer = engine?.audioBuffer;
    if (!audioBuffer) return;
    const runId = newRunId();
    setAutoMasterRunId(runId);
    setAutoMasterStatus({ kind: "analyzing" });
    try {
      const analysis = await analyzeAudio(audioBuffer, { runId });
      const result = computeAutoMasterParams(analysis);
      const resetToggles = { ...INITIAL_TOGGLES };
      setGenre(result.genre);
      setIntensity(result.intensity);
      setToggles(resetToggles);
      recomputeParams(result.genre, result.intensity, resetToggles);
      setAutoMasterStatus({ kind: "idle" });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Auto-master failed";
      // Best-effort: identify the failing stage from the most-recent start
      // event. The harness store always records that.
      const { useAnalysisStageStore } = await import(
        "@/lib/stores/analysis-stage-store"
      );
      const run = useAnalysisStageStore.getState().runs[runId];
      const lastStart = run?.stages
        ? [...run.stages].reverse().find((ev) => ev.phase === "start")
        : undefined;
      const failedStage = lastStart?.stage ?? "unknown";
      emitStage({
        flow: "mastering-auto",
        runId,
        stage: failedStage,
        phase: "error",
        note: message,
      });
      emitErrorTrace(runId, message);
      setAutoMasterStatus({ kind: "error", message, stage: failedStage });
    }
  };

  const handleOutputPresetChange = (preset: OutputPresetName) => {
    const selectedPreset = preset;
    const platform = OUTPUT_PRESET_PLATFORM_MAP[selectedPreset];
    if (platform && PLATFORM_PRESETS[platform]) {
      setOutputPreset(selectedPreset);
      setParams(PLATFORM_PRESETS[platform]);
    }
  };

  useEffect(() => {
    if (!outputPreset) return;
    if (!matchesOutputPreset(params, outputPreset)) {
      setOutputPreset(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only targetLufs and ceiling are checked
  }, [outputPreset, params.targetLufs, params.ceiling]);

  // Load the file when the page mounts
  useEffect(() => {
    if (file && !isLoaded) {
      loadFile(file);
    }
  }, [file, isLoaded, loadFile]);

  // Redirect if no file
  useEffect(() => {
    if (!file) {
      router.replace("/");
    }
  }, [file, router]);

  if (!file) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-[rgba(255,255,255,0.4)] text-sm">Loading...</div>
      </div>
    );
  }

  const sampleRate = engine.sampleRate;
  const channels = engine.audioBuffer?.numberOfChannels ?? 0;

  return (
    <div className="min-h-screen bg-black flex flex-col">
      <header className="flex items-center justify-between px-5 py-3 border-b border-[rgba(255,255,255,0.06)] bg-[rgba(0,0,0,0.8)] backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center gap-4">
          <button
            onClick={() => {
              stop();
              router.push("/");
            }}
            className="w-8 h-8 rounded-full bg-[rgba(255,255,255,0.06)] flex items-center justify-center hover:bg-[rgba(255,255,255,0.1)] transition-colors"
            aria-label="Back to upload"
          >
            <ArrowLeft className="w-4 h-4 text-[rgba(255,255,255,0.7)]" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-b from-[#0a84ff] to-[#0066cc] flex items-center justify-center">
              <Headphones className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="text-white text-sm">Aurialis</span>
          </div>
        </div>
        <div className="flex bg-[rgba(255,255,255,0.06)] rounded-lg p-0.5">
          {(["simple", "advanced", "deep"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              data-testid={`mode-toggle-${m}`}
              className={`px-4 py-1.5 rounded-md text-xs transition-all capitalize ${
                mode === m
                  ? "bg-[rgba(255,255,255,0.12)] text-white shadow-sm"
                  : "text-[rgba(255,255,255,0.4)] hover:text-[rgba(255,255,255,0.6)]"
              }`}
              aria-pressed={mode === m}
            >
              {m}
            </button>
          ))}
        </div>
        <div className="w-20" />
      </header>

      <div className="flex-1 flex overflow-hidden">
        {isLgViewport && (
          <aside className="w-80 border-r border-[rgba(255,255,255,0.06)] overflow-y-auto bg-[rgba(255,255,255,0.02)] p-4 shrink-0">
            <AnimatePresence mode="wait">
              {mode === "simple" ? (
                <motion.div
                  key="simple"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.2 }}
                >
                  <SimpleMastering
                    intensity={intensity}
                    onIntensityChange={handleIntensityChange}
                    genre={genre}
                    onGenreChange={handleGenreChange}
                    toggles={toggles}
                    onToggle={handleToggle}
                    onAutoMaster={handleAutoMaster}
                  />
                  {autoMasterStatus.kind === "analyzing" ? (
                    <div
                      data-testid="auto-master-progress"
                      role="status"
                      aria-live="polite"
                      className="mt-2 rounded-md border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] px-3 py-2 text-[10px] text-[rgba(255,255,255,0.7)]"
                    >
                      Analyzing… {autoMasterActiveStage}
                    </div>
                  ) : autoMasterStatus.kind === "error" ? (
                    <div
                      data-testid="auto-master-error"
                      role="alert"
                      className="mt-2 rounded-md border border-red-500/60 bg-red-500/5 px-3 py-2 text-[10px] text-red-300"
                    >
                      Failed at: {autoMasterStatus.stage} —{" "}
                      {autoMasterStatus.message}
                    </div>
                  ) : null}
                </motion.div>
              ) : mode === "advanced" ? (
                <motion.div
                  key="advanced"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.2 }}
                >
                  <AdvancedMastering
                    params={{ ...params }}
                    onParamChange={handleAdvancedParamChange}
                    dynamics={{ deharsh: toggles.deharsh, glueComp: toggles.glueComp }}
                    onDynamicsToggle={handleToggle}
                    tonePreset={tonePreset}
                    onTonePresetChange={handleTonePresetChange}
                    outputPreset={outputPreset}
                    onOutputPresetChange={handleOutputPresetChange}
                  />
                </motion.div>
              ) : (
                <motion.div
                  key="deep"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.2 }}
                >
                  <DeepMastering audioFile={file} />
                </motion.div>
              )}
            </AnimatePresence>
          </aside>
        )}

        <main className="flex-1 flex flex-col p-5 gap-4 overflow-y-auto">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[rgba(255,255,255,0.06)] flex items-center justify-center">
                <Music className="w-4 h-4 text-[#0a84ff]" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-white text-sm">{file.name}</p>
                  <LibraryStateBadge />
                </div>
                <p className="text-[rgba(255,255,255,0.35)] text-xs">
                  {formatTime(duration)} &middot;{" "}
                  {(sampleRate / 1000).toFixed(1)} kHz &middot;{" "}
                  {channels === 2
                    ? "Stereo"
                    : channels === 1
                      ? "Mono"
                      : `${channels}ch`}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[#0a84ff] text-lg tabular-nums">
                {metering.lufs === -Infinity
                  ? "---"
                  : metering.lufs.toFixed(1)}{" "}
                <span className="text-xs text-[rgba(255,255,255,0.4)]">
                  LUFS
                </span>
              </p>
              <p className="text-[rgba(255,255,255,0.35)] text-xs">
                {metering.truePeak === -Infinity
                  ? "---"
                  : metering.truePeak.toFixed(1)}{" "}
                dBTP
              </p>
              <p className="text-[rgba(255,255,255,0.35)] text-xs tabular-nums">
                LRA:{" "}
                {metering.lraReady
                  ? `${metering.lra.toFixed(1)} LU`
                  : "--- LU"}
              </p>
              <p
                className={`text-xs tabular-nums ${
                  metering.correlationPeakMin < 0
                    ? "text-red-400"
                    : metering.correlationPeakMin < 0.3
                      ? "text-amber-400"
                      : "text-green-400"
                }`}
              >
                Corr:{" "}
                {metering.correlation >= 0
                  ? `+${metering.correlation.toFixed(2)}`
                  : metering.correlation.toFixed(2)}
              </p>
              <p
                className="text-[rgba(255,255,255,0.5)] text-xs tabular-nums"
                data-testid="mb-gr-readout"
              >
                {params.multibandEnabled > 0 ? (
                  <>
                    MB L/M/H:{" "}
                    <span className={mbGrColorClass(metering.multibandGR.low)}>
                      {formatMbGr(metering.multibandGR.low)}
                    </span>
                    {" / "}
                    <span className={mbGrColorClass(metering.multibandGR.mid)}>
                      {formatMbGr(metering.multibandGR.mid)}
                    </span>
                    {" / "}
                    <span
                      className={mbGrColorClass(metering.multibandGR.high)}
                    >
                      {formatMbGr(metering.multibandGR.high)}
                    </span>{" "}
                    dB
                  </>
                ) : (
                  "MB: ---"
                )}
              </p>
            </div>
          </div>

          <WaveformDisplay
            audioData={waveformPeaks}
            currentTime={currentTime}
            duration={duration}
            onSeek={seek}
          />

          <div className="flex items-center justify-center gap-4">
            <ABToggle isActive={isBypassed} onToggle={toggleBypass} />
            <button
              onClick={stop}
              className="w-10 h-10 rounded-full bg-[rgba(255,255,255,0.06)] flex items-center justify-center hover:bg-[rgba(255,255,255,0.1)] transition-colors"
              aria-label="Stop and return to beginning"
            >
              <SkipBack className="w-4 h-4 text-[rgba(255,255,255,0.7)]" />
            </button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => (isPlaying ? pause() : play())}
              disabled={!isLoaded}
              className="w-12 h-12 rounded-full bg-gradient-to-b from-[#0a84ff] to-[#0066cc] flex items-center justify-center shadow-[0_2px_20px_rgba(10,132,255,0.35)] disabled:opacity-40"
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? (
                <Pause className="w-5 h-5 text-white" />
              ) : (
                <Play className="w-5 h-5 text-white ml-0.5" />
              )}
            </motion.button>
            <div className="text-[rgba(255,255,255,0.5)] text-xs tabular-nums min-w-[80px] text-center">
              {formatTime(currentTime)} / {formatTime(duration)}
            </div>
          </div>

          <SpectrumDisplay data={spectrumData} />
          <ExportPanel onExport={handleExport} isExporting={isExporting} />

          {!isLgViewport && (
            <details className="group">
              <summary className="cursor-pointer text-[#0a84ff] text-sm py-2 list-none flex items-center gap-1">
                <span>
                  Show {mode === "simple" ? "Simple" : mode === "advanced" ? "Advanced" : "Deep"} Controls
                </span>
              </summary>
              <div className="pt-2">
                {mode === "simple" ? (
                  <>
                    <SimpleMastering
                      intensity={intensity}
                      onIntensityChange={handleIntensityChange}
                      genre={genre}
                      onGenreChange={handleGenreChange}
                      toggles={toggles}
                      onToggle={handleToggle}
                      onAutoMaster={handleAutoMaster}
                    />
                    {autoMasterStatus.kind === "analyzing" ? (
                      <div
                        data-testid="auto-master-progress-mobile"
                        role="status"
                        aria-live="polite"
                        className="mt-2 rounded-md border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] px-3 py-2 text-[10px] text-[rgba(255,255,255,0.7)]"
                      >
                        Analyzing… {autoMasterActiveStage}
                      </div>
                    ) : autoMasterStatus.kind === "error" ? (
                      <div
                        data-testid="auto-master-error-mobile"
                        role="alert"
                        className="mt-2 rounded-md border border-red-500/60 bg-red-500/5 px-3 py-2 text-[10px] text-red-300"
                      >
                        Failed at: {autoMasterStatus.stage} —{" "}
                        {autoMasterStatus.message}
                      </div>
                    ) : null}
                  </>
                ) : mode === "advanced" ? (
                  <AdvancedMastering
                    params={{ ...params }}
                    onParamChange={handleAdvancedParamChange}
                    dynamics={{ deharsh: toggles.deharsh, glueComp: toggles.glueComp }}
                    onDynamicsToggle={handleToggle}
                    tonePreset={tonePreset}
                    onTonePresetChange={handleTonePresetChange}
                    outputPreset={outputPreset}
                    onOutputPresetChange={handleOutputPresetChange}
                  />
                ) : (
                  <DeepMastering audioFile={file} />
                )}
              </div>
            </details>
          )}
        </main>

        <aside className="w-64 border-l border-[rgba(255,255,255,0.06)] overflow-y-auto bg-[rgba(255,255,255,0.02)] p-4 shrink-0 hidden xl:block space-y-4">
          <LevelMeter
            leftLevel={peakLevels.left}
            rightLevel={peakLevels.right}
            lufs={metering.lufs === -Infinity ? 0 : metering.lufs}
            truePeak={metering.truePeak === -Infinity ? 0 : metering.truePeak}
            dynamicRange={metering.dynamicRange}
            target={params.targetLufs}
          />
          <Goniometer
            left={engine.leftAnalyserNode}
            right={engine.rightAnalyserNode}
          />
        </aside>
      </div>
    </div>
  );
}

function LibraryStateBadge(): React.ReactElement | null {
  const loadedFromLibrary = useDeepStore((s) => s.loadedFromLibrary);
  const suppress = useDeepStore((s) => s.suppressLibraryAutoUpdate);

  if (loadedFromLibrary) {
    return (
      <span
        data-testid="loaded-from-library-badge"
        className="text-[10px] px-1.5 py-0.5 rounded bg-[#0a84ff]/15 text-[#0a84ff] uppercase tracking-wider"
      >
        Loaded from library
      </span>
    );
  }
  if (suppress) {
    return (
      <span
        data-testid="started-fresh-badge"
        className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 uppercase tracking-wider"
        title="Analyze to overwrite the saved version"
      >
        Fresh — analyze to overwrite
      </span>
    );
  }
  return null;
}
