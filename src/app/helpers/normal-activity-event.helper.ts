/**
 * Calendar and range-based browsing deliberately omit generated comparison
 * records so they only represent recorded activities.
 */
export function isNormalActivityEvent<T extends object | null | undefined>(event: T): event is NonNullable<T> {
  if (!event) {
    return false;
  }

  const record = event as {
    isMerge?: unknown;
    hasBenchmark?: unknown;
    benchmarkResults?: unknown;
    benchmarkResult?: unknown;
    benchmarkDevices?: unknown;
  };
  return record.isMerge !== true
    && record.hasBenchmark !== true
    && !record.benchmarkResults
    && !record.benchmarkResult
    && !(Array.isArray(record.benchmarkDevices) && record.benchmarkDevices.length > 0);
}
