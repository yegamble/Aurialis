import { describe, it, expect, beforeEach } from "vitest";
import { useSettingsStore } from "../settings-store";

const STORAGE_KEY = "aurialis-settings-v1";

describe("settings-store", () => {
  beforeEach(() => {
    // Reset persisted state between tests.
    localStorage.removeItem(STORAGE_KEY);
    useSettingsStore.setState({ proMode: false });
  });

  it("defaults proMode to false", () => {
    expect(useSettingsStore.getState().proMode).toBe(false);
  });

  it("setProMode updates state", () => {
    useSettingsStore.getState().setProMode(true);
    expect(useSettingsStore.getState().proMode).toBe(true);
    useSettingsStore.getState().setProMode(false);
    expect(useSettingsStore.getState().proMode).toBe(false);
  });

  it("persists proMode to localStorage under the versioned key", () => {
    useSettingsStore.getState().setProMode(true);
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    // zustand persist wraps state under `state` key
    expect(parsed.state.proMode).toBe(true);
  });

  it("toggleProMode flips the value", () => {
    expect(useSettingsStore.getState().proMode).toBe(false);
    useSettingsStore.getState().toggleProMode();
    expect(useSettingsStore.getState().proMode).toBe(true);
    useSettingsStore.getState().toggleProMode();
    expect(useSettingsStore.getState().proMode).toBe(false);
  });
});
