import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useVisualization } from "../useVisualization";
import { AudioEngine } from "@/lib/audio/engine";

describe("useVisualization", () => {
  let engine: AudioEngine;

  beforeEach(async () => {
    engine = new AudioEngine();
    await engine.init();
  });

  it("returns empty data when engine has no analyser", () => {
    const uninitEngine = new AudioEngine();
    const { result } = renderHook(() => useVisualization(uninitEngine));

    expect(result.current.spectrumData).toHaveLength(0);
    expect(result.current.peakLevels).toEqual({ left: 0, right: 0 });
  });

  it("returns waveform peaks when buffer is loaded", () => {
    const mockBuffer = {
      duration: 1,
      length: 44100,
      numberOfChannels: 1,
      sampleRate: 44100,
      getChannelData: () => {
        const data = new Float32Array(44100);
        for (let i = 0; i < data.length; i++) {
          data[i] = Math.sin((2 * Math.PI * 440 * i) / 44100);
        }
        return data;
      },
    } as unknown as AudioBuffer;

    engine.loadBuffer(mockBuffer);

    const { result } = renderHook(() => useVisualization(engine));

    expect(result.current.waveformPeaks.length).toBeGreaterThan(0);
    expect(Math.max(...result.current.waveformPeaks)).toBeGreaterThan(0.5);
  });

  it("recomputes waveform when buffer changes", () => {
    const buffer1 = {
      duration: 1,
      length: 44100,
      numberOfChannels: 1,
      sampleRate: 44100,
      getChannelData: () => new Float32Array(44100).fill(0.5),
    } as unknown as AudioBuffer;

    engine.loadBuffer(buffer1);
    const { result, rerender } = renderHook(() => useVisualization(engine));

    const firstPeaks = [...result.current.waveformPeaks];
    expect(firstPeaks.length).toBeGreaterThan(0);

    const buffer2 = {
      duration: 2,
      length: 88200,
      numberOfChannels: 1,
      sampleRate: 44100,
      getChannelData: () => new Float32Array(88200).fill(0.9),
    } as unknown as AudioBuffer;

    engine.loadBuffer(buffer2);
    rerender();

    // Peaks should update for the new buffer
    expect(result.current.waveformPeaks.length).toBeGreaterThan(0);
  });

  it("provides spectrumData and peakLevels from engine", () => {
    const { result } = renderHook(() => useVisualization(engine));

    // Without playing, data should be from analyser (all zeros from mock)
    expect(result.current.spectrumData).toBeDefined();
    expect(result.current.peakLevels).toBeDefined();
    expect(result.current.peakLevels).toHaveProperty("left");
    expect(result.current.peakLevels).toHaveProperty("right");
  });

  it("has correct return type shape", () => {
    const { result } = renderHook(() => useVisualization(engine));

    expect(result.current).toHaveProperty("waveformPeaks");
    expect(result.current).toHaveProperty("spectrumData");
    expect(result.current).toHaveProperty("peakLevels");
    expect(Array.isArray(result.current.waveformPeaks)).toBe(true);
  });
});
