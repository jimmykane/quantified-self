import {
  DERIVED_METRIC_KINDS,
  DerivedMetricKind,
} from '../../../shared/derived-metrics';

export const MCP_TRAINING_METRIC_CATEGORIES = [
  'load',
  'recovery',
  'intensity',
  'performance',
  'volume',
  'comparison',
  'readiness',
  'measurement',
] as const;

export type McpTrainingMetricCategory =
  typeof MCP_TRAINING_METRIC_CATEGORIES[number];

export interface McpTrainingMetricDescriptor {
  metricKind: DerivedMetricKind;
  title: string;
  description: string;
  category: McpTrainingMetricCategory;
  periodLabel: string;
}

type McpTrainingMetricPresentation = Omit<
  McpTrainingMetricDescriptor,
  'metricKind'
>;

const MCP_TRAINING_METRIC_PRESENTATION = {
  [DERIVED_METRIC_KINDS.Form]: {
    title: 'Fitness, fatigue, and Form history',
    description: 'Daily TSS-based fitness, fatigue, Form, and load history.',
    category: 'load',
    periodLabel: 'Available daily history',
  },
  [DERIVED_METRIC_KINDS.RecoveryNow]: {
    title: 'Imported recovery remaining',
    description: 'The current imported post-workout recovery estimate when one is active.',
    category: 'recovery',
    periodLabel: 'Current estimate',
  },
  [DERIVED_METRIC_KINDS.Acwr]: {
    title: 'Acute-to-chronic workload ratio',
    description: 'Seven-day acute load compared with 28-day chronic load.',
    category: 'load',
    periodLabel: 'Current value and 8-week trend',
  },
  [DERIVED_METRIC_KINDS.RampRate]: {
    title: 'Training ramp rate',
    description: 'Seven-day change in chronic training load.',
    category: 'load',
    periodLabel: 'Current value and 8-week trend',
  },
  [DERIVED_METRIC_KINDS.MonotonyStrain]: {
    title: 'Training monotony and strain',
    description: 'Weekly load consistency and the resulting strain estimate.',
    category: 'load',
    periodLabel: 'Current value and 8-week trend',
  },
  [DERIVED_METRIC_KINDS.FormNow]: {
    title: 'Current Form',
    description: 'Current TSS-based fitness minus fatigue.',
    category: 'load',
    periodLabel: 'Current value and 8-week trend',
  },
  [DERIVED_METRIC_KINDS.FormPlus7d]: {
    title: 'Seven-day Form scenario',
    description: 'Projected Form after seven days with no additional recorded load.',
    category: 'load',
    periodLabel: 'Seven-day zero-load scenario',
  },
  [DERIVED_METRIC_KINDS.EasyPercent]: {
    title: 'Easy training percentage',
    description: 'Share of recorded weekly zone time in approximate Easy groups: HR and power Z1–Z2. Auto uses usable power per activity, otherwise HR.',
    category: 'intensity',
    periodLabel: 'Latest week and 8-week trend',
  },
  [DERIVED_METRIC_KINDS.HardPercent]: {
    title: 'Hard training percentage',
    description: 'Share of recorded weekly zone time in approximate Hard groups: HR Z4–Z5; power Z5–Z7. Auto uses usable power per activity, otherwise HR.',
    category: 'intensity',
    periodLabel: 'Latest week and 8-week trend',
  },
  [DERIVED_METRIC_KINDS.EfficiencyDelta4w]: {
    title: 'Four-week efficiency change',
    description: 'Recent aerobic-efficiency evidence compared with its earlier baseline.',
    category: 'performance',
    periodLabel: 'Four-week comparison and 8-week trend',
  },
  [DERIVED_METRIC_KINDS.FreshnessForecast]: {
    title: 'Freshness forecast',
    description: 'A TSS-only zero-future-load Form scenario, not a workout recommendation.',
    category: 'load',
    periodLabel: 'Next 7 days',
  },
  [DERIVED_METRIC_KINDS.IntensityDistribution]: {
    title: 'Training intensity distribution',
    description: 'Recorded weekly intensity time: approximate HR groups Z1–Z2 / Z3 / Z4–Z5; power Z1–Z2 / Z3–Z4 / Z5–Z7. Auto uses usable power per activity, otherwise HR; mixed weeks retain both sources.',
    category: 'intensity',
    periodLabel: 'Latest 8 weeks',
  },
  [DERIVED_METRIC_KINDS.EfficiencyTrend]: {
    title: 'Aerobic efficiency trend',
    description: 'Weekly aerobic-efficiency observations from eligible activities.',
    category: 'performance',
    periodLabel: 'Latest 8 weeks',
  },
  [DERIVED_METRIC_KINDS.TrainingSummary]: {
    title: 'Training summary',
    description: 'Current volume and intensity versus an equivalent usual period. Approximate Easy/Moderate/Hard groups: HR Z1–Z2 / Z3 / Z4–Z5; power Z1–Z2 / Z3–Z4 / Z5–Z7, using usable power per activity first, otherwise HR.',
    category: 'volume',
    periodLabel: 'Current 28 days versus preceding 84 days',
  },
  [DERIVED_METRIC_KINDS.TrainingCapacity]: {
    title: 'Imported capacity observations',
    description: 'Stable imported FTP and VO2 max observations where recorded.',
    category: 'performance',
    periodLabel: 'Latest stable observations',
  },
  [DERIVED_METRIC_KINDS.TrainingPowerSystems]: {
    title: 'Rolling power systems',
    description: 'Evidence-gated CP, W-prime, and maximum-power models by exact activity type.',
    category: 'performance',
    periodLabel: '42-day model with 84-day sparse history',
  },
  [DERIVED_METRIC_KINDS.PowerCurve]: {
    title: 'Power curves',
    description: 'Best recorded mean-max power evidence across supported sports and periods.',
    category: 'performance',
    periodLabel: 'Recent through all-time ranges',
  },
  [DERIVED_METRIC_KINDS.TrainingExplanation]: {
    title: 'What drove Training',
    description: 'Load, contributor, sport-mix, and rhythm changes behind the current period.',
    category: 'comparison',
    periodLabel: 'Current 28 days versus three prior 28-day blocks',
  },
  [DERIVED_METRIC_KINDS.TrainingDurability]: {
    title: 'Aerobic durability',
    description: 'Repeated comparable-session durability evidence and exclusions.',
    category: 'performance',
    periodLabel: 'Current 28 days, usual blocks, and 12-week trend',
  },
  [DERIVED_METRIC_KINDS.TrainingBuildComparison]: {
    title: 'Best build comparison',
    description: 'Current build versus the selected historical build, including recovery. Approximate Easy/Moderate/Hard groups: HR Z1–Z2 / Z3 / Z4–Z5; power Z1–Z2 / Z3–Z4 / Z5–Z7, using usable power per activity first, otherwise HR.',
    category: 'comparison',
    periodLabel: 'Matched 8, 10, or 12-week builds',
  },
  [DERIVED_METRIC_KINDS.TrainingReadiness]: {
    title: 'Training readiness history',
    description: 'Recovery-aware readiness history using load and available normalized sleep evidence.',
    category: 'readiness',
    periodLabel: 'Latest 14 UTC days',
  },
  [DERIVED_METRIC_KINDS.BodyWeightTrend]: {
    title: 'Body-weight Training context',
    description: 'Recent recorded body-weight medians and equal-window changes for Training context.',
    category: 'measurement',
    periodLabel: 'Latest 28 UTC days',
  },
  [DERIVED_METRIC_KINDS.TrainingSwimPerformance]: {
    title: 'Swimming performance',
    description: 'Separate pool and open-water pace plus comparable SWOLF evidence.',
    category: 'performance',
    periodLabel: 'Latest 12 UTC weeks',
  },
} as const satisfies Record<
  DerivedMetricKind,
  McpTrainingMetricPresentation
>;

export function getMcpTrainingMetricDescriptors(
  search?: string,
): McpTrainingMetricDescriptor[] {
  const normalizedSearch = `${search || ''}`.trim().toLowerCase();
  return Object.values(DERIVED_METRIC_KINDS)
    .map(metricKind => ({
      metricKind,
      ...MCP_TRAINING_METRIC_PRESENTATION[metricKind],
    }))
    .filter(descriptor => (
      !normalizedSearch
      || [
        descriptor.metricKind,
        descriptor.title,
        descriptor.description,
        descriptor.category,
        descriptor.periodLabel,
      ].join(' ').toLowerCase().includes(normalizedSearch)
    ));
}
