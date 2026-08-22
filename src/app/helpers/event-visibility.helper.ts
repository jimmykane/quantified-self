import { EventInterface } from '@sports-alliance/sports-lib';

type BenchmarkAwareEvent = EventInterface & {
  hasBenchmark?: boolean;
  benchmarkResults?: unknown;
  benchmarkResult?: unknown;
  benchmarkDevices?: unknown[];
};

export function isMergeOrBenchmarkEvent(event: EventInterface | null | undefined): boolean {
  return event?.isMerge === true || isBenchmarkEvent(event);
}

export function isBenchmarkEvent(event: EventInterface | null | undefined): boolean {
  const benchmarkAwareEvent = event as BenchmarkAwareEvent | null | undefined;
  if (!benchmarkAwareEvent) {
    return false;
  }

  return benchmarkAwareEvent.hasBenchmark === true
    || !!benchmarkAwareEvent.benchmarkResults
    || !!benchmarkAwareEvent.benchmarkResult
    || (Array.isArray(benchmarkAwareEvent.benchmarkDevices) && benchmarkAwareEvent.benchmarkDevices.length > 0);
}
