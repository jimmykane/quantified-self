/** Lightweight canonical identities. Do not import builders, sport registries or payloads here. */
export const DERIVED_METRIC_KINDS = {
  Form: 'form',
  RecoveryNow: 'recovery_now',
  Acwr: 'acwr',
  RampRate: 'ramp_rate',
  MonotonyStrain: 'monotony_strain',
  FormNow: 'form_now',
  FormPlus7d: 'form_plus_7d',
  EasyPercent: 'easy_percent',
  HardPercent: 'hard_percent',
  EfficiencyDelta4w: 'efficiency_delta_4w',
  FreshnessForecast: 'freshness_forecast',
  IntensityDistribution: 'intensity_distribution',
  EfficiencyTrend: 'efficiency_trend',
  TrainingSummary: 'training_summary',
  TrainingCapacity: 'training_capacity',
  TrainingPowerSystems: 'training_power_systems',
  PowerCurve: 'power_curve',
  TrainingExplanation: 'training_explanation',
  TrainingDurability: 'training_durability',
  TrainingBuildComparison: 'training_build_comparison',
  TrainingReadiness: 'training_readiness',
  BodyWeightTrend: 'body_weight_trend',
  TrainingSwimPerformance: 'training_swim_performance',
} as const;

export type DerivedMetricKind = typeof DERIVED_METRIC_KINDS[keyof typeof DERIVED_METRIC_KINDS];
export const DERIVED_METRICS_COLLECTION_ID = 'derivedMetrics';
export const DERIVED_METRICS_COORDINATOR_DOC_ID = 'coordinator';
export const DERIVED_METRICS_ENTRY_TYPES = { Coordinator: 'coordinator', Snapshot: 'snapshot' } as const;

export function isDerivedMetricKind(value: unknown): value is DerivedMetricKind {
  return Object.values(DERIVED_METRIC_KINDS).includes(`${value}` as DerivedMetricKind);
}

export function normalizeDerivedMetricKindsStrict(metricKinds: readonly unknown[] | null | undefined): DerivedMetricKind[] {
  return Array.from(new Set(
    (metricKinds || [])
      .filter(isDerivedMetricKind)
      .map(metricKind => `${metricKind}` as DerivedMetricKind),
  ));
}
