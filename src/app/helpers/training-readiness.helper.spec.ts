import { describe, expect, it } from 'vitest';
import { buildTrainingReadinessViewModel } from './training-readiness.helper';

describe('training-readiness.helper', () => {
  it('formats the shared readiness evidence without turning it into a recommendation', () => {
    const view = buildTrainingReadinessViewModel({
      score: 82,
      label: 'Ready',
      confidence: 'high',
      availableSignalCount: 4,
      baselineEvidenceCount: 6,
      totalSignalCount: 4,
      form: 10,
      rampRate: 1,
      sleepScore: 90,
      latestSleepAtMs: Date.UTC(2026, 6, 16, 6),
      hrvRatio: 1.1,
      averageHeartRateRatio: 0.95,
      minimumHeartRateRatio: 0.96,
      overnightHeartRateRatio: 0.953,
      trend: [],
    }, { locale: 'en-US' });

    expect(view).toMatchObject({
      state: 'ready',
      label: 'Ready',
      scoreText: '82/100',
      confidenceText: 'High confidence',
      evidenceText: '4/4 signals',
      isUpdating: false,
    });
    expect(view.metricRows.map(row => [row.label, row.valueText])).toEqual([
      ['Load context', 'Form +10 · Ramp +1'],
      ['Sleep', '90/100'],
      ['HRV vs baseline', '+10%'],
      ['Overnight HR vs baseline', '-5%'],
    ]);
    expect(view.implicationTitle).toBe('Signals are broadly supportive');
    expect(view.implicationText).toContain('does not choose a workout');
    expect(view.sourceText).toContain('bounded sleep envelope');
    expect(view.sourceText).toContain('same 30-day window applied at each daily cutoff');
    expect(view.sourceText).toContain('browser does not load event or activity history');
  });

  it('keeps unavailable evidence explicit while the shared inputs prepare', () => {
    const view = buildTrainingReadinessViewModel(null, { isPreparing: true });

    expect(view).toMatchObject({
      state: 'preparing',
      label: 'Preparing',
      scoreText: '--',
      evidenceText: '0/4 signals',
      isUpdating: true,
      metricRows: [],
    });
  });

  it('distinguishes a sleep read failure from genuinely missing sleep', () => {
    const loadOnly = buildTrainingReadinessViewModel({
      score: 90,
      label: 'Ready',
      confidence: 'low',
      availableSignalCount: 1,
      baselineEvidenceCount: 0,
      totalSignalCount: 4,
      form: 10,
      rampRate: 1,
      sleepScore: null,
      latestSleepAtMs: null,
      hrvRatio: null,
      averageHeartRateRatio: null,
      minimumHeartRateRatio: null,
      overnightHeartRateRatio: null,
      trend: [],
    }, { sleepEvidenceFailed: true });
    const unavailable = buildTrainingReadinessViewModel(null, { sleepEvidenceFailed: true });
    const retained = buildTrainingReadinessViewModel({
      score: 88,
      label: 'Ready',
      confidence: 'low',
      availableSignalCount: 2,
      baselineEvidenceCount: 0,
      totalSignalCount: 4,
      form: 10,
      rampRate: 1,
      latestSleepAtMs: Date.UTC(2026, 6, 16, 6),
      sleepScore: 85,
      hrvRatio: null,
      averageHeartRateRatio: null,
      minimumHeartRateRatio: null,
      overnightHeartRateRatio: null,
      trend: [],
    }, { sleepEvidenceFailed: true });

    expect(loadOnly.state).toBe('ready');
    expect(loadOnly.detailText).toContain('could not be loaded');
    expect(loadOnly.detailText).toContain('load signals only');
    expect(loadOnly.metricRows.find(row => row.label === 'Sleep')?.detailText).toContain('could not be loaded');
    expect(retained.detailText).toContain('last loaded evidence');
    expect(retained.metricRows.find(row => row.label === 'Sleep')?.detailText).toContain('Latest eligible night ended');
    expect(unavailable).toMatchObject({ state: 'unavailable', label: 'Unavailable' });
    expect(unavailable.detailText).toContain('Refresh the page to retry');
  });

  it('distinguishes failed load snapshots from genuinely missing load evidence', () => {
    const unavailable = buildTrainingReadinessViewModel(null, { loadEvidenceFailed: true });
    const sleepOnly = buildTrainingReadinessViewModel({
      score: 80,
      label: 'Ready',
      confidence: 'low',
      availableSignalCount: 1,
      baselineEvidenceCount: 0,
      totalSignalCount: 4,
      form: null,
      rampRate: null,
      sleepScore: 80,
      latestSleepAtMs: Date.UTC(2026, 6, 16, 6),
      hrvRatio: null,
      averageHeartRateRatio: null,
      minimumHeartRateRatio: null,
      overnightHeartRateRatio: null,
      trend: [],
    }, { loadEvidenceFailed: true });

    expect(unavailable.state).toBe('unavailable');
    expect(unavailable.detailText).toContain('Current load evidence could not be loaded');
    expect(sleepOnly.state).toBe('ready');
    expect(sleepOnly.detailText).toContain('load snapshots could not be loaded');
    expect(sleepOnly.metricRows.find(row => row.label === 'Load context')?.detailText)
      .toContain('load snapshots could not be loaded');
  });

  it('builds chart geometry from backend history, preserves gaps, and replaces today with live evidence', () => {
    const asOfDayMs = Date.UTC(2026, 6, 16);
    const points = Array.from({ length: 14 }, (_, index) => ({
      dayMs: asOfDayMs - ((13 - index) * 24 * 60 * 60 * 1000),
      score: index === 5 ? null : 60 + index,
      label: index === 5 ? null : 'Mixed' as const,
      confidence: index === 5 ? null : 'medium' as const,
      availableSignalCount: index === 5 ? 0 : 3,
      baselineEvidenceCount: index === 5 ? 0 : 3,
      totalSignalCount: 4 as const,
      form: index === 5 ? null : 2,
      rampRate: index === 5 ? null : 1,
      sleepScore: index === 5 ? null : 80,
      latestSleepAtMs: index === 5 ? null : asOfDayMs,
      hrvRatio: index === 5 ? null : 1,
      averageHeartRateRatio: index === 5 ? null : 1,
      minimumHeartRateRatio: index === 5 ? null : 1,
      overnightHeartRateRatio: index === 5 ? null : 1,
    }));
    const view = buildTrainingReadinessViewModel({
      score: 82,
      label: 'Ready',
      confidence: 'high',
      availableSignalCount: 4,
      baselineEvidenceCount: 6,
      totalSignalCount: 4,
      form: 10,
      rampRate: 1,
      sleepScore: 90,
      latestSleepAtMs: asOfDayMs,
      hrvRatio: 1.1,
      averageHeartRateRatio: 0.95,
      minimumHeartRateRatio: 0.96,
      overnightHeartRateRatio: 0.953,
      trend: [],
    }, {
      locale: 'en-US',
      calculatedAtMs: Date.UTC(2026, 6, 16, 12),
      historyStatus: 'ready',
      history: {
        formulaVersion: 2,
        dayBoundary: 'UTC',
        asOfDayMs,
        generatedAtMs: Date.UTC(2026, 6, 16, 11),
        historyDays: 14,
        points,
      },
    });

    expect(view.updatedText).toContain('Jul 16');
    expect(view.historyState).toBe('ready');
    expect(view.historyEvidenceText).toBe('13/14 days scored');
    expect(view.historyPoints.at(-1)?.score).toBe(82);
    expect(view.historySegments).toHaveLength(2);
    expect(view.historyAriaLabel).toContain('missing days are gaps');
  });

  it('does not plot a new live score on yesterday when retained history is stale', () => {
    const asOfDayMs = Date.UTC(2026, 6, 15);
    const points = Array.from({ length: 14 }, (_, index) => ({
      dayMs: asOfDayMs - ((13 - index) * 24 * 60 * 60 * 1000),
      score: 60 + index,
      label: 'Mixed' as const,
      confidence: 'medium' as const,
      availableSignalCount: 2,
      baselineEvidenceCount: 3,
      totalSignalCount: 4 as const,
      form: 2,
      rampRate: 1,
      sleepScore: 80,
      latestSleepAtMs: asOfDayMs,
      hrvRatio: null,
      averageHeartRateRatio: null,
      minimumHeartRateRatio: null,
      overnightHeartRateRatio: null,
    }));
    const view = buildTrainingReadinessViewModel({
      score: 92,
      label: 'Ready',
      confidence: 'medium',
      availableSignalCount: 2,
      baselineEvidenceCount: 3,
      totalSignalCount: 4,
      form: 12,
      rampRate: 1,
      sleepScore: 90,
      latestSleepAtMs: Date.UTC(2026, 6, 16, 6),
      hrvRatio: null,
      averageHeartRateRatio: null,
      minimumHeartRateRatio: null,
      overnightHeartRateRatio: null,
      trend: [],
    }, {
      calculatedAtMs: Date.UTC(2026, 6, 16, 12),
      historyStatus: 'ready',
      history: {
        formulaVersion: 2,
        dayBoundary: 'UTC',
        asOfDayMs,
        generatedAtMs: Date.UTC(2026, 6, 15, 12),
        historyDays: 14,
        points,
      },
    });

    expect(view.historyState).toBe('updating');
    expect(view.historyStatusText).toContain('requesting the current UTC day');
    expect(view.historyPoints.at(-1)?.dayMs).toBe(asOfDayMs);
    expect(view.historyPoints.at(-1)?.score).toBe(73);
  });

  it('reports a failed history refresh while retaining the last complete series', () => {
    const asOfDayMs = Date.UTC(2026, 6, 16);
    const points = Array.from({ length: 14 }, (_, index) => ({
      dayMs: asOfDayMs - ((13 - index) * 24 * 60 * 60 * 1000),
      score: 60,
      label: 'Mixed' as const,
      confidence: 'low' as const,
      availableSignalCount: 1,
      baselineEvidenceCount: 0,
      totalSignalCount: 4 as const,
      form: 2,
      rampRate: null,
      sleepScore: null,
      latestSleepAtMs: null,
      hrvRatio: null,
      averageHeartRateRatio: null,
      minimumHeartRateRatio: null,
      overnightHeartRateRatio: null,
    }));
    const view = buildTrainingReadinessViewModel(null, {
      calculatedAtMs: Date.UTC(2026, 6, 16, 12),
      historyStatus: 'failed',
      history: {
        formulaVersion: 2,
        dayBoundary: 'UTC',
        asOfDayMs,
        generatedAtMs: Date.UTC(2026, 6, 16, 11),
        historyDays: 14,
        points,
      },
    });

    expect(view.historyState).toBe('unavailable');
    expect(view.historyPoints).toHaveLength(14);
    expect(view.historyStatusText).toContain('refresh failed');
    expect(view.historyStatusText).toContain('remains visible');
  });
});
