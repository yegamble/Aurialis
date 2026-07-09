import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // In CI, use the pre-built app (`pnpm run build` runs before E2E).
    // In dev, use the dev server for fast iteration.
    command: process.env.CI ? "pnpm run start" : "pnpm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    // The Next dev/prod server can take well over the 60s default to become
    // ready on a loaded machine; give it room so the suite doesn't false-fail
    // at boot.
    timeout: 180_000,
    // No global Turnstile site key: backend-driven specs (smart-split,
    // deep-mastering, mixer) run in honest no-site-key dev mode — the
    // dev-only multipart path. r2-upload.spec.ts enables the gate per-spec
    // via the __aurialisTurnstileSiteKey E2E seam (see e2e/helpers/turnstile.ts).
  },
});
