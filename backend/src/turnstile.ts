/**
 * Cloudflare Turnstile token verification.
 *
 * Workers POSTs the token to challenges.cloudflare.com/turnstile/v0/siteverify
 * with the secret key. Returns true iff the token is valid AND was issued for
 * the expected action.
 *
 * Action values:
 *   "upload-initiate" — gates POST /upload/initiate
 *   "upload-complete" — gates POST /upload/complete
 * Validating on BOTH endpoints caps per-session abuse — a stolen token can't
 * drive an unbounded multipart upload because /upload/complete demands a
 * fresh token.
 */

const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

interface SiteverifyResponse {
  success: boolean;
  action?: string;
  "error-codes"?: string[];
}

export async function verifyTurnstile(
  token: string,
  expectedAction: "upload-initiate" | "upload-complete",
  remoteIp: string | null,
  env: Pick<Env, "TURNSTILE_SECRET_KEY">
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!token) return { ok: false, reason: "missing_token" };

  const body = new URLSearchParams({
    secret: env.TURNSTILE_SECRET_KEY,
    response: token,
  });
  if (remoteIp) body.set("remoteip", remoteIp);

  const res = await fetch(SITEVERIFY_URL, {
    method: "POST",
    body,
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
  if (!res.ok) {
    return { ok: false, reason: `siteverify_http_${res.status}` };
  }
  const data = (await res.json()) as SiteverifyResponse;
  if (!data.success) {
    const codes = (data["error-codes"] ?? []).join(",") || "unknown";
    return { ok: false, reason: `siteverify_failed:${codes}` };
  }
  if (data.action && data.action !== expectedAction) {
    return { ok: false, reason: `action_mismatch:${data.action}` };
  }
  return { ok: true };
}
