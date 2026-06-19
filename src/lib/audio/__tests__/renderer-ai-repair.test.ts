import { describe, it, expect } from "vitest";
import { applyProcessingPipeline } from "../renderer";
import { DEFAULT_PARAMS } from "../presets";
import type { AudioParams } from "@/types/mastering";
import type { MasteringScript } from "@/types/deep-mastering";

const SR = 44100;
const N = 8192;

function tone(freq: number, amp: number, n: number, sr: number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr);
  return out;
}

function sideRms(l: Float32Array, r: Float32Array): number {
  let s = 0;
  for (let i = 0; i < l.length; i++) {
    const side = (l[i]! - r[i]!) * 0.5;
    s += side * side;
  }
  return Math.sqrt(s / l.length);
}

/** Every stage bypassed except AI repair, which is driven only by the script. */
function aiRepairOnlyParams(): AudioParams {
  return {
    ...DEFAULT_PARAMS,
    parametricEqEnabled: 0,
    compressorEnabled: 0,
    multibandEnabled: 0,
    saturationEnabled: 0,
    stereoWidthEnabled: 0,
    limiterEnabled: 0,
  };
}

function aiRepairScript(amount: number): MasteringScript {
  const durSec = N / SR;
  return {
    version: 1,
    trackId: "ai-test",
    sampleRate: SR,
    duration: durSec,
    profile: "modern_pop_polish",
    sections: [],
    moves: [
      {
        id: "ai1",
        param: "master.aiRepair.amount",
        startSec: 0,
        endSec: durSec,
        envelope: [
          [0, amount],
          [durSec, amount],
        ],
        reason: "test",
        original: amount,
        edited: false,
        muted: false,
      },
    ],
  };
}

/** A 2.5 kHz tone with L≠R so there is in-band side content for the widener. */
function stereoPair(): [Float32Array, Float32Array] {
  return [tone(2500, 0.3, N, SR), tone(2500, 0.1, N, SR)];
}

describe("offline renderer — AI repair (export == preview)", () => {
  it("widens the side band when the deep script drives aiRepair amount > 0", () => {
    const [l0, r0] = stereoPair();
    applyProcessingPipeline([l0, r0], aiRepairOnlyParams(), SR, aiRepairScript(0));
    const sideBypass = sideRms(l0, r0);

    const [l1, r1] = stereoPair();
    applyProcessingPipeline([l1, r1], aiRepairOnlyParams(), SR, aiRepairScript(80));
    const sideWidened = sideRms(l1, r1);

    // The M/S widener boosts the 2.5 kHz side band, so side energy must rise.
    expect(sideWidened).toBeGreaterThan(sideBypass * 1.05);
  });

  it("amount = 0 is a bit-exact bypass (aiRepair move at 0 == no aiRepair move)", () => {
    const [la, ra] = stereoPair();
    applyProcessingPipeline([la, ra], aiRepairOnlyParams(), SR, aiRepairScript(0));

    const [lb, rb] = stereoPair();
    const noMoveScript: MasteringScript = { ...aiRepairScript(0), moves: [] };
    applyProcessingPipeline([lb, rb], aiRepairOnlyParams(), SR, noMoveScript);

    expect(la).toEqual(lb);
    expect(ra).toEqual(rb);
  });
});
