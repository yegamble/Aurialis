/**
 * Playwright global setup — generates test fixtures before any test runs.
 */
import { generateTestWav } from "./fixtures/generate-test-wav.js";

export default async function globalSetup() {
  generateTestWav();
}
