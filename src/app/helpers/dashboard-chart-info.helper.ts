import {
  DASHBOARD_ACWR_KPI_CHART_TYPE,
  DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE,
  DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE,
  DASHBOARD_EFFICIENCY_TREND_CHART_TYPE,
  DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE,
  DASHBOARD_FORM_CHART_TYPE,
  DASHBOARD_FORM_NOW_KPI_CHART_TYPE,
  DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE,
  DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE,
  DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE,
  DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE,
  DASHBOARD_RAMP_RATE_KPI_CHART_TYPE,
  DASHBOARD_RECOVERY_NOW_CHART_TYPE,
  isDashboardSpecialChartType,
  type DashboardChartType,
  type DashboardSpecialChartType,
} from './dashboard-special-chart-types';

const DASHBOARD_CHART_INFO_COPY: Record<DashboardSpecialChartType, string> = {
  [DASHBOARD_RECOVERY_NOW_CHART_TYPE]: 'Recovery Left Now shows remaining recovery from active recovery windows. Left now drops toward zero over time, while elapsed is the completed part of the same active total.',
  [DASHBOARD_FORM_CHART_TYPE]: 'Form uses TSS-derived CTL (42-day EMA) and ATL (7-day EMA). Form (TSB) is same-day CTL minus ATL: more negative means more fatigue, around zero is balanced, positive is fresher.',
  [DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE]: 'Freshness Forecast projects Form (TSB) for the next 7 days with zero new load. Rising values suggest recovery and freshness; lower values indicate accumulated fatigue.',
  [DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE]: 'Intensity Distribution groups weekly training into Easy (Z1-2), Moderate (Z3-4), and Hard (Z5-7). Power zones are used first; heart-rate zones are the fallback when power is missing.',
  [DASHBOARD_EFFICIENCY_TREND_CHART_TYPE]: 'Efficiency Trend is weekly duration-weighted avgPower/avgHeartRate for sessions that have both metrics. Higher values usually mean more power per beat at similar conditions.',
  [DASHBOARD_ACWR_KPI_CHART_TYPE]: 'ACWR is acute-to-chronic load: last 7 days divided by (last 28 days / 4). Values near your normal range indicate stable load; sustained spikes can indicate overload risk.',
  [DASHBOARD_RAMP_RATE_KPI_CHART_TYPE]: 'Ramp Rate is CTL(today) minus CTL(7 days ago). Positive values mean fitness load is ramping up, and negative values mean load is easing down.',
  [DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE]: 'Monotony is 7-day mean load divided by 7-day load stddev. Strain is weekly load times monotony. High monotony means less day-to-day variation; high strain means concentrated stress.',
  [DASHBOARD_FORM_NOW_KPI_CHART_TYPE]: 'Form Now is same-day TSB (CTL minus ATL) from your latest derived state. Negative values indicate residual fatigue; positive values indicate fresher readiness.',
  [DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE]: 'Form +7d projects same-day TSB seven days ahead assuming zero new load. Use it to gauge expected freshness if training load is reduced.',
  [DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE]: 'Easy % is the share of your latest weekly load spent in easy intensity (Z1-2). Higher values indicate more low-intensity base work.',
  [DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE]: 'Hard % is the share of your latest weekly load spent in hard intensity (Z5-7). Higher values indicate more high-intensity stress in that week.',
  [DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE]: 'Efficiency Δ (4w) compares the latest weekly efficiency to the prior up-to-4-week baseline. Positive delta means better efficiency versus baseline; negative means lower efficiency.',
};

export function resolveDashboardChartInfoTooltip(chartType: DashboardChartType | null | undefined): string | null {
  if (!isDashboardSpecialChartType(chartType)) {
    return null;
  }

  const infoText = DASHBOARD_CHART_INFO_COPY[chartType];
  return typeof infoText === 'string' && infoText.trim().length > 0
    ? infoText
    : null;
}
