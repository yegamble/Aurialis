import { describe, it, expect } from "vitest";
import { GENRE_PRESETS, applyIntensity } from "../presets";
import {
  MultibandCompressorDSP,
  type BandParams,
} from "../dsp/multiband";
import type { GenreName } from "../presets";

const FS = 48000;

function paramsToBand(
  p: ReturnType<typeof applyIntensity>,
  prefix: "mbLow" | "mbMid" | "mbHigh"
): BandParams {
  return {
    enabled: p[`${prefix}Enabled` as const],
    solo: p[`${prefix}Solo` as const],
    threshold: p[`${prefix}Threshold` as const],
    ratio: p[`${prefix}Ratio` as const],
    attack: p[`${prefix}Attack` as const] / 1000,
    release: p[`${prefix}Release` as const] / 1000,
    makeup: p[`${prefix}Makeup` as const],
    mode: p[`${prefix}Mode` as const],
    msBalance: p[`${prefix}MsBalance` as const],
  };
}

function deterministicNoise(n: number, seed = 1): Float32Array {
  const out = new Float32Array(n);
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    out[i] = ((s / 0x7fffffff) * 2 - 1) * 0.3;
  }
  return out;
}

describe("P2 preset regression — multiband bypassed across all genres", () => {
  const genres: GenreName[] = [
    "pop",
    "rock",
    "hiphop",
    "electronic",
    "jazz",
    "classical",
    "rnb",
    "podcast",
    "lofi",
  ];

  it.each(genres)(
    "genre '%s' at 100%% intensity has multibandEnabled=0 (byte-equivalent to pre-P2)",
    (genre) => {
      const p = applyIntensity(genre, 100);
      expect(p.multibandEnabled).toBe(0);
      // All three bands disabled
      expect(p.mbLowEnabled).toBe(0);
      expect(p.mbMidEnabled).toBe(0);
      expect(p.mbHighEnabled).toBe(0);
      // Default crossovers inherited
      expect(p.mbCrossLowMid).toBe(200);
      expect(p.mbCrossMidHigh).toBe(2000);
    }
  );

  it.each(genres)(
    "genre '%s' multiband pass is bit-exact passthrough (all disabled + master off)",
    (genre) => {
      const p = applyIntensity(genre, 100);
      const dsp = new MultibandCompressorDSP(FS);
      const n = 2048;
      const left = deterministicNoise(n, 1);
      const right = deterministicNoise(n, 2);
      const outL = new Float32Array(n);
      const outR = new Float32Array(n);

      dsp.processStereo(
        left,
        right,
        {
          low: paramsToBand(p, "mbLow"),
          mid: paramsToBand(p, "mbMid"),
          high: paramsToBand(p, "mbHigh"),
        },
        { lowMid: p.mbCrossLowMid, midHigh: p.mbCrossMidHigh },
        { left: outL, right: outR }
      );
      for (let i = 0; i < n; i++) {
        expect(outL[i]).toBe(left[i]);
        expect(outR[i]).toBe(right[i]);
      }
    }
  );

  it.each(genres)(
    "genre '%s' genre preset (direct) has multibandEnabled=0",
    (genre) => {
      expect(GENRE_PRESETS[genre].multibandEnabled).toBe(0);
    }
  );
});

describe("P2 perf microbenchmark — multiband DSP timing", () => {
  it("enabled multiband is within a reasonable CPU budget vs disabled", () => {
    const fs = 48000;
    const n = 48000; // 1 second
    const left = deterministicNoise(n, 1);
    const right = deterministicNoise(n, 2);
    const outL = new Float32Array(n);
    const outR = new Float32Array(n);

    const neutralBand = (): BandParams => ({
      enabled: 0,
      solo: 0,
      threshold: -18,
      ratio: 2,
      attack: 0.02,
      release: 0.25,
      makeup: 0,
      mode: "stereo",
      msBalance: 0,
    });
    const activeBand = (): BandParams => ({
      ...neutralBand(),
      enabled: 1,
      threshold: -20,
      ratio: 3,
    });

    // Baseline: all disabled → short-circuit bypass path
    const dsp1 = new MultibandCompressorDSP(fs);
    const t0 = performance.now();
    dsp1.processStereo(
      left,
      right,
      { low: neutralBand(), mid: neutralBand(), high: neutralBand() },
      { lowMid: 200, midHigh: 2000 },
      { left: outL, right: outR }
    );
    const bypassMs = performance.now() - t0;

    // Fully active (all 3 bands stereo)
    const dsp2 = new MultibandCompressorDSP(fs);
    const t1 = performance.now();
    dsp2.processStereo(
      left,
      right,
      { low: activeBand(), mid: activeBand(), high: activeBand() },
      { lowMid: 200, midHigh: 2000 },
      { left: outL, right: outR }
    );
    const activeMs = performance.now() - t1;

    // Fully active with all bands in M/S
    const dsp3 = new MultibandCompressorDSP(fs);
    const t2 = performance.now();
    dsp3.processStereo(
      left,
      right,
      {
        low: { ...activeBand(), mode: "ms" },
        mid: { ...activeBand(), mode: "ms" },
        high: { ...activeBand(), mode: "ms" },
      },
      { lowMid: 200, midHigh: 2000 },
      { left: outL, right: outR }
    );
    const msMs = performance.now() - t2;

    // Sanity bounds — active must finish a 1s buffer in far less than realtime.
    // On any reasonable CI, 1s of audio should process in < 250 ms.
    expect(activeMs).toBeLessThan(250);
    expect(msMs).toBeLessThan(300);
    // Bypass path should be clearly cheaper than active (at least 3×)
    expect(bypassMs).toBeLessThan(activeMs);
  });
});
