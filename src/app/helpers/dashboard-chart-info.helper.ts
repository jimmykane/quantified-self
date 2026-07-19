import {
  DASHBOARD_ACWR_KPI_CHART_TYPE,
  DASHBOARD_AEROBIC_CAPACITY_KPI_CHART_TYPE,
  DASHBOARD_AEROBIC_DURABILITY_KPI_CHART_TYPE,
  DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE,
  DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE,
  DASHBOARD_EFFICIENCY_TREND_CHART_TYPE,
  DASHBOARD_FATIGUE_ATL_KPI_CHART_TYPE,
  DASHBOARD_FATIGUE_TREND_KPI_CHART_TYPE,
  DASHBOARD_FITNESS_CTL_KPI_CHART_TYPE,
  DASHBOARD_FITNESS_TREND_KPI_CHART_TYPE,
  DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE,
  DASHBOARD_FORM_CHART_TYPE,
  DASHBOARD_FORM_NOW_KPI_CHART_TYPE,
  DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE,
  DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE,
  DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE,
  DASHBOARD_LOAD_STATUS_KPI_CHART_TYPE,
  DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE,
  DASHBOARD_POWER_CURVE_CHART_TYPE,
  DASHBOARD_RAMP_RATE_KPI_CHART_TYPE,
  DASHBOARD_RECOVERY_DEBT_KPI_CHART_TYPE,
  DASHBOARD_RECOVERY_NOW_CHART_TYPE,
  DASHBOARD_SLEEP_TREND_CHART_TYPE,
  DASHBOARD_TRAINING_BALANCE_KPI_CHART_TYPE,
  isDashboardSpecialChartType,
  type DashboardChartType,
  type DashboardSpecialChartType,
} from './dashboard-special-chart-types';

const DASHBOARD_CHART_INFO_COPY: Record<DashboardSpecialChartType, string> = {
  [DASHBOARD_RECOVERY_NOW_CHART_TYPE]: 'Recovery left shows remaining recovery from active recovery windows. Left now drops toward zero over time, while elapsed is the completed part of the same active total.',
  [DASHBOARD_FORM_CHART_TYPE]: 'Form uses TSS-derived CTL (42-day EMA) and ATL (7-day EMA). CTL updates as previous CTL + (today TSS - previous CTL) / 42; ATL uses the same calculation with / 7. Current TSB is same-day CTL minus ATL. Current CTL/ATL/TSB decay through today with zero load after your latest workout; latest workout TSS stays anchored to the last real workout.',
  [DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE]: 'Freshness Forecast projects Form (TSB) for the next 7 days with zero new load. Rising values suggest recovery and freshness; lower values indicate accumulated fatigue.',
  [DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE]: 'Intensity Distribution groups weekly training into Easy (Z1-2), Moderate (Z3-4), and Hard (Z5-7). Power zones are used first; heart-rate zones are the fallback when power is missing.',
  [DASHBOARD_EFFICIENCY_TREND_CHART_TYPE]: 'Efficiency Trend is weekly duration-weighted avgPower/avgHeartRate for sessions that have both metrics. Higher values usually mean more power per beat at similar conditions.',
  [DASHBOARD_SLEEP_TREND_CHART_TYPE]: 'Sleep Trend shows synced Garmin, Suunto, and COROS sessions separately by source. Stage stacks appear when the provider supplies them; otherwise total sleep is shown as unknown stage. Vitals lines appear for recorded HRV, average heart rate, minimum heart rate, and SpO2 when available. Dashed reference lines show the selected range average for HRV and both heart-rate series.',
  [DASHBOARD_POWER_CURVE_CHART_TYPE]: 'Power Curve compares your prepared best power per duration inside this tile range with either the latest activity or a recent-best window. Cycling and running Power Curve tiles use separate curated snapshots, so their envelopes are not mixed.',
  [DASHBOARD_ACWR_KPI_CHART_TYPE]: 'ACWR is acute-to-chronic load: last 7 days divided by (last 28 days / 4). Values near your normal range indicate stable load; sustained spikes can indicate overload risk.',
  [DASHBOARD_RAMP_RATE_KPI_CHART_TYPE]: 'Ramp Rate is CTL(today) minus CTL(7 days ago). Positive values mean fitness load is ramping up, and negative values mean load is easing down.',
  [DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE]: 'Monotony is 7-day mean load divided by 7-day load stddev. Strain is weekly load times monotony. High monotony means less day-to-day variation; high strain means concentrated stress.',
  [DASHBOARD_LOAD_STATUS_KPI_CHART_TYPE]: 'Load Status combines current TSB, CTL ramp, current CTL, and current ATL into one current-state label. It is a dashboard summary, not a separate training model.',
  [DASHBOARD_FORM_NOW_KPI_CHART_TYPE]: 'Form Now is current TSB (CTL minus ATL) from your latest derived state, decayed through today with zero load when needed. Negative values indicate residual fatigue; positive values indicate fresher readiness.',
  [DASHBOARD_FITNESS_CTL_KPI_CHART_TYPE]: 'Fitness (CTL) is current chronic training load from the derived Form model, using a 42-day exponential moving average of daily TSS. Higher values indicate more accumulated fitness load.',
  [DASHBOARD_FATIGUE_ATL_KPI_CHART_TYPE]: 'Fatigue (ATL) is current acute training load from the derived Form model, using a 7-day exponential moving average of daily TSS. Higher values indicate more recent training stress.',
  [DASHBOARD_FITNESS_TREND_KPI_CHART_TYPE]: 'Fitness Trend shows the recent CTL change from the derived Form model. Positive values mean chronic training load is rising; negative values mean it is easing down.',
  [DASHBOARD_FATIGUE_TREND_KPI_CHART_TYPE]: 'Fatigue Trend shows the recent ATL change from the derived Form model. Rising values mean short-term fatigue is building; falling values mean acute load is clearing.',
  [DASHBOARD_RECOVERY_DEBT_KPI_CHART_TYPE]: 'Recovery Debt estimates how many zero-load days are needed for current TSB to return to neutral, using the same decay model as Freshness Forecast.',
  [DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE]: 'Form +7d projects current TSB seven days ahead assuming zero new load. Use it to gauge expected freshness if training load is reduced.',
  [DASHBOARD_TRAINING_BALANCE_KPI_CHART_TYPE]: 'Training Balance summarizes the latest weekly Easy/Moderate/Hard intensity split. It uses the same power-first, heart-rate fallback buckets as Intensity Distribution.',
  [DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE]: 'Easy % is the share of your latest weekly load spent in easy intensity (Z1-2). Higher values indicate more low-intensity base work.',
  [DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE]: 'Hard % is the share of your latest weekly load spent in hard intensity (Z5-7). Higher values indicate more high-intensity stress in that week.',
  [DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE]: 'Efficiency Δ (4w) compares the latest weekly efficiency to the prior up-to-4-week baseline. Positive delta means better efficiency versus baseline; negative means lower efficiency.',
  [DASHBOARD_AEROBIC_CAPACITY_KPI_CHART_TYPE]: 'Aerobic Capacity shows the latest imported running or cycling VO2 max and compares only observations from the same provider source. It never substitutes FTP or critical power for VO2 max.',
  [DASHBOARD_AEROBIC_DURABILITY_KPI_CHART_TYPE]: 'Aerobic Durability shows persisted long-session evidence. Running, cycling, and open-water scopes use aerobic decoupling; pool swimming uses pace retention. Lower decoupling or higher pace retention generally indicates better durability.',
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
