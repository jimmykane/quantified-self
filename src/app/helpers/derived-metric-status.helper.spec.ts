import { describe, expect, it } from 'vitest';
import {
  isDerivedMetricPendingStatus,
  resolveDerivedMetricsRefreshPhase,
} from './derived-metric-status.helper';

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

  it('resolves one route-level refresh phase with failures taking priority', () => {
    expect(resolveDerivedMetricsRefreshPhase(['ready', 'failed', 'stale'])).toBe('failed');
    expect(resolveDerivedMetricsRefreshPhase(['ready', 'stale', 'building'])).toBe('refreshing');
    expect(resolveDerivedMetricsRefreshPhase(['ready', 'queued'])).toBe('building');
    expect(resolveDerivedMetricsRefreshPhase(['ready', 'missing'])).toBe('building');
    expect(resolveDerivedMetricsRefreshPhase(['ready', 'ready'])).toBeNull();
    expect(resolveDerivedMetricsRefreshPhase([])).toBeNull();
  });
});
