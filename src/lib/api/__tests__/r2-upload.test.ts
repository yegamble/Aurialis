import { describe, it, expect, vi, afterEach } from "vitest";
import { uploadFileToR2 } from "../r2-upload";

const BASE = "https://api.test";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function putResponse(etag: string | null, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h: string) => (h.toLowerCase() === "etag" ? etag : null) },
    json: async () => ({}),
    text: async () => "",
  } as unknown as Response;
}

function makeFile(size: number, type = "audio/wav"): File {
  return new File([new Uint8Array(size)], "track.wav", { type });
}

function bodyOf(call: [unknown, RequestInit?]): Record<string, unknown> {
  return JSON.parse(String(call[1]!.body));
}

describe("uploadFileToR2", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uploads every chunk (count = ceil(size/chunkSize)) and returns the key", async () => {
    const chunkSize = 1024 * 1024; // 1 MB
    const size = chunkSize * 2 + 100; // → 3 parts
    const initiate = {
      uploadId: "up-1",
      key: "abc.wav",
      chunkSize,
      partUrls: [
        { partNumber: 1, url: `${BASE}/part/1` },
        { partNumber: 2, url: `${BASE}/part/2` },
        { partNumber: 3, url: `${BASE}/part/3` },
      ],
    };
    const fetchMock = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.endsWith("/upload/initiate")) return jsonResponse(initiate);
      if (u.includes("/part/")) return putResponse(`"etag-${u.slice(-1)}"`);
      if (u.endsWith("/upload/complete")) return jsonResponse({ key: "abc.wav" });
      throw new Error(`unexpected ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await uploadFileToR2(makeFile(size), "tok", BASE);

    expect(result).toEqual({ key: "abc.wav" });
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit?][];
    expect(bodyOf(calls.find((c) => c[0].endsWith("/upload/initiate"))!)).toEqual({
      token: "tok",
      contentType: "audio/wav",
      size,
    });
    expect(calls.filter((c) => c[0].includes("/part/"))).toHaveLength(3);
    const complete = bodyOf(calls.find((c) => c[0].endsWith("/upload/complete"))!);
    expect(complete.uploadId).toBe("up-1");
    expect(complete.parts).toHaveLength(3);
  });

  it("retries a failed part then succeeds", async () => {
    const chunkSize = 1024 * 1024;
    const initiate = {
      uploadId: "up-2",
      key: "x.wav",
      chunkSize,
      partUrls: [{ partNumber: 1, url: `${BASE}/part/1` }],
    };
    let partAttempts = 0;
    const fetchMock = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.endsWith("/upload/initiate")) return jsonResponse(initiate);
      if (u.includes("/part/")) {
        partAttempts++;
        return partAttempts === 1 ? putResponse(null, 500) : putResponse(`"ok"`);
      }
      if (u.endsWith("/upload/complete")) return jsonResponse({ key: "x.wav" });
      throw new Error(`unexpected ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await uploadFileToR2(makeFile(chunkSize / 2), "tok", BASE, {
      maxRetries: 3,
    });
    expect(result.key).toBe("x.wav");
    expect(partAttempts).toBe(2); // one failure + one success
  });

  it("aborts and throws when a part exhausts its retries", async () => {
    const chunkSize = 1024 * 1024;
    const initiate = {
      uploadId: "up-3",
      key: "y.wav",
      chunkSize,
      partUrls: [{ partNumber: 1, url: `${BASE}/part/1` }],
    };
    let aborted = false;
    const fetchMock = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.endsWith("/upload/initiate")) return jsonResponse(initiate);
      if (u.includes("/part/")) return putResponse(null, 500); // always fails
      if (u.endsWith("/upload/abort")) {
        aborted = true;
        return jsonResponse({});
      }
      throw new Error(`unexpected ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      uploadFileToR2(makeFile(chunkSize / 2), "tok", BASE, { maxRetries: 1 }),
    ).rejects.toThrow(/chunk/);
    expect(aborted).toBe(true);
  });
});
