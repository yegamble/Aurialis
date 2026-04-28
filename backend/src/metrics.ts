/**
 * Workers Analytics Engine helpers.
 *
 * Used to count multipart_legacy_calls — the metric that gates Task 9 of the
 * direct-r2-upload plan. Removal of the legacy multipart endpoints requires
 * 0 hits in the trailing 48 hours.
 */

interface MetricsEnv {
  METRICS?: AnalyticsEngineDataset;
}

export function incrementCounter(
  env: MetricsEnv,
  name: string,
  labels: Record<string, string> = {}
): void {
  if (!env.METRICS) return; // no-op in dev / when binding absent
  const blobs: string[] = [name];
  for (const [k, v] of Object.entries(labels)) blobs.push(`${k}=${v}`);
  try {
    env.METRICS.writeDataPoint({ blobs, doubles: [1], indexes: [name] });
  } catch {
    // Analytics Engine writes are best-effort.
  }
}
