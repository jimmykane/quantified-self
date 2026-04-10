import { describe, expect, it } from 'vitest';
import { isDerivedMetricPendingStatus } from './derived-metric-status.helper';

describe('derived-metric-status.helper', () => {
  it('returns true for pending statuses used by derived dashboards', () => {
    expect(isDerivedMetricPendingStatus('building')).toBe(true);
    expect(isDerivedMetricPendingStatus('stale')).toBe(true);
    expect(isDerivedMetricPendingStatus('queued')).toBe(true);
    expect(isDerivedMetricPendingStatus('processing')).toBe(true);
  });

  it('returns false for non-pending statuses', () => {
    expect(isDerivedMetricPendingStatus('ready')).toBe(false);
    expect(isDerivedMetricPendingStatus('failed')).toBe(false);
    expect(isDerivedMetricPendingStatus('missing')).toBe(false);
    expect(isDerivedMetricPendingStatus(null)).toBe(false);
    expect(isDerivedMetricPendingStatus(undefined)).toBe(false);
  });
});
