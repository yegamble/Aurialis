/**
 * Frontend API client for the Smart Split separation backend.
 * Communicates with the self-hosted Demucs Docker service.
 */

export const SEPARATION_API_URL =
  process.env.NEXT_PUBLIC_SEPARATION_API_URL ?? "http://localhost:8000";

export interface SeparationStartResult {
  jobId: string;
  status: string;
}

export interface StemStatus {
  name: string;
  ready: boolean;
}

export interface JobStatus {
  jobId: string;
  status: "queued" | "processing" | "done" | "error";
  progress: number;
  model: string;
  stems: StemStatus[];
  error: string | null;
}

/**
 * Structured failure metadata for Smart Split. Mirrors `DeepErrorDetails`
 * so the UI can render technical details and the console can log a
 * queryable JSON line.
 */
export interface SeparationErrorDetails {
  /** Human-readable summary for the UI's headline. */
  message: string;
  /** Request URL that failed. Undefined for client-side errors. */
  url?: string;
  /**
   * HTTP status as string, or one of: "network error", "timeout",
   * "cancelled", "client", "backend-error".
   */
  status: string;
  /** Job ID if known at the time of failure. */
  jobId?: string;
  /** Raw error message / stack for the technical-details `<pre>`. */
  raw: string;
  /** ISO timestamp of failure. */
  at: string;
}

export class SeparationError extends Error {
  details: SeparationErrorDetails;
  constructor(details: SeparationErrorDetails) {
    super(details.message);
    this.name = "SeparationError";
    this.details = details;
  }
}

interface ErrorResponse {
  detail?: string;
}

interface StartSeparationResponse {
  job_id: string;
  status: string;
}

interface JobStatusResponse {
  job_id: string;
  status: JobStatus["status"];
  progress: number;
  model: string;
  stems: StemStatus[];
  error: string | null;
}

interface HealthResponse {
  gpu: boolean;
  models: string[];
}

function buildSeparationError(
  partial: Omit<SeparationErrorDetails, "at">
): SeparationError {
  return new SeparationError({
    ...partial,
    at: new Date().toISOString(),
  });
}

/**
 * Upload an audio file to the separation backend and start processing.
 */
export async function startSeparation(
  file: File,
  model: string,
  signal?: AbortSignal
): Promise<SeparationStartResult> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("model", model);
  const url = `${SEPARATION_API_URL}/separate`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      body: formData,
      signal,
    });
  } catch (e) {
    throw buildSeparationError({
      message: "Couldn't reach the separation service",
      url,
      status: "network error",
      raw: e instanceof Error ? (e.stack ?? e.message) : String(e),
    });
  }

  if (!response.ok) {
    const err = (await response
      .json()
      .catch(() => ({ detail: "Unknown error" }))) as ErrorResponse;
    throw buildSeparationError({
      message: err.detail ?? `Separation failed: ${response.status}`,
      url,
      status: String(response.status),
      raw: JSON.stringify(err),
    });
  }

  const data = (await response.json()) as StartSeparationResponse;
  return { jobId: data.job_id, status: data.status };
}

/**
 * Poll the status of a separation job.
 */
export async function pollJobStatus(
  jobId: string,
  signal?: AbortSignal
): Promise<JobStatus> {
  const url = `${SEPARATION_API_URL}/jobs/${jobId}/status`;
  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (e) {
    throw buildSeparationError({
      message: "Couldn't reach the separation service",
      url,
      status: "network error",
      jobId,
      raw: e instanceof Error ? (e.stack ?? e.message) : String(e),
    });
  }

  if (!response.ok) {
    const err = (await response
      .json()
      .catch(() => ({ detail: "Unknown error" }))) as ErrorResponse;
    throw buildSeparationError({
      message: err.detail ?? `Status check failed: ${response.status}`,
      url,
      status: String(response.status),
      jobId,
      raw: JSON.stringify(err),
    });
  }

  const data = (await response.json()) as JobStatusResponse;
  return {
    jobId: data.job_id,
    status: data.status,
    progress: data.progress,
    model: data.model,
    stems: data.stems,
    error: data.error,
  };
}

/**
 * Download a separated stem as an ArrayBuffer.
 */
export async function downloadStem(
  jobId: string,
  stemName: string
): Promise<ArrayBuffer> {
  const response = await fetch(
    `${SEPARATION_API_URL}/jobs/${jobId}/stems/${stemName}`
  );

  if (!response.ok) {
    const err = (await response
      .json()
      .catch(() => ({ detail: "Unknown error" }))) as ErrorResponse;
    throw new Error(err.detail ?? `Download failed: ${response.status}`);
  }

  return response.arrayBuffer();
}

/**
 * Check if the separation backend is reachable.
 */
export async function checkBackendHealth(): Promise<{
  ok: boolean;
  gpu: boolean;
  models: string[];
}> {
  try {
    const response = await fetch(`${SEPARATION_API_URL}/health`);
    if (!response.ok) return { ok: false, gpu: false, models: [] };
    const data = (await response.json()) as HealthResponse;
    return { ok: true, gpu: data.gpu, models: data.models };
  } catch {
    return { ok: false, gpu: false, models: [] };
  }
}
