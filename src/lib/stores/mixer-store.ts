import { create } from "zustand";
import { MAX_STEMS } from "@/types/mixer";
import type { StemTrack, StemChannelParams } from "@/types/mixer";

function computeDuration(stems: StemTrack[]): number {
  if (stems.length === 0) return 0;
  return Math.max(...stems.map((s) => s.duration + s.offset));
}

export interface MixerState {
  stems: StemTrack[];
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  masterVolume: number;
  isAutoMixing: boolean;
  selectedStemId: string | null;
  originalMixBuffer: AudioBuffer | null;

  addStems: (newStems: StemTrack[]) => void;
  removeStem: (id: string) => void;
  updateStemParam: <K extends keyof StemChannelParams>(
    stemId: string,
    key: K,
    value: StemChannelParams[K]
  ) => void;
  setClassification: (
    stemId: string,
    classification: StemTrack["classification"],
    confidence: number
  ) => void;
  setStemOffset: (stemId: string, offset: number) => void;
  setAutoMixResults: (results: Record<string, StemChannelParams>) => void;
  setIsPlaying: (playing: boolean) => void;
  setCurrentTime: (time: number) => void;
  setMasterVolume: (volume: number) => void;
  setIsAutoMixing: (mixing: boolean) => void;
  setSelectedStemId: (id: string | null) => void;
  reset: () => void;
}

export const useMixerStore = create<MixerState>((set) => ({
  stems: [],
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  masterVolume: 0,
  isAutoMixing: false,
  selectedStemId: null,
  originalMixBuffer: null,

  addStems: (newStems) =>
    set((state) => {
      const combined = [...state.stems, ...newStems].slice(0, MAX_STEMS);
      return { stems: combined, duration: computeDuration(combined) };
    }),

  removeStem: (id) =>
    set((state) => {
      const stems = state.stems.filter((s) => s.id !== id);
      return {
        stems,
        duration: computeDuration(stems),
        selectedStemId: state.selectedStemId === id ? null : state.selectedStemId,
      };
    }),

  updateStemParam: (stemId, key, value) =>
    set((state) => ({
      stems: state.stems.map((s) =>
        s.id === stemId
          ? { ...s, channelParams: { ...s.channelParams, [key]: value } }
          : s
      ),
    })),

  setClassification: (stemId, classification, confidence) =>
    set((state) => ({
      stems: state.stems.map((s) =>
        s.id === stemId ? { ...s, classification, confidence } : s
      ),
    })),

  setStemOffset: (stemId, offset) =>
    set((state) => {
      const clampedOffset = Math.max(0, offset);
      const stems = state.stems.map((s) =>
        s.id === stemId ? { ...s, offset: clampedOffset } : s
      );
      return { stems, duration: computeDuration(stems) };
    }),

  setAutoMixResults: (results) =>
    set((state) => ({
      stems: state.stems.map((s) =>
        results[s.id] ? { ...s, channelParams: results[s.id] } : s
      ),
    })),

  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setCurrentTime: (currentTime) => set({ currentTime }),
  setMasterVolume: (masterVolume) => set({ masterVolume }),
  setIsAutoMixing: (isAutoMixing) => set({ isAutoMixing }),
  setSelectedStemId: (selectedStemId) => set({ selectedStemId }),

  reset: () =>
    set({
      stems: [],
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      masterVolume: 0,
      isAutoMixing: false,
      selectedStemId: null,
      originalMixBuffer: null,
    }),
}));
