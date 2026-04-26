import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  startDeepAnalysis,
  pollDeepJobStatus,
  fetchDeepResult,
  DEEP_ANALYSIS_API_URL,
} from "../deep-analysis";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("deep-analysis API client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
