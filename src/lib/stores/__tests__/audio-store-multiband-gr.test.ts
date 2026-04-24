import { describe, it, expect, beforeEach } from "vitest";
import { useAudioStore } from "../audio-store";

/**
 * Task 3: per-band multiband gain-reduction readout.
 * Audio-store metering carries a `multibandGR: {low, mid, high}` field.
 * Default values are 0 (no GR). Engine updates this field via setMetering.
 */

describe("audio-store multibandGR (Phase 4a Task 3)", () => {
  beforeEach(() => {
    useAudioStore.getState().reset();
  });

  it("metering.multibandGR defaults to {low:0, mid:0, high:0}", () => {
    const { metering } = useAudioStore.getState();
    expect(metering.multibandGR).toEqual({ low: 0, mid: 0, high: 0 });
  });

  it("setMetering updates multibandGR", () => {
    useAudioStore
      .getState()
      .setMetering({ multibandGR: { low: -2.5, mid: -0.4, high: -1.1 } });
    const { metering } = useAudioStore.getState();
    expect(metering.multibandGR).toEqual({
      low: -2.5,
      mid: -0.4,
      high: -1.1,
    });
  });

  it("setMetering is partial — updating multibandGR alone leaves other metering intact", () => {
    useAudioStore.getState().setMetering({ lufs: -14.2 });
    useAudioStore
      .getState()
      .setMetering({ multibandGR: { low: -3, mid: 0, high: 0 } });
    const { metering } = useAudioStore.getState();
    expect(metering.lufs).toBe(-14.2);
    expect(metering.multibandGR).toEqual({ low: -3, mid: 0, high: 0 });
  });

  it("reset restores multibandGR to defaults", () => {
    useAudioStore
      .getState()
      .setMetering({ multibandGR: { low: -5, mid: -2, high: -1 } });
    useAudioStore.getState().reset();
    expect(useAudioStore.getState().metering.multibandGR).toEqual({
      low: 0,
      mid: 0,
      high: 0,
    });
  });
});
