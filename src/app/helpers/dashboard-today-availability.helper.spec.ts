import { describe, expect, it } from 'vitest';
import type { SleepSession } from '@shared/sleep';
import { buildDashboardTodayAvailability, type TodayAvailabilitySnapshots } from './dashboard-today-availability.helper';
import { buildDashboardSleepTrendContext } from './dashboard-sleep-chart.helper';
import { buildTodayActivityMetrics } from './dashboard-today-metrics.helper';

const nowMs = new Date(2026, 10, 10, 12).getTime();
const derived: TodayAvailabilitySnapshots = { formPoints: [], formStatus: 'ready',
  formNow: { value: 0, latestDayMs: nowMs, trend8Weeks: [] }, formNowStatus: 'ready',
  rampRate: { rampRate: 0, latestDayMs: nowMs, ctlToday: 0, ctl7DaysAgo: 0, trend8Weeks: [] }, rampRateStatus: 'ready', recoveryNow: null, recoveryNowStatus: 'ready' };
const night = (daysAgo = 0, vitals: SleepSession['vitals'] = { averageHrvMs: 50, averageHeartRateBpm: 50 }) => ({
  id: `night-${daysAgo}`, sleepDate: new Date(nowMs - (daysAgo * 24 + 2) * 3_600_000).toISOString().slice(0, 10), startTimeMs: nowMs - (daysAgo * 24 + 10) * 3_600_000,
  endTimeMs: nowMs - (daysAgo * 24 + 2) * 3_600_000, durationSeconds: 28_800,
  score: { value: 80 }, vitals, source: { provider: 'SuuntoApp', sourceSessionKey: `night-${daysAgo}`, providerUserId: 'fixture-account' },
} as SleepSession);
const input = () => ({ nowMs, derived, metrics: {}, sleep: buildDashboardSleepTrendContext([night()]), sleepStatus: 'ready' as const });

describe('Today selector data availability', () => {
  it('keeps initial loads, failures and absent readings separate without dropping valid zero load', () => {
    expect(buildDashboardTodayAvailability({ ...input(), derived: null, sleepStatus: 'loading' }).readiness.state).toBe('loading');
    const ready = buildDashboardTodayAvailability(input());
    expect(ready.trainingState.hasData).toBe(true); expect(ready.load.state).toBe('ready');
    expect(ready.readiness.state).toBe('ready'); expect(ready.sleep.hasData).toBe(true);
    const failed = buildDashboardTodayAvailability({ ...input(), sleepStatus: 'error' });
    expect(failed.sleep.state).toBe('error'); expect(failed.hrv.hasData).toBe(false);
    expect(failed.load.state).toBe('ready');
    expect(buildDashboardTodayAvailability({ ...input(), sleep: buildDashboardSleepTrendContext([]) }).sleep.state).toBe('no-data');
  });
  it('keeps yesterday’s eligible night available but withholds today’s Readiness', () => {
    const availability = buildDashboardTodayAvailability({ ...input(), sleep: buildDashboardSleepTrendContext([night(1)]) });
    expect(availability.sleep).toMatchObject({ state: 'history', hasData: true });
    expect(availability['overnight-hr'].hasData).toBe(true);
    expect(availability.readiness).toMatchObject({ hasData: false, label: 'Awaiting today’s sleep' });
    expect(buildDashboardTodayAvailability({ ...input(), sleep: buildDashboardSleepTrendContext([night(3)]) }).sleep.hasData).toBe(false);
  });
  it('uses HRV evidence independently of a sleep score or provider connection', () => {
    expect(buildDashboardTodayAvailability(input()).hrv.label).toBe('More HRV history required');
    const history = Array.from({ length: 20 }, (_, index) => night(index));
    expect(buildDashboardTodayAvailability({ ...input(), sleep: buildDashboardSleepTrendContext(history) }).hrv.state).toBe('ready');
    const noVitals = buildDashboardSleepTrendContext([night(0, {})]);
    expect(buildDashboardTodayAvailability({ ...input(), sleep: noVitals })['overnight-hr'].hasData).toBe(false);
  });
  it('distinguishes an empty day from a real recorded zero and partial or pinned-source failures', () => {
    const empty = buildDashboardTodayAvailability({ ...input(), metrics: buildTodayActivityMetrics([], true) });
    expect(empty.activities.hasData).toBe(false); expect(empty.distance.label).toBe('No activities recorded today');
    const availability = buildDashboardTodayAvailability({ ...input(), metrics: {
      ascent: { value: '0 m', detail: 'Today', status: 'ready', hasData: true },
      steps: { value: '0', detail: 'Today', status: 'ready', hasData: true },
      weight: { value: '—', detail: 'No weigh-in recorded for the selected source', status: 'empty', hasData: false },
      tss: { value: '10', detail: 'Incomplete total', status: 'error', hasData: true },
    } });
    expect(availability.ascent.state).toBe('ready'); expect(availability.steps.hasData).toBe(true);
    expect(availability.weight.label).toContain('selected source');
    expect(availability.tss).toMatchObject({ state: 'error', hasData: true, label: 'Partial data available' });
  });
  it('checks active recovery and derived state without exposing stale or expired estimates as ready', () => {
    expect(buildDashboardTodayAvailability(input()).recovery.state).toBe('no-data');
    const active = { ...derived, recoveryNow: { totalSeconds: 3600, endTimeMs: nowMs } };
    expect(buildDashboardTodayAvailability({ ...input(), derived: active }).recovery.hasData).toBe(true);
    expect(buildDashboardTodayAvailability({ ...input(), nowMs: nowMs + 3_600_001, derived: active }).recovery.hasData).toBe(false);
    expect(buildDashboardTodayAvailability({ ...input(), derived: { ...active, recoveryNowStatus: 'stale' } }).recovery.state).toBe('updating');
    expect(buildDashboardTodayAvailability({ ...input(), derived: { ...derived, formNowStatus: 'failed' } }).trainingState)
      .toMatchObject({ state: 'error', hasData: true, label: 'Partial data available' });
  });
  it('does not let an unused Form snapshot override ready compact load evidence', () => {
    const availability = buildDashboardTodayAvailability({ ...input(), derived: { ...derived, formStatus: 'failed' } });
    expect(availability.trainingState.state).toBe('ready');
    expect(availability.load.state).toBe('ready');
    expect(availability.readiness.state).toBe('ready');
  });
  it('uses the ready Form series while a failed compact Form fallback is unused', () => {
    const formPoints = [{ time: Date.UTC(2026, 10, 10), trainingStressScore: 10, activityCount: 1,
      ctl: 10, atl: 8, formSameDay: 2, formPriorDay: 0 }];
    const availability = buildDashboardTodayAvailability({ ...input(), derived: {
      ...derived, formPoints, formNow: null, formNowStatus: 'failed',
    } });
    expect(availability.trainingState.state).toBe('ready');
    expect(availability.load.state).toBe('ready');
    expect(availability.readiness.state).toBe('ready');
  });
  it('distinguishes missing calculated data from a calculation that is actually updating', () => {
    const missing = { ...derived, formNow: null, formNowStatus: 'missing' as const,
      rampRate: null, rampRateStatus: 'missing' as const, recoveryNowStatus: 'missing' as const };
    expect(buildDashboardTodayAvailability({ ...input(), derived: missing }).load)
      .toMatchObject({ state: 'no-data', hasData: false, label: 'Not calculated yet' });
    expect(buildDashboardTodayAvailability({ ...input(), derived: missing }).recovery.state).toBe('no-data');
    expect(buildDashboardTodayAvailability({ ...input(), derived: { ...missing, formNowStatus: 'building' } }).load.state).toBe('updating');
  });
});
