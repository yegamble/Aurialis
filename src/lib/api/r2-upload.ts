/**
 * Browser → R2 chunked multipart upload client.
 *
 * Fixes the >100 MB upload ceiling: instead of POSTing the whole file as
 * multipart/form-data through the Worker (which buffers the request), the
 * browser uploads directly to R2 via presigned part URLs, then hands the
 * backend just the object `key`.
 *
 * Contract (see `backend/src/worker.ts` upload control plane):
 *   1. POST /upload/initiate { token, contentType, size }
 *        → { uploadId, key, chunkSize, partUrls: [{ partNumber, url }] }
 *   2. PUT each chunk to its presigned `partUrls[i].url`, capturing the ETag.
 *   3. POST /upload/complete { token, key, uploadId, parts: [{ partNumber, etag }] }
 *        → { key }
 *   4. POST /upload/abort { key, uploadId } on unrecoverable failure.
 *
 * Returns the R2 object key; callers then POST { key, ... } to /analyze/deep or
 * /separate (the Worker swaps the key for a 10-min presigned GET fetchUrl).
 */

import { buildBackendError } from "./errors";

export interface UploadOptions {
  /** Max concurrent part uploads (default 4). */
  concurrency?: number;
  /** Per-part retry attempts after the first try (default 3). */
  maxRetries?: number;
  /** Abort the whole upload. */
  signal?: AbortSignal;
  /** Progress callback (bytes uploaded so far, total bytes). */
  onProgress?: (uploadedBytes: number, totalBytes: number) => void;
}

interface InitiateResponse {
  uploadId: string;
  key: string;
  chunkSize: number;
  partUrls: { partNumber: number; url: string }[];
}

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_MAX_RETRIES = 3;
const RETRY_BASE_MS = 200;

export async function uploadFileToR2(
  file: Blob,
  turnstileToken: string,
  baseUrl: string,
  opts: UploadOptions = {},
): Promise<{ key: string }> {
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const contentType = file.type || "audio/wav";
  const size = file.size;

  // 1. initiate
  const init = await postJson<InitiateResponse>(
    `${baseUrl}/upload/initiate`,
    { token: turnstileToken, contentType, size },
    "Failed to start upload",
    opts.signal,
  );
  const { uploadId, key, chunkSize, partUrls } = init;

  // 2. upload parts (concurrency-limited, retried)
  const etags = new Array<string>(partUrls.length);
  let uploadedBytes = 0;
  try {
    await mapWithConcurrency(partUrls, concurrency, async (part, idx) => {
      const start = (part.partNumber - 1) * chunkSize;
      const end = Math.min(start + chunkSize, size);
      const etag = await putPartWithRetry(
        part.url,
        file.slice(start, end),
        maxRetries,
        opts.signal,
      );
      etags[idx] = etag;
      uploadedBytes += end - start;
      opts.onProgress?.(uploadedBytes, size);
    });
  } catch (e) {
    await abortUpload(baseUrl, key, uploadId);
    throw e;
  }

  // 3. complete
  try {
    const done = await postJson<{ key: string }>(
      `${baseUrl}/upload/complete`,
      {
        token: turnstileToken,
        key,
        uploadId,
        parts: partUrls.map((p, i) => ({
          partNumber: p.partNumber,
          etag: etags[i]!,
        })),
      },
      "Failed to finalize upload",
      opts.signal,
    );
    return { key: done.key };
  } catch (e) {
    await abortUpload(baseUrl, key, uploadId);
    throw e;
  }
}

async function postJson<T>(
  url: string,
  body: unknown,
  errorPrefix: string,
  signal?: AbortSignal,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    throw buildBackendError({
      message: `${errorPrefix}: network error`,
      url,
      status: "network error",
      raw: e instanceof Error ? e.message : String(e),
    });
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw buildBackendError({
      message: `${errorPrefix} (${res.status})`,
      url,
      status: String(res.status),
      raw: detail || `HTTP ${res.status}`,
    });
  }
  return (await res.json()) as T;
}

async function putPartWithRetry(
  url: string,
  chunk: Blob,
  maxRetries: number,
  signal?: AbortSignal,
): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) {
      throw buildBackendError({
        message: "Upload cancelled",
        url,
        status: "cancelled",
        raw: "aborted",
      });
    }
    try {
      const res = await fetch(url, { method: "PUT", body: chunk, signal });
      if (!res.ok) throw new Error(`PUT part failed: HTTP ${res.status}`);
      const etag = res.headers.get("etag") ?? res.headers.get("ETag");
      if (!etag) throw new Error("Missing ETag on part response");
      return etag;
    } catch (e) {
      lastErr = e;
      if (signal?.aborted) break;
      if (attempt < maxRetries) await delay(RETRY_BASE_MS * 2 ** attempt);
    }
  }
  throw buildBackendError({
    message: "Failed to upload a file chunk after retries",
    url,
    status: "upload-part-error",
    raw: lastErr instanceof Error ? lastErr.message : String(lastErr),
  });
}

/** Best-effort abort so a failed upload doesn't leak an incomplete R2 object. */
async function abortUpload(
  baseUrl: string,
  key: string,
  uploadId: string,
): Promise<void> {
  try {
    await fetch(`${baseUrl}/upload/abort`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, uploadId }),
    });
  } catch {
    // best-effort cleanup; the original error is what matters to the caller
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Run `fn` over `items` with at most `limit` in flight; rejects on first error. */
async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T, idx: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (true) {
        const idx = next++;
        if (idx >= items.length) break;
        await fn(items[idx]!, idx);
      }
    },
  );
  await Promise.all(workers);
}
