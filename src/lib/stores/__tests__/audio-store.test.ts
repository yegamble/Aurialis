import { describe, it, expect, beforeEach } from "vitest";
import { useAudioStore } from "../audio-store";

describe("audio-store", () => {
  beforeEach(() => {
    useAudioStore.getState().reset();
  });

  it("has correct default state", () => {
    const state = useAudioStore.getState();
    expect(state.file).toBeNull();
    expect(state.audioBuffer).toBeNull();
    expect(state.isPlaying).toBe(false);
    expect(state.currentTime).toBe(0);
    expect(state.duration).toBe(0);
    expect(state.isLoaded).toBe(false);
    expect(state.params.threshold).toBe(-18);
    expect(state.params.ratio).toBe(2);       // matches DEFAULT_PARAMS in presets.ts
    expect(state.params.attack).toBe(30);     // matches DEFAULT_PARAMS in presets.ts
    expect(state.params.release).toBe(300);   // matches DEFAULT_PARAMS in presets.ts
    expect(state.params.targetLufs).toBe(-14);
    expect(state.params.ceiling).toBe(-1);
  });

  it("sets file", () => {
    const file = new File(["test"], "test.wav", { type: "audio/wav" });
    useAudioStore.getState().setFile(file);
    expect(useAudioStore.getState().file).toBe(file);
  });

  it("sets playback state", () => {
    useAudioStore.getState().setIsPlaying(true);
    expect(useAudioStore.getState().isPlaying).toBe(true);

    useAudioStore.getState().setCurrentTime(42.5);
    expect(useAudioStore.getState().currentTime).toBe(42.5);

    useAudioStore.getState().setDuration(120);
    expect(useAudioStore.getState().duration).toBe(120);
  });

  it("sets individual params", () => {
    useAudioStore.getState().setParam("threshold", -24);
    expect(useAudioStore.getState().params.threshold).toBe(-24);

    useAudioStore.getState().setParam("eq1k", 3.5);
    expect(useAudioStore.getState().params.eq1k).toBe(3.5);
  });

  it("sets multiple params at once", () => {
    useAudioStore.getState().setParams({ threshold: -30, ratio: 4, attack: 10 });
    const { params } = useAudioStore.getState();
    expect(params.threshold).toBe(-30);
    expect(params.ratio).toBe(4);
    expect(params.attack).toBe(10);
    // Unchanged params preserved (default release is 300 per DEFAULT_PARAMS)
    expect(params.release).toBe(300);
  });

  it("sets metering data", () => {
    useAudioStore.getState().setMetering({ leftLevel: 0.8, rightLevel: 0.75 });
    const { metering } = useAudioStore.getState();
    expect(metering.leftLevel).toBe(0.8);
    expect(metering.rightLevel).toBe(0.75);
    // Unchanged metering preserved
    expect(metering.lufs).toBe(-Infinity);
  });

  it("resets to defaults", () => {
    useAudioStore.getState().setIsPlaying(true);
    useAudioStore.getState().setParam("threshold", -30);
    useAudioStore.getState().setFile(new File(["x"], "x.wav"));

    useAudioStore.getState().reset();

    const state = useAudioStore.getState();
    expect(state.file).toBeNull();
    expect(state.isPlaying).toBe(false);
    expect(state.params.threshold).toBe(-18);
  });

  it("marks as loaded when audioBuffer is set", () => {
    const mockBuffer = {} as AudioBuffer;
    useAudioStore.getState().setAudioBuffer(mockBuffer);
    expect(useAudioStore.getState().isLoaded).toBe(true);

    useAudioStore.getState().setAudioBuffer(null);
    expect(useAudioStore.getState().isLoaded).toBe(false);
  });
});
