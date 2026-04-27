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

/**
 * Upload an audio file to the separation backend and start processing.
 */
export async function startSeparation(
  file: File,
  model: string
): Promise<SeparationStartResult> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("model", model);

  const response = await fetch(`${SEPARATION_API_URL}/separate`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const err = (await response
      .json()
      .catch(() => ({ detail: "Unknown error" }))) as ErrorResponse;
    throw new Error(err.detail ?? `Separation failed: ${response.status}`);
  }

  const data = (await response.json()) as StartSeparationResponse;
  return { jobId: data.job_id, status: data.status };
}

/**
 * Poll the status of a separation job.
 */
export async function pollJobStatus(jobId: string): Promise<JobStatus> {
  const response = await fetch(`${SEPARATION_API_URL}/jobs/${jobId}/status`);

  if (!response.ok) {
    const err = (await response
      .json()
      .catch(() => ({ detail: "Unknown error" }))) as ErrorResponse;
    throw new Error(err.detail ?? `Status check failed: ${response.status}`);
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
