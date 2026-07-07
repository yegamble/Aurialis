"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { Play, Pause, SkipBack, SkipForward, ArrowLeft } from "lucide-react";
import { WaveformDisplay } from "@/components/visualization/WaveformDisplay";
import { SpectrumDisplay } from "@/components/visualization/SpectrumDisplay";
import { LevelMeter } from "@/components/visualization/LevelMeter";
import { Goniometer } from "@/components/visualization/Goniometer";
import { MasterScreen } from "@/components/mastering/MasterScreen";
import { BigReadout } from "@/components/mastering/BigReadout";
import { DeepTimeline } from "@/components/mastering/DeepTimeline";
import { PROFILE_CARDS } from "@/components/mastering/EngineerProfilePicker";
import { type ShellScreen } from "@/components/shell/Sidebar";
import { AppShell } from "@/components/shell/AppShell";
import { ABToggle } from "@/components/mastering/ABToggle";
import { MasterToolbar, type MasterMode } from "@/components/mastering/MasterToolbar";
import { ExportView } from "@/components/export/ExportView";
import { useAudioStore } from "@/lib/stores/audio-store";
import { useUIStore } from "@/lib/stores/ui-store";
import { useSettingsStore } from "@/lib/stores/settings-store";
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
import { buildExportOptions } from "@/lib/audio/export-options";
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

/**
 * Human-readable stereo-correlation phrase for the Phase Scope status line
 * (Direction C). Derived from the same live value that drives the CORR
 * readout — never a mocked number.
 */
function correlationPhrase(c: number): string {
  if (!Number.isFinite(c)) return "No signal";
  if (c >= 0.6) return "Mono-compatible";
  if (c >= 0.2) return "Mostly correlated";
  if (c >= -0.2) return "Wide / decorrelated";
  return "Out of phase";
}

function profileLabel(id: string): string {
  return PROFILE_CARDS.find((p) => p.id === id)?.name ?? id;
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
  const proMode = useSettingsStore((s) => s.proMode);
  const setProMode = useSettingsStore((s) => s.setProMode);
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
  const deepScript = useDeepStore((s) => s.script);
  const activeFingerprint = useLibraryStore((s) => s.activeFingerprint);
  const updateLibrarySettings = useLibraryStore((s) => s.updateSettings);
  const updateMeasuredLufs = useLibraryStore((s) => s.updateMeasuredLufs);

  // Export state
  const [isExporting, setIsExporting] = useState(false);
  // Focused "Export" screen state (design intent): the toolbar Export button
  // opens a dedicated export view with a "Back to mastering" affordance.
  const [showExport, setShowExport] = useState(false);

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
      const { script, scriptActive } = useDeepStore.getState();
      await exportWav(
        audioBuffer,
        params,
        buildExportOptions(settings, { script, scriptActive }),
      );
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
      // Persist the measured integrated loudness so the Smart Master Album can
      // show real per-track loudness deltas (not the configured target).
      if (activeFingerprint && Number.isFinite(analysis.integratedLufs)) {
        void updateMeasuredLufs(activeFingerprint, analysis.integratedLufs);
      }
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

  const handleSidebarSelect = (next: ShellScreen) => {
    if (next === "master") return;
    stop();
    if (next === "stems") router.push("/mix");
    else if (next === "album") router.push("/album");
    else router.push("/");
  };

  return (
    <AppShell
      activeScreen="master"
      onSelect={handleSidebarSelect}
      proMode={proMode}
      onProModeChange={setProMode}
      variant="workspace"
    >
      <MasterToolbar
        fileName={file.name}
        durationLabel={formatTime(duration)}
        sampleRateLabel={`${(sampleRate / 1000).toFixed(1)} kHz`}
        channelLabel={
          channels === 2 ? "Stereo" : channels === 1 ? "Mono" : `${channels}ch`
        }
        mode={mode as MasterMode}
        onModeChange={(next) => setMode(next)}
        onBack={() => {
          stop();
          router.push("/");
        }}
        onStems={() => {
          stop();
          router.push("/mix");
        }}
        onExport={() => setShowExport(true)}
      >
        <LibraryStateBadge />
      </MasterToolbar>

      {showExport ? (
        <FocusedExport
          fileName={file.name}
          onBack={() => setShowExport(false)}
        >
          <ExportView
            onExport={handleExport}
            isExporting={isExporting}
            lufs={metering.lufs}
            truePeak={metering.truePeak}
            lra={metering.lra}
            lraReady={metering.lraReady}
            dynamicRange={metering.dynamicRange}
            durationSec={duration}
          />
        </FocusedExport>
      ) : (
      <div className="flex-1 flex overflow-hidden">
        {isLgViewport && (
          <aside className="order-3 w-80 border-l border-[rgba(255,255,255,0.06)] overflow-y-auto bg-[rgba(20,20,22,0.6)] p-4 shrink-0">
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[rgba(255,255,255,0.5)]">
              Controls
            </div>
            <MasterScreen
              animated
              mode={mode as MasterMode}
              audioFile={file}
              intensity={intensity}
              onIntensityChange={handleIntensityChange}
              genre={genre}
              onGenreChange={handleGenreChange}
              toggles={toggles}
              onToggle={handleToggle}
              onAutoMaster={handleAutoMaster}
              autoMasterStatus={autoMasterStatus}
              autoMasterActiveStage={autoMasterActiveStage}
              params={params}
              onAdvancedParamChange={handleAdvancedParamChange}
              tonePreset={tonePreset}
              onTonePresetChange={handleTonePresetChange}
              outputPreset={outputPreset}
              onOutputPresetChange={handleOutputPresetChange}
            />
          </aside>
        )}

        <div className="order-1 min-w-0 flex-1 flex flex-col p-5 gap-4 overflow-y-auto">
          {/* Top readouts row — design Direction A: 5-col metering grid */}
          <div
            className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-5"
            data-testid="master-readouts"
          >
            <BigReadout
              label="LUFS-I"
              value={metering.lufs === -Infinity ? null : metering.lufs.toFixed(1)}
              sub="Target −9.5"
              emphasized
            />
            <BigReadout
              label="dBTP"
              value={
                metering.truePeak === -Infinity ? null : metering.truePeak.toFixed(1)
              }
              sub="Ceiling −1.0"
              warn={metering.truePeak > -0.5}
            />
            <BigReadout
              label="LRA"
              value={metering.lraReady ? `${metering.lra.toFixed(1)} LU` : null}
              sub="Range"
            />
            <BigReadout
              label="DR"
              value={
                Number.isFinite(metering.dynamicRange)
                  ? metering.dynamicRange.toFixed(1)
                  : null
              }
              sub="Dynamic range"
            />
            <BigReadout
              label="CORR"
              value={
                metering.correlation >= 0
                  ? `+${metering.correlation.toFixed(2)}`
                  : metering.correlation.toFixed(2)
              }
              sub="Stereo correlation"
              warn={metering.correlationPeakMin < 0}
            />
          </div>

          {/* Waveform card — header: current time · "Waveform" · duration.
              Honest label: the display is not M/S, so no Mid/Side claim. */}
          <div className="rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] px-4 py-3">
            <div className="mb-2 flex items-center justify-between text-[10px] tabular-nums text-[rgba(255,255,255,0.4)]">
              <span>{formatTime(currentTime)}</span>
              <span className="font-semibold uppercase tracking-[0.14em] text-[rgba(255,255,255,0.5)]">
                Waveform
              </span>
              <span>{formatTime(duration)}</span>
            </div>
            <WaveformDisplay
              audioData={waveformPeaks}
              currentTime={currentTime}
              duration={duration}
              onSeek={seek}
            />
          </div>

          {/* Transport — bordered three-zone card: A/B left · controls
              center · time right (design app.jsx Transport). */}
          <div
            data-testid="master-transport"
            className="flex items-center gap-4 rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] px-4 py-2.5"
          >
            <ABToggle isActive={isBypassed} onToggle={toggleBypass} />
            <div className="flex-1" />
            <button
              onClick={stop}
              className="w-8 h-8 rounded-full bg-[rgba(255,255,255,0.06)] flex items-center justify-center hover:bg-[rgba(255,255,255,0.1)] transition-colors"
              aria-label="Stop and return to beginning"
            >
              <SkipBack className="w-3.5 h-3.5 text-[rgba(255,255,255,0.7)]" />
            </button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => (isPlaying ? pause() : play())}
              disabled={!isLoaded}
              className="w-11 h-11 rounded-full bg-gradient-to-b from-[#0a84ff] to-[#0066cc] flex items-center justify-center shadow-[0_2px_20px_rgba(10,132,255,0.35)] disabled:opacity-40"
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? (
                <Pause className="w-5 h-5 text-white" />
              ) : (
                <Play className="w-5 h-5 text-white ml-0.5" />
              )}
            </motion.button>
            <button
              onClick={() => seek(Math.min(duration, currentTime + 5))}
              disabled={!isLoaded}
              className="w-8 h-8 rounded-full bg-[rgba(255,255,255,0.06)] flex items-center justify-center hover:bg-[rgba(255,255,255,0.1)] transition-colors disabled:opacity-40"
              aria-label="Skip forward 5 seconds"
            >
              <SkipForward className="w-3.5 h-3.5 text-[rgba(255,255,255,0.7)]" />
            </button>
            <div className="flex-1" />
            <div className="text-xs tabular-nums min-w-[90px] text-right text-[rgba(255,255,255,0.7)]">
              {formatTime(currentTime)}{" "}
              <span className="text-[rgba(255,255,255,0.4)]">
                / {formatTime(duration)}
              </span>
            </div>
          </div>

          {/* Spectrum card — header: "Spectrum" · range + source. */}
          <div className="rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] px-4 py-3">
            <div className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.12em] text-[rgba(255,255,255,0.5)]">
              <span>Spectrum</span>
              <span className="text-[rgba(255,255,255,0.4)]">
                20 Hz — 20 kHz &middot; Bus output
              </span>
            </div>
            <SpectrumDisplay data={spectrumData} pro={proMode} />
          </div>

          {/* Deep timeline — promoted to a full-width main-canvas card below
              the transport when a script is ready (design views.jsx
              DeepTimelineBig). Header + Move/Edited/AI-Repair legend. */}
          {mode === "deep" && deepScript ? (
            <div
              data-testid="deep-timeline-card"
              className="rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] p-4"
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgba(255,255,255,0.5)]">
                  Mastering Script &middot; {profileLabel(deepScript.profile)}
                </span>
                <div className="flex items-center gap-3 text-[10px] text-[rgba(255,255,255,0.5)]">
                  <LegendDot color="#0a84ff" label="Move" />
                  <LegendDot color="#ffd60a" label="Edited" />
                  <LegendDot color="#ff7a00" label="AI Repair" />
                </div>
              </div>
              <DeepTimeline script={deepScript} />
            </div>
          ) : null}

          {!isLgViewport && (
            <details className="group">
              <summary className="cursor-pointer text-[#0a84ff] text-sm py-2 list-none flex items-center gap-1">
                <span>
                  Show {mode === "simple" ? "Simple" : mode === "advanced" ? "Advanced" : "Deep"} Controls
                </span>
              </summary>
              <div className="pt-2">
                <MasterScreen
                  testIdSuffix="-mobile"
                  mode={mode as MasterMode}
                  audioFile={file}
                  intensity={intensity}
                  onIntensityChange={handleIntensityChange}
                  genre={genre}
                  onGenreChange={handleGenreChange}
                  toggles={toggles}
                  onToggle={handleToggle}
                  onAutoMaster={handleAutoMaster}
                  autoMasterStatus={autoMasterStatus}
                  autoMasterActiveStage={autoMasterActiveStage}
                  params={params}
                  onAdvancedParamChange={handleAdvancedParamChange}
                  tonePreset={tonePreset}
                  onTonePresetChange={handleTonePresetChange}
                  outputPreset={outputPreset}
                  onOutputPresetChange={handleOutputPresetChange}
                />
              </div>
            </details>
          )}
        </div>

        <aside
          data-testid="master-right-rail"
          className="order-2 w-64 border-l border-[rgba(255,255,255,0.06)] overflow-y-auto bg-[rgba(255,255,255,0.02)] p-4 shrink-0 hidden xl:block space-y-4"
        >
          <LevelMeter
            leftLevel={peakLevels.left}
            rightLevel={peakLevels.right}
            lufs={metering.lufs === -Infinity ? 0 : metering.lufs}
            truePeak={metering.truePeak === -Infinity ? 0 : metering.truePeak}
            dynamicRange={metering.dynamicRange}
            target={params.targetLufs}
          />
          <div
            data-testid="mb-gr-readout"
            className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] px-3 py-2.5 text-[11px] tabular-nums text-[rgba(255,255,255,0.55)]"
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
                <span className={mbGrColorClass(metering.multibandGR.high)}>
                  {formatMbGr(metering.multibandGR.high)}
                </span>{" "}
                dB
              </>
            ) : (
              "MB: ---"
            )}
          </div>
          {proMode ? (
            <div
              data-testid="master-goniometer-slot"
              className="rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] p-3"
            >
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[rgba(255,255,255,0.5)]">
                Phase Scope
              </div>
              <div className="flex justify-center">
                <Goniometer
                  left={engine.leftAnalyserNode}
                  right={engine.rightAnalyserNode}
                  size={200}
                  hideLabel
                />
              </div>
              <div
                data-testid="phase-scope-status"
                className="mt-2 flex items-center gap-1.5 text-[10px] text-[rgba(255,255,255,0.55)]"
              >
                <span
                  aria-hidden
                  className="inline-block h-2 w-2 rounded-full"
                  style={{
                    background:
                      metering.correlation >= 0 ? "#30d158" : "#ff453a",
                  }}
                />
                <span>
                  {correlationPhrase(metering.correlation)}
                  {Number.isFinite(metering.correlation)
                    ? ` · ${metering.correlation >= 0 ? "+" : ""}${metering.correlation.toFixed(2)}`
                    : ""}
                </span>
              </div>
            </div>
          ) : null}
        </aside>
      </div>
      )}
    </AppShell>
  );
}

/**
 * Focused "Export" screen state on /master — a dedicated view reached from the
 * toolbar Export button. Header (Export + track name) + "Back to mastering";
 * the existing ExportView is mounted inside unchanged.
 */
function FocusedExport({
  fileName,
  onBack,
  children,
}: {
  fileName: string;
  onBack: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      data-testid="master-export-focused"
      className="flex-1 overflow-y-auto p-6"
    >
      <div className="mx-auto max-w-3xl">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-white">Export</h1>
            <p className="truncate text-xs text-[rgba(255,255,255,0.5)]">
              {fileName}
            </p>
          </div>
          <button
            type="button"
            data-testid="export-back-button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[rgba(255,255,255,0.06)] px-3 py-1.5 text-xs text-[rgba(255,255,255,0.75)] hover:bg-[rgba(255,255,255,0.1)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to mastering
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function LegendDot({
  color,
  label,
}: {
  color: string;
  label: string;
}): React.ReactElement {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        aria-hidden
        className="inline-block h-2 w-2 rounded-full"
        style={{ background: color }}
      />
      {label}
    </span>
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
