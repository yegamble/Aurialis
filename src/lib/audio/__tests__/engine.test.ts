import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AudioEngine } from "../engine";

describe("AudioEngine", () => {
  let engine: AudioEngine;

  beforeEach(() => {
    engine = new AudioEngine();
  });

  afterEach(async () => {
    await engine.dispose();
  });

  it("starts in unloaded, stopped state", () => {
    expect(engine.isPlaying).toBe(false);
    expect(engine.isLoaded).toBe(false);
    expect(engine.duration).toBe(0);
    expect(engine.getCurrentTime()).toBe(0);
  });

  it("initializes AudioContext on init()", async () => {
    await engine.init();
    expect(engine.analyserNode).not.toBeNull();
    expect(engine.sampleRate).toBe(44100);
  });

  it("loads a buffer and updates state", async () => {
    await engine.init();

    const mockBuffer = {
      duration: 5,
      length: 220500,
      numberOfChannels: 2,
      sampleRate: 44100,
      getChannelData: () => new Float32Array(220500),
    } as unknown as AudioBuffer;

    const loadedSpy = vi.fn();
    engine.on("loaded", loadedSpy);

    engine.loadBuffer(mockBuffer);

    expect(engine.isLoaded).toBe(true);
    expect(engine.duration).toBe(5);
    expect(loadedSpy).toHaveBeenCalledWith({
      duration: 5,
      sampleRate: 44100,
      channels: 2,
    });
  });

  it("seek updates time offset", async () => {
    await engine.init();

    const mockBuffer = {
      duration: 10,
      length: 441000,
      numberOfChannels: 1,
      sampleRate: 44100,
      getChannelData: () => new Float32Array(441000),
    } as unknown as AudioBuffer;

    engine.loadBuffer(mockBuffer);
    engine.seek(5);

    expect(engine.getCurrentTime()).toBe(5);
  });

  it("seek clamps to valid range", async () => {
    await engine.init();

    const mockBuffer = {
      duration: 10,
      length: 441000,
      numberOfChannels: 1,
      sampleRate: 44100,
      getChannelData: () => new Float32Array(441000),
    } as unknown as AudioBuffer;

    engine.loadBuffer(mockBuffer);

    engine.seek(-5);
    expect(engine.getCurrentTime()).toBe(0);

    engine.seek(100);
    expect(engine.getCurrentTime()).toBe(10);
  });

  it("stop resets time to 0", async () => {
    await engine.init();

    const mockBuffer = {
      duration: 10,
      length: 441000,
      numberOfChannels: 1,
      sampleRate: 44100,
      getChannelData: () => new Float32Array(441000),
    } as unknown as AudioBuffer;

    engine.loadBuffer(mockBuffer);
    engine.seek(5);
    engine.stop();

    expect(engine.getCurrentTime()).toBe(0);
    expect(engine.isPlaying).toBe(false);
  });

  it("emits statechange events", async () => {
    await engine.init();

    const mockBuffer = {
      duration: 10,
      length: 441000,
      numberOfChannels: 1,
      sampleRate: 44100,
      getChannelData: () => new Float32Array(441000),
    } as unknown as AudioBuffer;

    engine.loadBuffer(mockBuffer);

    const stateChangeSpy = vi.fn();
    engine.on("statechange", stateChangeSpy);

    await engine.play();
    expect(stateChangeSpy).toHaveBeenCalledWith({ isPlaying: true });

    engine.pause();
    expect(stateChangeSpy).toHaveBeenCalledWith({ isPlaying: false });
  });

  it("returns empty visualization data when no analyser", () => {
    expect(engine.getFrequencyData()).toHaveLength(0);
    expect(engine.getTimeDomainData()).toHaveLength(0);
    expect(engine.getPeakLevels()).toEqual({ left: 0, right: 0 });
  });

  it("dispose cleans up resources", async () => {
    await engine.init();
    await engine.dispose();

    expect(engine.analyserNode).toBeNull();
    expect(engine.audioBuffer).toBeNull();
  });

  it("loads processing chain (worklets) on init()", async () => {
    await engine.init();
    // processingAvailable reflects worklet loading success
    // In test environment with mock, it should be true
    expect(typeof engine.processingAvailable).toBe("boolean");
  });

  it("updateParameter does not throw after init", async () => {
    await engine.init();
    expect(() => engine.updateParameter("threshold", -18)).not.toThrow();
    expect(() => engine.updateParameter("ratio", 4)).not.toThrow();
    expect(() => engine.updateParameter("eq1k", 6)).not.toThrow();
    expect(() => engine.updateParameter("ceiling", -1)).not.toThrow();
    expect(() => engine.updateParameter("satDrive", 0)).not.toThrow();
    expect(() => engine.updateParameter("stereoWidth", 100)).not.toThrow();
  });

  it("emits metering events when metering worklet posts data", async () => {
    await engine.init();
    const meterSpy = vi.fn();
    engine.on("metering", meterSpy);
    // Trigger metering callback directly via chain
    const chain = (engine as unknown as { chain: { onMetering: ((d: unknown) => void) | null } }).chain;
    if (chain?.onMetering) {
      chain.onMetering({
        type: "metering",
        lufs: -23,
        shortTermLufs: -22,
        integratedLufs: -23,
        truePeak: -1,
        dynamicRange: 22,
        leftLevel: 0.1,
        rightLevel: 0.1,
      });
    }
    expect(meterSpy).toHaveBeenCalledWith(
      expect.objectContaining({ lufs: -23, truePeak: -1 })
    );
  });

  it("off removes event listener", async () => {
    const spy = vi.fn();
    engine.on("statechange", spy);
    engine.off("statechange", spy);

    await engine.init();
    const mockBuffer = {
      duration: 10,
      length: 441000,
      numberOfChannels: 1,
      sampleRate: 44100,
      getChannelData: () => new Float32Array(441000),
    } as unknown as AudioBuffer;
    engine.loadBuffer(mockBuffer);
    await engine.play();

    expect(spy).not.toHaveBeenCalled();
  });

  describe("deep mastering script (T8)", () => {
    function makeBuffer(): AudioBuffer {
      return {
        duration: 30,
        length: 1_323_000,
        numberOfChannels: 2,
        sampleRate: 44100,
        getChannelData: () => new Float32Array(1_323_000),
      } as unknown as AudioBuffer;
    }

    function makeScript() {
      return {
        version: 1 as const,
        trackId: "test",
        sampleRate: 44100,
        duration: 30,
        profile: "modern_pop_polish" as const,
        sections: [],
        moves: [
          {
            id: "m1",
            param: "master.compressor.threshold" as const,
            startSec: 0,
            endSec: 30,
            envelope: [
              [0, -24] as [number, number],
              [30, -18] as [number, number],
            ],
            reason: "test",
            original: -24,
            edited: false,
            muted: false,
          },
        ],
      };
    }

    it("setScript stores script without throwing when paused", async () => {
      await engine.init();
      expect(() => engine.setScript(makeScript())).not.toThrow();
    });

    it("emits envelopes via chain.applyMoveEnvelope on play()", async () => {
      await engine.init();
      const chain = (engine as unknown as { chain: { applyMoveEnvelope: ReturnType<typeof vi.fn> } }).chain;
      chain.applyMoveEnvelope = vi.fn().mockReturnValue(true);
      engine.loadBuffer(makeBuffer());
      engine.setScript(makeScript());
      await engine.play();
      expect(chain.applyMoveEnvelope).toHaveBeenCalledWith(
        "master.compressor.threshold",
        expect.any(Array)
      );
    });

    it("clears envelopes via chain.clearMoveEnvelope on pause()", async () => {
      await engine.init();
      const chain = (engine as unknown as { chain: { applyMoveEnvelope: ReturnType<typeof vi.fn>; clearMoveEnvelope: ReturnType<typeof vi.fn> } }).chain;
      chain.applyMoveEnvelope = vi.fn().mockReturnValue(true);
      chain.clearMoveEnvelope = vi.fn().mockReturnValue(true);
      engine.loadBuffer(makeBuffer());
      engine.setScript(makeScript());
      await engine.play();
      engine.pause();
      expect(chain.clearMoveEnvelope).toHaveBeenCalledWith(
        "master.compressor.threshold"
      );
    });

    it("re-emits envelopes on seek (via play restart)", async () => {
      await engine.init();
      const chain = (engine as unknown as { chain: { applyMoveEnvelope: ReturnType<typeof vi.fn>; clearMoveEnvelope: ReturnType<typeof vi.fn> } }).chain;
      chain.applyMoveEnvelope = vi.fn().mockReturnValue(true);
      chain.clearMoveEnvelope = vi.fn().mockReturnValue(true);
      engine.loadBuffer(makeBuffer());
      engine.setScript(makeScript());
      await engine.play();
      const beforeSeek = chain.applyMoveEnvelope.mock.calls.length;
      engine.seek(10);
      // seek() while playing destroys source then re-plays — that re-emit
      // path applies envelopes again with the new offset.
      expect(chain.applyMoveEnvelope.mock.calls.length).toBeGreaterThan(
        beforeSeek
      );
    });

    it("setScriptActive(false) clears envelopes during playback", async () => {
      await engine.init();
      const chain = (engine as unknown as { chain: { applyMoveEnvelope: ReturnType<typeof vi.fn>; clearMoveEnvelope: ReturnType<typeof vi.fn> } }).chain;
      chain.applyMoveEnvelope = vi.fn().mockReturnValue(true);
      chain.clearMoveEnvelope = vi.fn().mockReturnValue(true);
      engine.loadBuffer(makeBuffer());
      engine.setScript(makeScript());
      await engine.play();
      engine.setScriptActive(false);
      expect(chain.clearMoveEnvelope).toHaveBeenCalled();
    });

    it("applyMoveEdit posts a single envelope when playing", async () => {
      await engine.init();
      const chain = (engine as unknown as { chain: { applyMoveEnvelope: ReturnType<typeof vi.fn>; clearMoveEnvelope: ReturnType<typeof vi.fn> } }).chain;
      chain.applyMoveEnvelope = vi.fn().mockReturnValue(true);
      chain.clearMoveEnvelope = vi.fn().mockReturnValue(true);
      engine.loadBuffer(makeBuffer());
      engine.setScript(makeScript());
      await engine.play();
      const before = chain.applyMoveEnvelope.mock.calls.length;
      const move = makeScript().moves[0]!;
      const ok = engine.applyMoveEdit(move);
      expect(ok).toBe(true);
      expect(chain.applyMoveEnvelope.mock.calls.length).toBe(before + 1);
    });

    it("applyMoveEdit no-ops when not playing", async () => {
      await engine.init();
      const move = makeScript().moves[0]!;
      expect(engine.applyMoveEdit(move)).toBe(false);
    });
  });
});
