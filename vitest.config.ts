import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/test/**",
        "src/**/*.test.{ts,tsx}",
        "src/**/*.spec.{ts,tsx}",
        // UI components and pages are tested via Playwright E2E — exclude from unit coverage
        "src/app/**",
        "src/components/**",
        "src/hooks/**",
        // AudioWorklet processors run inside AudioWorkletGlobalScope which
        // Vitest's coverage instrumenter cannot enter. They are verified
        // indirectly by the parity tests (parametric-eq-parity, multiband-parity,
        // halfband-parity), the envelope-scheduler unit tests, and the
        // Playwright E2E spec. Per T18 — see plan doc 2026-04-25-ai-deep-mastering-mode.md.
        "src/worklets/**",
        "public/worklets/**",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
      },
    },
  },
});
