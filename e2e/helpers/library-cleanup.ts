/**
 * Helper for clearing the library state between E2E tests.
 *
 * Wraps OPFS removeEntry + IDB deleteDatabase in try/catch so beforeEach
 * succeeds on a fresh browser context where neither has been created yet.
 */

import type { Page } from "@playwright/test";

export async function clearLibraryStorage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    // OPFS — may throw NotFoundError on first run.
    try {
      const root = await navigator.storage?.getDirectory?.();
      if (root) await root.removeEntry("library", { recursive: true });
    } catch (e) {
      if ((e as Error).name !== "NotFoundError") throw e;
    }

    // IDB — both databases. Resolve on success, error, or blocked.
    const deleteDb = (name: string): Promise<void> =>
      new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
      });
    await deleteDb("aurialis-library-entries-v1");
    await deleteDb("aurialis-library-prefs-v1");
  });
}
