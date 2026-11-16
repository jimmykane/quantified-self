import { EventInterface } from '@sports-alliance/sports-lib';
import { isBenchmarkEvent as isPersistedBenchmarkEvent } from '@shared/event-classification';

type BenchmarkAwareEvent = EventInterface & {
  hasBenchmark?: boolean;
  benchmarkResults?: unknown;
  benchmarkResult?: unknown;
  benchmarkDevices?: unknown[];
};

export function isMergeOrBenchmarkEvent(event: EventInterface | null | undefined): boolean {
  return event?.isMerge === true || isPersistedBenchmarkEvent(event) || isBenchmarkEvent(event);
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
