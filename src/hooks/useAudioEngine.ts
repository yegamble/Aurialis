"use client";

import { useRef, useEffect, useCallback, useSyncExternalStore } from "react";
import { AudioEngine } from "@/lib/audio/engine";
import { useAudioStore } from "@/lib/stores/audio-store";

interface AudioEngineSnapshot {
  isPlaying: boolean;
  isLoaded: boolean;
  currentTime: number;
  duration: number;
}

const defaultSnapshot: AudioEngineSnapshot = {
  isPlaying: false,
  isLoaded: false,
  currentTime: 0,
  duration: 0,
};

/**
 * React hook wrapping AudioEngine with reactive state and Zustand sync.
 * Creates a single engine instance per component lifecycle.
 */
export function useAudioEngine() {
  const engineRef = useRef<AudioEngine | null>(null);
  const snapshotRef = useRef<AudioEngineSnapshot>({ ...defaultSnapshot });
  const listenersRef = useRef(new Set<() => void>());

  // Lazily create engine
  if (!engineRef.current) {
    engineRef.current = new AudioEngine();
  }

  const engine = engineRef.current;

  // Subscribe/getSnapshot pattern for useSyncExternalStore
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
    (partial: Partial<AudioEngineSnapshot>) => {
      const prev = snapshotRef.current;
      const next = { ...prev, ...partial };
      // Only update if something actually changed
      if (
        next.isPlaying !== prev.isPlaying ||
        next.isLoaded !== prev.isLoaded ||
        next.currentTime !== prev.currentTime ||
        next.duration !== prev.duration
      ) {
        snapshotRef.current = next;
        notifyListeners();
      }
    },
    [notifyListeners]
  );

  // Sync engine events to snapshot and Zustand
  useEffect(() => {
    const store = useAudioStore.getState();

    const onStateChange = (data: unknown) => {
      const { isPlaying } = data as { isPlaying: boolean };
      updateSnapshot({ isPlaying });
      useAudioStore.getState().setIsPlaying(isPlaying);
    };

    const onTimeUpdate = (data: unknown) => {
      const time = data as number;
      updateSnapshot({ currentTime: time });
      useAudioStore.getState().setCurrentTime(time);
    };

    const onLoaded = (data: unknown) => {
      const { duration } = data as { duration: number; sampleRate: number; channels: number };
      updateSnapshot({ isLoaded: true, duration, currentTime: 0 });
      useAudioStore.getState().setDuration(duration);
      useAudioStore.getState().setIsLoaded(true);
    };

    const onEnded = () => {
      updateSnapshot({ isPlaying: false, currentTime: 0 });
      useAudioStore.getState().setIsPlaying(false);
      useAudioStore.getState().setCurrentTime(0);
    };

    engine.on("statechange", onStateChange);
    engine.on("timeupdate", onTimeUpdate);
    engine.on("loaded", onLoaded);
    engine.on("ended", onEnded);

    return () => {
      engine.off("statechange", onStateChange);
      engine.off("timeupdate", onTimeUpdate);
      engine.off("loaded", onLoaded);
      engine.off("ended", onEnded);
    };
  }, [engine, updateSnapshot]);

  // Dispose on unmount
  useEffect(() => {
    return () => {
      engine.dispose();
    };
  }, [engine]);

  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => defaultSnapshot);

  // Stable action callbacks
  const play = useCallback(async () => {
    await engine.init();
    await engine.play();
  }, [engine]);

  const pause = useCallback(() => {
    engine.pause();
  }, [engine]);

  const stop = useCallback(() => {
    engine.stop();
  }, [engine]);

  const seek = useCallback(
    (time: number) => {
      engine.seek(time);
      updateSnapshot({ currentTime: engine.getCurrentTime() });
    },
    [engine, updateSnapshot]
  );

  const loadFile = useCallback(
    async (file: File) => {
      await engine.init();
      await engine.loadFile(file);
      useAudioStore.getState().setAudioBuffer(engine.audioBuffer);
    },
    [engine]
  );

  const loadBuffer = useCallback(
    (buffer: AudioBuffer) => {
      engine.init().then(() => {
        engine.loadBuffer(buffer);
        useAudioStore.getState().setAudioBuffer(buffer);
      });
    },
    [engine]
  );

  return {
    // State
    isPlaying: snapshot.isPlaying,
    isLoaded: snapshot.isLoaded,
    currentTime: snapshot.currentTime,
    duration: snapshot.duration,

    // Actions
    play,
    pause,
    stop,
    seek,
    loadFile,
    loadBuffer,

    // Engine ref for visualization hooks
    engine,
  };
}
