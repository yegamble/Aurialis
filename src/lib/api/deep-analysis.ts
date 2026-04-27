/**
 * Frontend API client for the Deep Analysis backend (T2/T3/T5).
 * Same FastAPI service as Smart Split — re-uses the env var when one
 * dedicated to deep analysis isn't set.
 */

import type { MasteringScript, ProfileId } from "@/types/deep-mastering";

export const DEEP_ANALYSIS_API_URL =
  process.env.NEXT_PUBLIC_DEEP_ANALYSIS_API_URL ??
  process.env.NEXT_PUBLIC_SEPARATION_API_URL ??
  "http://localhost:8000";

export interface DeepStartResult {
  jobId: string;
  status: string;
}

export type DeepSubStatus = "sections" | "stems" | "script" | null;

export interface DeepJobStatus {
  jobId: string;
  status: "queued" | "processing" | "done" | "error";
  progress: number;
  model: string;
  jobType: string;
  partialResult: Record<string, unknown>;
  /** Derived from `partial_result` keys — most-advanced phase reached. */
  subStatus: DeepSubStatus;
  error: string | null;
}

/**
 * Structured failure metadata. Carried by every DeepAnalysisError so the UI
 * can render technical details (URL, status, traceId) and the console can log
 * a queryable JSON line.
 */
export interface DeepErrorDetails {
  /** Human-readable summary for the UI's headline. */
  message: string;
  /** Request URL that failed. Undefined for client-side errors. */
  url?: string;
  /**
   * HTTP status as string, or one of: "network error", "timeout",
   * "cancelled", "cancel-timeout", "client", "backend-error".
   */
  status: string;
  /** Job ID if known at the time of failure. */
  jobId?: string;
  /** W3C trace ID parsed from `traceparent` response header, if present. */
  traceId?: string;
  /** Raw error message / stack for the technical-details `<pre>`. */
  raw: string;
  /** ISO timestamp of failure. */
  at: string;
}

export class DeepAnalysisError extends Error {
  details: DeepErrorDetails;
  constructor(details: DeepErrorDetails) {
    super(details.message);
    this.name = "DeepAnalysisError";
    this.details = details;
  }
}

interface ErrorBody {
  detail?: string;
}

interface StartResponse {
  job_id: string;
  status: string;
}

interface JobStatusResponse {
  job_id: string;
  status: DeepJobStatus["status"];
  progress: number;
  model: string;
  job_type?: string;
  partial_result?: Record<string, unknown>;
  error: string | null;
}

const TRACEPARENT_RE =
  /^00-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/i;

/** Parse a W3C `traceparent` header. Returns the 32-hex trace ID or undefined. */
export function parseTraceparent(header: string | null | undefined): string | undefined {
  if (!header) return undefined;
  const m = TRACEPARENT_RE.exec(header.trim());
  return m ? m[1]!.toLowerCase() : undefined;
}

function buildAndLogError(partial: Omit<DeepErrorDetails, "at">): DeepAnalysisError {
  const details: DeepErrorDetails = { ...partial, at: new Date().toISOString() };
  try {
    console.error(JSON.stringify(details));
  } catch {
    console.error(details.message);
  }
  return new DeepAnalysisError(details);
}

interface FetchContext {
  url: string;
  jobId?: string;
  errorPrefix: string;
}

async function fetchOrThrow(
  ctx: FetchContext,
  init: RequestInit
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(ctx.url, init);
  } catch (e) {
    throw buildAndLogError({
      message: "Couldn't reach the analysis service",
      url: ctx.url,
      status: "network error",
      jobId: ctx.jobId,
      raw: e instanceof Error ? e.stack ?? e.message : String(e),
    });
  }
  if (!response.ok) {
    const traceId = parseTraceparent(
      response.headers?.get?.("traceparent") ?? null
    );
    let body: ErrorBody = {};
    try {
      body = (await response.json()) as ErrorBody;
    } catch {
      body = { detail: "Unknown error" };
    }
    throw buildAndLogError({
      message: body.detail ?? `${ctx.errorPrefix}: ${response.status}`,
      url: ctx.url,
      status: String(response.status),
      jobId: ctx.jobId,
      traceId,
      raw: JSON.stringify(body),
    });
  }
  return response;
}

/** Start a deep-analysis job for the given audio file + profile. */
export async function startDeepAnalysis(
  file: File,
  profile: ProfileId,
  signal?: AbortSignal
): Promise<DeepStartResult> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("profile", profile);

  const response = await fetchOrThrow(
    {
      url: `${DEEP_ANALYSIS_API_URL}/analyze/deep`,
      errorPrefix: "Deep analysis failed",
    },
    { method: "POST", body: formData, signal }
  );
  const data = (await response.json()) as StartResponse;
  return { jobId: data.job_id, status: data.status };
}

/** Poll deep-analysis job status. Computes a sub-status from `partial_result`. */
export async function pollDeepJobStatus(
  jobId: string,
  signal?: AbortSignal
): Promise<DeepJobStatus> {
  const response = await fetchOrThrow(
    {
      url: `${DEEP_ANALYSIS_API_URL}/jobs/${jobId}/status`,
      jobId,
      errorPrefix: "Status check failed",
    },
    { signal }
  );
  const data = (await response.json()) as JobStatusResponse;
  const partial: Record<string, unknown> = data.partial_result ?? {};
  return {
    jobId: data.job_id,
    status: data.status,
    progress: data.progress,
    model: data.model,
    jobType: data.job_type ?? "separation",
    partialResult: partial,
    subStatus: deriveSubStatus(partial),
    error: data.error,
  };
}

function deriveSubStatus(
  partial: Record<string, unknown>
): DeepSubStatus {
  if ("script" in partial) return "script";
  if ("stems" in partial) return "stems";
  if ("sections" in partial) return "sections";
  return null;
}

/** Fetch the full MasteringScript once the job is done. */
export async function fetchDeepResult(
  jobId: string,
  signal?: AbortSignal
): Promise<MasteringScript> {
  const response = await fetchOrThrow(
    {
      url: `${DEEP_ANALYSIS_API_URL}/jobs/${jobId}/result`,
      jobId,
      errorPrefix: "Result fetch failed",
    },
    { signal }
  );
  return (await response.json()) as MasteringScript;
}

/**
 * Cancel an in-progress deep-analysis job. Returns `{ ok: true }` when the
 * backend honored the request, or `{ ok: false, status: 404 }` when the job
 * has already completed (idempotent — treat as no-op). Throws on 5xx.
 */
export async function cancelDeepAnalysis(
  jobId: string,
  signal?: AbortSignal
): Promise<{ ok: true } | { ok: false; status: number }> {
  const url = `${DEEP_ANALYSIS_API_URL}/jobs/${jobId}`;
  let response: Response;
  try {
    response = await fetch(url, { method: "DELETE", signal });
  } catch (e) {
    throw buildAndLogError({
      message: "Couldn't reach the analysis service",
      url,
      status: "network error",
      jobId,
      raw: e instanceof Error ? e.stack ?? e.message : String(e),
    });
  }
  if (response.ok) return { ok: true };
  if (response.status === 404) return { ok: false, status: 404 };
  // 5xx or unexpected: fall through to error
  const traceId = parseTraceparent(
    response.headers?.get?.("traceparent") ?? null
  );
  let body: ErrorBody = {};
  try {
    body = (await response.json()) as ErrorBody;
  } catch {
    body = { detail: "Unknown error" };
  }
  throw buildAndLogError({
    message: body.detail ?? `Cancel failed: ${response.status}`,
    url,
    status: String(response.status),
    jobId,
    traceId,
    raw: JSON.stringify(body),
  });
}
