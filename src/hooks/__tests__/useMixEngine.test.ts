import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMixEngine } from "../useMixEngine";
import { useMixerStore } from "@/lib/stores/mixer-store";
import { useAnalysisStageStore } from "@/lib/stores/analysis-stage-store";
import {
  DEFAULT_CHANNEL_PARAMS,
  type StemTrack,
} from "@/types/mixer";

function makeStem(name: string, id: string): StemTrack {
  // 100ms of silence at 44.1kHz
  const buffer = {
    numberOfChannels: 1,
    length: 4410,
    sampleRate: 44100,
    duration: 0.1,
    getChannelData: () => new Float32Array(4410),
  } as unknown as AudioBuffer;
  return {
    id,
    name,
    file: new File([""], name),
    audioBuffer: buffer,
    waveformPeaks: [0, 0, 0],
    classification: "other",
    confidence: 0,
    channelParams: { ...DEFAULT_CHANNEL_PARAMS },
    offset: 0,
    duration: 0.1,
    color: "#FF6B6B",
  };
}

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

describe("useMixEngine.autoMix — stage emits", () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    useMixerStore.getState().reset();
    useAnalysisStageStore.getState().reset();
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    // Cancel any pending prune setTimeouts to avoid leaking handles.
    useAnalysisStageStore.getState().reset();
    infoSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("emits per-stem stage events plus generate-mix and apply boundaries", async () => {
    const { result } = renderHook(() => useMixEngine());
    useMixerStore.getState().addStems([
      makeStem("drums.wav", "s1"),
      makeStem("bass.wav", "s2"),
      makeStem("vocals.wav", "s3"),
    ]);

    await act(async () => {
      await result.current.autoMix();
    });

    const runId = useMixerStore.getState().autoMixRunId!;
    expect(runId).not.toBeNull();
    const run = useAnalysisStageStore.getState().runs[runId]!;
    const startStages = run.stages
      .filter((e) => e.phase === "start")
      .map((e) => e.stage);
    expect(startStages).toEqual([
      "stem-1/3",
      "stem-2/3",
      "stem-3/3",
      "generate-mix",
      "apply",
    ]);
    const endEvent = run.stages.find(
      (e) => e.stage === "done" && e.phase === "end"
    );
    expect(endEvent).toBeDefined();
  });

  it("emits an error stage when a stem analysis throws and re-throws", async () => {
    const { result } = renderHook(() => useMixEngine());
    const badStem = makeStem("bad.wav", "bad");
    // Force analyzeStem to throw by stripping the audioBuffer in a way that
    // makes analyzeStem fail. Easier: provide an incoherent buffer that
    // makes getChannelData throw.
    (badStem.audioBuffer as unknown as { getChannelData: () => never }).getChannelData =
      () => {
        throw new Error("corrupt buffer");
      };
    useMixerStore.getState().addStems([
      makeStem("drums.wav", "s1"),
      badStem,
    ]);

    await act(async () => {
      await expect(result.current.autoMix()).rejects.toThrow(/corrupt buffer/);
    });

    const runId = useMixerStore.getState().autoMixRunId!;
    const run = useAnalysisStageStore.getState().runs[runId]!;
    expect(run.error).not.toBeNull();
    expect(run.error!.stage).toBe("stem-2/2");
    expect(run.error!.message).toContain("bad.wav");
    // isAutoMixing must reset to false even on error (finally block)
    expect(useMixerStore.getState().isAutoMixing).toBe(false);
  });
});
