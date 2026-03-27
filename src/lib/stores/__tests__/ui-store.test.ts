import { describe, it, expect, beforeEach } from "vitest";
import { useUIStore } from "../ui-store";

describe("ui-store", () => {
  beforeEach(() => {
    useUIStore.setState({ mode: "simple", isMobileControlsOpen: false });
  });

  it("has correct default state", () => {
    const state = useUIStore.getState();
    expect(state.mode).toBe("simple");
    expect(state.isMobileControlsOpen).toBe(false);
  });

  it("sets mode", () => {
    useUIStore.getState().setMode("advanced");
    expect(useUIStore.getState().mode).toBe("advanced");

    useUIStore.getState().setMode("simple");
    expect(useUIStore.getState().mode).toBe("simple");
  });

  it("sets mobile controls open state", () => {
    useUIStore.getState().setMobileControlsOpen(true);
    expect(useUIStore.getState().isMobileControlsOpen).toBe(true);
  });
});
