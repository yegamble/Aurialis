import { create } from "zustand";

export type MasteringMode = "simple" | "advanced";

export interface UIState {
  mode: MasteringMode;
  isMobileControlsOpen: boolean;
  setMode: (mode: MasteringMode) => void;
  setMobileControlsOpen: (open: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  mode: "simple",
  isMobileControlsOpen: false,
  setMode: (mode) => set({ mode }),
  setMobileControlsOpen: (isMobileControlsOpen) =>
    set({ isMobileControlsOpen }),
}));
