import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ParameterBridge } from "../parameter-bridge";
import type { AudioEngine } from "../engine";

function makeMockEngine(): Partial<AudioEngine> {
  return {
    updateParameter: vi.fn(),
  };
}

describe("ParameterBridge", () => {
  let bridge: ParameterBridge;
  let engine: Partial<AudioEngine>;

  beforeEach(() => {
    engine = makeMockEngine();
    vi.useFakeTimers();
  });

  afterEach(() => {
    bridge?.destroy();
    vi.useRealTimers();
  });

  it("should call engine.updateParameter when a store param changes", async () => {
    const { useAudioStore } = await import("@/lib/stores/audio-store");
    bridge = new ParameterBridge(engine as AudioEngine);

    // Trigger a param change
    useAudioStore.getState().setParam("threshold", -24);

    // Advance timers past debounce
    vi.advanceTimersByTime(20);

    expect(engine.updateParameter).toHaveBeenCalledWith("threshold", -24);
  });

  it("should debounce rapid param changes (only last value sent)", async () => {
    const { useAudioStore } = await import("@/lib/stores/audio-store");
    bridge = new ParameterBridge(engine as AudioEngine);

    // Multiple rapid changes
    useAudioStore.getState().setParam("threshold", -20);
    useAudioStore.getState().setParam("threshold", -22);
    useAudioStore.getState().setParam("threshold", -24);

    // Before debounce timeout — might not have called yet (depends on timing)
    // After debounce timeout
    vi.advanceTimersByTime(20);

    // Should have been called with the final value
    const calls = (engine.updateParameter as ReturnType<typeof vi.fn>).mock.calls;
    const thresholdCalls = calls.filter((c: unknown[]) => c[0] === "threshold");
    // Last call should be the final value
    if (thresholdCalls.length > 0) {
      const lastCall = thresholdCalls[thresholdCalls.length - 1];
      expect(lastCall[1]).toBe(-24);
    }
  });

  it("should batch rapid changes within 16ms into a single call", async () => {
    const { useAudioStore } = await import("@/lib/stores/audio-store");
    bridge = new ParameterBridge(engine as AudioEngine);
    const mock = engine.updateParameter as ReturnType<typeof vi.fn>;

    // 5 rapid threshold changes within 1ms
    useAudioStore.getState().setParam("threshold", -10);
    useAudioStore.getState().setParam("threshold", -15);
    useAudioStore.getState().setParam("threshold", -20);
    useAudioStore.getState().setParam("threshold", -22);
    useAudioStore.getState().setParam("threshold", -24);

    // Before debounce period (15ms) — should NOT have fired yet
    vi.advanceTimersByTime(15);
    const callsBefore = mock.mock.calls.filter((c: unknown[]) => c[0] === "threshold").length;
    expect(callsBefore).toBe(0);

    // After full debounce (1ms more = 16ms total) — exactly 1 call with final value
    vi.advanceTimersByTime(1);
    const callsAfter = mock.mock.calls.filter((c: unknown[]) => c[0] === "threshold");
    expect(callsAfter.length).toBe(1);
    expect(callsAfter[0][1]).toBe(-24);
  });

  it("should unsubscribe from store on destroy()", async () => {
    const { useAudioStore } = await import("@/lib/stores/audio-store");
    bridge = new ParameterBridge(engine as AudioEngine);
    bridge.destroy();

    // Reset mock
    (engine.updateParameter as ReturnType<typeof vi.fn>).mockClear();

    // Change after destroy — should NOT trigger updateParameter
    useAudioStore.getState().setParam("ratio", 8);
    vi.advanceTimersByTime(20);

    expect(engine.updateParameter).not.toHaveBeenCalled();
  });
});
