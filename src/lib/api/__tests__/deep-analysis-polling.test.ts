import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  pollUntilDone,
  pollOnceWithTimeout,
  type PollFn,
} from "../deep-analysis-polling";
import { DeepAnalysisError, type DeepJobStatus } from "../deep-analysis";

const buildStatus = (overrides: Partial<DeepJobStatus> = {}): DeepJobStatus => ({
  jobId: "j1",
  status: "processing",
  progress: 30,
  model: "modern_pop_polish",
  jobType: "deep_analysis",
  partialResult: {},
  subStatus: null,
  error: null,
  ...overrides,
});

describe("pollUntilDone", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Helper that wires up a stub PollFn returning a queued sequence. */
  function queuedPollFn(
    queue: Array<DeepJobStatus | Error>
  ): PollFn & { calls: number } {
    let i = 0;
    const fn = vi.fn(async () => {
      const item = queue[i] ?? queue[queue.length - 1];
      i++;
      if (item instanceof Error) throw item;
      return item as DeepJobStatus;
    });
    Object.defineProperty(fn, "calls", { get: () => i });
    return fn as unknown as PollFn & { calls: number };
  }

  /** Drive the polling loop forward by N intervals plus epsilon for promise turns. */
  async function tick(times: number, intervalMs = 1000) {
    for (let i = 0; i < times; i++) {
      await vi.advanceTimersByTimeAsync(intervalMs + 1);
    }
  }

  it("resolves { kind: 'done' } when status reaches done", async () => {
    const pollFn = queuedPollFn([
      buildStatus({ status: "processing", progress: 30 }),
      buildStatus({ status: "processing", progress: 70 }),
      buildStatus({ status: "done", progress: 100 }),
    ]);
    const onPoll = vi.fn();
    const ctl = new AbortController();

    const promise = pollUntilDone(
      {
        jobId: "j1",
        signal: ctl.signal,
        isCancelling: () => false,
        onPoll,
      },
      pollFn
    );

    await tick(3);
    const result = await promise;
    expect(result).toEqual({ kind: "done" });
    expect(onPoll).toHaveBeenCalledTimes(3);
  });

  it("recovers from a single transient 5xx and continues", async () => {
    const transient = new DeepAnalysisError({
      message: "Bad gateway",
      status: "502",
      raw: "{}",
      at: "2026-04-27T00:00:00Z",
    });
    const pollFn = queuedPollFn([
      buildStatus({ progress: 10 }),
      transient,
      buildStatus({ progress: 50 }),
      buildStatus({ status: "done" }),
    ]);
    const ctl = new AbortController();
    const promise = pollUntilDone(
      {
        jobId: "j1",
        signal: ctl.signal,
        isCancelling: () => false,
        onPoll: () => {},
      },
      pollFn
    );

    await tick(4);
    const result = await promise;
    expect(result).toEqual({ kind: "done" });
  });

  it("aborts on 3 consecutive 5xx with the last error's details", async () => {
    const err = (status: string) =>
      new DeepAnalysisError({
        message: `Failed ${status}`,
        status,
        raw: "{}",
        at: "2026-04-27T00:00:00Z",
      });
    const pollFn = queuedPollFn([err("502"), err("503"), err("504")]);
    const ctl = new AbortController();
    const promise = pollUntilDone(
      {
        jobId: "j1",
        signal: ctl.signal,
        isCancelling: () => false,
        onPoll: () => {},
      },
      pollFn
    );
    // Attach a no-op handler synchronously so Node doesn't fire
    // unhandledRejection during the timer advance below — vitest's CI
    // reporter treats unhandled rejections as fatal even when the test's
    // `.rejects` matcher catches them later.
    promise.catch(() => {});

    await tick(3);
    await expect(promise).rejects.toMatchObject({
      details: { status: "504" },
    });
  });

  it("aborts immediately on a single 4xx (no retries)", async () => {
    const pollFn = queuedPollFn([
      new DeepAnalysisError({
        message: "Job not found",
        status: "404",
        raw: "{}",
        at: "2026-04-27T00:00:00Z",
      }),
    ]);
    const ctl = new AbortController();
    const promise = pollUntilDone(
      {
        jobId: "j1",
        signal: ctl.signal,
        isCancelling: () => false,
        onPoll: () => {},
      },
      pollFn
    );
    promise.catch(() => {});

    await tick(1);
    await expect(promise).rejects.toMatchObject({
      details: { status: "404" },
    });
    expect(pollFn).toHaveBeenCalledTimes(1);
  });

  it("aborts after total cap with status 'timeout'", async () => {
    // Always return processing
    const pollFn: PollFn = vi.fn(async () => buildStatus({ progress: 10 }));
    const ctl = new AbortController();
    const promise = pollUntilDone(
      {
        jobId: "j1",
        signal: ctl.signal,
        isCancelling: () => false,
        onPoll: () => {},
        totalCapMs: 600_000,
      },
      pollFn
    );

    // Suppress unhandled rejection — we await later
    promise.catch(() => {});
    // Advance well past 10 minutes
    await vi.advanceTimersByTimeAsync(700_000);
    await expect(promise).rejects.toMatchObject({
      details: { status: "timeout" },
    });
  });

  it("external abort terminates polling within ~50ms", async () => {
    const pollFn: PollFn = vi.fn(async () => buildStatus({ progress: 10 }));
    const ctl = new AbortController();
    const promise = pollUntilDone(
      {
        jobId: "j1",
        signal: ctl.signal,
        isCancelling: () => false,
        onPoll: () => {},
      },
      pollFn
    );

    promise.catch(() => {});
    // Let the first poll complete
    await tick(1);
    // Abort during the next sleep
    ctl.abort(new DOMException("cancelled by user", "AbortError"));
    await vi.advanceTimersByTimeAsync(50);

    await expect(promise).rejects.toThrow();
  });

  it("cancel hard-bound: elapses while cancelling → throws cancel-timeout", async () => {
    let cancelling = false;
    // Backend never honors cancel — keeps returning processing
    const pollFn: PollFn = vi.fn(async () => buildStatus({ progress: 50 }));
    const ctl = new AbortController();
    // Compress timing: 100ms poll interval, 500ms cancel hard-bound — same
    // logic, faster test. Production defaults stay at 1s/35s.
    const promise = pollUntilDone(
      {
        jobId: "j1",
        signal: ctl.signal,
        isCancelling: () => cancelling,
        onPoll: () => {},
        pollIntervalMs: 100,
        cancelHardBoundMs: 500,
      },
      pollFn
    );
    promise.catch(() => {});

    // Run normally for one tick
    await tick(1, 100);
    // User clicks cancel
    cancelling = true;
    // Advance past 500ms hard-bound
    await tick(7, 100);

    await expect(promise).rejects.toMatchObject({
      details: { status: "cancel-timeout" },
    });
  });

  it("returns { kind: 'cancelled' } when backend reports error: 'Cancelled by user'", async () => {
    let cancelling = false;
    const pollFn = queuedPollFn([
      buildStatus({ progress: 50 }),
      buildStatus({ status: "error", error: "Cancelled by user" }),
    ]);
    const ctl = new AbortController();
    const promise = pollUntilDone(
      {
        jobId: "j1",
        signal: ctl.signal,
        isCancelling: () => cancelling,
        onPoll: () => {},
      },
      pollFn
    );

    await tick(1);
    cancelling = true;
    await tick(1);

    const result = await promise;
    expect(result).toEqual({ kind: "cancelled" });
  });

  it("backend error (not cancel) propagates as DeepAnalysisError", async () => {
    const pollFn = queuedPollFn([
      buildStatus({ progress: 10 }),
      buildStatus({ status: "error", error: "Demucs OOM" }),
    ]);
    const ctl = new AbortController();
    const promise = pollUntilDone(
      {
        jobId: "j1",
        signal: ctl.signal,
        isCancelling: () => false,
        onPoll: () => {},
      },
      pollFn
    );
    promise.catch(() => {});

    await tick(2);
    await expect(promise).rejects.toMatchObject({
      message: "Demucs OOM",
    });
  });
});

describe("pollOnceWithTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("aborts the inner poll after the timeout elapses", async () => {
    let aborted = false;
    const slowPoll: PollFn = (jobId, signal) =>
      new Promise<DeepJobStatus>((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("aborted", "AbortError"));
        });
      });

    const ctl = new AbortController();
    const promise = pollOnceWithTimeout(
      "j1",
      ctl.signal,
      slowPoll,
      15_000
    );
    promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(15_001);
    await expect(promise).rejects.toThrow();
    expect(aborted).toBe(true);
  });

  it("forwards external abort", async () => {
    let aborted = false;
    const slowPoll: PollFn = (jobId, signal) =>
      new Promise<DeepJobStatus>((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    const ctl = new AbortController();
    const promise = pollOnceWithTimeout(
      "j1",
      ctl.signal,
      slowPoll,
      15_000
    );
    promise.catch(() => {});
    ctl.abort();
    await vi.advanceTimersByTimeAsync(0);
    await expect(promise).rejects.toThrow();
    expect(aborted).toBe(true);
  });

  it("clears the timeout when poll resolves quickly", async () => {
    const fastPoll: PollFn = async () => buildStatus({ status: "done" });
    const ctl = new AbortController();
    const promise = pollOnceWithTimeout("j1", ctl.signal, fastPoll, 15_000);
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;
    expect(result.status).toBe("done");
    // No leaked timers
    expect(vi.getTimerCount()).toBe(0);
  });
});
