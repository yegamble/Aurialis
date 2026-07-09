import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const uploadMock = vi.fn();
vi.mock("../r2-upload", () => ({
  uploadFileToR2: (...args: unknown[]) => uploadMock(...args),
}));

import { startDeepAnalysis } from "../deep-analysis";

function okJson(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const file = () => new File([new Uint8Array(10)], "a.wav", { type: "audio/wav" });

describe("startDeepAnalysis — R2 path vs legacy fallback", () => {
  beforeEach(() => uploadMock.mockReset());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("with a Turnstile token: uploads to R2, then POSTs JSON { key, profile }", async () => {
    // Contract: the R2 path requires the site key to be CONFIGURED.
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "test-site-key");
    uploadMock.mockResolvedValue({ key: "obj-123.wav" });
    const fetchMock = vi.fn(async () => okJson({ job_id: "j1", status: "queued" }));
    vi.stubGlobal("fetch", fetchMock);

    const f = file();
    const res = await startDeepAnalysis(f, "modern_pop_polish", "tok-1");

    expect(res.jobId).toBe("j1");
    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(uploadMock).toHaveBeenCalledWith(
      f,
      "tok-1",
      expect.any(String),
      expect.any(Object),
    );
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      key: "obj-123.wav",
      profile: "modern_pop_polish",
    });
    expect((init.headers as Record<string, string>)["content-type"]).toBe(
      "application/json",
    );
  });

  it("without a token: skips R2 and POSTs multipart FormData (legacy fallback)", async () => {
    const fetchMock = vi.fn(async () => okJson({ job_id: "j2", status: "queued" }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await startDeepAnalysis(file(), "modern_pop_polish", "");

    expect(res.jobId).toBe("j2");
    expect(uploadMock).not.toHaveBeenCalled();
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.body).toBeInstanceOf(FormData);
  });
});
