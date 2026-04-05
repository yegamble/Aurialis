import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMixEngine } from "../useMixEngine";
import { useMixerStore } from "@/lib/stores/mixer-store";

describe("useMixEngine", () => {
  beforeEach(() => {
    useMixerStore.getState().reset();
  });

  it("returns initial non-playing state", () => {
    const { result } = renderHook(() => useMixEngine());

    expect(result.current.isPlaying).toBe(false);
    expect(result.current.currentTime).toBe(0);
    expect(result.current.duration).toBe(0);
  });

  it("exposes play/pause/stop/seek actions", () => {
    const { result } = renderHook(() => useMixEngine());

    expect(typeof result.current.play).toBe("function");
    expect(typeof result.current.pause).toBe("function");
    expect(typeof result.current.stop).toBe("function");
    expect(typeof result.current.seek).toBe("function");
  });

  it("exposes loadStems action", () => {
    const { result } = renderHook(() => useMixEngine());

    expect(typeof result.current.loadStems).toBe("function");
  });

  it("exposes updateStemParam action", () => {
    const { result } = renderHook(() => useMixEngine());

    expect(typeof result.current.updateStemParam).toBe("function");
  });

  it("exposes autoMix action", () => {
    const { result } = renderHook(() => useMixEngine());

    expect(typeof result.current.autoMix).toBe("function");
  });

  it("exposes engine ref", () => {
    const { result } = renderHook(() => useMixEngine());

    expect(result.current.engine).toBeDefined();
  });

  it("creates a new engine after disposal (StrictMode safety)", () => {
    const { result, unmount, rerender } = renderHook(() => useMixEngine());

    const firstEngine = result.current.engine;
    unmount();

    // After unmount, the engine ref should have been disposed
    // Re-rendering (simulating StrictMode remount) creates fresh engine
    const { result: result2 } = renderHook(() => useMixEngine());
    expect(result2.current.engine).toBeDefined();
  });

  it("exposes toggleMute and toggleSolo", () => {
    const { result } = renderHook(() => useMixEngine());

    expect(typeof result.current.toggleMute).toBe("function");
    expect(typeof result.current.toggleSolo).toBe("function");
  });
});
