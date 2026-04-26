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

/** Start a deep-analysis job for the given audio file + profile. */
export async function startDeepAnalysis(
  file: File,
  profile: ProfileId
): Promise<DeepStartResult> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("profile", profile);

  const response = await fetch(`${DEEP_ANALYSIS_API_URL}/analyze/deep`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const err = await response
      .json()
      .catch(() => ({ detail: "Unknown error" }));
    throw new Error(err.detail ?? `Deep analysis failed: ${response.status}`);
  }

  const data = await response.json();
  return { jobId: data.job_id, status: data.status };
}

/** Poll deep-analysis job status. Computes a sub-status from `partial_result`. */
export async function pollDeepJobStatus(jobId: string): Promise<DeepJobStatus> {
  const response = await fetch(
    `${DEEP_ANALYSIS_API_URL}/jobs/${jobId}/status`
  );
  if (!response.ok) {
    const err = await response
      .json()
      .catch(() => ({ detail: "Unknown error" }));
    throw new Error(err.detail ?? `Status check failed: ${response.status}`);
  }
  const data = await response.json();
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
export async function fetchDeepResult(jobId: string): Promise<MasteringScript> {
  const response = await fetch(
    `${DEEP_ANALYSIS_API_URL}/jobs/${jobId}/result`
  );
  if (!response.ok) {
    const err = await response
      .json()
      .catch(() => ({ detail: "Unknown error" }));
    throw new Error(err.detail ?? `Result fetch failed: ${response.status}`);
  }
  return (await response.json()) as MasteringScript;
}
