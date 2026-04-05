"use client";

import { useState } from "react";
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
} from "lucide-react";
import { StemUpload } from "@/components/mixer/StemUpload";
import { StemList } from "@/components/mixer/StemList";
import { StemTimeline } from "@/components/mixer/StemTimeline";
import { useMixEngine } from "@/hooks/useMixEngine";
import { useMixerStore } from "@/lib/stores/mixer-store";
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

  const handleStemsLoaded = async (files: File[]) => {
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

  const handleSendToMaster = async () => {
    if (stems.length === 0 || isRendering) return;
    setIsRendering(true);
    try {
      // Dynamic import to keep initial bundle light
      const { renderMix } = await import("@/lib/audio/mix-renderer");
      const { encodeWav } = await import("@/lib/audio/wav-encoder");
      const { useAudioStore } = await import("@/lib/stores/audio-store");

      const rendered = await renderMix(stems, 44100);
      const wavData = encodeWav(rendered, 16);
      const blob = new Blob([wavData], { type: "audio/wav" });
      const syntheticFile = new File([blob], "mixed-stems.wav", {
        type: "audio/wav",
      });

      useAudioStore.getState().setFile(syntheticFile);
      useAudioStore.getState().setAudioBuffer(rendered);

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

      const rendered = await renderMix(stems, 44100);
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
            <span className="text-white text-sm">Waveish</span>
            <span className="text-[rgba(255,255,255,0.3)] text-xs">/ Mix</span>
          </div>
        </div>

        {hasStemsLoaded && (
          <div className="flex items-center gap-2">
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
          {/* Upload area (always visible to allow adding more stems) */}
          <StemUpload
            onStemsLoaded={handleStemsLoaded}
            isLoading={isLoadingStems}
            error={loadError}
            stemCount={stems.length}
          />

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
