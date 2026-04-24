import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ParameterBridge } from "../parameter-bridge";
import type { AudioEngine } from "../engine";
import type { AudioParams } from "@/types/mastering";

const ENABLED_KEYS = [
  "compressorEnabled",
  "multibandEnabled",
  "parametricEqEnabled",
  "saturationEnabled",
  "stereoWidthEnabled",
  "limiterEnabled",
] as const satisfies ReadonlyArray<keyof AudioParams>;

function makeMockEngine(): Partial<AudioEngine> {
  return { updateParameter: vi.fn() };
}

describe("Parameter bridge audit — every *Enabled key forwards to engine", () => {
  let bridge: ParameterBridge | null = null;
  let engine: Partial<AudioEngine>;

  beforeEach(() => {
    engine = makeMockEngine();
    vi.useFakeTimers();
  });

  afterEach(async () => {
    bridge?.destroy();
    bridge = null;
    vi.useRealTimers();
    // Reset store to defaults so one test's trailing value does not leak into the next
    const { useAudioStore } = await import("@/lib/stores/audio-store");
    useAudioStore.getState().reset();
  });

  it.each(ENABLED_KEYS)(
    "flipping %s in the store forwards the exact value to engine.updateParameter",
    async (key) => {
      const { useAudioStore } = await import("@/lib/stores/audio-store");
      bridge = new ParameterBridge(engine as AudioEngine);

      const before = useAudioStore.getState().params[key] as number;
      const after = before === 0 ? 1 : 0;

      useAudioStore.getState().setParam(key, after as never);
      vi.advanceTimersByTime(20);

      const calls = (engine.updateParameter as ReturnType<typeof vi.fn>).mock.calls;
      const matched = calls.find((c) => c[0] === key);
      expect(matched, `no updateParameter call seen for ${key}`).toBeDefined();
      expect(matched?.[1]).toBe(after);
    },
  );

  it("round-trip: flipping and flipping back lands two distinct calls with the right values", async () => {
    const { useAudioStore } = await import("@/lib/stores/audio-store");
    bridge = new ParameterBridge(engine as AudioEngine);
    const key = "compressorEnabled";

    const initial = useAudioStore.getState().params[key] as number;
    const flipped = initial === 0 ? 1 : 0;

    useAudioStore.getState().setParam(key, flipped as never);
    vi.advanceTimersByTime(20);
    useAudioStore.getState().setParam(key, initial as never);
    vi.advanceTimersByTime(20);

    const calls = (engine.updateParameter as ReturnType<typeof vi.fn>).mock.calls
      .filter((c) => c[0] === key)
      .map((c) => c[1]);
    expect(calls).toEqual([flipped, initial]);
  });
});
