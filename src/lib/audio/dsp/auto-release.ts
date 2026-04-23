/**
 * Auto-release envelope follower — dual-stage parallel design (SSL G-Series inspired).
 *
 * When `autoRelease` is off, the envelope follower behaves identically to P0
 * (single-stage: user's attack/release times). When on, a second "slow" envelope
 * runs in parallel (5× the user's release time, capped at 2 seconds). During
 * release, the effective envelope is `max(env_fast, env_slow)` — gain reduction
 * is HELD longer on dense content, preventing the classic "pumping" effect.
 *
 * Trade-off: next-transient compression ramps in slightly later. This is the
 * intentional "glue for dense mixes" behavior, not "fast recovery from transients".
 */

export interface AutoReleaseState {
  envelope: number;
  envSlow: number;
}

/** Create a fresh state (both envelopes at zero). */
export function createAutoReleaseState(): AutoReleaseState {
  return { envelope: 0, envSlow: 0 };
}

/**
 * Process one sample through the dual-envelope follower.
 *
 * @param input         Absolute value of the detector sample (or signal level)
 * @param state         Mutable envelope state — caller owns
 * @param attackCoeff   Pre-computed `exp(-1 / (attackSec * sampleRate))`
 * @param releaseCoeff  Pre-computed `exp(-1 / (releaseSec * sampleRate))` — fast
 * @param releaseSlowCoeff  Pre-computed slow coefficient (5× release time).
 * @param autoRelease   0 = manual (P0 behavior), 1 = dual-stage auto
 * @returns             The effective envelope sample
 */
export function processAutoReleaseSample(
  input: number,
  state: AutoReleaseState,
  attackCoeff: number,
  releaseCoeff: number,
  releaseSlowCoeff: number,
  autoRelease: number
): number {
  if (input > state.envelope) {
    // Attack — both envelopes track the rising signal the same way (P0 behavior
    // on fast envelope; slow mirrors it so it's ready for release).
    state.envelope = attackCoeff * state.envelope + (1 - attackCoeff) * input;
    if (autoRelease > 0) {
      state.envSlow = attackCoeff * state.envSlow + (1 - attackCoeff) * input;
    }
    return state.envelope;
  }

  // Release
  state.envelope = releaseCoeff * state.envelope + (1 - releaseCoeff) * input;

  if (autoRelease > 0) {
    state.envSlow = releaseSlowCoeff * state.envSlow + (1 - releaseSlowCoeff) * input;
    // Pick the slower (higher-held) envelope during release
    if (state.envSlow > state.envelope) {
      return state.envSlow;
    }
  }

  return state.envelope;
}

/**
 * Compute the slow release time constant from the user's release setting.
 * 5× multiplier, capped at 2 seconds.
 */
export function computeSlowReleaseSeconds(releaseSeconds: number): number {
  return Math.min(releaseSeconds * 5, 2);
}
