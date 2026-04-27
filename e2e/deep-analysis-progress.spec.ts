/**
 * E2E for the Deep Analysis progress + error UX (plan TS-001..TS-005).
 *
 * Hermetic: the backend is mocked at the network layer via `page.route`.
 * No live FastAPI / Demucs needed — tests can run in CI without `docker
 * compose up backend`.
 */

import { expect, test, type Page, type Route } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_WAV = path.join(__dirname, "fixtures", "test-audio.wav");
const JOB_ID = "test-job-123";
const TRACE_HEX = "0123456789abcdef0123456789abcdef";
const SPAN_HEX = "0011223344556677";
const TRACEPARENT = `00-${TRACE_HEX}-${SPAN_HEX}-01`;

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

/** Convenience for matching any host hitting `/path`. */
const url = (suffix: string) => `**${suffix}`;

test.describe("TS-001 — happy path: progress visible at every phase", () => {
  test("progress card cycles through sections → stems → done", async ({ page }) => {
    let pollCount = 0;
    await page.route(url("/analyze/deep"), (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ job_id: JOB_ID, status: "queued" }),
      })
    );
    await page.route(url(`/jobs/${JOB_ID}/status`), (route: Route) => {
      pollCount++;
      let body: Record<string, unknown>;
      if (pollCount === 1) {
        body = {
          job_id: JOB_ID,
          status: "processing",
          progress: 40,
          model: "modern_pop_polish",
          job_type: "deep_analysis",
          partial_result: { sections: [] },
          error: null,
        };
      } else if (pollCount === 2) {
        body = {
          job_id: JOB_ID,
          status: "processing",
          progress: 80,
          model: "modern_pop_polish",
          job_type: "deep_analysis",
          partial_result: { sections: [], stems: [] },
          error: null,
        };
      } else {
        body = {
          job_id: JOB_ID,
          status: "done",
          progress: 100,
          model: "modern_pop_polish",
          job_type: "deep_analysis",
          partial_result: {},
          error: null,
        };
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    });
    await page.route(url(`/jobs/${JOB_ID}/result`), (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          version: 1,
          trackId: "t1",
          sampleRate: 48000,
          duration: 30,
          profile: "modern_pop_polish",
          sections: [],
          moves: [],
        }),
      })
    );

    await uploadAndOpenDeep(page);
    await page.getByTestId("deep-analyze-button").click();

    const card = page.getByTestId("deep-progress-card");
    await expect(card).toBeVisible();
    // Progress bar reaches 80%+ before completing
    await expect(page.getByTestId("deep-progress-stage-stems")).toHaveAttribute(
      "data-active",
      "true",
      { timeout: 5_000 }
    );
    // Card disappears once we hit done
    await expect(card).toBeHidden({ timeout: 5_000 });
  });
});

test.describe("TS-002 — backend down: error with Retry + technical details", () => {
  test("network failure → error UI with URL/status/raw + Retry restarts", async ({
    page,
  }) => {
    let attempt = 0;
    await page.route(url("/analyze/deep"), (route: Route) => {
      attempt++;
      if (attempt === 1) return route.abort("failed");
      // Second attempt (retry) succeeds
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
        body: JSON.stringify({
          job_id: JOB_ID,
          status: "done",
          progress: 100,
          model: "modern_pop_polish",
          job_type: "deep_analysis",
          partial_result: {},
          error: null,
        }),
      })
    );
    await page.route(url(`/jobs/${JOB_ID}/result`), (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          version: 1,
          trackId: "t1",
          sampleRate: 48000,
          duration: 30,
          profile: "modern_pop_polish",
          sections: [],
          moves: [],
        }),
      })
    );

    await uploadAndOpenDeep(page);
    await page.getByTestId("deep-analyze-button").click();

    // Error UI appears
    const errorBox = page.getByTestId("deep-progress-error");
    await expect(errorBox).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("deep-progress-error-message")).toContainText(
      /(reach|failed|error)/i
    );

    // Show details reveals technical fields
    await page.getByTestId("deep-progress-details-toggle").click();
    const details = page.getByTestId("deep-progress-error-details");
    await expect(details).toBeVisible();
    await expect(details).toContainText("/analyze/deep");
    await expect(details).toContainText(/network error/i);

    // Retry restarts the flow and succeeds on attempt #2
    await page.getByTestId("deep-progress-retry").click();
    await expect(errorBox).toBeHidden({ timeout: 5_000 });
  });

  test("HTTP error response surfaces traceparent trace ID in details", async ({
    page,
  }) => {
    await uploadAndOpenDeep(page);
    // Set up the failing route AFTER navigation so page bootstrap isn't
    // affected by it (Next.js may issue probes that match `**/analyze/deep`
    // patterns under heavy dev-server load).
    await page.route(url("/analyze/deep"), (route: Route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        // CORS expose-headers because Playwright's mock is cross-origin
        // (3000 -> 8000); without this the browser hides `traceparent`
        // from JS, mirroring production CORS.
        headers: {
          traceparent: TRACEPARENT,
          "access-control-expose-headers": "traceparent",
          "access-control-allow-origin": "*",
        },
        body: JSON.stringify({ detail: "Internal server error" }),
      })
    );
    await page.getByTestId("deep-analyze-button").click();

    await expect(page.getByTestId("deep-progress-error")).toBeVisible({
      timeout: 5_000,
    });
    await page.getByTestId("deep-progress-details-toggle").click();
    await expect(page.getByTestId("deep-progress-error-details")).toContainText(
      TRACE_HEX
    );
  });
});

test.describe("TS-003 — cancel mid-job", () => {
  test("Cancel returns to idle when backend honors", async ({ page }) => {
    let polls = 0;
    let deleted = false;
    await page.route(url("/analyze/deep"), (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ job_id: JOB_ID, status: "queued" }),
      })
    );
    await page.route(url(`/jobs/${JOB_ID}/status`), (route: Route) => {
      polls++;
      if (deleted) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            job_id: JOB_ID,
            status: "error",
            progress: 50,
            model: "modern_pop_polish",
            job_type: "deep_analysis",
            partial_result: {},
            error: "Cancelled by user",
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          job_id: JOB_ID,
          status: "processing",
          progress: polls * 20,
          model: "modern_pop_polish",
          job_type: "deep_analysis",
          partial_result: { sections: [] },
          error: null,
        }),
      });
    });
    await page.route(url(`/jobs/${JOB_ID}`), (route: Route) => {
      if (route.request().method() === "DELETE") {
        deleted = true;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            job_id: JOB_ID,
            status: "processing",
            cancelled: true,
          }),
        });
      }
      return route.continue();
    });

    await uploadAndOpenDeep(page);
    await page.getByTestId("deep-analyze-button").click();
    await expect(page.getByTestId("deep-progress-card")).toBeVisible();

    await page.getByTestId("deep-progress-cancel").click();
    await expect(page.getByTestId("deep-progress-cancelling-note")).toBeVisible();
    await expect(page.getByTestId("deep-progress-cancel")).toBeDisabled();

    // Backend reports cancellation; UI returns to idle
    await expect(page.getByTestId("deep-progress-card")).toBeHidden({
      timeout: 5_000,
    });
    await expect(page.getByTestId("deep-analyze-button")).toBeEnabled();
  });
});

/*
 * TS-004 (10-min total-cap timeout) — covered by Vitest unit test
 * `src/lib/api/__tests__/deep-analysis-polling.test.ts` ("aborts after total
 * cap with status 'timeout'"). Driving 600 polling iterations through
 * Playwright's mock clock + cross-process fetch chain proved flaky (the
 * mocked setTimeout fires but each poll's real fetch IPC doesn't drain
 * deterministically). The behavior under test is purely time-based logic in
 * `pollUntilDone`, fully exercised by fake timers in unit tests. The error
 * UI rendering for timeout-shaped DeepErrorDetails is exercised by TS-002.
 */

test.describe("TS-005 — transient poll failures", () => {
  test("404 mid-poll aborts immediately (no 3-strikes wait)", async ({ page }) => {
    let polls = 0;
    await page.route(url("/analyze/deep"), (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ job_id: JOB_ID, status: "queued" }),
      })
    );
    await page.route(url(`/jobs/${JOB_ID}/status`), (route: Route) => {
      polls++;
      if (polls === 1) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            job_id: JOB_ID,
            status: "processing",
            progress: 20,
            model: "modern_pop_polish",
            job_type: "deep_analysis",
            partial_result: {},
            error: null,
          }),
        });
      }
      // Second poll: 404 → aborts immediately, no retries
      return route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Job not found" }),
      });
    });

    await uploadAndOpenDeep(page);
    await page.getByTestId("deep-analyze-button").click();
    await expect(page.getByTestId("deep-progress-card")).toBeVisible();

    // 404 aborts immediately; error appears within ~2s
    await expect(page.getByTestId("deep-progress-error")).toBeVisible({
      timeout: 4_000,
    });
    await page.getByTestId("deep-progress-details-toggle").click();
    await expect(page.getByTestId("deep-progress-error-details")).toContainText(
      "404"
    );
  });
});
