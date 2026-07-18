import {
  formatDashboardWeekRangeLabel,
} from './dashboard-chart-data.helper';
import {
  type DashboardAcwrContext,
  type DashboardEasyPercentContext,
  type DashboardEfficiencyDelta4wContext,
  type DashboardFatigueAtlContext,
  type DashboardFitnessCtlContext,
  type DashboardFreshnessForecastContext,
  type DashboardFormNowContext,
  type DashboardFormPlus7dContext,
  type DashboardHardPercentContext,
  type DashboardIntensityDistributionContext,
  type DashboardMonotonyStrainContext,
  type DashboardRampRateContext,
} from './dashboard-derived-metrics.helper';
import type { DashboardDerivedMetricStatus } from './derived-metric-status.helper';
import {
  DASHBOARD_ACWR_KPI_CHART_TYPE,
  DASHBOARD_AEROBIC_CAPACITY_KPI_CHART_TYPE,
  DASHBOARD_AEROBIC_DURABILITY_KPI_CHART_TYPE,
  DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE,
  DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE,
  DASHBOARD_FATIGUE_ATL_KPI_CHART_TYPE,
  DASHBOARD_FATIGUE_TREND_KPI_CHART_TYPE,
  DASHBOARD_FITNESS_CTL_KPI_CHART_TYPE,
  DASHBOARD_FITNESS_TREND_KPI_CHART_TYPE,
  DASHBOARD_FORM_NOW_KPI_CHART_TYPE,
  DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE,
  DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE,
  DASHBOARD_LOAD_STATUS_KPI_CHART_TYPE,
  DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE,
  DASHBOARD_RAMP_RATE_KPI_CHART_TYPE,
  DASHBOARD_RECOVERY_DEBT_KPI_CHART_TYPE,
  DASHBOARD_TRAINING_BALANCE_KPI_CHART_TYPE,
  type DashboardKpiChartType,
} from './dashboard-special-chart-types';
import type {
  DashboardAerobicCapacityContext,
  DashboardAerobicDurabilityContext,
} from './dashboard-training-insights.helper';
import { getBrowserLocale } from '../shared/adapters/date-locale.config';

export interface DashboardKpiExplanationRow {
  label: string;
  value: string;
}

export interface DashboardKpiExplanationViewModel {
  description: string;
  rows: DashboardKpiExplanationRow[];
  missingHint: string;
}

export interface DashboardKpiExplanationInputs {
  chartType: DashboardKpiChartType;
  primaryValueText?: string | null;
  primaryLabel?: string | null;
  secondaryValueText?: string | null;
  status?: DashboardDerivedMetricStatus | null;
  acwr?: DashboardAcwrContext | null;
  rampRate?: DashboardRampRateContext | null;
  monotonyStrain?: DashboardMonotonyStrainContext | null;
  formNow?: DashboardFormNowContext | null;
  fitnessCtl?: DashboardFitnessCtlContext | null;
  fatigueAtl?: DashboardFatigueAtlContext | null;
  formPlus7d?: DashboardFormPlus7dContext | null;
  easyPercent?: DashboardEasyPercentContext | null;
  hardPercent?: DashboardHardPercentContext | null;
  efficiencyDelta4w?: DashboardEfficiencyDelta4wContext | null;
  freshnessForecast?: DashboardFreshnessForecastContext | null;
  intensityDistribution?: DashboardIntensityDistributionContext | null;
  aerobicCapacity?: DashboardAerobicCapacityContext | null;
  aerobicDurability?: DashboardAerobicDurabilityContext | null;
  locale?: string;
}

type FormatMetricValue = (value: unknown, options?: { suffix?: string; signed?: boolean }) => string;

export function buildDashboardKpiExplanation(
  inputs: DashboardKpiExplanationInputs,
  formatMetricValue: FormatMetricValue = defaultFormatMetricValue,
): DashboardKpiExplanationViewModel {
  const rows: DashboardKpiExplanationRow[] = [];
  const locale = inputs.locale || getBrowserLocale();
  const description = resolveDescription(inputs);
  const missingHint = resolveMissingHint(inputs.chartType);

  const statusLabel = formatStatus(inputs.status);
  if (statusLabel) {
    rows.push({ label: 'Metric state', value: statusLabel });
  }

  const asOfLabel = resolveAsOfLabel(inputs, locale);
  if (asOfLabel) {
    rows.push({ label: 'As of', value: asOfLabel });
  }

  rows.push(...resolveMetricRows(inputs, formatMetricValue, locale));

  return {
    description,
    rows: dedupeRows(rows),
    missingHint,
  };
}

function resolveDescription(inputs: DashboardKpiExplanationInputs): string {
  switch (inputs.chartType) {
    case DASHBOARD_AEROBIC_CAPACITY_KPI_CHART_TYPE:
      return 'Shows the latest stable imported VO2 max observation. It is not inferred from FTP or critical power.';
    case DASHBOARD_AEROBIC_DURABILITY_KPI_CHART_TYPE:
      return inputs.aerobicDurability?.metric === 'pace-retention'
        ? 'Shows pool durability from persisted eligible activity evidence; higher pace retention is steadier.'
        : 'Shows long-session durability from persisted eligible activity evidence; lower aerobic decoupling is steadier.';
    case DASHBOARD_LOAD_STATUS_KPI_CHART_TYPE:
      return 'Combines current Form, ramp rate, CTL, and ATL from the same UTC-day Form model into one current-state label.';
    case DASHBOARD_FORM_NOW_KPI_CHART_TYPE:
      return 'Current Form is TSB: CTL minus ATL. It uses the same UTC-day Form series as the chart and decays through today after the latest workout.';
    case DASHBOARD_FITNESS_CTL_KPI_CHART_TYPE:
      return 'Fitness is current CTL, a 42-day exponential moving average of daily TSS, carried through empty UTC days with zero load.';
    case DASHBOARD_FATIGUE_ATL_KPI_CHART_TYPE:
      return 'Fatigue is current ATL, a 7-day exponential moving average of daily TSS, carried through empty UTC days with zero load.';
    case DASHBOARD_FITNESS_TREND_KPI_CHART_TYPE:
      return 'Shows recent CTL direction so you can see whether chronic training load is rising or easing.';
    case DASHBOARD_FATIGUE_TREND_KPI_CHART_TYPE:
      return 'Shows recent ATL direction so you can see whether short-term fatigue is building or clearing.';
    case DASHBOARD_RECOVERY_DEBT_KPI_CHART_TYPE:
      return 'Estimates zero-load days until current Form returns to neutral.';
    case DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE:
      return 'Projects Form seven days ahead assuming no new training load.';
    case DASHBOARD_TRAINING_BALANCE_KPI_CHART_TYPE:
      return 'Summarizes the latest weekly Easy, Moderate, and Hard intensity mix.';
    case DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE:
      return 'Shows the latest weekly share of easy intensity work.';
    case DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE:
      return 'Shows the latest weekly share of hard intensity work.';
    case DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE:
      return 'Compares latest weekly efficiency with the previous baseline weeks.';
    case DASHBOARD_RAMP_RATE_KPI_CHART_TYPE:
      return 'Ramp Rate is CTL today minus CTL seven UTC days ago, calculated from the same current Form series.';
    case DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE:
      return 'Monotony captures day-to-day load variation; strain combines weekly load with monotony.';
    case DASHBOARD_ACWR_KPI_CHART_TYPE:
    default:
      return 'ACWR compares acute 7-day load with chronic 28-day load normalized to one week.';
  }
}

function resolveMissingHint(chartType: DashboardKpiChartType): string {
  switch (chartType) {
    case DASHBOARD_AEROBIC_CAPACITY_KPI_CHART_TYPE:
      return 'Needs a stable imported VO2 max observation from a running or cycling activity.';
    case DASHBOARD_AEROBIC_DURABILITY_KPI_CHART_TYPE:
      return 'Needs eligible persisted durability evidence from comparable long aerobic activities.';
    case DASHBOARD_TRAINING_BALANCE_KPI_CHART_TYPE:
    case DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE:
    case DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE:
      return 'Needs activities with usable power or heart-rate zone data to build weekly intensity buckets.';
    case DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE:
      return 'Needs activities with both average power and average heart rate across enough recent weeks.';
    case DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE:
      return 'Needs several days of TSS load in the recent week to calculate monotony and strain.';
    case DASHBOARD_RECOVERY_DEBT_KPI_CHART_TYPE:
    case DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE:
      return 'Needs derived Form and Freshness Forecast data from activities with TSS.';
    default:
      return 'Needs activities with Training Stress Score so derived training-load metrics can be calculated.';
  }
}

function resolveMetricRows(
  inputs: DashboardKpiExplanationInputs,
  formatMetricValue: FormatMetricValue,
  locale: string,
): DashboardKpiExplanationRow[] {
  switch (inputs.chartType) {
    case DASHBOARD_AEROBIC_CAPACITY_KPI_CHART_TYPE:
      return [
        metricRow('Imported VO2 max', inputs.aerobicCapacity?.value, formatMetricValue, { suffix: ' ml/kg/min' }),
        textRow('Discipline', inputs.aerobicCapacity?.discipline),
        textRow('Source', inputs.aerobicCapacity?.sourceLabel),
        textRow('Observations', inputs.aerobicCapacity?.observationCount),
        metricRow('Same-source change', inputs.aerobicCapacity?.changePct, formatMetricValue, { signed: true, suffix: '%' }),
      ].filter(isExplanationRow);
    case DASHBOARD_AEROBIC_DURABILITY_KPI_CHART_TYPE:
      return [
        textRow('Scope', inputs.aerobicDurability?.scopeLabel),
        textRow('Output context', inputs.aerobicDurability?.contextLabel),
        metricRow(
          inputs.aerobicDurability?.metric === 'pace-retention' ? 'Pace retained' : 'Aerobic decoupling',
          inputs.aerobicDurability?.value,
          formatMetricValue,
          { suffix: '%' },
        ),
        textRow('Eligible samples', inputs.aerobicDurability?.sampleCount),
        metricRow('Eligibility', inputs.aerobicDurability?.eligibilityRatio === null || inputs.aerobicDurability?.eligibilityRatio === undefined
          ? null
          : inputs.aerobicDurability.eligibilityRatio * 100, formatMetricValue, { suffix: '%' }),
      ].filter(isExplanationRow);
    case DASHBOARD_LOAD_STATUS_KPI_CHART_TYPE:
      return [
        textRow('Model basis', 'UTC daily TSS; zero-load decay through today'),
        textRow('Current label', inputs.primaryValueText),
        textRow('Reason', inputs.primaryLabel),
        metricRow('Form (TSB)', inputs.formNow?.value, formatMetricValue, { signed: true }),
        metricRow('Ramp', inputs.rampRate?.rampRate, formatMetricValue, { signed: true }),
        metricRow('Fitness (CTL)', inputs.fitnessCtl?.value, formatMetricValue),
        metricRow('Fatigue (ATL)', inputs.fatigueAtl?.value, formatMetricValue),
      ].filter(isExplanationRow);
    case DASHBOARD_FORM_NOW_KPI_CHART_TYPE:
      return [
        metricRow('Current TSB', inputs.formNow?.value, formatMetricValue, { signed: true }),
        textRow('Formula', 'CTL - ATL'),
        textRow('Daily input', 'Training Stress Score (TSS)'),
        textRow('Empty UTC days', '0 TSS through today'),
      ].filter(isExplanationRow);
    case DASHBOARD_FITNESS_CTL_KPI_CHART_TYPE:
      return [
        metricRow('Current CTL', inputs.fitnessCtl?.value, formatMetricValue),
        textRow('Formula', 'Previous CTL + (today TSS - CTL) / 42'),
        textRow('Time constant', '42 days'),
        textRow('Empty UTC days', '0 TSS through today'),
      ].filter(isExplanationRow);
    case DASHBOARD_FATIGUE_ATL_KPI_CHART_TYPE:
      return [
        metricRow('Current ATL', inputs.fatigueAtl?.value, formatMetricValue),
        textRow('Formula', 'Previous ATL + (today TSS - ATL) / 7'),
        textRow('Time constant', '7 days'),
        textRow('Empty UTC days', '0 TSS through today'),
      ].filter(isExplanationRow);
    case DASHBOARD_FITNESS_TREND_KPI_CHART_TYPE:
      return [
        metricRow('4w CTL change', trendDelta(inputs.fitnessCtl?.trend8Weeks, 4), formatMetricValue, { signed: true }),
        metricRow('Current CTL', inputs.fitnessCtl?.value, formatMetricValue),
      ].filter(isExplanationRow);
    case DASHBOARD_FATIGUE_TREND_KPI_CHART_TYPE:
      return [
        metricRow('1w ATL change', trendDelta(inputs.fatigueAtl?.trend8Weeks, 1), formatMetricValue, { signed: true }),
        metricRow('Current ATL', inputs.fatigueAtl?.value, formatMetricValue),
      ].filter(isExplanationRow);
    case DASHBOARD_RECOVERY_DEBT_KPI_CHART_TYPE:
      return [
        textRow('Recovery left', inputs.primaryValueText),
        metricRow('Current TSB', inputs.formNow?.value, formatMetricValue, { signed: true }),
      ].filter(isExplanationRow);
    case DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE:
      return [
        metricRow('Projected TSB', inputs.formPlus7d?.value, formatMetricValue, { signed: true }),
        dateRow('Projected day', inputs.formPlus7d?.projectedDayMs, locale),
      ].filter(isExplanationRow);
    case DASHBOARD_TRAINING_BALANCE_KPI_CHART_TYPE:
      return [
        textRow('Current label', inputs.primaryValueText),
        textRow('Zone source', resolveIntensitySourceLabel(inputs.intensityDistribution)),
        metricRow('Easy', inputs.intensityDistribution?.latestEasyPercent ?? inputs.easyPercent?.value, formatMetricValue, { suffix: '%' }),
        metricRow('Moderate', inputs.intensityDistribution?.latestModeratePercent, formatMetricValue, { suffix: '%' }),
        metricRow('Hard', inputs.intensityDistribution?.latestHardPercent ?? inputs.hardPercent?.value, formatMetricValue, { suffix: '%' }),
      ].filter(isExplanationRow);
    case DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE:
      return [
        metricRow('Easy share', inputs.easyPercent?.value, formatMetricValue, { suffix: '%' }),
      ].filter(isExplanationRow);
    case DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE:
      return [
        metricRow('Hard share', inputs.hardPercent?.value, formatMetricValue, { suffix: '%' }),
      ].filter(isExplanationRow);
    case DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE:
      return [
        metricRow('Absolute delta', inputs.efficiencyDelta4w?.deltaAbs, formatMetricValue, { signed: true }),
        metricRow('Percent delta', inputs.efficiencyDelta4w?.deltaPct, formatMetricValue, { signed: true, suffix: '%' }),
        metricRow('Latest efficiency', inputs.efficiencyDelta4w?.latestValue, formatMetricValue),
        metricRow('Baseline', inputs.efficiencyDelta4w?.baselineValue, formatMetricValue),
        textRow('Baseline weeks', formatBaselineWeeks(inputs.efficiencyDelta4w?.baselineWeekCount)),
      ].filter(isExplanationRow);
    case DASHBOARD_RAMP_RATE_KPI_CHART_TYPE:
      return [
        metricRow('Ramp', inputs.rampRate?.rampRate, formatMetricValue, { signed: true }),
        metricRow('CTL today', inputs.rampRate?.ctlToday, formatMetricValue),
        metricRow('CTL 7d ago', inputs.rampRate?.ctl7DaysAgo, formatMetricValue),
        textRow('Formula', 'CTL(today) - CTL(7 UTC days ago)'),
        textRow('Empty UTC days', '0 TSS through today'),
      ].filter(isExplanationRow);
    case DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE:
      return [
        metricRow('Strain', inputs.monotonyStrain?.strain, formatMetricValue),
        metricRow('Monotony', inputs.monotonyStrain?.monotony, formatMetricValue),
        metricRow('7d load', inputs.monotonyStrain?.weeklyLoad7, formatMetricValue),
      ].filter(isExplanationRow);
    case DASHBOARD_ACWR_KPI_CHART_TYPE:
    default:
      return [
        metricRow('Ratio', inputs.acwr?.ratio, formatMetricValue),
        metricRow('Acute 7d load', inputs.acwr?.acuteLoad7, formatMetricValue),
        metricRow('Chronic weekly load', inputs.acwr ? inputs.acwr.chronicLoad28 / 4 : null, formatMetricValue),
      ].filter(isExplanationRow);
  }
}

function resolveAsOfLabel(
  inputs: DashboardKpiExplanationInputs,
  locale: string,
): string {
  const weekStartMs = resolveLatestWeekStartMs(inputs);
  if (weekStartMs !== null) {
    return formatDashboardWeekRangeLabel(weekStartMs, locale, 'UTC');
  }

  const dayMs = resolveLatestDayMs(inputs);
  if (dayMs !== null) {
    return formatDay(dayMs, locale);
  }

  const generatedAtMs = toFiniteNumber(inputs.freshnessForecast?.generatedAtMs);
  return generatedAtMs !== null ? formatDay(generatedAtMs, locale) : '';
}

function resolveLatestWeekStartMs(inputs: DashboardKpiExplanationInputs): number | null {
  switch (inputs.chartType) {
    case DASHBOARD_TRAINING_BALANCE_KPI_CHART_TYPE:
      return toFiniteNumber(inputs.intensityDistribution?.latestWeekStartMs)
        ?? toFiniteNumber(inputs.easyPercent?.latestWeekStartMs)
        ?? toFiniteNumber(inputs.hardPercent?.latestWeekStartMs);
    case DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE:
      return toFiniteNumber(inputs.easyPercent?.latestWeekStartMs);
    case DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE:
      return toFiniteNumber(inputs.hardPercent?.latestWeekStartMs);
    case DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE:
      return toFiniteNumber(inputs.efficiencyDelta4w?.latestWeekStartMs);
    default:
      return null;
  }
}

function resolveLatestDayMs(inputs: DashboardKpiExplanationInputs): number | null {
  switch (inputs.chartType) {
    case DASHBOARD_AEROBIC_CAPACITY_KPI_CHART_TYPE:
      return toFiniteNumber(inputs.aerobicCapacity?.lastSeenAtMs);
    case DASHBOARD_LOAD_STATUS_KPI_CHART_TYPE:
      return maxFiniteNumber([
        inputs.formNow?.latestDayMs,
        inputs.rampRate?.latestDayMs,
        inputs.fitnessCtl?.latestDayMs,
        inputs.fatigueAtl?.latestDayMs,
      ]);
    case DASHBOARD_FORM_NOW_KPI_CHART_TYPE:
      return toFiniteNumber(inputs.formNow?.latestDayMs);
    case DASHBOARD_FITNESS_CTL_KPI_CHART_TYPE:
    case DASHBOARD_FITNESS_TREND_KPI_CHART_TYPE:
      return toFiniteNumber(inputs.fitnessCtl?.latestDayMs);
    case DASHBOARD_FATIGUE_ATL_KPI_CHART_TYPE:
    case DASHBOARD_FATIGUE_TREND_KPI_CHART_TYPE:
      return toFiniteNumber(inputs.fatigueAtl?.latestDayMs);
    case DASHBOARD_RECOVERY_DEBT_KPI_CHART_TYPE:
      return toFiniteNumber(inputs.formNow?.latestDayMs);
    case DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE:
      return toFiniteNumber(inputs.formPlus7d?.latestDayMs);
    case DASHBOARD_RAMP_RATE_KPI_CHART_TYPE:
      return toFiniteNumber(inputs.rampRate?.latestDayMs);
    case DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE:
      return toFiniteNumber(inputs.monotonyStrain?.latestDayMs);
    case DASHBOARD_ACWR_KPI_CHART_TYPE:
    default:
      return toFiniteNumber(inputs.acwr?.latestDayMs);
  }
}

function resolveIntensitySourceLabel(context: DashboardIntensityDistributionContext | null | undefined): string {
  const latestWeekStartMs = toFiniteNumber(context?.latestWeekStartMs);
  const latestWeek = latestWeekStartMs === null
    ? null
    : (context?.weeks || []).find(week => toFiniteNumber(week.weekStartMs) === latestWeekStartMs);
  const source = latestWeek?.source;
  if (source === 'power') {
    return 'Power zones';
  }
  if (source === 'heart-rate') {
    return 'Heart-rate zones';
  }
  return '';
}

function textRow(label: string, value: unknown): DashboardKpiExplanationRow | null {
  const text = `${value ?? ''}`.trim();
  return text && text !== '--' ? { label, value: text } : null;
}

function dateRow(label: string, value: unknown, locale = getBrowserLocale()): DashboardKpiExplanationRow | null {
  const timestamp = toFiniteNumber(value);
  return timestamp === null ? null : { label, value: formatDay(timestamp, locale) };
}

function metricRow(
  label: string,
  value: unknown,
  formatMetricValue: FormatMetricValue,
  options?: { suffix?: string; signed?: boolean },
): DashboardKpiExplanationRow | null {
  const numericValue = toFiniteNumber(value);
  if (numericValue === null) {
    return null;
  }
  return { label, value: formatMetricValue(numericValue, options) };
}

function isExplanationRow(row: DashboardKpiExplanationRow | null): row is DashboardKpiExplanationRow {
  return !!row && !!row.label && !!row.value;
}

function trendDelta(
  trend: ReadonlyArray<{ value: number | null | undefined }> | null | undefined,
  preferredPointsAgo: number,
): number | null {
  const numericValues = (trend || [])
    .map(point => toFiniteNumber(point.value))
    .filter((value): value is number => value !== null);
  if (numericValues.length < 2) {
    return null;
  }
  const latest = numericValues[numericValues.length - 1];
  const comparisonIndex = Math.max(0, numericValues.length - 1 - preferredPointsAgo);
  return latest - numericValues[comparisonIndex];
}

function formatStatus(status: DashboardDerivedMetricStatus | null | undefined): string {
  switch (status) {
    case 'ready':
      return 'Ready';
    case 'building':
    case 'queued':
    case 'processing':
    case 'stale':
      return 'Updating';
    case 'failed':
      return 'Needs retry';
    case 'missing':
      return 'Waiting for data';
    default:
      return '';
  }
}

function formatBaselineWeeks(value: unknown): string {
  const weekCount = toFiniteNumber(value);
  if (weekCount === null || weekCount <= 0) {
    return '';
  }
  return weekCount === 1 ? '1 week' : `${Math.round(weekCount)} weeks`;
}

function formatDay(timestamp: number, locale: string): string {
  return new Date(timestamp).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function maxFiniteNumber(values: ReadonlyArray<unknown>): number | null {
  const finiteValues = values
    .map(value => toFiniteNumber(value))
    .filter((value): value is number => value !== null);
  return finiteValues.length ? Math.max(...finiteValues) : null;
}

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numericValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function dedupeRows(rows: DashboardKpiExplanationRow[]): DashboardKpiExplanationRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.label}\u0000${row.value}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function defaultFormatMetricValue(
  value: unknown,
  options?: { suffix?: string; signed?: boolean },
): string {
  const numericValue = toFiniteNumber(value);
  if (numericValue === null) {
    return '--';
  }
  const suffix = `${options?.suffix || ''}`;
  const prefix = options?.signed === true && numericValue > 0 ? '+' : '';
  if (Math.abs(numericValue) >= 100) {
    return `${prefix}${Math.round(numericValue)}${suffix}`;
  }
  if (Math.abs(numericValue) >= 10) {
    return `${prefix}${Math.round(numericValue * 10) / 10}${suffix}`;
  }
  return `${prefix}${Math.round(numericValue * 100) / 100}${suffix}`;
}
