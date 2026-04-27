import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  startDeepAnalysis,
  pollDeepJobStatus,
  fetchDeepResult,
  cancelDeepAnalysis,
  parseTraceparent,
  DeepAnalysisError,
  DEEP_ANALYSIS_API_URL,
} from "../deep-analysis";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const buildResponse = (
  body: unknown,
  init: { ok?: boolean; status?: number; headers?: Record<string, string> } = {}
) => ({
  ok: init.ok ?? true,
  status: init.status ?? 200,
  json: () => Promise.resolve(body),
  headers: {
    get: (name: string) =>
      init.headers?.[name] ?? init.headers?.[name.toLowerCase()] ?? null,
  },
});

describe("deep-analysis API client", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe("startDeepAnalysis", () => {
    it("uploads file + profile, returns job ID", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ job_id: "deep-1", status: "queued" }),
      });

      const file = new File(["audio"], "track.wav", { type: "audio/wav" });
      const result = await startDeepAnalysis(file, "modern_pop_polish");

      expect(result.jobId).toBe("deep-1");
      expect(result.status).toBe("queued");
      expect(mockFetch).toHaveBeenCalledWith(
        `${DEEP_ANALYSIS_API_URL}/analyze/deep`,
        expect.objectContaining({ method: "POST" })
      );
      const body = mockFetch.mock.calls[0]![1].body as FormData;
      expect(body.get("profile")).toBe("modern_pop_polish");
    });

    it("throws on backend error", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ detail: "Invalid profile" }),
      });
      const file = new File(["audio"], "track.wav");
      await expect(startDeepAnalysis(file, "metal_wall")).rejects.toThrow(
        /Invalid profile/
      );
    });
  });

  describe("pollDeepJobStatus", () => {
    it("parses job_type + partial_result correctly", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            job_id: "j1",
            status: "processing",
            progress: 40,
            model: "modern_pop_polish",
            job_type: "deep_analysis",
            partial_result: { sections: [{ id: "s1" }] },
            stems: [],
            error: null,
          }),
      });
      const status = await pollDeepJobStatus("j1");
      expect(status.jobId).toBe("j1");
      expect(status.status).toBe("processing");
      expect(status.progress).toBe(40);
      expect(status.partialResult).toEqual({ sections: [{ id: "s1" }] });
    });

    it("computes subStatus from partial_result keys", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            job_id: "j2",
            status: "processing",
            progress: 60,
            model: "x",
            job_type: "deep_analysis",
            partial_result: { sections: [{}], stems: [{}] },
            stems: [],
            error: null,
          }),
      });
      const status = await pollDeepJobStatus("j2");
      expect(status.subStatus).toBe("stems");
    });

    it("subStatus is 'sections' when only sections present", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            job_id: "j3",
            status: "processing",
            progress: 30,
            model: "x",
            job_type: "deep_analysis",
            partial_result: { sections: [] },
            stems: [],
            error: null,
          }),
      });
      const status = await pollDeepJobStatus("j3");
      expect(status.subStatus).toBe("sections");
    });

    it("subStatus is 'script' when script present", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            job_id: "j4",
            status: "done",
            progress: 100,
            model: "x",
            job_type: "deep_analysis",
            partial_result: {
              sections: [],
              stems: [],
              script: { version: 1 },
            },
            stems: [],
            error: null,
          }),
      });
      const status = await pollDeepJobStatus("j4");
      expect(status.subStatus).toBe("script");
    });

    it("subStatus is null when nothing partial", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            job_id: "j5",
            status: "queued",
            progress: 0,
            model: "x",
            job_type: "deep_analysis",
            partial_result: {},
            stems: [],
            error: null,
          }),
      });
      const status = await pollDeepJobStatus("j5");
      expect(status.subStatus).toBeNull();
    });
  });

  describe("parseTraceparent", () => {
    it("returns the 32-hex trace ID from a valid header", () => {
      const traceId = "0123456789abcdef0123456789abcdef";
      const header = `00-${traceId}-0123456789abcdef-01`;
      expect(parseTraceparent(header)).toBe(traceId);
    });

    it("returns undefined for null", () => {
      expect(parseTraceparent(null)).toBeUndefined();
    });

    it("returns undefined for malformed header", () => {
      expect(parseTraceparent("not-a-traceparent")).toBeUndefined();
      expect(parseTraceparent("00-tooshort-0123456789abcdef-01")).toBeUndefined();
    });

    it("rejects non-hex characters", () => {
      const bad = "00-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-0123456789abcdef-01";
      expect(parseTraceparent(bad)).toBeUndefined();
    });
  });

  describe("DeepAnalysisError + DeepErrorDetails", () => {
    it("network failure produces details with status='network error'", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));

      const file = new File(["audio"], "track.wav");
      const promise = startDeepAnalysis(file, "modern_pop_polish");

      await expect(promise).rejects.toBeInstanceOf(DeepAnalysisError);
      try {
        await promise;
      } catch (err) {
        const e = err as DeepAnalysisError;
        expect(e.details.status).toBe("network error");
        expect(e.details.url).toBe(`${DEEP_ANALYSIS_API_URL}/analyze/deep`);
        expect(e.details.message).toMatch(/Couldn't reach/);
        expect(e.details.raw).toContain("Failed to fetch");
        expect(e.details.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      }

      // Verify structured console.error was emitted as JSON
      expect(consoleSpy).toHaveBeenCalled();
      const logged = consoleSpy.mock.calls[0]![0] as string;
      expect(() => JSON.parse(logged)).not.toThrow();
      const parsed = JSON.parse(logged);
      expect(parsed.status).toBe("network error");
      expect(parsed.url).toBe(`${DEEP_ANALYSIS_API_URL}/analyze/deep`);
      consoleSpy.mockRestore();
    });

    it("HTTP error captures status, url, and traceId from response headers", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const traceId = "abcdef0123456789abcdef0123456789";
      mockFetch.mockResolvedValueOnce(
        buildResponse(
          { detail: "Job not found" },
          {
            ok: false,
            status: 404,
            headers: { traceparent: `00-${traceId}-0123456789abcdef-01` },
          }
        )
      );

      try {
        await pollDeepJobStatus("missing-id");
        expect.fail("should have thrown");
      } catch (err) {
        const e = err as DeepAnalysisError;
        expect(e).toBeInstanceOf(DeepAnalysisError);
        expect(e.details.status).toBe("404");
        expect(e.details.url).toBe(
          `${DEEP_ANALYSIS_API_URL}/jobs/missing-id/status`
        );
        expect(e.details.traceId).toBe(traceId);
        expect(e.details.message).toBe("Job not found");
      }
      consoleSpy.mockRestore();
    });

    it("parses jobId out of failing pollDeepJobStatus URL into details", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockFetch.mockResolvedValueOnce(
        buildResponse({ detail: "Server error" }, { ok: false, status: 500 })
      );
      try {
        await pollDeepJobStatus("job-xyz");
      } catch (err) {
        const e = err as DeepAnalysisError;
        expect(e.details.jobId).toBe("job-xyz");
      }
      consoleSpy.mockRestore();
    });
  });

  describe("cancelDeepAnalysis", () => {
    it("returns { ok: true } on 200", async () => {
      mockFetch.mockResolvedValueOnce(
        buildResponse({ job_id: "j1", cancelled: true }, { ok: true, status: 200 })
      );
      const result = await cancelDeepAnalysis("j1");
      expect(result).toEqual({ ok: true });
      expect(mockFetch).toHaveBeenCalledWith(
        `${DEEP_ANALYSIS_API_URL}/jobs/j1`,
        expect.objectContaining({ method: "DELETE" })
      );
    });

    it("returns { ok: false, status: 404 } on 404 (no throw)", async () => {
      mockFetch.mockResolvedValueOnce(
        buildResponse({ detail: "Job not found" }, { ok: false, status: 404 })
      );
      const result = await cancelDeepAnalysis("missing");
      expect(result).toEqual({ ok: false, status: 404 });
    });

    it("throws DeepAnalysisError on 500", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockFetch.mockResolvedValueOnce(
        buildResponse({ detail: "Server error" }, { ok: false, status: 500 })
      );
      await expect(cancelDeepAnalysis("j1")).rejects.toBeInstanceOf(
        DeepAnalysisError
      );
      consoleSpy.mockRestore();
    });

    it("forwards the abort signal to fetch", async () => {
      mockFetch.mockResolvedValueOnce(
        buildResponse({ ok: true }, { ok: true, status: 200 })
      );
      const controller = new AbortController();
      await cancelDeepAnalysis("j1", controller.signal);
      const init = mockFetch.mock.calls[0]![1];
      expect(init.signal).toBe(controller.signal);
    });
  });

  describe("fetchDeepResult", () => {
    it("returns the parsed MasteringScript", async () => {
      const fakeScript = {
        version: 1,
        trackId: "t1",
        sampleRate: 48000,
        duration: 30,
        profile: "modern_pop_polish",
        sections: [],
        moves: [],
      };
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(fakeScript),
      });
      const out = await fetchDeepResult("j1");
      expect(out).toEqual(fakeScript);
    });

    it("throws on HTTP error", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ detail: "Not found" }),
      });
      await expect(fetchDeepResult("missing")).rejects.toThrow(/Not found/);
    });
  });
});
