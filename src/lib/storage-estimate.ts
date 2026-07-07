/**
 * Human-readable byte formatting for the sidebar storage readout.
 * Deterministic, dependency-free.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  const rounded = value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
  return `${rounded} ${units[i]}`;
}

/**
 * Best-effort OPFS/quota usage via the Storage API. Resolves to the number of
 * bytes in use, or null when the API is unavailable or throws (graceful).
 */
export async function getStorageUsage(): Promise<number | null> {
  if (
    typeof navigator === "undefined" ||
    !navigator.storage ||
    typeof navigator.storage.estimate !== "function"
  ) {
    return null;
  }
  try {
    const estimate = await navigator.storage.estimate();
    return typeof estimate.usage === "number" ? estimate.usage : null;
  } catch {
    return null;
  }
}
