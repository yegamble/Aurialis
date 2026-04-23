/**
 * Multiband compressor DSP — pure TypeScript reference.
 *
 * Three-band Linkwitz-Riley 4th-order crossover → per-band compressor
 * (envelope follower + gain computer + attack/release smoothing + makeup gain)
 * with optional Mid/Side mode and msBalance threshold biasing → summation.
 *
 * This reference mirrors the hot loop of
 * `public/worklets/multiband-compressor-processor.js` one-to-one; parity is
 * enforced by `src/lib/audio/dsp/__tests__/multiband-parity.test.ts`.
 */

import { computeGainReduction } from "./compressor";
import { ThreeWaySplitter } from "./crossover";

/** ±BALANCE_RANGE_DB is the maximum threshold bias in M/S mode at |msBalance|=1. */
export const BALANCE_RANGE_DB = 6;

/** Compressor fixed knee width (dB) — matches worklet default. */
const KNEE_DB = 6;

export interface BandParams {
  /** 0 = disabled (band contributes passthrough of its split signal). */
  enabled: number;
  /** 0/1 — when any band is soloed, non-soloed bands contribute silence. */
  solo: number;
  /** dBFS */
  threshold: number;
  ratio: number;
  /** seconds */
  attack: number;
  /** seconds */
  release: number;
  /** dB */
  makeup: number;
  mode: "stereo" | "ms";
  /** -1..+1 — in M/S mode, biases threshold: +1 softer on M, harder on S. */
  msBalance: number;
}

/** Per-band envelope state: two independent envelopes (either L/R or M/S). */
interface BandState {
  /** L or M envelope follower state (linear amplitude). */
  envA: number;
  /** R or S envelope follower state. */
  envB: number;
  /** Last computed gain reduction (dB, ≤ 0) for metering. */
  lastGr: number;
}

function makeBandState(): BandState {
  return { envA: 0, envB: 0, lastGr: 0 };
}

/** Envelope follower (peak detector with attack/release smoothing). */
function updateEnv(
  env: number,
  level: number,
  attackCoeff: number,
  releaseCoeff: number
): number {
  if (level > env) {
    return attackCoeff * env + (1 - attackCoeff) * level;
  }
  return releaseCoeff * env + (1 - releaseCoeff) * level;
}

export class MultibandCompressorDSP {
  private readonly fs: number;
  private splitL: ThreeWaySplitter;
  private splitR: ThreeWaySplitter;
  private stateLow: BandState = makeBandState();
  private stateMid: BandState = makeBandState();
  private stateHigh: BandState = makeBandState();

  constructor(fs: number) {
    this.fs = fs;
    this.splitL = new ThreeWaySplitter(200, 2000, fs);
    this.splitR = new ThreeWaySplitter(200, 2000, fs);
  }

  reset(): void {
    this.splitL.reset();
    this.splitR.reset();
    this.stateLow = makeBandState();
    this.stateMid = makeBandState();
    this.stateHigh = makeBandState();
  }

  /**
   * Process a stereo buffer in place-of-output.
   *
   * @returns last-sample gain reductions (dB, ≤ 0) per band, for metering.
   */
  processStereo(
    left: Float32Array,
    right: Float32Array,
    bands: { low: BandParams; mid: BandParams; high: BandParams },
    crossovers: { lowMid: number; midHigh: number },
    out: { left: Float32Array; right: Float32Array }
  ): { grLow: number; grMid: number; grHigh: number } {
    const n = left.length;
    const fs = this.fs;

    // Update splitter cutoffs if caller changed them
    const cur = this.splitL.crossovers;
    if (cur.lowMid !== crossovers.lowMid || cur.midHigh !== crossovers.midHigh) {
      this.splitL.setCrossovers(crossovers.lowMid, crossovers.midHigh);
      this.splitR.setCrossovers(crossovers.lowMid, crossovers.midHigh);
    }

    const anySolo =
      bands.low.solo > 0 || bands.mid.solo > 0 || bands.high.solo > 0;
    const anyEnabled =
      bands.low.enabled > 0 ||
      bands.mid.enabled > 0 ||
      bands.high.enabled > 0;

    // True bypass: no enabled bands and no active solos → skip splitter entirely.
    // This preserves bit-exact passthrough, avoiding the all-pass phase shift
    // that LR4 summation would otherwise impose on the signal.
    if (!anyEnabled && !anySolo) {
      if (out.left !== left) out.left.set(left);
      if (out.right !== right) out.right.set(right);
      this.stateLow.lastGr = 0;
      this.stateMid.lastGr = 0;
      this.stateHigh.lastGr = 0;
      return { grLow: 0, grMid: 0, grHigh: 0 };
    }

    const bandCtx = {
      low: this.makeBandContext(bands.low, fs),
      mid: this.makeBandContext(bands.mid, fs),
      high: this.makeBandContext(bands.high, fs),
    };

    for (let i = 0; i < n; i++) {
      const lSplit = this.splitL.process(left[i]);
      const rSplit = this.splitR.process(right[i]);

      const lowOut = this.processBand(
        lSplit.low,
        rSplit.low,
        bands.low,
        bandCtx.low,
        this.stateLow,
        anySolo
      );
      const midOut = this.processBand(
        lSplit.mid,
        rSplit.mid,
        bands.mid,
        bandCtx.mid,
        this.stateMid,
        anySolo
      );
      const highOut = this.processBand(
        lSplit.high,
        rSplit.high,
        bands.high,
        bandCtx.high,
        this.stateHigh,
        anySolo
      );

      out.left[i] = lowOut.l + midOut.l + highOut.l;
      out.right[i] = lowOut.r + midOut.r + highOut.r;
    }

    return {
      grLow: this.stateLow.lastGr,
      grMid: this.stateMid.lastGr,
      grHigh: this.stateHigh.lastGr,
    };
  }

  private makeBandContext(band: BandParams, fs: number) {
    return {
      attackCoeff: Math.exp(-1 / (Math.max(band.attack, 1e-5) * fs)),
      releaseCoeff: Math.exp(-1 / (Math.max(band.release, 1e-5) * fs)),
      makeupLin: Math.pow(10, band.makeup / 20),
    };
  }

  private processBand(
    bL: number,
    bR: number,
    params: BandParams,
    ctx: { attackCoeff: number; releaseCoeff: number; makeupLin: number },
    state: BandState,
    anySolo: boolean
  ): { l: number; r: number } {
    // Solo: non-soloed bands contribute silence when any solo is active.
    if (anySolo && params.solo <= 0) {
      state.lastGr = 0;
      return { l: 0, r: 0 };
    }
    // Disabled band: pass split signal through unchanged (no compression, no makeup).
    if (params.enabled <= 0) {
      state.lastGr = 0;
      return { l: bL, r: bR };
    }

    if (params.mode === "ms") {
      return this.processBandMS(bL, bR, params, ctx, state);
    }
    return this.processBandStereo(bL, bR, params, ctx, state);
  }

  private processBandStereo(
    bL: number,
    bR: number,
    params: BandParams,
    ctx: { attackCoeff: number; releaseCoeff: number; makeupLin: number },
    state: BandState
  ): { l: number; r: number } {
    // Linked stereo: detector = max of |L|, |R| envelopes.
    const absL = Math.abs(bL);
    const absR = Math.abs(bR);
    state.envA = updateEnv(state.envA, absL, ctx.attackCoeff, ctx.releaseCoeff);
    state.envB = updateEnv(state.envB, absR, ctx.attackCoeff, ctx.releaseCoeff);
    const env = Math.max(state.envA, state.envB);
    const inputDb = env > 0 ? 20 * Math.log10(env) : -120;
    const gr = computeGainReduction(inputDb, {
      threshold: params.threshold,
      ratio: params.ratio,
      knee: KNEE_DB,
    });
    state.lastGr = gr;
    const gainLin = Math.pow(10, gr / 20) * ctx.makeupLin;
    return { l: bL * gainLin, r: bR * gainLin };
  }

  private processBandMS(
    bL: number,
    bR: number,
    params: BandParams,
    ctx: { attackCoeff: number; releaseCoeff: number; makeupLin: number },
    state: BandState
  ): { l: number; r: number } {
    // M/S encode
    const m = (bL + bR) * 0.5;
    const s = (bL - bR) * 0.5;

    // Threshold bias: positive msBalance → softer (higher threshold) on M.
    const thrM = params.threshold + params.msBalance * BALANCE_RANGE_DB;
    const thrS = params.threshold - params.msBalance * BALANCE_RANGE_DB;

    state.envA = updateEnv(
      state.envA,
      Math.abs(m),
      ctx.attackCoeff,
      ctx.releaseCoeff
    );
    state.envB = updateEnv(
      state.envB,
      Math.abs(s),
      ctx.attackCoeff,
      ctx.releaseCoeff
    );
    const mDb = state.envA > 0 ? 20 * Math.log10(state.envA) : -120;
    const sDb = state.envB > 0 ? 20 * Math.log10(state.envB) : -120;
    const grM = computeGainReduction(mDb, {
      threshold: thrM,
      ratio: params.ratio,
      knee: KNEE_DB,
    });
    const grS = computeGainReduction(sDb, {
      threshold: thrS,
      ratio: params.ratio,
      knee: KNEE_DB,
    });
    // Metering uses the more-reduced of the two channels.
    state.lastGr = Math.min(grM, grS);

    const gainM = Math.pow(10, grM / 20) * ctx.makeupLin;
    const gainS = Math.pow(10, grS / 20) * ctx.makeupLin;
    const mOut = m * gainM;
    const sOut = s * gainS;

    // M/S decode
    return { l: mOut + sOut, r: mOut - sOut };
  }
}
