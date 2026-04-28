/**
 * Shared constants for the resilient polling loops used by Deep Analysis
 * and Smart Split. Centralizing these prevents the two flows from drifting
 * apart on retry / timeout behavior.
 */

/** Cadence between successful poll iterations. */
export const POLL_INTERVAL_MS = 1000;

/** Per-request timeout (per `pollOnceWithTimeout` call). */
export const PER_REQUEST_TIMEOUT_MS = 15_000;

/** Total time cap for a single analysis run. */
export const TOTAL_CAP_MS = 600_000;

/** Hard bound on the cancelling state — prevents UI sitting on "Cancelling…" forever. */
export const CANCEL_HARD_BOUND_MS = 35_000;

/** Consecutive transient failures (5xx, network, timeout) before giving up. */
export const MAX_CONSECUTIVE_FAILURES = 3;
