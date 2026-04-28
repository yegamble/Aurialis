import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  pollSeparationUntilDone,
  type SeparationPollFn,
} from "../separation-polling";
import { SeparationError, type JobStatus } from "../separation";

const buildStatus = (overrides: Partial<JobStatus> = {}): JobStatus => ({
  jobId: "j1",
  status: "processing",
  progress: 30,
  model: "htdemucs",
  stems: [],
  error: null,
  ...overrides,
});

describe("pollSeparationUntilDone", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function queuedPollFn(
    queue: Array<JobStatus | Error>
  ): SeparationPollFn & { calls: number } {
    let i = 0;
    const fn = vi.fn(async () => {
      const item = queue[i] ?? queue[queue.length - 1];
      i++;
      if (item instanceof Error) throw item;
      return item as JobStatus;
    });
    Object.defineProperty(fn, "calls", { get: () => i });
    return fn as unknown as SeparationPollFn & { calls: number };
  }

  async function tick(times: number, intervalMs = 1000): Promise<void> {
    for (let i = 0; i < times; i++) {
      await vi.advanceTimersByTimeAsync(intervalMs + 1);
    }
  }

  it("resolves done when status reaches done", async () => {
    const pollFn = queuedPollFn([
      buildStatus({ status: "queued", progress: 0 }),
      buildStatus({ status: "processing", progress: 50 }),
      buildStatus({ status: "done", progress: 100 }),
    ]);
    const onPoll = vi.fn();
    const ctl = new AbortController();

    const promise = pollSeparationUntilDone(
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
    expect(result.kind).toBe("done");
    if (result.kind === "done") {
      expect(result.final.status).toBe("done");
    }
    expect(onPoll).toHaveBeenCalledTimes(3);
  });

  it("recovers from a single transient 5xx and continues", async () => {
    const transient = new SeparationError({
      message: "Bad gateway",
      status: "502",
      raw: "{}",
      at: new Date().toISOString(),
    });
    const pollFn = queuedPollFn([
      buildStatus({ status: "processing", progress: 30 }),
      transient,
      buildStatus({ status: "done", progress: 100 }),
    ]);
    const ctl = new AbortController();
    const promise = pollSeparationUntilDone(
      {
        jobId: "j1",
        signal: ctl.signal,
        isCancelling: () => false,
        onPoll: vi.fn(),
      },
      pollFn
    );
    await tick(3);
    const result = await promise;
    expect(result.kind).toBe("done");
  });

  it("aborts immediately on 4xx (fatal)", async () => {
    const fatal = new SeparationError({
      message: "Job not found",
      status: "404",
      raw: "{}",
      at: new Date().toISOString(),
    });
    const pollFn = queuedPollFn([fatal]);
    const ctl = new AbortController();
    const promise = pollSeparationUntilDone(
      {
        jobId: "missing",
        signal: ctl.signal,
        isCancelling: () => false,
        onPoll: vi.fn(),
      },
      pollFn
    );
    // Attach rejection expectation BEFORE advancing timers so Node has a
    // catch handler in place when the rejection lands.
    const expectation = expect(promise).rejects.toThrow(/Job not found/);
    await tick(1);
    await expectation;
  });

  it("rethrows AbortError when external signal aborts", async () => {
    const pollFn = queuedPollFn([
      buildStatus({ status: "processing", progress: 30 }),
      buildStatus({ status: "processing", progress: 60 }),
      buildStatus({ status: "processing", progress: 70 }),
    ]);
    const ctl = new AbortController();
    const promise = pollSeparationUntilDone(
      {
        jobId: "j1",
        signal: ctl.signal,
        isCancelling: () => false,
        onPoll: vi.fn(),
      },
      pollFn
    );
    await tick(1);
    ctl.abort();
    await expect(promise).rejects.toThrow(/aborted|AbortError/i);
  });

  it("returns 'cancelled' when backend emits Cancelled by user", async () => {
    const pollFn = queuedPollFn([
      buildStatus({ status: "processing", progress: 30 }),
      buildStatus({ status: "error", error: "Cancelled by user" }),
    ]);
    const ctl = new AbortController();
    let cancelling = false;
    const promise = pollSeparationUntilDone(
      {
        jobId: "j1",
        signal: ctl.signal,
        isCancelling: () => cancelling,
        onPoll: vi.fn(),
      },
      pollFn
    );
    await tick(1);
    cancelling = true;
    await tick(1);
    const result = await promise;
    expect(result.kind).toBe("cancelled");
  });

  it("throws backend-error when status === error and not cancel", async () => {
    const pollFn = queuedPollFn([
      buildStatus({ status: "error", error: "Demucs OOM" }),
    ]);
    const ctl = new AbortController();
    const promise = pollSeparationUntilDone(
      {
        jobId: "j1",
        signal: ctl.signal,
        isCancelling: () => false,
        onPoll: vi.fn(),
      },
      pollFn
    );
    const expectation = expect(promise).rejects.toThrow(/Demucs OOM/);
    await tick(1);
    await expectation;
  });
});
