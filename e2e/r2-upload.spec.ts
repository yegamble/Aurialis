/**
 * E2E for the browser upload transport selection (plan G · R2 test debt).
 *
 * Two paths share the `/analyze/deep` entry point in
 * `src/lib/api/deep-analysis.ts`:
 *
 *   - DIRECT-TO-R2 (JSON): taken when a Cloudflare Turnstile token is present.
 *     The browser uploads the file straight to R2 through the Worker control
 *     plane (`/upload/initiate` → PUT presigned parts → `/upload/complete`),
 *     then POSTs `application/json` `{ key, profile }` to `/analyze/deep`.
 *   - LEGACY MULTIPART: the fallback when no token exists — the whole file is
 *     POSTed as `multipart/form-data` to `/analyze/deep`.
 *
 * Hermetic: every backend + Worker endpoint is mocked at the network layer via
 * `page.route`; no live Worker / FastAPI / Demucs is contacted. Turnstile's
 * remote script is stubbed via `addInitScript` so no cross-origin request to
 * challenges.cloudflare.com is made.
 *
 * NOTE ON THE R2 PATH TEST: the token only exists when
 * `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is configured for the dev/preview server.
 * It is NOT set in the default Playwright webServer env, so the Turnstile gate
 * renders nothing and the browser always falls back to multipart. The R2-path
 * test therefore self-skips when the gate is absent (rather than asserting a
 * flow the environment cannot produce). To make it run, the webServer needs
 * `env: { NEXT_PUBLIC_TURNSTILE_SITE_KEY: "<cloudflare test key>" }` — see the
 * agent report's interface notes. The multipart-fallback test below runs
 * unconditionally and is the deterministic guarantee in CI.
 */

import { expect, test, type Page, type Route } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_WAV = path.join(__dirname, "fixtures", "test-audio.wav");
const JOB_ID = "r2-upload-job-1";
const R2_KEY = "uploads/abc123.wav";

/** Convenience for matching any host hitting `/path`. */
const url = (suffix: string) => `**${suffix}`;

async function uploadAndOpenDeep(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: /upload audio file/i })
    .waitFor({ state: "visible" });
  await page.locator('input[type="file"]').setInputFiles(TEST_WAV);
  await page.waitForURL("**/master", { timeout: 30_000 });
  await page.getByTestId("mode-toggle-deep").click();
  await expect(page.getByTestId("deep-mastering-panel")).toBeVisible();
}

/** A terminal "done" status body so the flow settles after start. */
function doneStatus() {
  return {
    job_id: JOB_ID,
    status: "done",
    progress: 100,
    model: "modern_pop_polish",
    job_type: "deep_analysis",
    partial_result: {},
    error: null,
  };
}

function doneResult() {
  return {
    version: 1,
    trackId: "t1",
    sampleRate: 48000,
    duration: 30,
    profile: "modern_pop_polish",
    sections: [],
    moves: [],
  };
}

test.describe("R2 upload transport selection", () => {
  test("no Turnstile token → legacy multipart POST, no R2 control-plane calls", async ({
    page,
  }) => {
    let initiateCalls = 0;
    let analyzeContentType: string | null = null;
    let analyzeIsMultipart = false;

    // The R2 control plane must NEVER be hit on the fallback path.
    await page.route(url("/upload/initiate"), (route: Route) => {
      initiateCalls++;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          uploadId: "u1",
          key: R2_KEY,
          chunkSize: 8 * 1024 * 1024,
          partUrls: [{ partNumber: 1, url: "https://r2.mock/part/1" }],
        }),
      });
    });

    await page.route(url("/analyze/deep"), (route: Route) => {
      const req = route.request();
      analyzeContentType = req.headers()["content-type"] ?? null;
      analyzeIsMultipart = (analyzeContentType ?? "").includes(
        "multipart/form-data",
      );
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ job_id: JOB_ID, status: "queued" }),
      });
    });
    await page.route(url(`/jobs/${JOB_ID}/status`), (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(doneStatus()),
      }),
    );
    await page.route(url(`/jobs/${JOB_ID}/result`), (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(doneResult()),
      }),
    );

    await uploadAndOpenDeep(page);
    // In the default env the Turnstile gate is absent → guaranteed fallback.
    await expect(page.getByTestId("turnstile-gate")).toHaveCount(0);

    await page.getByTestId("deep-analyze-button").click();

    // The job started (card appears then hides on done), proving the POST fired.
    await expect(page.getByTestId("deep-progress-card")).toBeHidden({
      timeout: 15_000,
    });

    expect(analyzeIsMultipart).toBe(true);
    expect(analyzeContentType).toContain("multipart/form-data");
    // No direct-to-R2 upload was attempted.
    expect(initiateCalls).toBe(0);
  });

  test("with a Turnstile token → direct-to-R2 upload then JSON { key, profile }", async ({
    page,
  }) => {
    // Stub the Turnstile widget BEFORE app code runs so no remote script loads
    // and the gate yields a token synchronously (only matters when a site key
    // is configured; otherwise the gate never renders and we skip below).
    await page.addInitScript(() => {
      // @ts-expect-error - injected test double for the Turnstile global.
      window.turnstile = {
        render: (
          _el: HTMLElement,
          opts: { callback: (t: string) => void },
        ) => {
          opts.callback("test-turnstile-token");
          return "widget-1";
        },
        reset: () => {},
        remove: () => {},
      };
    });
    // Defensively block the real Turnstile script (hermetic guarantee).
    await page.route(
      "https://challenges.cloudflare.com/**",
      (route: Route) => route.abort(),
    );

    const initiateBodies: unknown[] = [];
    let partPutCount = 0;
    let completeCalls = 0;
    let analyzeContentType: string | null = null;
    let analyzeJsonBody: { key?: string; profile?: string } | null = null;

    await page.route(url("/upload/initiate"), async (route: Route) => {
      initiateBodies.push(route.request().postDataJSON());
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          uploadId: "u1",
          key: R2_KEY,
          // Single part covering the whole fixture (~344 KB < 8 MB).
          chunkSize: 8 * 1024 * 1024,
          partUrls: [{ partNumber: 1, url: "https://r2.mock/part/1" }],
        }),
      });
    });
    await page.route("https://r2.mock/part/1", (route: Route) => {
      partPutCount++;
      return route.fulfill({
        status: 200,
        headers: { etag: '"etag-part-1"' },
        body: "",
      });
    });
    await page.route(url("/upload/complete"), (route: Route) => {
      completeCalls++;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ key: R2_KEY }),
      });
    });
    await page.route(url("/analyze/deep"), (route: Route) => {
      const req = route.request();
      analyzeContentType = req.headers()["content-type"] ?? null;
      analyzeJsonBody = req.postDataJSON();
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ job_id: JOB_ID, status: "queued" }),
      });
    });
    await page.route(url(`/jobs/${JOB_ID}/status`), (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(doneStatus()),
      }),
    );
    await page.route(url(`/jobs/${JOB_ID}/result`), (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(doneResult()),
      }),
    );

    await uploadAndOpenDeep(page);

    const gateCount = await page.getByTestId("turnstile-gate").count();
    test.skip(
      gateCount === 0,
      "NEXT_PUBLIC_TURNSTILE_SITE_KEY not configured — Turnstile gate absent, " +
        "browser cannot obtain a token so the R2/JSON path is unreachable here. " +
        "Set the webServer env to a Cloudflare test key to exercise this path.",
    );

    await page.getByTestId("deep-analyze-button").click();

    await expect(page.getByTestId("deep-progress-card")).toBeHidden({
      timeout: 15_000,
    });

    // R2 control plane was driven in order: initiate → PUT part → complete.
    expect(initiateBodies.length).toBe(1);
    expect(partPutCount).toBe(1);
    expect(completeCalls).toBe(1);

    // The analyze request carried the R2 key as JSON, not a multipart file.
    expect(analyzeContentType).toContain("application/json");
    expect(analyzeJsonBody).toMatchObject({
      key: R2_KEY,
      profile: expect.any(String),
    });
  });
});
