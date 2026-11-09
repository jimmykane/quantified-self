import type {
  AppDashboardTodaySettings,
  DashboardTodayMetricId,
} from '../models/app-user.interface';

export const DASHBOARD_TODAY_METRICS: readonly {
  id: DashboardTodayMetricId;
  label: string;
  detail: string;
}[] = [
  { id: 'load', label: 'Load', detail: 'Form and your weekly fitness change' },
  {
    id: 'sleep',
    label: 'Sleep',
    detail: 'Recent sleep score and duration',
  },
  {
    id: 'hrv',
    label: 'HRV',
    detail: '7-day average compared with your usual range',
  },
  {
    id: 'overnight-hr',
    label: 'Overnight HR',
    detail: 'Overnight heart rate compared with your usual level',
  },
  {
    id: 'weight',
    label: 'Weight',
    detail: 'Latest weigh-in, with its date and source',
  },
  {
    id: 'tss',
    label: 'TSS',
    detail: 'Training Stress Score from today’s activities',
  },
  {
    id: 'ascent',
    label: 'Ascent',
    detail: 'Elevation gained during activities',
  },
  {
    id: 'duration',
    label: 'Activity duration',
    detail: 'Total recorded activity time',
  },
  {
    id: 'distance',
    label: 'Distance',
    detail: 'Total recorded activity distance',
  },
  {
    id: 'activities',
    label: 'Activities',
    detail: 'Number of activities recorded today',
  },
  {
    id: 'steps',
    label: 'Steps',
    detail: 'Today’s step count, using your source choice in Health',
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

/** An absent field belongs to an existing account, not a new-account reset. */
export function normalizeDashboardTodaySettings(
  value: unknown
): AppDashboardTodaySettings {
  const legacy: AppDashboardTodaySettings = {
    version: 1,
    trainingState: true,
    readiness: true,
    recovery: true,
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
