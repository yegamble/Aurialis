"use client";

import {
  useRef,
  useEffect,
  useCallback,
  useSyncExternalStore,
} from "react";
import { MixEngine } from "@/lib/audio/mix-engine";
import { useMixerStore } from "@/lib/stores/mixer-store";
import { analyzeStem } from "@/lib/audio/stem-analyzer";
import { generateAutoMix } from "@/lib/audio/auto-mixer";
import { loadStemsFromFiles, loadStemsFromZip, isZipFile } from "@/lib/audio/stem-loader";
import { DEFAULT_CHANNEL_PARAMS, STEM_COLORS } from "@/types/mixer";
import type { StemTrack, StemChannelParams, AnalyzedStem } from "@/types/mixer";

interface MixEngineSnapshot {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
}

const defaultSnapshot: MixEngineSnapshot = {
  isPlaying: false,
  currentTime: 0,
  duration: 0,
};

export function useMixEngine() {
  const engineRef = useRef<MixEngine | null>(null);
  const snapshotRef = useRef<MixEngineSnapshot>({ ...defaultSnapshot });
  const listenersRef = useRef(new Set<() => void>());

  // Create a fresh engine if none exists or if the previous one was disposed
  /* eslint-disable react-hooks/refs -- intentional lazy init pattern for StrictMode */
  if (!engineRef.current || engineRef.current.isDisposed) {
    engineRef.current = new MixEngine();
  }
  const engine = engineRef.current;
  /* eslint-enable react-hooks/refs */

  const subscribe = useCallback((listener: () => void) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const getSnapshot = useCallback(() => snapshotRef.current, []);

  const notifyListeners = useCallback(() => {
    listenersRef.current.forEach((l) => l());
  }, []);

  const updateSnapshot = useCallback(
    (partial: Partial<MixEngineSnapshot>) => {
      const prev = snapshotRef.current;
      const next = { ...prev, ...partial };
      if (
        next.isPlaying !== prev.isPlaying ||
        next.currentTime !== prev.currentTime ||
        next.duration !== prev.duration
      ) {
        snapshotRef.current = next;
        notifyListeners();
      }
    },
    [notifyListeners]
  );

  // Sync engine events → snapshot + Zustand
  useEffect(() => {
    const onStateChange = (data: unknown) => {
      const { isPlaying } = data as { isPlaying: boolean };
      updateSnapshot({ isPlaying });
      useMixerStore.getState().setIsPlaying(isPlaying);
    };

    const onTimeUpdate = (data: unknown) => {
      const time = data as number;
      updateSnapshot({ currentTime: time });
      useMixerStore.getState().setCurrentTime(time);
    };

    engine.on("statechange", onStateChange);
    engine.on("timeupdate", onTimeUpdate);

    return () => {
      engine.off("statechange", onStateChange);
      engine.off("timeupdate", onTimeUpdate);
    };
    // eslint-disable-next-line react-hooks/refs -- engine is a stable local derived from ref init above
  }, [engine, updateSnapshot]);

  // Dispose on unmount
  useEffect(() => {
    return () => {
      engine.dispose();
      if (engineRef.current === engine) {
        engineRef.current = null;
      }
    };
  }, [engine]);

  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => defaultSnapshot
  );

  // --- Actions ---

  const play = useCallback(async () => {
    await engine.init();
    await engine.play();
  }, [engine]);

  const pause = useCallback(() => engine.pause(), [engine]);
  const stop = useCallback(() => engine.stop(), [engine]);

  const seek = useCallback(
    (time: number) => {
      engine.seek(time);
      updateSnapshot({ currentTime: engine.getCurrentTime() });
    },
    [engine, updateSnapshot]
  );

  const loadStems = useCallback(
    async (files: File[]) => {
      await engine.init();

      useMixerStore.getState().setIsAutoMixing(false);

      // Use the engine's AudioContext for decoding — avoids orphaned contexts
      const ctx = engine.ctx!;

      let result;
      if (files.length === 1 && isZipFile(files[0])) {
        result = await loadStemsFromZip(files[0], ctx);
      } else {
        result = await loadStemsFromFiles(files, ctx);
      }

      // Log any failures for user awareness
      if (result.failures.length > 0) {
        console.warn(
          `Failed to load ${result.failures.length} file(s):`,
          result.failures.map((f) => `${f.name}: ${f.reason}`)
        );
      }

      const existingCount = useMixerStore.getState().stems.length;

      const stems: StemTrack[] = result.stems.map((s, i) => {
        const colorIndex = (existingCount + i) % STEM_COLORS.length;
        return {
          id: `stem-${Date.now()}-${i}`,
          name: s.name,
          file: new File([], s.name), // placeholder
          audioBuffer: s.buffer,
          waveformPeaks: s.waveformPeaks,
          classification: "other",
          confidence: 0,
          channelParams: { ...DEFAULT_CHANNEL_PARAMS },
          offset: 0,
          duration: s.buffer.duration,
          color: STEM_COLORS[colorIndex],
        };
      });

      // Warn if memory footprint is high
      const totalBytes = stems.reduce(
        (acc, s) =>
          acc +
          (s.audioBuffer
            ? s.audioBuffer.length * s.audioBuffer.numberOfChannels * 4
            : 0),
        0
      );
      if (totalBytes > 1e9) {
        console.warn(
          `Stem memory footprint: ${(totalBytes / 1e9).toFixed(1)} GB — performance may be impacted`
        );
      }

      // Add to store
      useMixerStore.getState().addStems(stems);

      // Add to engine
      for (const stem of stems) {
        engine.addStem(stem);
      }

      updateSnapshot({ duration: engine.duration });
    },
    [engine, updateSnapshot]
  );

  const updateStemParam = useCallback(
    <K extends keyof StemChannelParams>(
      stemId: string,
      key: K,
      value: StemChannelParams[K]
    ) => {
      useMixerStore.getState().updateStemParam(stemId, key, value);

      // Apply to engine
      switch (key) {
        case "volume":
          engine.updateStemVolume(stemId, value as number);
          break;
        case "pan":
          engine.updateStemPan(stemId, value as number);
          break;
        case "eq":
          for (let i = 0; i < 5; i++) {
            engine.updateStemEQ(stemId, i, (value as number[])[i]);
          }
          break;
        case "compThreshold":
          engine.updateStemCompressor(stemId, { threshold: value as number });
          break;
        case "compRatio":
          engine.updateStemCompressor(stemId, { ratio: value as number });
          break;
        case "compAttack":
          engine.updateStemCompressor(stemId, { attack: value as number });
          break;
        case "compRelease":
          engine.updateStemCompressor(stemId, { release: value as number });
          break;
        case "satDrive":
          engine.updateStemSaturation(stemId, value as number);
          break;
      }
    },
    [engine]
  );

  const toggleMute = useCallback(
    (stemId: string) => {
      const stem = useMixerStore
        .getState()
        .stems.find((s) => s.id === stemId);
      if (!stem) return;
      const next = !stem.channelParams.mute;
      useMixerStore.getState().updateStemParam(stemId, "mute", next);
      engine.setMute(stemId, next);
    },
    [engine]
  );

  const toggleSolo = useCallback(
    (stemId: string) => {
      const stem = useMixerStore
        .getState()
        .stems.find((s) => s.id === stemId);
      if (!stem) return;
      const next = !stem.channelParams.solo;
      useMixerStore.getState().updateStemParam(stemId, "solo", next);
      engine.setSolo(stemId, next);
    },
    [engine]
  );

  const autoMix = useCallback(async () => {
    const stems = useMixerStore.getState().stems;
    if (stems.length === 0) return;

    useMixerStore.getState().setIsAutoMixing(true);

    // Analyze all stems
    const analyzed: AnalyzedStem[] = stems.map((stem) => {
      const result = analyzeStem(stem.audioBuffer!, stem.name);
      result.stemId = stem.id;

      // Update classification in store
      useMixerStore
        .getState()
        .setClassification(stem.id, result.classification, result.confidence);

      return result;
    });

    // Generate auto-mix params
    const { stemParams, masterParams: _masterParams } =
      generateAutoMix(analyzed);

    // Apply to store
    useMixerStore.getState().setAutoMixResults(stemParams);

    // Apply to engine
    for (const [stemId, params] of Object.entries(stemParams)) {
      engine.applyChannelParams(stemId, params);
    }

    useMixerStore.getState().setIsAutoMixing(false);
  }, [engine]);

  const setStemOffset = useCallback(
    (stemId: string, offset: number) => {
      useMixerStore.getState().setStemOffset(stemId, offset);
      engine.setStemOffset(stemId, offset);
      updateSnapshot({ duration: engine.duration });
    },
    [engine, updateSnapshot]
  );

  return {
    isPlaying: snapshot.isPlaying,
    currentTime: snapshot.currentTime,
    duration: snapshot.duration,
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
  };
}
