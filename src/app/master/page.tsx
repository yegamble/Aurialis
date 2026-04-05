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
import { SimpleMastering } from "@/components/mastering/SimpleMastering";
import { AdvancedMastering } from "@/components/mastering/AdvancedMastering";
import { ABToggle } from "@/components/mastering/ABToggle";
import { ExportPanel } from "@/components/export/ExportPanel";
import { useAudioStore } from "@/lib/stores/audio-store";
import { useUIStore } from "@/lib/stores/ui-store";
import { useAudioEngine } from "@/hooks/useAudioEngine";
import { useVisualization } from "@/hooks/useVisualization";
import { applyIntensity, PLATFORM_PRESETS, type GenreName } from "@/lib/audio/presets";
import { analyzeAudio } from "@/lib/audio/analysis";
import { computeAutoMasterParams } from "@/lib/audio/auto-master";
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

export default function MasterPage() {
  const router = useRouter();
  const file = useAudioStore((s) => s.file);
  const { mode, setMode } = useUIStore();

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

  // Export state
  const [isExporting, setIsExporting] = useState(false);

  // Simple mode: genre, intensity (0-100), and toggles
  const [genre, setGenre] = useState<GenreName>("pop");
  const [intensity, setIntensity] = useState(50);
  const [toggles, setToggles] = useState({ ...INITIAL_TOGGLES });
  const [tonePreset, setTonePreset] = useState<TonePresetName | null>(null);
  const [outputPreset, setOutputPreset] = useState<OutputPresetName | null>(
    null
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

  // Sync store params with the genre/intensity system on mount.
  // The store initializes with neutral defaults; this aligns them with the
  // actual genre+intensity+toggles state so the first toggle doesn't cause
  // an unexpected param jump.
  useEffect(() => {
    recomputeParams(genre, intensity, toggles);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally run once — captures initial genre/intensity/toggles

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

  const handleAdvancedParamChange = (key: keyof AudioParams, value: number) => {
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

  const handleAutoMaster = () => {
    const audioBuffer = engine?.audioBuffer;
    if (!audioBuffer) return;
    const analysis = analyzeAudio(audioBuffer);
    const result = computeAutoMasterParams(analysis);
    const resetToggles = { ...INITIAL_TOGGLES };
    setGenre(result.genre);
    setIntensity(result.intensity);
    setToggles(resetToggles);
    recomputeParams(result.genre, result.intensity, resetToggles);
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
          {(["simple", "advanced"] as const).map((m) => (
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
        <aside className="w-80 border-r border-[rgba(255,255,255,0.06)] overflow-y-auto bg-[rgba(255,255,255,0.02)] p-4 shrink-0 hidden lg:block">
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
              </motion.div>
            ) : (
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
            )}
          </AnimatePresence>
        </aside>

        <main className="flex-1 flex flex-col p-5 gap-4 overflow-y-auto">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[rgba(255,255,255,0.06)] flex items-center justify-center">
                <Music className="w-4 h-4 text-[#0a84ff]" />
              </div>
              <div>
                <p className="text-white text-sm">{file.name}</p>
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

          <div className="lg:hidden">
            <details className="group">
              <summary className="cursor-pointer text-[#0a84ff] text-sm py-2 list-none flex items-center gap-1">
                <span>
                  Show {mode === "simple" ? "Simple" : "Advanced"} Controls
                </span>
              </summary>
              <div className="pt-2">
                {mode === "simple" ? (
                  <SimpleMastering
                    intensity={intensity}
                    onIntensityChange={handleIntensityChange}
                    genre={genre}
                    onGenreChange={handleGenreChange}
                    toggles={toggles}
                    onToggle={handleToggle}
                    onAutoMaster={handleAutoMaster}
                  />
                ) : (
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
                )}
              </div>
            </details>
          </div>
        </main>

        <aside className="w-64 border-l border-[rgba(255,255,255,0.06)] overflow-y-auto bg-[rgba(255,255,255,0.02)] p-4 shrink-0 hidden xl:block">
          <LevelMeter
            leftLevel={peakLevels.left}
            rightLevel={peakLevels.right}
            lufs={metering.lufs === -Infinity ? 0 : metering.lufs}
            truePeak={metering.truePeak === -Infinity ? 0 : metering.truePeak}
            dynamicRange={metering.dynamicRange}
            target={params.targetLufs}
          />
        </aside>
      </div>
    </div>
  );
}
