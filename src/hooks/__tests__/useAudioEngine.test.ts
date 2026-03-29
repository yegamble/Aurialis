import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAudioEngine } from "../useAudioEngine";
import { useAudioStore } from "@/lib/stores/audio-store";

describe("useAudioEngine", () => {
  beforeEach(() => {
    useAudioStore.getState().reset();
  });

  afterEach(async () => {
    // Clean up engine
    vi.restoreAllMocks();
  });

  it("starts in idle state", () => {
    const { result } = renderHook(() => useAudioEngine());

    expect(result.current.isPlaying).toBe(false);
    expect(result.current.isLoaded).toBe(false);
    expect(result.current.currentTime).toBe(0);
    expect(result.current.duration).toBe(0);
  });

  it("exposes transport control functions", () => {
    const { result } = renderHook(() => useAudioEngine());

    expect(typeof result.current.play).toBe("function");
    expect(typeof result.current.pause).toBe("function");
    expect(typeof result.current.stop).toBe("function");
    expect(typeof result.current.seek).toBe("function");
    expect(typeof result.current.loadFile).toBe("function");
    expect(typeof result.current.loadBuffer).toBe("function");
  });

  it("loadBuffer updates state to loaded", async () => {
    const { result } = renderHook(() => useAudioEngine());

    const mockBuffer = {
      duration: 5,
      length: 220500,
      numberOfChannels: 2,
      sampleRate: 44100,
      getChannelData: () => new Float32Array(220500),
    } as unknown as AudioBuffer;

    await act(async () => {
      result.current.loadBuffer(mockBuffer);
    });

    expect(result.current.isLoaded).toBe(true);
    expect(result.current.duration).toBe(5);
  });

  it("loadBuffer syncs to zustand store", async () => {
    const { result } = renderHook(() => useAudioEngine());

    const mockBuffer = {
      duration: 8,
      length: 352800,
      numberOfChannels: 2,
      sampleRate: 44100,
      getChannelData: () => new Float32Array(352800),
    } as unknown as AudioBuffer;

    await act(async () => {
      result.current.loadBuffer(mockBuffer);
    });

    const storeState = useAudioStore.getState();
    expect(storeState.isLoaded).toBe(true);
    expect(storeState.duration).toBe(8);
    expect(storeState.audioBuffer).toBe(mockBuffer);
  });

  it("play updates isPlaying state", async () => {
    const { result } = renderHook(() => useAudioEngine());

    const mockBuffer = {
      duration: 10,
      length: 441000,
      numberOfChannels: 1,
      sampleRate: 44100,
      getChannelData: () => new Float32Array(441000),
    } as unknown as AudioBuffer;

    await act(async () => {
      result.current.loadBuffer(mockBuffer);
    });

    await act(async () => {
      await result.current.play();
    });

    expect(result.current.isPlaying).toBe(true);
    expect(useAudioStore.getState().isPlaying).toBe(true);
  });

  it("pause updates isPlaying state", async () => {
    const { result } = renderHook(() => useAudioEngine());

    const mockBuffer = {
      duration: 10,
      length: 441000,
      numberOfChannels: 1,
      sampleRate: 44100,
      getChannelData: () => new Float32Array(441000),
    } as unknown as AudioBuffer;

    await act(async () => {
      result.current.loadBuffer(mockBuffer);
    });

    await act(async () => {
      await result.current.play();
    });

    act(() => {
      result.current.pause();
    });

    expect(result.current.isPlaying).toBe(false);
    expect(useAudioStore.getState().isPlaying).toBe(false);
  });

  it("stop resets time and stops playback", async () => {
    const { result } = renderHook(() => useAudioEngine());

    const mockBuffer = {
      duration: 10,
      length: 441000,
      numberOfChannels: 1,
      sampleRate: 44100,
      getChannelData: () => new Float32Array(441000),
    } as unknown as AudioBuffer;

    await act(async () => {
      result.current.loadBuffer(mockBuffer);
    });

    await act(async () => {
      result.current.seek(5);
      await result.current.play();
    });

    act(() => {
      result.current.stop();
    });

    expect(result.current.isPlaying).toBe(false);
    expect(result.current.currentTime).toBe(0);
  });

  it("seek updates currentTime", async () => {
    const { result } = renderHook(() => useAudioEngine());

    const mockBuffer = {
      duration: 10,
      length: 441000,
      numberOfChannels: 1,
      sampleRate: 44100,
      getChannelData: () => new Float32Array(441000),
    } as unknown as AudioBuffer;

    await act(async () => {
      result.current.loadBuffer(mockBuffer);
    });

    act(() => {
      result.current.seek(5);
    });

    expect(result.current.currentTime).toBe(5);
  });

  it("exposes engine ref for visualization access", () => {
    const { result } = renderHook(() => useAudioEngine());
    expect(result.current.engine).toBeDefined();
  });

  it("disposes engine on unmount", async () => {
    const { result, unmount } = renderHook(() => useAudioEngine());

    const disposeSpy = vi.spyOn(result.current.engine, "dispose");

    unmount();

    expect(disposeSpy).toHaveBeenCalledOnce();
  });

  it("toggleBypass calls engine.setBypass and updates isBypassed", () => {
    const { result } = renderHook(() => useAudioEngine());

    const setBypassSpy = vi.spyOn(result.current.engine, "setBypass");

    expect(result.current.isBypassed).toBe(false);

    act(() => {
      result.current.toggleBypass();
    });

    expect(result.current.isBypassed).toBe(true);
    expect(setBypassSpy).toHaveBeenCalledWith(true);

    act(() => {
      result.current.toggleBypass();
    });

    expect(result.current.isBypassed).toBe(false);
    expect(setBypassSpy).toHaveBeenCalledWith(false);
  });
});
