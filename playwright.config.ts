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
    env: {
      // Cloudflare's official always-passing test site key so the Turnstile
      // gate activates during E2E (exercising the direct-to-R2 upload path in
      // r2-upload.spec.ts instead of it self-skipping). Docs:
      // https://developers.cloudflare.com/turnstile/troubleshooting/testing/
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
    },
  },
});
