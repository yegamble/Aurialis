"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import {
  ArrowLeft,
  Play,
  Pause,
  SkipBack,
  Headphones,
  Sparkles,
  Download,
  SendHorizonal,
  Wand2,
} from "lucide-react";
import { StemUpload } from "@/components/mixer/StemUpload";
import { StemList } from "@/components/mixer/StemList";
import { StemTimeline } from "@/components/mixer/StemTimeline";
import { SeparationProgress } from "@/components/mixer/SeparationProgress";
import { useMixEngine } from "@/hooks/useMixEngine";
import { useMixerStore } from "@/lib/stores/mixer-store";
import {
  startSeparation,
  pollJobStatus,
  downloadStem,
  checkBackendHealth,
} from "@/lib/api/separation";
import type { JobStatus } from "@/lib/api/separation";
import type { StemChannelParams } from "@/types/mixer";

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export default function MixPage() {
  const router = useRouter();
  const stems = useMixerStore((s) => s.stems);
  const isAutoMixing = useMixerStore((s) => s.isAutoMixing);
  const masterParams = useMixerStore((s) => s.masterParams);

  const {
    isPlaying,
    currentTime,
    duration,
    play,
    pause,
    stop,
    seek,
    loadStems,
    updateStemParam,
    toggleMute,
    toggleSolo,
    autoMix,
    setStemOffset,
    engine,
  } = useMixEngine();

  const [isLoadingStems, setIsLoadingStems] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(false);

  // Separation state
  const [isSeparating, setIsSeparating] = useState(false);
  const [separationStatus, setSeparationStatus] = useState<JobStatus | null>(null);
  const [showModelSelect, setShowModelSelect] = useState(false);
  const [pendingSingleFile, setPendingSingleFile] = useState<File | null>(null);
  const [smartRepairEnabled, setSmartRepairEnabled] = useState(true);
  const [backendAvailable, setBackendAvailable] = useState<boolean | null>(null);

  // Check backend on mount
  useEffect(() => {
    checkBackendHealth().then((h) => setBackendAvailable(h.ok));
  }, []);

  // Pick up files passed from home page via sessionStorage
  useEffect(() => {
    const urlsJson = sessionStorage.getItem("pendingMixUrls");
    const namesJson = sessionStorage.getItem("pendingMixFiles");
    if (!urlsJson || !namesJson) return;

    sessionStorage.removeItem("pendingMixUrls");
    sessionStorage.removeItem("pendingMixFiles");

    const urls: string[] = JSON.parse(urlsJson);
    const names: string[] = JSON.parse(namesJson);

    (async () => {
      try {
        const files = await Promise.all(
          urls.map(async (url, i) => {
            const res = await fetch(url);
            const blob = await res.blob();
            URL.revokeObjectURL(url);
            return new File([blob], names[i], { type: blob.type });
          })
        );
        await handleStemsLoaded(files);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Failed to load files");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStartSeparation = useCallback(
    async (file: File, model: string) => {
      setShowModelSelect(false);
      setPendingSingleFile(null);
      setIsSeparating(true);
      setLoadError(null);
      setSeparationStatus({
        jobId: "",
        status: "queued",
        progress: 0,
        model,
        stems: [],
        error: null,
      });

      try {
        const { jobId } = await startSeparation(file, model);

        // Poll until done
        const poll = async (): Promise<JobStatus> => {
          const status = await pollJobStatus(jobId);
          setSeparationStatus(status);
          if (status.status === "done" || status.status === "error") {
            return status;
          }
          await new Promise((r) => setTimeout(r, 2000));
          return poll();
        };

        const finalStatus = await poll();

        if (finalStatus.status === "error") {
          setLoadError(finalStatus.error ?? "Separation failed");
          setIsSeparating(false);
          return;
        }

        // Download all stems and load into mixer
        await engine.init();
        const ctx = engine.ctx!;
        const stemBuffers: Array<{ name: string; buffer: AudioBuffer }> = [];

        for (const stem of finalStatus.stems) {
          if (!stem.ready) continue;
          const arrayBuf = await downloadStem(jobId, stem.name);
          const audioBuf = await ctx.decodeAudioData(arrayBuf);
          stemBuffers.push({ name: `${stem.name}.wav`, buffer: audioBuf });
        }

        // Apply Smart Repair if enabled
        if (smartRepairEnabled) {
          const { applySmartRepair } = await import("@/lib/audio/smart-repair");
          // Decode original for phase coherence
          const origBuf = await file.arrayBuffer();
          const originalMix = await ctx.decodeAudioData(origBuf);
          const mixSamples = originalMix.getChannelData(0);

          for (const stem of stemBuffers) {
            const stemType = stem.name.replace(".wav", "") as import("@/types/mixer").StemClassification;
            for (let c = 0; c < stem.buffer.numberOfChannels; c++) {
              const samples = stem.buffer.getChannelData(c);
              const repaired = applySmartRepair(samples, {
                stemType,
                sampleRate: stem.buffer.sampleRate,
                mixSamples,
              });
              stem.buffer.getChannelData(c).set(repaired);
            }
          }
        }

        // Create File objects and load via existing stem loader path
        const files = stemBuffers.map(
          (s) => new File([], s.name, { type: "audio/wav" })
        );
        // Load directly using the engine's loadStems-like flow
        const { generateWaveformPeaks } = await import("@/lib/audio/stem-loader");
        const { DEFAULT_CHANNEL_PARAMS, STEM_COLORS } = await import("@/types/mixer");
        const stemTracks = stemBuffers.map((s, i) => ({
          id: `stem-${Date.now()}-${i}`,
          name: s.name,
          file: files[i],
          audioBuffer: s.buffer,
          waveformPeaks: generateWaveformPeaks(s.buffer),
          classification: s.name.replace(".wav", "") as import("@/types/mixer").StemClassification,
          confidence: 0.9,
          channelParams: { ...DEFAULT_CHANNEL_PARAMS },
          offset: 0,
          duration: s.buffer.duration,
          color: STEM_COLORS[i % STEM_COLORS.length],
        }));

        useMixerStore.getState().addStems(stemTracks);
        for (const t of stemTracks) {
          engine.addStem(t);
        }

        // Auto-mix after separation
        await autoMix();

        setIsSeparating(false);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Separation failed");
        setIsSeparating(false);
      }
    },
    [engine, autoMix, smartRepairEnabled]
  );

  const handleStemsLoaded = async (files: File[]) => {
    // Single audio file → trigger separation if backend available
    if (files.length === 1 && !files[0].name.endsWith(".zip") && backendAvailable) {
      setPendingSingleFile(files[0]);
      setShowModelSelect(true);
      return;
    }

    // Multi-file or ZIP → load directly into mixer
    setIsLoadingStems(true);
    setLoadError(null);
    try {
      await loadStems(files);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load stems");
    } finally {
      setIsLoadingStems(false);
    }
  };

  const handleParamChange = (
    stemId: string,
    key: keyof StemChannelParams,
    value: StemChannelParams[keyof StemChannelParams]
  ) => {
    updateStemParam(stemId, key, value);
  };

  const handleAutoMix = async () => {
    await autoMix();
  };

  const handleSplitFurther = useCallback(
    async (stemId: string) => {
      const stem = stems.find((s) => s.id === stemId);
      if (!stem?.audioBuffer || !backendAvailable) return;

      setIsSeparating(true);
      setLoadError(null);

      try {
        // Encode the stem's audio buffer to WAV for upload
        const { encodeWav } = await import("@/lib/audio/wav-encoder");
        const wavData = encodeWav(stem.audioBuffer, 16);
        const blob = new Blob([wavData], { type: "audio/wav" });
        const file = new File([blob], `${stem.name}`, { type: "audio/wav" });

        // Start separation on the "other" stem
        const { jobId } = await startSeparation(file, "htdemucs_6s");

        const poll = async (): Promise<JobStatus> => {
          const status = await pollJobStatus(jobId);
          setSeparationStatus(status);
          if (status.status === "done" || status.status === "error") return status;
          await new Promise((r) => setTimeout(r, 2000));
          return poll();
        };

        const finalStatus = await poll();
        if (finalStatus.status === "error") {
          setLoadError(finalStatus.error ?? "Re-separation failed");
          setIsSeparating(false);
          return;
        }

        // Download sub-stems
        await engine.init();
        const ctx = engine.ctx!;
        const { generateWaveformPeaks } = await import("@/lib/audio/stem-loader");
        const { DEFAULT_CHANNEL_PARAMS, STEM_COLORS } = await import("@/types/mixer");

        const newTracks = [];
        for (const s of finalStatus.stems) {
          if (!s.ready) continue;
          const buf = await downloadStem(jobId, s.name);
          const audioBuf = await ctx.decodeAudioData(buf);
          const track = {
            id: `stem-${Date.now()}-sub-${s.name}`,
            name: `Other → ${s.name}.wav`,
            file: new File([], `${s.name}.wav`),
            audioBuffer: audioBuf,
            waveformPeaks: generateWaveformPeaks(audioBuf),
            classification: s.name as import("@/types/mixer").StemClassification,
            confidence: 0.6,
            channelParams: { ...DEFAULT_CHANNEL_PARAMS },
            offset: stem.offset,
            duration: audioBuf.duration,
            color: STEM_COLORS[Math.floor(Math.random() * STEM_COLORS.length)],
          };
          newTracks.push(track);
        }

        // Remove original "other" stem and add sub-stems
        useMixerStore.getState().removeStem(stemId);
        engine.removeStem(stemId);
        useMixerStore.getState().addStems(newTracks);
        for (const t of newTracks) engine.addStem(t);

        setIsSeparating(false);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Re-separation failed");
        setIsSeparating(false);
      }
    },
    [stems, backendAvailable, engine]
  );

  const handleSendToMaster = async () => {
    if (stems.length === 0 || isRendering) return;
    setIsRendering(true);
    try {
      // Dynamic import to keep initial bundle light
      const { renderMix } = await import("@/lib/audio/mix-renderer");
      const { useAudioStore } = await import("@/lib/stores/audio-store");

      const rendered = await renderMix(stems, 44100);
      const { encodeWav } = await import("@/lib/audio/wav-encoder");
      const wavData = encodeWav(rendered, 16);
      const syntheticFile = new File([new Blob([wavData], { type: "audio/wav" })], "mixed-stems.wav", {
        type: "audio/wav",
      });

      useAudioStore.getState().setFile(syntheticFile);
      useAudioStore.getState().setAudioBuffer(rendered);
      useAudioStore.getState().setParams(masterParams);

      router.push("/master");
    } catch (e) {
      setLoadError(
        e instanceof Error ? e.message : "Failed to render mix"
      );
    } finally {
      setIsRendering(false);
    }
  };

  const handleExportMix = async () => {
    if (stems.length === 0 || isRendering) return;
    setIsRendering(true);
    try {
      const { renderMix } = await import("@/lib/audio/mix-renderer");
      const { encodeWav } = await import("@/lib/audio/wav-encoder");

      const rendered = await renderMix(stems, 44100, masterParams);
      const wavData = encodeWav(rendered, 16);
      const blob = new Blob([wavData], { type: "audio/wav" });

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "mixed-stems.wav";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setLoadError(
        e instanceof Error ? e.message : "Failed to export mix"
      );
    } finally {
      setIsRendering(false);
    }
  };

  const isEffectivelyMuted = (stemId: string): boolean => {
    return engine.isEffectivelyMuted(stemId);
  };

  const hasStemsLoaded = stems.length > 0;

  return (
    <div className="min-h-screen bg-black flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-3 border-b border-[rgba(255,255,255,0.06)] bg-[rgba(0,0,0,0.8)] backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center gap-4">
          <button
            onClick={() => {
              stop();
              useMixerStore.getState().reset();
              router.push("/");
            }}
            className="w-8 h-8 rounded-full bg-[rgba(255,255,255,0.06)] flex items-center justify-center hover:bg-[rgba(255,255,255,0.1)] transition-colors"
            aria-label="Back to home"
          >
            <ArrowLeft className="w-4 h-4 text-[rgba(255,255,255,0.7)]" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-b from-[#0a84ff] to-[#0066cc] flex items-center justify-center">
              <Headphones className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="text-white text-sm">Aurialis</span>
            <span className="text-[rgba(255,255,255,0.3)] text-xs">/ Mix</span>
          </div>
        </div>

        {hasStemsLoaded && (
          <div className="flex items-center gap-2">
            {/* Smart Repair toggle */}
            <button
              onClick={() => setSmartRepairEnabled(!smartRepairEnabled)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors ${
                smartRepairEnabled
                  ? "bg-green-500/20 text-green-400 border border-green-500/30"
                  : "bg-[rgba(255,255,255,0.06)] text-[rgba(255,255,255,0.4)]"
              }`}
              aria-pressed={smartRepairEnabled}
              aria-label="Smart Repair"
            >
              <Wand2 className="w-3.5 h-3.5" />
              Smart Repair
            </button>
            <button
              onClick={handleAutoMix}
              disabled={isAutoMixing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[rgba(255,255,255,0.06)] text-[rgba(255,255,255,0.7)] hover:bg-[rgba(255,255,255,0.1)] hover:text-white text-xs transition-colors disabled:opacity-40"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {isAutoMixing ? "Analyzing..." : "Auto Mix"}
            </button>
            <button
              onClick={handleSendToMaster}
              disabled={isRendering}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0a84ff]/20 text-[#0a84ff] hover:bg-[#0a84ff]/30 text-xs transition-colors disabled:opacity-40"
            >
              <SendHorizonal className="w-3.5 h-3.5" />
              {isRendering ? "Rendering..." : "Send to Master"}
            </button>
            <button
              onClick={handleExportMix}
              disabled={isRendering}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[rgba(255,255,255,0.06)] text-[rgba(255,255,255,0.7)] hover:bg-[rgba(255,255,255,0.1)] hover:text-white text-xs transition-colors disabled:opacity-40"
            >
              <Download className="w-3.5 h-3.5" />
              Export Mix
            </button>
          </div>
        )}
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar: Channel Strips */}
        {hasStemsLoaded && (
          <aside className="w-auto max-w-[50%] border-r border-[rgba(255,255,255,0.06)] overflow-y-auto overflow-x-auto bg-[rgba(255,255,255,0.02)] p-3 shrink-0 hidden lg:block">
            <StemList
              stems={stems}
              onParamChange={handleParamChange}
              onMuteToggle={toggleMute}
              onSoloToggle={toggleSolo}
              isEffectivelyMuted={isEffectivelyMuted}
            />
          </aside>
        )}

        {/* Main content */}
        <main className="flex-1 flex flex-col p-5 gap-4 overflow-y-auto">
          {/* Model selection dialog */}
          {showModelSelect && pendingSingleFile && (
            <div className="rounded-xl bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.1)] p-6">
              <p className="text-white text-sm mb-1">
                Single file detected: <strong>{pendingSingleFile.name}</strong>
              </p>
              <p className="text-[rgba(255,255,255,0.4)] text-xs mb-4">
                Choose how many stems to separate into:
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => handleStartSeparation(pendingSingleFile, "htdemucs")}
                  className="flex-1 py-3 rounded-lg bg-[#0a84ff]/20 text-[#0a84ff] hover:bg-[#0a84ff]/30 text-sm transition-colors"
                >
                  4 Stems
                  <span className="block text-[10px] text-[rgba(255,255,255,0.3)] mt-0.5">
                    vocals, drums, bass, other
                  </span>
                </button>
                <button
                  onClick={() => handleStartSeparation(pendingSingleFile, "htdemucs_6s")}
                  className="flex-1 py-3 rounded-lg bg-[#0a84ff]/20 text-[#0a84ff] hover:bg-[#0a84ff]/30 text-sm transition-colors"
                >
                  6 Stems
                  <span className="block text-[10px] text-[rgba(255,255,255,0.3)] mt-0.5">
                    + guitar, piano
                  </span>
                </button>
              </div>
              <button
                onClick={() => {
                  // Skip separation — load as single stem directly
                  setShowModelSelect(false);
                  setPendingSingleFile(null);
                  loadStems([pendingSingleFile]);
                }}
                className="w-full mt-2 py-2 text-[rgba(255,255,255,0.3)] text-xs hover:text-white transition-colors"
              >
                Skip separation — load as single track
              </button>
            </div>
          )}

          {/* Separation progress */}
          {isSeparating && separationStatus && (
            <SeparationProgress
              status={separationStatus.status}
              progress={separationStatus.progress}
              model={separationStatus.model}
              stems={separationStatus.stems}
              error={separationStatus.error}
            />
          )}

          {/* Backend unavailable warning */}
          {backendAvailable === false && !hasStemsLoaded && (
            <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/20 px-4 py-3 text-yellow-400 text-xs">
              Separation backend not available. Run <code className="bg-[rgba(255,255,255,0.1)] px-1 rounded">docker compose up</code> to enable Smart Split.
              Multi-file and ZIP uploads still work.
            </div>
          )}

          {/* Upload area (always visible to allow adding more stems) */}
          {!isSeparating && !showModelSelect && (
            <StemUpload
              onStemsLoaded={handleStemsLoaded}
              isLoading={isLoadingStems}
              error={loadError}
              stemCount={stems.length}
            />
          )}

          {hasStemsLoaded && (
            <>
              {/* Timeline */}
              <StemTimeline
                stems={stems}
                currentTime={currentTime}
                duration={duration}
                onSeek={seek}
                onOffsetChange={setStemOffset}
              />

              {/* Split Further buttons for "other" stems */}
              {backendAvailable && stems.some((s) => s.classification === "other") && !isSeparating && (
                <div className="flex flex-wrap gap-2">
                  {stems
                    .filter((s) => s.classification === "other")
                    .map((s) => (
                      <button
                        key={s.id}
                        onClick={() => handleSplitFurther(s.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[rgba(255,255,255,0.06)] text-[rgba(255,255,255,0.5)] hover:bg-[rgba(255,255,255,0.1)] hover:text-white text-xs transition-colors"
                      >
                        <Sparkles className="w-3 h-3" />
                        Split Further: {s.name}
                      </button>
                    ))}
                </div>
              )}

              {/* Playback controls */}
              <div className="flex items-center justify-center gap-4">
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
                  disabled={!hasStemsLoaded}
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

              {/* Mobile channel strips */}
              <div className="lg:hidden">
                <details className="group">
                  <summary className="cursor-pointer text-[#0a84ff] text-sm py-2 list-none flex items-center gap-1">
                    <span>Show Channel Strips</span>
                  </summary>
                  <div className="pt-2 overflow-x-auto">
                    <StemList
                      stems={stems}
                      onParamChange={handleParamChange}
                      onMuteToggle={toggleMute}
                      onSoloToggle={toggleSolo}
                      isEffectivelyMuted={isEffectivelyMuted}
                    />
                  </div>
                </details>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
