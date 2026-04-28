/**
 * Resilient polling loop for Smart Split (Demucs separation) jobs.
 * Mirrors `deep-analysis-polling.ts`: per-request timeout, 3-strikes
 * tolerance for transient failures, total-time cap, cancel hard-bound.
 */

import {
  pollJobStatus,
  SeparationError,
  type JobStatus,
  type SeparationErrorDetails,
} from "./separation";
import {
  CANCEL_HARD_BOUND_MS,
  MAX_CONSECUTIVE_FAILURES,
  PER_REQUEST_TIMEOUT_MS,
  POLL_INTERVAL_MS,
  TOTAL_CAP_MS,
} from "./poll-defaults";

export type SeparationPollFn = (
  jobId: string,
  signal?: AbortSignal
) => Promise<JobStatus>;

export interface SeparationPollOptions {
  jobId: string;
  /** External abort (cancel button + component unmount). */
  signal: AbortSignal;
  /** Returns true once the user has clicked Cancel — gates the cancel hard-bound. */
  isCancelling: () => boolean;
  /** Fires after every successful poll. */
  onPoll: (status: JobStatus, elapsedMs: number) => void;
  /** Defaults from `poll-defaults.ts` — override only in tests. */
  pollIntervalMs?: number;
  perRequestTimeoutMs?: number;
  totalCapMs?: number;
  cancelHardBoundMs?: number;
}

export type SeparationPollResult =
  | { kind: "done"; final: JobStatus }
  | { kind: "cancelled" };

function buildPollError(
  partial: Omit<SeparationErrorDetails, "at">
): SeparationError {
  return new SeparationError({
    ...partial,
    at: new Date().toISOString(),
  });
}

function classifyError(
  e: unknown,
  jobId: string
): { fatal4xx: boolean; details: SeparationErrorDetails } {
  if (e instanceof SeparationError) {
    const code = parseInt(e.details.status, 10);
    const fatal4xx = !Number.isNaN(code) && code >= 400 && code < 500;
    return { fatal4xx, details: e.details };
  }
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

/** Wrap a poll call with a per-request timeout that fires controller.abort(). */
export async function pollOnceWithTimeout(
  jobId: string,
  externalSignal: AbortSignal,
  pollFn: SeparationPollFn,
  timeoutMs: number
): Promise<JobStatus> {
  if (externalSignal.aborted) {
    throw new DOMException(
      String(externalSignal.reason ?? "aborted"),
      "AbortError"
    );
  }
  const ctl = new AbortController();
  const onExternalAbort = (): void => {
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
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(
        new DOMException(String(signal.reason ?? "aborted"), "AbortError")
      );
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Drive a separation job to completion (or controlled cancel), surfacing
 * intermediate progress via `onPoll`. Throws `SeparationError` on
 * unrecoverable backend failure. Throws `DOMException(AbortError)` when
 * the external signal aborts.
 */
export async function pollSeparationUntilDone(
  opts: SeparationPollOptions,
  pollFn: SeparationPollFn = pollJobStatus
): Promise<SeparationPollResult> {
  const pollIntervalMs = opts.pollIntervalMs ?? POLL_INTERVAL_MS;
  const perRequestTimeoutMs =
    opts.perRequestTimeoutMs ?? PER_REQUEST_TIMEOUT_MS;
  const totalCapMs = opts.totalCapMs ?? TOTAL_CAP_MS;
  const cancelHardBoundMs = opts.cancelHardBoundMs ?? CANCEL_HARD_BOUND_MS;

  const startMs = Date.now();
  let cancellingStartMs: number | null = null;
  let consecutiveFailures = 0;
  let lastError: SeparationError | null = null;

  while (true) {
    if (opts.signal.aborted) {
      throw new DOMException(
        String(opts.signal.reason ?? "aborted"),
        "AbortError"
      );
    }

    if (Date.now() - startMs > totalCapMs) {
      throw buildPollError({
        message: `Separation timed out after ${Math.round(totalCapMs / 60_000)} minutes`,
        status: "timeout",
        jobId: opts.jobId,
        raw: "Job ran past total-time cap",
      });
    }

    if (opts.isCancelling()) {
      if (cancellingStartMs === null) {
        cancellingStartMs = Date.now();
      } else if (Date.now() - cancellingStartMs > cancelHardBoundMs) {
        throw buildPollError({
          message:
            "Cancel timed out — the backend job will finish on its own",
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

      if (status.status === "done") return { kind: "done", final: status };
      if (status.status === "error") {
        if (status.error === "Cancelled by user") {
          return { kind: "cancelled" };
        }
        throw buildPollError({
          message: status.error ?? "Separation failed",
          status: "backend-error",
          jobId: opts.jobId,
          raw: status.error ?? "(no error message)",
        });
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        throw e;
      }
      if (
        e instanceof SeparationError &&
        e.details.status === "backend-error"
      ) {
        throw e;
      }
      const { fatal4xx, details } = classifyError(e, opts.jobId);
      if (fatal4xx) {
        throw e instanceof SeparationError ? e : buildPollError(details);
      }
      lastError = buildPollError(details);
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        throw lastError;
      }
    }

    await waitOrAbort(pollIntervalMs, opts.signal);
  }
}
