"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
} from "react";

/**
 * Cloudflare Turnstile bot-protection gate for the R2 upload control plane.
 *
 * NEEDS: `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (public, in wrangler.jsonc) + the
 * Worker secret `TURNSTILE_SECRET` (`wrangler secret put`, backend) to activate.
 * When the site key is ABSENT (local dev / tests) the gate renders nothing and
 * yields an empty token, so callers transparently fall back to the legacy
 * upload path — nothing is gated off.
 */

/** Public Turnstile site key, or null when not configured. */
export function getTurnstileSiteKey(): string | null {
  const key = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  return key && key.length > 0 ? key : null;
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";
const SCRIPT_ID = "cf-turnstile-script";

interface TurnstileApi {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback"?: () => void;
      "error-callback"?: () => void;
    },
  ) => string;
  reset: (id?: string) => void;
  remove: (id?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

function loadTurnstileScript(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof document === "undefined" || window.turnstile) return resolve();
    let s = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (!s) {
      s = document.createElement("script");
      s.id = SCRIPT_ID;
      s.src = SCRIPT_SRC;
      s.async = true;
      s.defer = true;
      document.head.appendChild(s);
    }
    s.addEventListener("load", () => resolve(), { once: true });
    const poll = () => (window.turnstile ? resolve() : setTimeout(poll, 50));
    poll();
  });
}

/**
 * Managed Turnstile widget. Calls `onToken` with a verification token (or "" on
 * expiry/error). Renders nothing when no site key is configured.
 */
export function TurnstileGate({
  onToken,
}: {
  onToken: (token: string) => void;
}): ReactElement | null {
  const siteKey = getTurnstileSiteKey();
  const ref = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    if (!siteKey || !ref.current) return;
    let cancelled = false;
    void loadTurnstileScript().then(() => {
      if (cancelled || !ref.current || !window.turnstile) return;
      widgetId.current = window.turnstile.render(ref.current, {
        sitekey: siteKey,
        callback: (token) => onToken(token),
        "expired-callback": () => onToken(""),
        "error-callback": () => onToken(""),
      });
    });
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetId.current);
        } catch {
          /* widget already gone */
        }
      }
    };
  }, [siteKey, onToken]);

  if (!siteKey) return null;
  return <div ref={ref} data-testid="turnstile-gate" className="cf-turnstile" />;
}

/**
 * Hook for entry points that start an upload. Returns the current token plus a
 * `gate` element to render. When Turnstile is not configured, `token` stays ""
 * and callers fall back to the legacy multipart upload.
 */
export function useTurnstileToken(): {
  token: string;
  /** Always-current token, safe to read inside event handlers (no stale closure). */
  tokenRef: RefObject<string>;
  siteKey: string | null;
  gate: ReactElement | null;
} {
  const [token, setToken] = useState("");
  const tokenRef = useRef("");
  const onToken = useCallback((t: string) => {
    tokenRef.current = t;
    setToken(t);
  }, []);
  const siteKey = getTurnstileSiteKey();
  const gate = siteKey ? <TurnstileGate onToken={onToken} /> : null;
  return { token, tokenRef, siteKey, gate };
}
