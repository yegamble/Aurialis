/**
 * Upload transport decision — shared by deep-analysis and separation.
 *
 * Contract (locked in when the R2 cutover was live-verified 2026-07-08):
 *   - Turnstile site key CONFIGURED (production/staging): the direct-to-R2
 *     path is REQUIRED. A missing token (expired/failed challenge) is a
 *     user-facing error — never a silent multipart fallback, which would
 *     bypass the Worker's abuse gate.
 *   - Site key NOT configured (local dev / docker compose — no Worker
 *     exists locally): the direct-to-backend multipart path is used. This
 *     is the dev-only path; the FastAPI multipart endpoints exist for it.
 */

import { getTurnstileSiteKey } from "@/components/security/TurnstileGate";

export type UploadStrategy =
  | { kind: "r2"; token: string }
  | { kind: "multipart" };

/** Thrown when Turnstile is configured but no token is available. */
export class TurnstileRequiredError extends Error {
  constructor() {
    super("Verification required — retry the security check");
    this.name = "TurnstileRequiredError";
  }
}

export function resolveUploadStrategy(
  turnstileToken: string | null | undefined,
  siteKeyConfigured: boolean = getTurnstileSiteKey() !== null,
): UploadStrategy {
  if (!siteKeyConfigured) return { kind: "multipart" };
  if (turnstileToken) return { kind: "r2", token: turnstileToken };
  throw new TurnstileRequiredError();
}
