import { describe, expect, it } from 'vitest';
import {
  buildDashboardKpiExplanation,
} from './dashboard-kpi-explanation.helper';
import {
  DASHBOARD_AEROBIC_CAPACITY_KPI_CHART_TYPE,
  DASHBOARD_AEROBIC_DURABILITY_KPI_CHART_TYPE,
  DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE,
  DASHBOARD_LOAD_STATUS_KPI_CHART_TYPE,
  DASHBOARD_TRAINING_BALANCE_KPI_CHART_TYPE,
} from './dashboard-special-chart-types';

describe('dashboard-kpi-explanation.helper', () => {
  it('explains Load Status with the signals behind the label', () => {
    const explanation = buildDashboardKpiExplanation({
      chartType: DASHBOARD_LOAD_STATUS_KPI_CHART_TYPE,
      primaryValueText: 'Building',
      primaryLabel: 'Productive load',
      status: 'ready',
      formNow: {
        latestDayMs: Date.UTC(2026, 4, 8),
        value: -4.91,
        trend8Weeks: [],
      },
      rampRate: {
        latestDayMs: Date.UTC(2026, 4, 8),
        ctlToday: 97,
        ctl7DaysAgo: 88,
        rampRate: 0.83,
        trend8Weeks: [],
      },
      fitnessCtl: {
        latestDayMs: Date.UTC(2026, 4, 8),
        value: 97,
        trend8Weeks: [],
      },
      fatigueAtl: {
        latestDayMs: Date.UTC(2026, 4, 8),
        value: 102,
        trend8Weeks: [],
      },
      locale: 'en-US',
    });

    expect(explanation.description).toContain('current-state label');
    expect(explanation.rows).toContainEqual({ label: 'Metric state', value: 'Ready' });
    expect(explanation.rows).toContainEqual({ label: 'Current label', value: 'Building' });
    expect(explanation.rows).toContainEqual({ label: 'Reason', value: 'Productive load' });
    expect(explanation.rows).toContainEqual({ label: 'Form (TSB)', value: '-4.91' });
    expect(explanation.rows).toContainEqual({ label: 'Ramp', value: '+0.83' });
    expect(explanation.rows).toContainEqual({ label: 'Fitness (CTL)', value: '97' });
    expect(explanation.rows).toContainEqual({ label: 'Fatigue (ATL)', value: '102' });
  });

  it('uses intensity source and weekly split details for Training Balance', () => {
    const explanation = buildDashboardKpiExplanation({
      chartType: DASHBOARD_TRAINING_BALANCE_KPI_CHART_TYPE,
      primaryValueText: 'Balanced',
      status: 'ready',
      intensityDistribution: {
        latestWeekStartMs: Date.UTC(2026, 4, 4),
        latestEasyPercent: 68.9,
        latestModeratePercent: 28.5,
        latestHardPercent: 2.6,
        weeks: [
          {
            weekStartMs: Date.UTC(2026, 4, 4),
            easySeconds: 10_000,
            moderateSeconds: 4_000,
            hardSeconds: 500,
            source: 'power',
          },
        ],
      },
      locale: 'en-US',
    });

    expect(explanation.rows).toContainEqual({ label: 'Zone source', value: 'Power zones' });
    expect(explanation.rows).toContainEqual({ label: 'Easy', value: '68.9%' });
    expect(explanation.rows).toContainEqual({ label: 'Moderate', value: '28.5%' });
    expect(explanation.rows).toContainEqual({ label: 'Hard', value: '2.6%' });
    expect(explanation.rows.find(row => row.label === 'As of')?.value).toContain('Week');
  });

  it('uses KPI-specific missing guidance for efficiency', () => {
    const explanation = buildDashboardKpiExplanation({
      chartType: DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE,
      status: 'missing',
      efficiencyDelta4w: {
        latestWeekStartMs: Date.UTC(2026, 4, 4),
        latestValue: 1.92,
        baselineValue: 1.8,
        baselineWeekCount: 4,
        deltaAbs: 0.12,
        deltaPct: 6.67,
        trend8Weeks: [],
      },
      locale: 'en-US',
    });

    expect(explanation.missingHint).toContain('average power');
    expect(explanation.missingHint).toContain('average heart rate');
    expect(explanation.rows).toContainEqual({ label: 'Baseline weeks', value: '4 weeks' });
    expect(explanation.rows).toContainEqual({ label: 'Percent delta', value: '+6.67%' });
  });

  it('shows aerobic-capacity source provenance', () => {
    const explanation = buildDashboardKpiExplanation({
      chartType: DASHBOARD_AEROBIC_CAPACITY_KPI_CHART_TYPE,
      aerobicCapacity: {
        value: 54,
        discipline: 'running',
        sourceKey: 'garmin:watch',
        sourceLabel: 'Garmin · Watch',
        observationCount: 4,
        changePct: 3.85,
        lastSeenAtMs: Date.UTC(2026, 0, 1),
        trend: [],
      },
      locale: 'en-US',
    });

    expect(explanation.rows).toContainEqual({ label: 'Source', value: 'Garmin · Watch' });
  });

  it('uses pace-retention semantics for pool durability', () => {
    const explanation = buildDashboardKpiExplanation({
      chartType: DASHBOARD_AEROBIC_DURABILITY_KPI_CHART_TYPE,
      aerobicDurability: {
        value: 98,
        metric: 'pace-retention',
        scopeLabel: 'Pool',
        contextLabel: '25 m · Freestyle',
        sampleCount: 3,
        eligibilityRatio: 0.75,
        trend: [],
      },
    });

    expect(explanation.description).toContain('higher pace retention is steadier');
    expect(explanation.rows).toContainEqual({ label: 'Pace retained', value: '98%' });
  });

});
