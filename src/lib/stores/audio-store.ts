import { create } from "zustand";
import type { MeteringData } from "@/types/audio";
export type { MeteringData };

export interface AudioParams {
  inputGain: number;
  threshold: number;
  ratio: number;
  attack: number;
  release: number;
  makeup: number;
  eq80: number;
  eq250: number;
  eq1k: number;
  eq4k: number;
  eq12k: number;
  satDrive: number;
  stereoWidth: number;
  bassMonoFreq: number;
  midGain: number;
  sideGain: number;
  targetLufs: number;
  ceiling: number;
  limiterRelease: number;
}

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

const defaultParams: AudioParams = {
  inputGain: 0,
  threshold: -18,
  ratio: 3,
  attack: 20,
  release: 250,
  makeup: 0,
  eq80: 0,
  eq250: 0,
  eq1k: 0,
  eq4k: 0,
  eq12k: 0,
  satDrive: 0,
  stereoWidth: 100,
  bassMonoFreq: 200,
  midGain: 0,
  sideGain: 0,
  targetLufs: -14,
  ceiling: -1,
  limiterRelease: 100,
};

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
  params: { ...defaultParams },
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
      params: { ...defaultParams },
      metering: { ...defaultMetering },
    }),
}));
