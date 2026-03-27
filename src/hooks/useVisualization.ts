"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { AudioEngine } from "@/lib/audio/engine";
import { extractWaveformPeaks, normalizeSpectrumData } from "@/lib/audio/visualization";

const WAVEFORM_BARS = 200;
const SPECTRUM_BINS = 64;

interface VisualizationState {
  waveformPeaks: number[];
  spectrumData: number[];
  peakLevels: { left: number; right: number };
}

/**
 * Hook that provides real-time visualization data from an AudioEngine.
 * - waveformPeaks: Static overview computed once per buffer load
 * - spectrumData: Live frequency data updated at animation frame rate
 * - peakLevels: Live L/R peak levels for meters
 */
export function useVisualization(engine: AudioEngine): VisualizationState {
  const [waveformPeaks, setWaveformPeaks] = useState<number[]>([]);
  const [spectrumData, setSpectrumData] = useState<number[]>([]);
  const [peakLevels, setPeakLevels] = useState({ left: 0, right: 0 });
  const rafRef = useRef<number | null>(null);
  const prevBufferRef = useRef<AudioBuffer | null>(null);

  // Compute static waveform when buffer changes
  useEffect(() => {
    const buffer = engine.audioBuffer;
    if (buffer && buffer !== prevBufferRef.current) {
      prevBufferRef.current = buffer;
      const peaks = extractWaveformPeaks(buffer, WAVEFORM_BARS);
      setWaveformPeaks(peaks);
    } else if (!buffer) {
      prevBufferRef.current = null;
      setWaveformPeaks([]);
    }
  }, [engine, engine.audioBuffer]);

  // rAF loop for live spectrum and peak data
  useEffect(() => {
    if (!engine.analyserNode) return;

    let active = true;

    const tick = () => {
      if (!active) return;

      if (engine.isPlaying) {
        const freqData = engine.getFrequencyData();
        const normalized = normalizeSpectrumData(freqData, SPECTRUM_BINS);
        setSpectrumData(normalized);

        const levels = engine.getPeakLevels();
        setPeakLevels(levels);
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      active = false;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [engine, engine.analyserNode, engine.isPlaying]);

  return { waveformPeaks, spectrumData, peakLevels };
}
