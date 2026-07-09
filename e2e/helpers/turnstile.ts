import type { Page } from "@playwright/test";

/**
 * Neutralise Cloudflare Turnstile for a test: define `window.turnstile` before
 * app code runs so the gate never loads the remote script and its widget never
 * fires a token callback. The gate still renders its container div, but the
 * empty token forces the deterministic legacy multipart upload path.
 *
 * The Playwright webServer runs WITHOUT a Turnstile site key, so specs run in
 * honest dev mode (multipart to the local backend) by default. Specs that need
 * the gate (r2-upload.spec.ts) enable it per-page via enableTurnstileGate();
 * the no-token stub remains for defensive determinism.
 */
export async function stubTurnstileNoToken(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { turnstile: unknown }).turnstile = {
      // Render the widget but never invoke the callback → token stays "".
      render: () => "widget-no-token",
      reset: () => {},
      remove: () => {},
    };
  });
}

/**
 * Stub Turnstile so it issues `token` synchronously on render — used by the
 * direct-to-R2 path test which needs a present token.
 */
export async function stubTurnstileWithToken(
  page: Page,
  token = "test-turnstile-token",
): Promise<void> {
  await page.addInitScript((t: string) => {
    (window as unknown as { turnstile: unknown }).turnstile = {
      render: (_el: HTMLElement, opts: { callback: (v: string) => void }) => {
        opts.callback(t);
        return "widget-1";
      },
      reset: () => {},
      remove: () => {},
    };
  }, token);
}

/**
 * Enable the Turnstile gate for THIS page only via the app's dev/E2E seam
 * (window.__aurialisTurnstileSiteKey, read by getTurnstileSiteKey). Under the
 * upload-strategy contract this makes the R2 path REQUIRED, so pair it with
 * stubTurnstileWithToken (R2 path) or stubTurnstileNoToken (error path).
 */
export async function enableTurnstileGate(
  page: Page,
  siteKey = "1x00000000000000000000AA",
): Promise<void> {
  await page.addInitScript((key: string) => {
    (
      window as unknown as { __aurialisTurnstileSiteKey?: string }
    ).__aurialisTurnstileSiteKey = key;
  }, siteKey);
}
