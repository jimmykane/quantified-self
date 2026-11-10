import type {
  AppDashboardTodaySettings,
  DashboardTodayMetricId,
} from '../models/app-user.interface';

export const DASHBOARD_TODAY_METRICS: readonly {
  id: DashboardTodayMetricId;
  label: string;
  detail: string;
}[] = [
  { id: 'load', label: 'Load', detail: 'Training balance and 7-day fitness change' },
  {
    id: 'sleep',
    label: 'Sleep',
    detail: 'Latest sleep score and duration',
  },
  {
    id: 'hrv',
    label: 'HRV',
    detail: '7-day heart rate variability average and usual range',
  },
  {
    id: 'overnight-hr',
    label: 'Overnight HR',
    detail: 'Overnight heart rate compared with your usual level',
  },
  {
    id: 'weight',
    label: 'Weight',
    detail: 'Most recent weigh-in, including its date and source',
  },
  {
    id: 'tss',
    label: 'TSS',
    detail: 'Training Stress Score from today’s activities',
  },
  {
    id: 'ascent',
    label: 'Ascent',
    detail: 'Total elevation gained in today’s activities',
  },
  {
    id: 'duration',
    label: 'Activity duration',
    detail: 'Total duration of today’s activities',
  },
  {
    id: 'distance',
    label: 'Distance',
    detail: 'Total distance covered in today’s activities',
  },
  {
    id: 'activities',
    label: 'Activities',
    detail: 'Number of activities recorded today',
  },
  {
    id: 'steps',
    label: 'Steps',
    detail: 'Today’s step count from your selected Health source',
  },
];
const ids = new Set(DASHBOARD_TODAY_METRICS.map((item) => item.id));

export function defaultDashboardTodaySettings(): AppDashboardTodaySettings {
  return {
    version: 1,
    trainingState: true,
    readiness: true,
    recovery: false,
    suggestion: false,
    metrics: ['load'],
  };
}

/** Preserve legacy summaries and metrics, but keep Recovery opt-in. */
export function normalizeDashboardTodaySettings(
  value: unknown
): AppDashboardTodaySettings {
  const legacy: AppDashboardTodaySettings = {
    version: 1,
    trainingState: true,
    readiness: true,
    recovery: false,
    suggestion: true,
    metrics: ['load', 'sleep', 'hrv', 'overnight-hr'],
  };
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return legacy;
  const source = value as Record<string, unknown>;
  if (source.version !== 1) return legacy;
  for (const key of [
    'trainingState',
    'readiness',
    'recovery',
    'suggestion',
  ] as const) {
    if (typeof source[key] === 'boolean') legacy[key] = source[key];
  }
  if (Array.isArray(source.metrics))
    legacy.metrics = [
      ...new Set(
        source.metrics.filter(
          (id): id is DashboardTodayMetricId =>
            typeof id === 'string' && ids.has(id as DashboardTodayMetricId)
        )
      ),
    ];
  return legacy;
}

export function dashboardTodayDependencies(
  settings: AppDashboardTodaySettings
) {
  const has = (id: DashboardTodayMetricId) => settings.metrics.includes(id);
  return {
    load:
      settings.trainingState ||
      settings.readiness ||
      settings.suggestion ||
      has('load'),
    sleep:
      settings.readiness ||
      settings.suggestion ||
      has('sleep') ||
      has('hrv') ||
      has('overnight-hr'),
    recovery: settings.recovery,
    activities: ['tss', 'ascent', 'duration', 'distance', 'activities'].some(
      (id) => settings.metrics.includes(id as DashboardTodayMetricId)
    ),
    weight: has('weight'),
    steps: has('steps'),
  };
}

export function dashboardTodaySignalVisible(
  id: string,
  settings: AppDashboardTodaySettings
): boolean {
  return id === 'readiness'
    ? settings.readiness
    : id === 'training-load'
      ? settings.trainingState
      : settings.metrics.includes(id as DashboardTodayMetricId);
}
