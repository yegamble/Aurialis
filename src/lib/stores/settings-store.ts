import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export interface SettingsState {
  /** Pro Mode shows the stereo Goniometer + denser spectrum on /master. */
  proMode: boolean;
  setProMode: (value: boolean) => void;
  toggleProMode: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      proMode: false,
      setProMode: (value) => set({ proMode: value }),
      toggleProMode: () => set({ proMode: !get().proMode }),
    }),
    {
      name: "aurialis-settings-v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ proMode: state.proMode }),
    },
  ),
);

// Expose for E2E tests to flip Pro Mode directly without traversing the UI.
if (typeof window !== "undefined") {
  (window as unknown as { __aurialisSettingsStore?: typeof useSettingsStore }).__aurialisSettingsStore =
    useSettingsStore;
}
