import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  startSeparation,
  pollJobStatus,
  downloadStem,
  SEPARATION_API_URL,
} from "../separation";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("separation API client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("startSeparation", () => {
    it("uploads file and returns job ID", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ job_id: "abc-123", status: "queued" }),
      });

      const file = new File(["audio"], "test.wav", { type: "audio/wav" });
      const result = await startSeparation(file, "htdemucs");

      expect(result.jobId).toBe("abc-123");
      expect(result.status).toBe("queued");
      expect(mockFetch).toHaveBeenCalledWith(
        `${SEPARATION_API_URL}/separate`,
        expect.objectContaining({ method: "POST" })
      );
    });

    it("sends model parameter in form data", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ job_id: "abc", status: "queued" }),
      });

      const file = new File(["audio"], "test.wav");
      await startSeparation(file, "htdemucs_6s");

      const call = mockFetch.mock.calls[0];
      const body = call[1].body as FormData;
      expect(body.get("model")).toBe("htdemucs_6s");
    });

    it("throws on HTTP error", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ detail: "Invalid model" }),
      });

      const file = new File(["audio"], "test.wav");
      await expect(startSeparation(file, "bad")).rejects.toThrow();
    });
  });

  describe("pollJobStatus", () => {
    it("returns job status", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            job_id: "abc",
            status: "processing",
            progress: 50,
            model: "htdemucs",
            stems: [],
            error: null,
          }),
      });

      const result = await pollJobStatus("abc");

      expect(result.status).toBe("processing");
      expect(result.progress).toBe(50);
    });

    it("returns stems when done", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            job_id: "abc",
            status: "done",
            progress: 100,
            model: "htdemucs",
            stems: [
              { name: "vocals", ready: true },
              { name: "drums", ready: true },
            ],
            error: null,
          }),
      });

      const result = await pollJobStatus("abc");

      expect(result.status).toBe("done");
      expect(result.stems).toHaveLength(2);
    });

    it("throws on 404 (job not found)", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ detail: "Job not found" }),
      });

      await expect(pollJobStatus("nonexistent")).rejects.toThrow();
    });
  });

  describe("downloadStem", () => {
    it("downloads stem as ArrayBuffer", async () => {
      const mockBuffer = new ArrayBuffer(100);
      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(mockBuffer),
      });

      const result = await downloadStem("abc", "vocals");

      expect(result).toBe(mockBuffer);
      expect(mockFetch).toHaveBeenCalledWith(
        `${SEPARATION_API_URL}/jobs/abc/stems/vocals`
      );
    });

    it("throws on error", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ detail: "Stem not found" }),
      });

      await expect(downloadStem("abc", "nonexistent")).rejects.toThrow();
    });
  });
});
