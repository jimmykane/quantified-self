import { describe, expect, it } from 'vitest';
import { isMergeOrBenchmarkEvent } from './event-visibility.helper';

describe('event-visibility.helper', () => {
  it('returns false when event is missing', () => {
    expect(isMergeOrBenchmarkEvent(undefined)).toBe(false);
    expect(isMergeOrBenchmarkEvent(null)).toBe(false);
  });

  it('returns true for merge events', () => {
    expect(isMergeOrBenchmarkEvent({ isMerge: true } as any)).toBe(true);
  });

  it('returns true for benchmark events by hasBenchmark', () => {
    expect(isMergeOrBenchmarkEvent({ isMerge: false, hasBenchmark: true } as any)).toBe(true);
  });

  it('returns true for benchmark events by benchmark fields', () => {
    expect(isMergeOrBenchmarkEvent({ isMerge: false, benchmarkResults: { key: {} } } as any)).toBe(true);
    expect(isMergeOrBenchmarkEvent({ isMerge: false, benchmarkResult: {} } as any)).toBe(true);
    expect(isMergeOrBenchmarkEvent({ isMerge: false, benchmarkDevices: ['A'] } as any)).toBe(true);
  });

  it('returns false for regular non-merge events', () => {
    expect(isMergeOrBenchmarkEvent({ isMerge: false } as any)).toBe(false);
  });
});
