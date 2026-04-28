import { describe, it, expect } from "vitest";
import {
  analyzeAudio,
  analyzeAudioSync,
  type AnalysisResult,
} from "../analysis";

/** Creates a minimal AudioBuffer-like mock */
function makeBuffer(
  left: Float32Array,
  right: Float32Array = left,
  sampleRate = 44100
): AudioBuffer {
  return {
    numberOfChannels: 2,
    length: left.length,
    sampleRate,
    duration: left.length / sampleRate,
    getChannelData: (ch: number) => (ch === 0 ? left : right),
    copyFromChannel: () => {},
    copyToChannel: () => {},
  } as unknown as AudioBuffer;
}

describe("analyzeAudio", () => {
  it("returns -Infinity LUFS for silence", () => {
    const silence = new Float32Array(44100); // 1s silence
    const buf = makeBuffer(silence);
    const result = analyzeAudioSync(buf);
    expect(result.integratedLufs).toBe(-Infinity);
  });

  it("measures approximately -23 LUFS for a -23 dBFS sine", () => {
    const sampleRate = 44100;
    const amplitude = Math.pow(10, -23 / 20);
    const samples = sampleRate * 3; // 3 seconds for gated integration
    const left = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      left[i] = amplitude * Math.sin((2 * Math.PI * 1000 * i) / sampleRate);
    }
    const buf = makeBuffer(left, left, sampleRate);
    const result = analyzeAudioSync(buf);
    expect(result.integratedLufs).toBeGreaterThan(-24);
    expect(result.integratedLufs).toBeLessThan(-22);
  });

  it("returns correct peak level", () => {
    const signal = new Float32Array([0, 0.5, -0.8, 0.3, 0]);
    const buf = makeBuffer(signal);
    const result = analyzeAudioSync(buf);
    expect(result.peakDb).toBeCloseTo(20 * Math.log10(0.8), 1);
  });

  it("computes positive dynamic range for music-like signal", () => {
    const sampleRate = 44100;
    const samples = sampleRate;
    const left = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      left[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
    }
    const buf = makeBuffer(left, left, sampleRate);
    const result = analyzeAudioSync(buf);
    expect(result.dynamicRange).toBeGreaterThanOrEqual(0);
  });

  it("detects bass-heavy signal via spectral balance", () => {
    const sampleRate = 44100;
    const samples = sampleRate;
    // Pure 80Hz tone — bass-heavy
    const left = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      left[i] = 0.8 * Math.sin((2 * Math.PI * 80 * i) / sampleRate);
    }
    const buf = makeBuffer(left, left, sampleRate);
    const result = analyzeAudioSync(buf);
    expect(result.bassRatio).toBeGreaterThan(result.midRatio);
  });

  it("detects bright signal via spectral balance", () => {
    const sampleRate = 44100;
    const samples = sampleRate;
    // Pure 8kHz tone — treble-heavy
    const left = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      left[i] = 0.8 * Math.sin((2 * Math.PI * 8000 * i) / sampleRate);
    }
    const buf = makeBuffer(left, left, sampleRate);
    const result = analyzeAudioSync(buf);
    expect(result.highRatio).toBeGreaterThan(result.bassRatio);
  });
});

describe("analyzeAudio (async)", () => {
  it("produces the same numbers as analyzeAudioSync within float tolerance", async () => {
    const sampleRate = 44100;
    const samples = sampleRate * 2;
    const left = new Float32Array(samples);
    const right = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      left[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
      right[i] = 0.5 * Math.sin((2 * Math.PI * 880 * i) / sampleRate);
    }
    const buf = makeBuffer(left, right, sampleRate);
    const sync = analyzeAudioSync(buf);
    const async_ = await analyzeAudio(buf);
    expect(async_.integratedLufs).toBeCloseTo(sync.integratedLufs, 6);
    expect(async_.peakDb).toBeCloseTo(sync.peakDb, 6);
    expect(async_.dynamicRange).toBeCloseTo(sync.dynamicRange, 6);
    expect(async_.bassRatio).toBeCloseTo(sync.bassRatio, 6);
    expect(async_.midRatio).toBeCloseTo(sync.midRatio, 6);
    expect(async_.highRatio).toBeCloseTo(sync.highRatio, 6);
  });

  it("emits stage events in the expected order when runId provided", async () => {
    const { useAnalysisStageStore } = await import(
      "@/lib/stores/analysis-stage-store"
    );
    useAnalysisStageStore.getState().reset();

    const sampleRate = 44100;
    const samples = sampleRate; // 1s
    const left = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      left[i] = 0.3 * Math.sin((2 * Math.PI * 1000 * i) / sampleRate);
    }
    const buf = makeBuffer(left, left, sampleRate);
    await analyzeAudio(buf, { runId: "test-run-1" });

    const run = useAnalysisStageStore.getState().runs["test-run-1"];
    expect(run).toBeDefined();
    const phaseStarts = run!.stages
      .filter((e) => e.phase === "start")
      .map((e) => e.stage);
    expect(phaseStarts).toEqual([
      "loudness",
      "peak",
      "dynamic-range",
      "spectral-balance",
    ]);
    const finalEnd = run!.stages.find(
      (e) => e.stage === "done" && e.phase === "end"
    );
    expect(finalEnd).toBeDefined();
  });

  it("does NOT emit stage events when runId omitted", async () => {
    const { useAnalysisStageStore } = await import(
      "@/lib/stores/analysis-stage-store"
    );
    useAnalysisStageStore.getState().reset();

    const left = new Float32Array(44100);
    const buf = makeBuffer(left);
    await analyzeAudio(buf);
    expect(useAnalysisStageStore.getState().runs).toEqual({});
  });
});
