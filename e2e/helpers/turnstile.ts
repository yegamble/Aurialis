import type { Page } from "@playwright/test";

/**
 * Neutralise Cloudflare Turnstile for a test: define `window.turnstile` before
 * app code runs so the gate never loads the remote script and its widget never
 * fires a token callback. The gate still renders its container div, but the
 * empty token forces the deterministic legacy multipart upload path.
 *
 * Needed because the Playwright webServer now sets a Cloudflare *test* site key
 * (so r2-upload.spec can exercise the direct-to-R2 path). Every other spec that
 * triggers a token-gated upload must opt out, or the always-passing test widget
 * would auto-issue a token and route uploads through the (unmocked) R2 control
 * plane.
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
