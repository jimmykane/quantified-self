import { describe, expect, it } from 'vitest';
import { DistanceUnits } from '@sports-alliance/sports-lib';
import { HEALTH_METRIC_IDS, HEALTH_UNITS } from '@shared/health';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';
import { createDashboardDerivedMetricsMissingState } from '../services/dashboard-derived-metrics.service';
import { buildCalendarDayHealthSummary, resolveCalendarDaySleepPoint, selectCalendarDaySleepPoint, type CalendarDayHealthEvidence } from './calendar-day-health.helper';
import type { HealthWorkspaceSeries } from './health-workspace.helper';

const nowMs = new Date(2026, 8, 25, 12).getTime();
const noEvidence = (): CalendarDayHealthEvidence => ({
  sessions: [], hrvSeries: [], derived: null, sleepError: false, hrvError: false, readinessError: false, recoveryError: false,
});

describe('calendar day health summary', () => {
  it('never uses a last-known reading or current recovery for a past day', () => {
    const evidence = noEvidence();
    evidence.hrvSeries = [{
      id: 'source-1', metricId: HEALTH_METRIC_IDS.HeartRateVariability, sourceLabel: 'Suunto',
      semanticLabel: 'Average HRV · Sleep session · Provider summary · Provider calculated', unit: HEALTH_UNITS.Millisecond, nativeOnly: false,
      points: [{ timestampMs: nowMs, calendarDate: '2026-09-25', value: 44, qualityCode: null }],
    } as HealthWorkspaceSeries];
    const summary = buildCalendarDayHealthSummary('2026-09-24', evidence, { nowMs });
    expect(summary.hrv.status).toBe('empty');
    expect(summary.recovery).toBeNull();
    expect(summary.readiness.status).toBe('empty');
  });

  it('shows exact-date historical readiness and source-labelled HRV with canonical units', () => {
    const evidence = noEvidence();
    const derived = createDashboardDerivedMetricsMissingState();
    derived.trainingReadinessStatus = 'ready';
    derived.trainingReadiness = { points: [{ dayMs: Date.UTC(2026, 8, 24), score: 67, label: 'Mixed' }] } as typeof derived.trainingReadiness;
    evidence.derived = derived;
    evidence.hrvSeries = [{
      id: 'source-1', metricId: HEALTH_METRIC_IDS.HeartRateVariability, sourceLabel: 'Suunto',
      semanticLabel: 'Sleep average', unit: HEALTH_UNITS.Millisecond, nativeOnly: false,
      points: [{ timestampMs: Date.UTC(2026, 8, 24, 7), calendarDate: '2026-09-24', value: 34, qualityCode: null }],
    } as HealthWorkspaceSeries];
    for (const units of [null, normalizeUserUnitSettings({ distanceUnits: DistanceUnits.Miles })]) {
      const summary = buildCalendarDayHealthSummary('2026-09-24', evidence, { nowMs, unitSettings: units });
      expect(summary.readiness.value).toBe('Mixed 67/100');
      expect(summary.hrv.value).toContain('34');
      expect(summary.hrv.value).toContain('ms');
      expect(summary.hrv.detail).toContain('Suunto · Sleep average');
      expect(summary.hrv.detail).not.toContain('Provider summary');
    }
  });

  it('keeps source failures distinct from genuine missing data', () => {
    const summary = buildCalendarDayHealthSummary('2026-09-25', {
      ...noEvidence(), sleepError: true, hrvError: true, readinessError: true, recoveryError: true,
    }, { nowMs });
    expect(summary.sleep.status).toBe('error');
    expect(summary.hrv.status).toBe('error');
    expect(summary.readiness.status).toBe('error');
    expect(summary.recovery?.status).toBe('error');
  });

  it('keeps a failed recovery source from hiding otherwise available readiness', () => {
    const summary = buildCalendarDayHealthSummary('2026-09-25', {
      ...noEvidence(), recoveryError: true,
    }, { nowMs });
    expect(summary.readiness.status).toBe('empty');
    expect(summary.recovery?.status).toBe('error');
  });

  it('keeps valid current values visible when a derived source fails to refresh', () => {
    const derived = createDashboardDerivedMetricsMissingState();
    derived.formNow = { value: 10 } as typeof derived.formNow;
    derived.rampRate = { rampRate: 1 } as typeof derived.rampRate;
    derived.recoveryNow = { totalSeconds: 3600, endTimeMs: nowMs - 5 * 60_000 };
    const summary = buildCalendarDayHealthSummary('2026-09-25', {
      ...noEvidence(), derived, readinessError: true, recoveryError: true,
    }, { nowMs });
    expect(summary.readiness.status).toBe('ready');
    expect(summary.readiness.detail).toContain('could not be refreshed');
    expect(summary.recovery?.status).toBe('ready');
    expect(summary.recovery?.detail).toContain('could not refresh estimate');
  });

  it('distinguishes updating derived metrics from an empty selected day', () => {
    const derived = createDashboardDerivedMetricsMissingState();
    derived.trainingReadinessStatus = 'building';
    derived.formStatus = 'stale';
    derived.recoveryNowStatus = 'queued';
    const evidence = { ...noEvidence(), derived };
    const past = buildCalendarDayHealthSummary('2026-09-24', evidence, { nowMs });
    expect(past.readiness.status).toBe('updating');
    expect(past.readiness.detail).toContain('being updated');
    expect(past.recovery).toBeNull();
    const today = buildCalendarDayHealthSummary('2026-09-25', evidence, { nowMs });
    expect(today.readiness.status).toBe('updating');
    expect(today.recovery?.status).toBe('updating');
  });

  it('keeps date-matched sleep visible while readiness and recovery are still loading', () => {
    const evidence = { ...noEvidence(), derivedPending: true };
    const past = buildCalendarDayHealthSummary('2026-09-24', evidence, { nowMs });
    expect(past.readiness).toMatchObject({ status: 'updating', detail: 'Loading readiness for this day' });
    expect(past.sleep.status).toBe('empty');
    expect(past.recovery).toBeNull();
    const today = buildCalendarDayHealthSummary('2026-09-25', evidence, { nowMs });
    expect(today.recovery).toMatchObject({ status: 'updating', detail: 'Loading recovery estimate' });
  });

  it('labels a Sleep HRV fallback as partial when the all-day read failed', () => {
    const evidence = noEvidence();
    evidence.hrvError = true;
    evidence.hrvSeries = [{
      id: 'sleep', metricId: HEALTH_METRIC_IDS.HeartRateVariability, sourceLabel: 'Suunto',
      semanticLabel: 'Sleep average', unit: HEALTH_UNITS.Millisecond, nativeOnly: false,
      points: [{ timestampMs: Date.UTC(2026, 8, 24, 7), calendarDate: '2026-09-24', value: 34 }],
    }] as HealthWorkspaceSeries[];
    const summary = buildCalendarDayHealthSummary('2026-09-24', evidence, { nowMs });
    expect(summary.hrv.value).toContain('34');
    expect(summary.hrv.detail).toContain('Suunto · Sleep average · Other HRV readings unavailable');
  });

  it('uses the latest matching sleep and HRV source without borrowing an adjacent day', () => {
    const evidence = noEvidence();
    evidence.sessions = [
      { id: 'garmin', sleepDate: '2026-09-24', startTimeMs: Date.UTC(2026, 8, 23, 23),
        endTimeMs: Date.UTC(2026, 8, 24, 6), durationSeconds: 7 * 3600,
        score: { value: 81 }, stageDurationsSeconds: {}, source: { provider: 'GarminAPI' } },
      { id: 'suunto', sleepDate: '2026-09-24', startTimeMs: Date.UTC(2026, 8, 23, 23),
        endTimeMs: Date.UTC(2026, 8, 24, 7), durationSeconds: 8 * 3600,
        score: { value: 74 }, stageDurationsSeconds: {}, source: { provider: 'SuuntoApp' } },
    ] as CalendarDayHealthEvidence['sessions'];
    evidence.hrvSeries = [
      { id: 'old', metricId: HEALTH_METRIC_IDS.HeartRateVariability, sourceLabel: 'Garmin',
        semanticLabel: 'Sleep average', unit: HEALTH_UNITS.Millisecond, nativeOnly: false,
        points: [{ timestampMs: Date.UTC(2026, 8, 24, 4), calendarDate: '2026-09-24', value: 40 }] },
      { id: 'new', metricId: HEALTH_METRIC_IDS.HeartRateVariability, sourceLabel: 'Suunto',
        semanticLabel: 'Sleep average', unit: HEALTH_UNITS.Millisecond, nativeOnly: false,
        points: [{ timestampMs: Date.UTC(2026, 8, 24, 7), calendarDate: '2026-09-24', value: 34 }] },
    ] as HealthWorkspaceSeries[];
    const summary = buildCalendarDayHealthSummary('2026-09-24', evidence, { nowMs });
    expect(summary.sleep.value).toBe('74/100');
    expect(summary.sleep.detail).toContain('Suunto');
    expect(selectCalendarDaySleepPoint('2026-09-24', evidence.sessions)?.providerLabel).toBe('Suunto');
    expect(selectCalendarDaySleepPoint('2026-09-25', evidence.sessions)).toBeNull();
    evidence.sleepPoint = selectCalendarDaySleepPoint('2026-09-24', evidence.sessions);
    expect(resolveCalendarDaySleepPoint('2026-09-25', evidence)).toBeNull();
    expect(summary.hrv.value).toContain('34');
    expect(summary.hrv.detail).toContain('Suunto');
  });

  it('uses recorded duration when a sleep source has no score', () => {
    const evidence = noEvidence();
    evidence.sessions = [{
      id: 'suunto', sleepDate: '2026-09-24', startTimeMs: Date.UTC(2026, 8, 23, 23),
      endTimeMs: Date.UTC(2026, 8, 24, 6, 30), durationSeconds: 7.5 * 3600,
      score: null, stageDurationsSeconds: {}, source: { provider: 'SuuntoApp' },
    }] as CalendarDayHealthEvidence['sessions'];
    const summary = buildCalendarDayHealthSummary('2026-09-24', evidence, { nowMs });
    expect(summary.sleep.status).toBe('ready');
    expect(summary.sleep.value).toBe('7h 30m');
    expect(summary.sleep.detail).toContain('Suunto · overnight duration');
  });
});
