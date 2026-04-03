import { create } from "zustand";
import type { MeteringData } from "@/types/audio";
import type { AudioParams } from "@/types/mastering";
import { DEFAULT_PARAMS } from "@/lib/audio/presets";
export type { MeteringData, AudioParams };

export interface AudioState {
  // File
  file: File | null;
  audioBuffer: AudioBuffer | null;

  // Playback
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  isLoaded: boolean;

  // Parameters
  params: AudioParams;

  // Metering
  metering: MeteringData;

  // Actions
  setFile: (file: File | null) => void;
  setAudioBuffer: (buffer: AudioBuffer | null) => void;
  setIsPlaying: (playing: boolean) => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setIsLoaded: (loaded: boolean) => void;
  setParam: (key: keyof AudioParams, value: number) => void;
  setParams: (params: Partial<AudioParams>) => void;
  setMetering: (data: Partial<MeteringData>) => void;
  reset: () => void;
}

const defaultMetering: MeteringData = {
  leftLevel: 0,
  rightLevel: 0,
  lufs: -Infinity,
  shortTermLufs: -Infinity,
  integratedLufs: -Infinity,
  truePeak: -Infinity,
  dynamicRange: 0,
};

export const useAudioStore = create<AudioState>((set) => ({
  file: null,
  audioBuffer: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  isLoaded: false,
  params: { ...DEFAULT_PARAMS },
  metering: { ...defaultMetering },

  setFile: (file) => set({ file }),
  setAudioBuffer: (audioBuffer) =>
    set({ audioBuffer, isLoaded: audioBuffer !== null }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setCurrentTime: (currentTime) => set({ currentTime }),
  setDuration: (duration) => set({ duration }),
  setIsLoaded: (isLoaded) => set({ isLoaded }),
  setParam: (key, value) =>
    set((state) => ({ params: { ...state.params, [key]: value } })),
  setParams: (params) =>
    set((state) => ({ params: { ...state.params, ...params } })),
  setMetering: (data) =>
    set((state) => ({ metering: { ...state.metering, ...data } })),
  reset: () =>
    set({
      file: null,
      audioBuffer: null,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      isLoaded: false,
      params: { ...DEFAULT_PARAMS },
      metering: { ...defaultMetering },
    }),
}));
