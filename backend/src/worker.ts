/**
 * Aurialis backend Worker.
 *
 * Two responsibilities:
 *   1. Upload control plane — POST /upload/initiate, /upload/complete,
 *      /upload/abort. Mints SigV4-presigned PUT URLs so the browser uploads
 *      directly to R2 without the body ever passing through this Worker.
 *   2. Container forwarder — proxies /health, /jobs/..., /analyze/deep,
 *      /separate to the FastAPI Durable Object container. For JSON bodies
 *      containing { key }, the Worker rewrites the body to { fetchUrl } using
 *      a 10-min presigned GET URL — the container never sees R2 credentials
 *      and never sees the raw key.
 *
 * Why a Worker in front of the container?
 *   - Cloudflare Containers are addressed via a Durable Object stub. The
 *     Worker is the public entry point that resolves the stub and proxies.
 *   - The Worker holds R2 credentials + Turnstile secret + rate-limit DOs.
 *     The container is dataplane only.
 */

import { Container } from "@cloudflare/containers";
import { AwsClient } from "aws4fetch";
import {
  corsHeaders,
  preflightResponse,
  jsonResponse,
  errorResponse,
} from "./cors";
import { verifyTurnstile } from "./turnstile";
import { presignUploadPart, presignGet } from "./r2-presign";
import {
  RateLimitDO,
  GlobalRateLimitDO,
  checkRateLimits,
} from "./rate-limit-do";
import { incrementCounter } from "./metrics";

export { RateLimitDO, GlobalRateLimitDO };

export class BackendContainer extends Container<Env> {
  defaultPort = 8000;
  sleepAfter = "10m";
}

// Env is the merged Cloudflare.Env (auto-generated from wrangler.jsonc) plus
// secrets declared in src/env-secrets.d.ts. The global `interface Env extends
// Cloudflare.Env {}` (also auto-generated) gives us the file-scope alias.

const KEY_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(wav|flac|mp3|aiff|aif|ogg)$/i;

const CONTENT_TYPE_TO_EXT: Record<string, string> = {
  "audio/wav": "wav",
  "audio/wave": "wav",
  "audio/x-wav": "wav",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/aiff": "aiff",
  "audio/x-aiff": "aiff",
  "audio/ogg": "ogg",
};

function uuidv4(): string {
  return crypto.randomUUID();
}

function clientIp(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "unknown";
}

function int(env: Env, key: keyof Env, fallback: number): number {
  const raw = env[key];
  if (typeof raw !== "string") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// ----------------------- Upload control plane -----------------------

interface InitiateBody {
  token: string;
  contentType: string;
  size: number;
}

async function handleInitiate(request: Request, env: Env): Promise<Response> {
  let body: InitiateBody;
  try {
    body = (await request.json()) as InitiateBody;
  } catch {
    return errorResponse(request, env, "Invalid JSON body", 400);
  }
  if (!body.token || typeof body.token !== "string") {
    return errorResponse(request, env, "Missing Turnstile token", 400);
  }
  if (typeof body.contentType !== "string") {
    return errorResponse(request, env, "Missing contentType", 400);
  }
  if (!Number.isFinite(body.size) || body.size <= 0) {
    return errorResponse(request, env, "Missing or invalid size", 400);
  }

  const ext = CONTENT_TYPE_TO_EXT[body.contentType.toLowerCase()];
  if (!ext) {
    return errorResponse(
      request,
      env,
      `Unsupported contentType: ${body.contentType}`,
      400
    );
  }

  const maxBytes = int(env, "MAX_UPLOAD_BYTES", 1024 * 1024 * 1024);
  if (body.size > maxBytes) {
    return errorResponse(
      request,
      env,
      `File too large: ${body.size} > ${maxBytes}`,
      413
    );
  }

  const ip = clientIp(request);
  const turnstile = await verifyTurnstile(body.token, "upload-initiate", ip, env);
  if (!turnstile.ok) {
    return errorResponse(
      request,
      env,
      `Turnstile verification failed: ${turnstile.reason}`,
      403
    );
  }

  const limits = await checkRateLimits(env, ip);
  if (!limits.allowed) {
    return errorResponse(
      request,
      env,
      `Rate limit exceeded (${limits.scope}); try again later.`,
      429,
      { "retry-after": String(limits.retryAfterSec ?? 60) }
    );
  }

  const key = `${uuidv4()}.${ext}`;
  const chunkSize = int(env, "CHUNK_SIZE_BYTES", 16 * 1024 * 1024);
  const partCount = Math.ceil(body.size / chunkSize);

  const created = await env.UPLOADS.createMultipartUpload(key, {
    httpMetadata: { contentType: body.contentType },
  });
  const uploadId = created.uploadId;

  const expirySec = int(env, "PART_PRESIGN_EXPIRY_SECONDS", 6 * 60 * 60);
  const partUrls: { partNumber: number; url: string }[] = [];
  for (let n = 1; n <= partCount; n++) {
    const url = await presignUploadPart(env, key, uploadId, n, expirySec);
    partUrls.push({ partNumber: n, url });
  }

  return jsonResponse(request, env, {
    uploadId,
    key,
    chunkSize,
    partUrls,
  });
}

interface CompleteBody {
  token: string;
  key: string;
  uploadId: string;
  parts: { partNumber: number; etag: string }[];
}

async function handleComplete(request: Request, env: Env): Promise<Response> {
  let body: CompleteBody;
  try {
    body = (await request.json()) as CompleteBody;
  } catch {
    return errorResponse(request, env, "Invalid JSON body", 400);
  }
  if (!body.token) return errorResponse(request, env, "Missing Turnstile token", 400);
  if (!body.key || !KEY_REGEX.test(body.key)) {
    return errorResponse(request, env, "Invalid key", 400);
  }
  if (!body.uploadId || typeof body.uploadId !== "string") {
    return errorResponse(request, env, "Missing uploadId", 400);
  }
  if (!Array.isArray(body.parts) || body.parts.length === 0) {
    return errorResponse(request, env, "Missing parts", 400);
  }

  const turnstile = await verifyTurnstile(
    body.token,
    "upload-complete",
    clientIp(request),
    env
  );
  if (!turnstile.ok) {
    return errorResponse(
      request,
      env,
      `Turnstile verification failed: ${turnstile.reason}`,
      403
    );
  }

  const upload = env.UPLOADS.resumeMultipartUpload(body.key, body.uploadId);
  try {
    // Pass etags through byte-for-byte. R2's resumeMultipartUpload.complete
    // expects R2UploadedPart objects: { partNumber, etag }.
    await upload.complete(
      body.parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag }))
    );
  } catch (err) {
    return errorResponse(
      request,
      env,
      `Multipart complete failed: ${(err as Error).message}`,
      500
    );
  }

  return jsonResponse(request, env, { key: body.key });
}

interface AbortBody {
  key: string;
  uploadId: string;
}

async function handleAbort(request: Request, env: Env): Promise<Response> {
  let body: AbortBody;
  try {
    body = (await request.json()) as AbortBody;
  } catch {
    return errorResponse(request, env, "Invalid JSON body", 400);
  }
  if (!body.key || !KEY_REGEX.test(body.key)) {
    return errorResponse(request, env, "Invalid key", 400);
  }
  if (!body.uploadId || typeof body.uploadId !== "string") {
    return errorResponse(request, env, "Missing uploadId", 400);
  }

  try {
    const upload = env.UPLOADS.resumeMultipartUpload(body.key, body.uploadId);
    await upload.abort();
  } catch {
    // Aborting a non-existent upload is a no-op for our purposes.
  }
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

// ----------------------- Container forward path -----------------------

async function forwardToContainer(
  request: Request,
  env: Env,
  rewrittenBody: BodyInit | null = null
): Promise<Response> {
  const id = env.BACKEND.idFromName("default");
  const stub = env.BACKEND.get(id);

  if (rewrittenBody === null) {
    return stub.fetch(request);
  }

  // Build a new request preserving method + most headers, but with the new
  // body. Drop content-length so the runtime recomputes for the new body.
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  const forwardReq = new Request(request.url, {
    method: request.method,
    headers,
    body: rewrittenBody,
  });
  return stub.fetch(forwardReq);
}

interface AnalyzeJsonBody {
  key?: string;
  fetchUrl?: string;
  profile?: string;
  model?: string;
}

async function handleAnalyzeOrSeparate(
  request: Request,
  env: Env
): Promise<Response> {
  const ct = (request.headers.get("content-type") ?? "").toLowerCase();

  if (ct.startsWith("multipart/form-data")) {
    incrementCounter(env, "multipart_legacy_calls", {
      path: new URL(request.url).pathname,
    });
    return forwardToContainer(request, env);
  }

  if (!ct.startsWith("application/json")) {
    // Anything else (no body, text/plain, etc) — let the container handle.
    return forwardToContainer(request, env);
  }

  let body: AnalyzeJsonBody;
  const raw = await request.text();
  try {
    body = JSON.parse(raw) as AnalyzeJsonBody;
  } catch {
    return errorResponse(request, env, "Invalid JSON body", 400);
  }

  // Reject any client-supplied fetchUrl — only `key` is trusted.
  if (body.fetchUrl) {
    return errorResponse(request, env, "Reserved field: fetchUrl", 400);
  }
  if (!body.key || !KEY_REGEX.test(body.key)) {
    return errorResponse(request, env, "Invalid key", 400);
  }

  const expirySec = int(env, "GET_PRESIGN_EXPIRY_SECONDS", 600);
  const fetchUrl = await presignGet(env, body.key, expirySec);

  // Build the body the container will see: drop key, inject fetchUrl,
  // preserve profile or model.
  const containerBody: Record<string, unknown> = { fetchUrl };
  if (typeof body.profile === "string") containerBody.profile = body.profile;
  if (typeof body.model === "string") containerBody.model = body.model;

  return forwardToContainer(request, env, JSON.stringify(containerBody));
}

// ----------------------- Router -----------------------

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight for every Worker-handled endpoint
    if (request.method === "OPTIONS") {
      return preflightResponse(request, env);
    }

    // Worker-handled control plane
    if (path === "/upload/initiate" && request.method === "POST") {
      return handleInitiate(request, env);
    }
    if (path === "/upload/complete" && request.method === "POST") {
      return handleComplete(request, env);
    }
    if (path === "/upload/abort" && request.method === "POST") {
      return handleAbort(request, env);
    }

    // Forwarded with potential body rewrite
    if (
      (path === "/analyze/deep" || path === "/separate") &&
      request.method === "POST"
    ) {
      return handleAnalyzeOrSeparate(request, env);
    }

    // Everything else: transparent passthrough to the container
    return forwardToContainer(request, env);
  },
} satisfies ExportedHandler<Env>;

// Suppress unused-import warning when aws4fetch is only used via r2-presign.ts
void AwsClient;
