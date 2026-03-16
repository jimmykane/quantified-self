import { describe, it, expect } from 'vitest';
import { BenchmarkEventAdapter } from './benchmark-event.adapter';
import { AppEventInterface, BenchmarkResult } from '@shared/app-event.interface';

describe('BenchmarkEventAdapter', () => {
  const adapter = new BenchmarkEventAdapter();

  const makeTimestamp = (date: Date) => ({
    toDate: () => date,
  });

  const makeResult = (overrides: Partial<BenchmarkResult> = {}): BenchmarkResult => ({
    referenceId: 'ref-1',
    testId: 'test-1',
    referenceName: 'Garmin   Forerunner 265',
    testName: 'COROS PACE 3',
    timestamp: new Date('2024-01-01T10:00:00Z'),
    metrics: {
      gnss: { cep50: 0, cep95: 0, maxDeviation: 0, rmse: 0, totalDistanceDifference: 0 },
      streamMetrics: {}
    },
    ...overrides,
  });

  it('no-ops when rawData is falsy', () => {
    const event = {} as AppEventInterface;
    adapter.applyBenchmarkFieldsFromFirestore(event, null);
    expect(event.benchmarkResults).toBeUndefined();
    expect(event.hasBenchmark).toBeUndefined();
  });

  it('hydrates benchmark results, normalizes devices, and derives index fields', () => {
    const event = {} as AppEventInterface;
    const ts1 = new Date('2024-01-01T10:00:00Z');
    const ts2 = new Date('2024-01-02T12:00:00Z');

    const rawData = {
      benchmarkResults: {
        'ref-1_test-1': makeResult({
          timestamp: makeTimestamp(ts1) as unknown as Date,
          qualityIssues: [{ type: 'dropout', streamType: 'HeartRate', description: 'x', severity: 'warning', timestamp: makeTimestamp(ts1) as unknown as Date }]
        }),
        'ref-2_test-2': makeResult({
          referenceName: 'Suunto  9 Peak',
          testName: 'Garmin Forerunner 265',
          timestamp: makeTimestamp(ts2) as unknown as Date,
        })
      }
    };

    adapter.applyBenchmarkFieldsFromFirestore(event, rawData);

    expect(Object.keys(event.benchmarkResults || {})).toHaveLength(2);
    expect(event.hasBenchmark).toBe(true);
    expect(event.benchmarkDevices?.sort()).toEqual([
      'coros pace 3',
      'garmin forerunner 265',
      'suunto 9 peak',
    ]);
    expect(event.benchmarkLatestAt?.toISOString()).toBe(ts2.toISOString());
    const hydratedIssue = event.benchmarkResults?.['ref-1_test-1']?.qualityIssues?.[0];
    expect(hydratedIssue?.timestamp).toBeInstanceOf(Date);
  });

  it('respects provided index fields and does not override them', () => {
    const event = {} as AppEventInterface;
    const fixedDate = new Date('2024-01-03T08:00:00Z');

    const rawData = {
      hasBenchmark: false,
      benchmarkDevices: ['custom device'],
      benchmarkLatestAt: makeTimestamp(fixedDate),
      benchmarkResults: {
        'ref-1_test-1': makeResult(),
      }
    };

    adapter.applyBenchmarkFieldsFromFirestore(event, rawData);

    expect(event.hasBenchmark).toBe(false);
    expect(event.benchmarkDevices).toEqual(['custom device']);
    expect(event.benchmarkLatestAt?.toISOString()).toBe(fixedDate.toISOString());
  });
});
