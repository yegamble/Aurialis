/**
 * Integration tests for the upload control plane.
 *
 * Uses @cloudflare/vitest-pool-workers so the worker runs in miniflare with
 * the real R2 binding + Durable Objects. Turnstile siteverify is mocked by
 * stubbing global fetch only for that URL. The strict bucket-locked
 * presigner is exercised indirectly via the response shape (we just assert
 * that the URLs target the configured bucket).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";

import worker from "../worker";

// Test-only secrets injected via miniflare bindings configured in
// vitest.worker.config.ts. Production secrets are never present at test
// time. We patch them on the env object before each test.
function patchEnv(overrides: Partial<typeof env>): typeof env {
  return Object.assign(env, overrides);
}

const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

function stubTurnstile(success: boolean, action = "upload-initiate") {
  const original = globalThis.fetch;
  const spy = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (u === TURNSTILE_VERIFY_URL) {
        return new Response(
          JSON.stringify(
            success
              ? { success: true, action }
              : { success: false, "error-codes": ["invalid-input-response"] }
          ),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return original.call(globalThis, input, init);
    });
  return spy;
}

const VALID_INITIATE = {
  token: "test-token-abc",
  contentType: "audio/wav",
  size: 50 * 1024 * 1024, // 50 MB
};

const ORIGIN = "https://aurialis.yosefgamble.com";

interface MakeRequestInit {
  body?: BodyInit;
  headers?: Record<string, string>;
  method?: string;
}

function makeRequest(path: string, init: MakeRequestInit = {}): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    origin: ORIGIN,
    "cf-connecting-ip": "203.0.113.7",
    ...(init.headers ?? {}),
  };
  return new Request(`https://aurialis-core.test${path}`, {
    method: init.method ?? "POST",
    headers,
    body: init.body,
  });
}

// Reset the rate-limit DO state between tests by clearing storage.
async function clearRateLimits(): Promise<void> {
  const perIp = env.RATE_LIMIT_PER_IP.idFromName("203.0.113.7");
  const stubA = env.RATE_LIMIT_PER_IP.get(perIp);
  await stubA.fetch("https://rate-limit.internal/?limit=999999"); // benign call to pass through
  // Hard reset by re-creating the DO is not possible here; tests use unique IPs
  // to side-step shared state instead.
}

describe("CORS preflight", () => {
  it("returns 204 with allow-origin for a known origin", async () => {
    const req = new Request("https://aurialis-core.test/upload/initiate", {
      method: "OPTIONS",
      headers: {
        origin: ORIGIN,
        "access-control-request-method": "POST",
      },
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  });
});

describe("POST /upload/initiate", () => {
  beforeEach(() => {
    patchEnv({
      TURNSTILE_SECRET_KEY: "test-secret",
      R2_ACCESS_KEY_ID: "test-akid",
      R2_SECRET_ACCESS_KEY: "test-secret-key",
      R2_ACCOUNT_ID: "test-account",
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it("rejects missing Turnstile token with 400", async () => {
    const req = makeRequest("/upload/initiate", {
      body: JSON.stringify({ ...VALID_INITIATE, token: "" }),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
  });

  it("rejects bad Turnstile token with 403", async () => {
    stubTurnstile(false);
    const req = makeRequest("/upload/initiate", {
      body: JSON.stringify(VALID_INITIATE),
      headers: { "cf-connecting-ip": "198.51.100.10" },
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(403);
  });

  it("rejects oversized files with 413", async () => {
    stubTurnstile(true);
    const req = makeRequest("/upload/initiate", {
      body: JSON.stringify({
        ...VALID_INITIATE,
        size: 5 * 1024 * 1024 * 1024, // 5 GB > 1 GB cap
      }),
      headers: { "cf-connecting-ip": "198.51.100.11" },
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(413);
  });

  it("rejects unsupported contentType with 400", async () => {
    stubTurnstile(true);
    const req = makeRequest("/upload/initiate", {
      body: JSON.stringify({ ...VALID_INITIATE, contentType: "video/mp4" }),
      headers: { "cf-connecting-ip": "198.51.100.12" },
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
  });

  it("returns uploadId, key matching pattern, and partUrls on success", async () => {
    stubTurnstile(true);
    const req = makeRequest("/upload/initiate", {
      body: JSON.stringify(VALID_INITIATE),
      headers: { "cf-connecting-ip": "198.51.100.13" },
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      uploadId: string;
      key: string;
      chunkSize: number;
      partUrls: { partNumber: number; url: string }[];
    };
    expect(data.uploadId).toBeTruthy();
    expect(data.key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.wav$/
    );
    // 50 MB / 16 MB chunk = 4 parts
    expect(data.partUrls).toHaveLength(4);
    for (const p of data.partUrls) {
      expect(p.url).toContain(env.UPLOADS_BUCKET_NAME);
      expect(p.url).toContain(`partNumber=${p.partNumber}`);
    }
  });

  it("rate-limits a single IP after RATE_LIMIT_PER_HOUR successes", async () => {
    stubTurnstile(true);
    const ip = "198.51.100.50";
    const limit = Number(env.RATE_LIMIT_PER_HOUR);
    let lastStatus = 0;
    // Exhaust the limit + one over.
    for (let i = 0; i <= limit; i++) {
      const req = makeRequest("/upload/initiate", {
        body: JSON.stringify(VALID_INITIATE),
        headers: { "cf-connecting-ip": ip },
      });
      const ctx = createExecutionContext();
      const res = await worker.fetch(req, env, ctx);
      await waitOnExecutionContext(ctx);
      lastStatus = res.status;
      if (res.status === 429) {
        expect(res.headers.get("retry-after")).toBeTruthy();
        break;
      }
    }
    expect(lastStatus).toBe(429);
  });
});

describe("POST /upload/abort", () => {
  beforeEach(() => {
    patchEnv({
      TURNSTILE_SECRET_KEY: "test-secret",
      R2_ACCESS_KEY_ID: "test-akid",
      R2_SECRET_ACCESS_KEY: "test-secret-key",
      R2_ACCOUNT_ID: "test-account",
    });
  });

  it("rejects invalid keys with 400", async () => {
    const req = makeRequest("/upload/abort", {
      body: JSON.stringify({ key: "../bad/path", uploadId: "abc" }),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
  });

  it("returns 204 for a valid (even non-existent) upload", async () => {
    const req = makeRequest("/upload/abort", {
      body: JSON.stringify({
        key: "12345678-1234-1234-1234-123456789012.wav",
        uploadId: "nonexistent",
      }),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(204);
  });
});

describe("POST /analyze/deep — JSON forward path", () => {
  beforeEach(() => {
    patchEnv({
      TURNSTILE_SECRET_KEY: "test-secret",
      R2_ACCESS_KEY_ID: "test-akid",
      R2_SECRET_ACCESS_KEY: "test-secret-key",
      R2_ACCOUNT_ID: "test-account",
    });
  });

  it("rejects invalid key with 400", async () => {
    const req = makeRequest("/analyze/deep", {
      body: JSON.stringify({ key: "../etc/passwd", profile: "modern_pop_polish" }),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
  });

  it("rejects client-supplied fetchUrl with 400 (SSRF mitigation)", async () => {
    const req = makeRequest("/analyze/deep", {
      body: JSON.stringify({
        key: "12345678-1234-1234-1234-123456789012.wav",
        profile: "modern_pop_polish",
        fetchUrl: "http://evil.example/malware.bin",
      }),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
  });

  it("rejects unsupported extension (.exe) via key regex", async () => {
    const req = makeRequest("/analyze/deep", {
      body: JSON.stringify({
        key: "12345678-1234-1234-1234-123456789012.exe",
        profile: "modern_pop_polish",
      }),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
  });

  it("accepts uppercase extensions (.WAV) in the key validator", async () => {
    // Exercise the validator via /upload/abort, which uses the same regex
    // and does NOT forward to the container (so we don't hit the Container
    // binding which isn't enabled in the test environment).
    const req = makeRequest("/upload/abort", {
      body: JSON.stringify({
        key: "12345678-1234-1234-1234-123456789012.WAV",
        uploadId: "nonexistent",
      }),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(204);
  });
});
