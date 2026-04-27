/**
 * Resilient polling loop for Deep Analysis jobs.
 *
 * Responsibilities (split from the API client so it can be unit-tested in
 * isolation with a stub poll function):
 *  - Per-request 15s timeout (no AbortSignal.any — manual setTimeout fallback
 *    so iOS Safari ≤17.3 isn't broken).
 *  - 3-consecutive-failure tolerance for transient errors (5xx, network,
 *    timeout). 4xx aborts immediately.
 *  - 10-minute total cap.
 *  - 35s client-side hard-bound on the cancelling state, so the UI never sits
 *    on "Cancelling…" forever if the backend misses a phase boundary.
 *  - External abort (cancel button or unmount) terminates within ~50ms.
 */

import {
  DeepAnalysisError,
  pollDeepJobStatus,
  type DeepErrorDetails,
  type DeepJobStatus,
} from "./deep-analysis";

export type PollFn = (
  jobId: string,
  signal?: AbortSignal
) => Promise<DeepJobStatus>;

export interface PollOptions {
  jobId: string;
  /** External abort (cancel button + component unmount). */
  signal: AbortSignal;
  /** Returns true once the user has clicked Cancel — gates the 35s hard-bound. */
  isCancelling: () => boolean;
  /** Fires after every successful poll. */
  onPoll: (status: DeepJobStatus, elapsedMs: number) => void;
  /** Default: 1000. */
  pollIntervalMs?: number;
  /** Default: 15_000. */
  perRequestTimeoutMs?: number;
  /** Default: 600_000 (10 min). */
  totalCapMs?: number;
  /** Default: 35_000. */
  cancelHardBoundMs?: number;
}

export type PollResult = { kind: "done" } | { kind: "cancelled" };

/** Wrap a poll call with a per-request timeout that fires controller.abort(). */
export async function pollOnceWithTimeout(
  jobId: string,
  externalSignal: AbortSignal,
  pollFn: PollFn,
  timeoutMs: number
): Promise<DeepJobStatus> {
  if (externalSignal.aborted) {
    throw new DOMException(
      String(externalSignal.reason ?? "aborted"),
      "AbortError"
    );
  }
  const ctl = new AbortController();
  const onExternalAbort = () => {
    ctl.abort(externalSignal.reason);
  };
  externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  const timer = setTimeout(() => {
    ctl.abort(new DOMException("timeout", "TimeoutError"));
  }, timeoutMs);
  try {
    return await pollFn(jobId, ctl.signal);
  } finally {
    clearTimeout(timer);
    externalSignal.removeEventListener("abort", onExternalAbort);
  }
}

/** Sleep for `ms` but resolve early (rejecting AbortError) if signal aborts. */
function waitOrAbort(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(
        new DOMException(String(signal.reason ?? "aborted"), "AbortError")
      );
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(
        new DOMException(String(signal.reason ?? "aborted"), "AbortError")
      );
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function buildPollError(
  partial: Omit<DeepErrorDetails, "at">
): DeepAnalysisError {
  return new DeepAnalysisError({
    ...partial,
    at: new Date().toISOString(),
  });
}

function classifyError(
  e: unknown,
  jobId: string
): { fatal4xx: boolean; details: DeepErrorDetails } {
  if (e instanceof DeepAnalysisError) {
    const code = parseInt(e.details.status, 10);
    const fatal4xx = !Number.isNaN(code) && code >= 400 && code < 500;
    return { fatal4xx, details: e.details };
  }
  // DOMException with name "AbortError" is handled by the caller (rethrown).
  // Anything else: timeout or unknown.
  const isTimeout =
    e instanceof DOMException && e.name === "TimeoutError";
  const msg = e instanceof Error ? e.message : String(e);
  return {
    fatal4xx: false,
    details: {
      message: isTimeout ? "Request timed out" : msg,
      status: isTimeout ? "timeout" : "network error",
      jobId,
      raw: msg,
      at: new Date().toISOString(),
    },
  };
}

export async function pollUntilDone(
  opts: PollOptions,
  pollFn: PollFn = pollDeepJobStatus
): Promise<PollResult> {
  const pollIntervalMs = opts.pollIntervalMs ?? 1000;
  const perRequestTimeoutMs = opts.perRequestTimeoutMs ?? 15_000;
  const totalCapMs = opts.totalCapMs ?? 600_000;
  const cancelHardBoundMs = opts.cancelHardBoundMs ?? 35_000;

  const startMs = Date.now();
  let cancellingStartMs: number | null = null;
  let consecutiveFailures = 0;
  let lastError: DeepAnalysisError | null = null;

  while (true) {
    if (opts.signal.aborted) {
      throw new DOMException(
        String(opts.signal.reason ?? "aborted"),
        "AbortError"
      );
    }

    // Total-time cap
    if (Date.now() - startMs > totalCapMs) {
      throw buildPollError({
        message: `Analysis timed out after ${Math.round(totalCapMs / 60_000)} minutes`,
        status: "timeout",
        jobId: opts.jobId,
        raw: "Job ran past total-time cap",
      });
    }

    // Track when cancelling started; enforce 35s hard-bound
    if (opts.isCancelling()) {
      if (cancellingStartMs === null) {
        cancellingStartMs = Date.now();
      } else if (Date.now() - cancellingStartMs > cancelHardBoundMs) {
        throw buildPollError({
          message:
            "Cancel timed out — the backend job will finish on its own and clean up automatically",
          status: "cancel-timeout",
          jobId: opts.jobId,
          raw: "Cancel hard-bound elapsed without backend honoring",
        });
      }
    }

    try {
      const status = await pollOnceWithTimeout(
        opts.jobId,
        opts.signal,
        pollFn,
        perRequestTimeoutMs
      );
      consecutiveFailures = 0;
      lastError = null;
      opts.onPoll(status, Date.now() - startMs);

      if (status.status === "done") return { kind: "done" };
      if (status.status === "error") {
        if (status.error === "Cancelled by user") {
          return { kind: "cancelled" };
        }
        throw buildPollError({
          message: status.error ?? "Analysis failed",
          status: "backend-error",
          jobId: opts.jobId,
          raw: status.error ?? "(no error message)",
        });
      }
      // queued or processing — continue
    } catch (e) {
      // External abort: rethrow verbatim so caller can distinguish from data errors
      if (e instanceof DOMException && e.name === "AbortError") {
        throw e;
      }
      // Backend non-cancel error from the try block (we threw above) — surface
      if (
        e instanceof DeepAnalysisError &&
        e.details.status === "backend-error"
      ) {
        throw e;
      }
      const { fatal4xx, details } = classifyError(e, opts.jobId);
      if (fatal4xx) {
        throw e instanceof DeepAnalysisError ? e : buildPollError(details);
      }
      lastError = buildPollError(details);
      consecutiveFailures++;
      if (consecutiveFailures >= 3) {
        throw lastError;
      }
    }

    // Sleep before next poll (cancellable)
    await waitOrAbort(pollIntervalMs, opts.signal);
  }
}
