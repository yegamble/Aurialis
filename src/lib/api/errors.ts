/**
 * Shared backend error type for the Aurialis API clients (R2 upload, deep
 * analysis, separation). Extracted from the original `DeepAnalysisError` shape
 * so every client surfaces the same structured failure metadata to the UI.
 */

export interface BackendErrorDetails {
  /** Human-readable summary for the UI's headline. */
  message: string;
  /** Request URL that failed. Undefined for client-side errors. */
  url?: string;
  /**
   * HTTP status as string, or one of: "network error", "timeout", "cancelled",
   * "client", "backend-error", "upload-part-error".
   */
  status: string;
  /** Job ID if known at the time of failure. */
  jobId?: string;
  /** W3C trace ID parsed from a `traceparent` response header, if present. */
  traceId?: string;
  /** Raw error message / stack for the technical-details view. */
  raw: string;
  /** ISO timestamp of failure. */
  at: string;
}

export class BackendError extends Error {
  readonly details: BackendErrorDetails;
  constructor(details: BackendErrorDetails) {
    super(details.message);
    this.name = "BackendError";
    this.details = details;
  }
}

/**
 * Build a `BackendError`, stamping `at` and logging a queryable JSON line.
 * `injectedNow` lets tests pass a deterministic timestamp.
 */
export function buildBackendError(
  partial: Omit<BackendErrorDetails, "at">,
  injectedNow?: () => string,
): BackendError {
  const at = injectedNow ? injectedNow() : new Date().toISOString();
  const details: BackendErrorDetails = { ...partial, at };
  try {
    console.error(JSON.stringify(details));
  } catch {
    console.error(details.message);
  }
  return new BackendError(details);
}
