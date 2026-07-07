import { describe, it, expect } from "vitest";
import { computeIntegratedLufs } from "@/lib/audio/dsp/lufs";
import { detectTruePeakDbTp } from "@/lib/audio/dsp/true-peak";
import {
  computeAlbumGainDb,
  applyGainDb,
  normalizeToAlbumTarget,
} from "../normalize";

const SR = 44100;

function sine(freq: number, amp: number, seconds: number): Float32Array {
  const n = Math.floor(seconds * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    out[i] = amp * Math.sin((2 * Math.PI * freq * i) / SR);
  }
  return out;
}

/** Two independent channels holding the same waveform (safe to gain in place). */
function stereo(mono: Float32Array): Float32Array[] {
  return [mono, Float32Array.from(mono)];
}

describe("album normalize", () => {
  it("returns 0 gain for silence (non-finite measurement is skipped)", () => {
    const silent = [new Float32Array(SR), new Float32Array(SR)];
    expect(computeAlbumGainDb(silent, SR, -14)).toBe(0);
  });

  it("leaves the buffer untouched when normalization is skipped", () => {
    const silent = [new Float32Array(SR), new Float32Array(SR)];
    const gain = normalizeToAlbumTarget(silent, SR, -14);
    expect(gain).toBe(0);
    expect(silent[0]!.every((v) => v === 0)).toBe(true);
  });

  it("boosts a quiet track onto the album target (not peak-limited)", () => {
    const chans = stereo(sine(1000, 0.05, 1));
    const before = computeIntegratedLufs(chans[0]!, chans[1]!, SR);
    expect(before).toBeLessThan(-14); // genuinely quiet

    const gain = normalizeToAlbumTarget(chans, SR, -14);
    expect(gain).toBeGreaterThan(0); // boosted

    const after = computeIntegratedLufs(chans[0]!, chans[1]!, SR);
    expect(after).toBeCloseTo(-14, 0); // landed on target
  });

  it("attenuates a track that is louder than the album target", () => {
    const chans = stereo(sine(1000, 0.6, 1));
    const gain = normalizeToAlbumTarget(chans, SR, -20);
    expect(gain).toBeLessThan(0); // pulled down
    const after = computeIntegratedLufs(chans[0]!, chans[1]!, SR);
    expect(after).toBeCloseTo(-20, 0);
  });

  it("caps the boost so the post-gain true peak never exceeds the ceiling", () => {
    // Chasing an absurd 0 LUFS target on a −6 dBFS sine would push the peak well
    // past the ceiling; the guard must clamp so the peak lands AT the ceiling.
    const chans = stereo(sine(1000, 0.5, 1));
    const gain = computeAlbumGainDb(chans, SR, 0, -1);
    applyGainDb(chans, gain);
    const postPeak = Math.max(
      detectTruePeakDbTp(chans[0]!),
      detectTruePeakDbTp(chans[1]!),
    );
    expect(postPeak).toBeLessThanOrEqual(-1 + 0.05);
    expect(postPeak).toBeCloseTo(-1, 1);
  });

  it("applyGainDb scales samples and treats 0 dB as a no-op", () => {
    const noop = Float32Array.from([0.1, -0.2, 0.3]);
    applyGainDb([noop], 0);
    expect(Array.from(noop)).toEqual([
      Math.fround(0.1),
      Math.fround(-0.2),
      Math.fround(0.3),
    ]);

    const doubled = Float32Array.from([0.1, -0.2]);
    applyGainDb([doubled], 20 * Math.log10(2)); // +6.02 dB ⇒ ×2
    expect(doubled[0]).toBeCloseTo(0.2, 5);
    expect(doubled[1]).toBeCloseTo(-0.4, 5);
  });
});
