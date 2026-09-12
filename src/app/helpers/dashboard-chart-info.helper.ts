import {
  DASHBOARD_ACWR_KPI_CHART_TYPE,
  DASHBOARD_ACTIVITY_CALENDAR_CHART_TYPE,
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
  DASHBOARD_HRV_TREND_CHART_TYPE,
  DASHBOARD_TRAINING_BALANCE_KPI_CHART_TYPE,
  isDashboardSpecialChartType,
  type DashboardChartType,
  type DashboardSpecialChartType,
} from './dashboard-special-chart-types';

const DASHBOARD_CHART_INFO_COPY: Record<DashboardSpecialChartType, string> = {
  [DASHBOARD_RECOVERY_NOW_CHART_TYPE]: 'Shows how much of your recorded recovery time remains. The remaining portion counts down as time passes; the elapsed portion shows how much has already passed.\n\nThis chart follows active recovery estimates and is independent of activity filters.',
  [DASHBOARD_ACTIVITY_CALENDAR_CHART_TYPE]: 'Shows your recorded activity time by day and sport group for the displayed month. Larger circles mean more time; compact layouts nest the circles.\n\nThe calendar has its own month selection, independent of the activity list and other charts.',
  [DASHBOARD_FORM_CHART_TYPE]: 'Shows how training load affects fitness (CTL), fatigue (ATL), and form (TSB). Form is the same-day difference between fitness and fatigue: positive values indicate more freshness; negative values indicate more accumulated fatigue.\n\nDaily Training Stress Score (TSS) feeds a 42-day fitness average and a 7-day fatigue average. Each day, fitness changes by (today’s TSS minus previous CTL) / 42; fatigue uses the same calculation with / 7. Days without recorded training count as zero load.\n\nForm is training-load only. Today Readiness separately includes available sleep and recovery signals.',
  [DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE]: 'Shows how your fitness, fatigue, and form could change over the next 7 days if you add no training load. Rising form indicates more freshness as fatigue eases.\n\nThis forecast uses training load only. Sleep and other recovery signals appear separately in Today Readiness.',
  [DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE]: 'Shows weekly time in Easy (zones 1–2), Moderate (zones 3–4), and Hard (zones 5–7) training. Taller bars mean more recorded time; the colors show how that time is divided.\n\nUses power zones when available, otherwise heart-rate zones. Time without usable zone data is not included.',
  [DASHBOARD_EFFICIENCY_TREND_CHART_TYPE]: 'Shows how much power you produce relative to your heart rate each week. Higher values mean more power for the same heart rate; compare workouts under similar conditions.\n\nOnly workouts with both average power and average heart rate contribute. Longer workouts have more weight in the weekly average.',
  [DASHBOARD_HRV_TREND_CHART_TYPE]: 'Shows recorded heart rate variability (HRV) from Health and Sleep summaries, with sources and measurement types kept separate. The date selector controls the period shown, independently of Sleep.\n\nFor eligible nightly readings, the shaded personal range uses the preceding 60 days of history for each date. This calculation history is separate from the displayed period. Missing readings remain gaps, and naps are excluded.',
  [DASHBOARD_SLEEP_TREND_CHART_TYPE]: 'Shows Sleep duration and stages from each connected source. When stages are unavailable, total sleep appears as an unknown stage.\n\nAvailable readings include heart rate variability (HRV), average heart rate, minimum heart rate, and blood oxygen (SpO2). Dashed lines show the selected range average for HRV and both heart-rate readings.',
  [DASHBOARD_POWER_CURVE_CHART_TYPE]: 'Shows your best recorded average power for different effort durations within this chart’s selected date range. Compare it with your latest workout or your best efforts from a recent period.\n\nCycling and running use separate curves. Only activities with usable power data contribute.',
  [DASHBOARD_ACWR_KPI_CHART_TYPE]: 'Compares your training load over the last 7 days with your average weekly load over the last 28 days. A value of 1 means those loads are equal; higher values mean your recent week was heavier.\n\nCalculated as 7-day load divided by (28-day load / 4). Compare the trend with your own training history.',
  [DASHBOARD_RAMP_RATE_KPI_CHART_TYPE]: 'Shows how much your fitness load (CTL) changed over the last 7 days. Positive values mean it increased; negative values mean it decreased.\n\nCalculated as today’s CTL minus CTL seven days ago.',
  [DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE]: 'Shows how repetitive and demanding your recent training has been. Higher monotony means less variation in daily load. Strain combines that repetition with the week’s total load.\n\nMonotony is the 7-day average daily load divided by its standard deviation. Strain is weekly load multiplied by monotony.',
  [DASHBOARD_LOAD_STATUS_KPI_CHART_TYPE]: 'Summarizes your current training load using form, ramp rate, fitness, and fatigue. The label describes the balance of recent and longer-term training.\n\nIt uses Training Stress Score (TSS). Today Readiness separately includes available sleep and recovery signals.',
  [DASHBOARD_FORM_NOW_KPI_CHART_TYPE]: 'Shows your current form (TSB): fitness load (CTL) minus fatigue load (ATL). Positive values indicate more freshness; negative values indicate more accumulated fatigue.\n\nDays without recorded training reduce both load estimates. Form uses training load only; Today Readiness includes available recovery signals separately.',
  [DASHBOARD_FITNESS_CTL_KPI_CHART_TYPE]: 'Shows your longer-term training load, also called chronic training load (CTL). It uses a 42-day weighted average of daily Training Stress Score (TSS), giving recent training more influence.\n\nHigher values reflect more sustained training load, rather than a direct measurement of fitness.',
  [DASHBOARD_FATIGUE_ATL_KPI_CHART_TYPE]: 'Shows your recent training load, also called acute training load (ATL). It uses a 7-day weighted average of daily Training Stress Score (TSS), giving recent training more influence.\n\nHigher values reflect more recent training stress. Days without recorded training let the estimate decrease.',
  [DASHBOARD_FITNESS_TREND_KPI_CHART_TYPE]: 'Shows the change in fitness load (CTL) over the last 4 weeks, or the available history if shorter. Positive values mean longer-term load increased; negative values mean it decreased.',
  [DASHBOARD_FATIGUE_TREND_KPI_CHART_TYPE]: 'Shows the change in fatigue load (ATL) over the last week, or the available history if shorter. Positive values mean recent load increased; negative values mean it decreased.',
  [DASHBOARD_RECOVERY_DEBT_KPI_CHART_TYPE]: 'Estimates how many days without training load it would take for your current form to reach neutral.\n\nUses the same fitness and fatigue calculations as Freshness Forecast. It is separate from the recorded recovery-time countdown.',
  [DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE]: 'Projects your form (TSB) 7 days ahead assuming no new training load. Positive values indicate more freshness; negative values indicate remaining fatigue.\n\nThis is a training-load projection. It does not forecast sleep or other recovery signals.',
  [DASHBOARD_TRAINING_BALANCE_KPI_CHART_TYPE]: 'Summarizes how your latest week’s recorded zone time is split between Easy, Moderate, and Hard effort.\n\nUses the same power-zone-first, heart-rate-zone fallback as Intensity Distribution.',
  [DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE]: 'Shows the percentage of your latest week’s recorded zone time spent in Easy effort (zones 1–2).\n\nUses power zones when available, otherwise heart-rate zones. Time without usable zone data is not included.',
  [DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE]: 'Shows the percentage of your latest week’s recorded zone time spent in Hard effort (zones 5–7).\n\nUses power zones when available, otherwise heart-rate zones. Time without usable zone data is not included.',
  [DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE]: 'Compares your latest weekly power-to-heart-rate efficiency with the average from up to 4 preceding weeks. Positive values mean higher efficiency; negative values mean lower efficiency.\n\nOnly workouts with both average power and average heart rate contribute. Compare similar training conditions.',
  [DASHBOARD_AEROBIC_CAPACITY_KPI_CHART_TYPE]: 'Shows your latest recorded running or cycling VO2 max, an estimate of aerobic capacity. The trend compares readings from the same source.\n\nRequires a recorded VO2 max value; it is not calculated from your power curve.',
  [DASHBOARD_AEROBIC_DURABILITY_KPI_CHART_TYPE]: 'Shows how steadily you maintain effort during longer workouts. For running, cycling, and open-water swimming, lower aerobic decoupling means a steadier relationship between output and heart rate.\n\nFor pool swimming, higher pace retention means less slowing. Only workouts with enough suitable recorded data contribute.',
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
