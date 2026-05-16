import { ActivityTypes, DateRanges, DaysOfTheWeek, EventInterface } from '@sports-alliance/sports-lib';
import {
  AppDashboardEventTableFiltersInterface,
  AppDashboardTileEventFilterRange,
  AppDashboardTileEventFiltersInterface,
} from '../models/app-user.interface';
import { getDatesForDateRange } from './date-range-helper';

export interface DashboardTileEventRangeOption {
  range: AppDashboardTileEventFilterRange;
  label: string;
  buttonLabel: string;
  shortLabel: string;
  days?: number;
}

export interface DashboardTileEventWindow {
  range: AppDashboardTileEventFilterRange;
  startMs: number | null;
  endMs: number | null;
}

export type DashboardTileEventNavigationDirection = 'older' | 'newer';

export const DASHBOARD_TILE_EVENT_DEFAULT_RANGE: AppDashboardTileEventFilterRange = '90d';
export const DASHBOARD_TILE_EVENT_LEGACY_ALL_RANGE: AppDashboardTileEventFilterRange = '1y';
export const DASHBOARD_EVENT_TABLE_DEFAULT_DATE_RANGE = DateRanges.thisWeek;

export const DASHBOARD_TILE_EVENT_RANGE_OPTIONS: ReadonlyArray<DashboardTileEventRangeOption> = [
  { range: 'thisWeek', label: 'This week', buttonLabel: 'Week', shortLabel: 'W' },
  { range: 'thisMonth', label: 'This month', buttonLabel: 'Month', shortLabel: 'M' },
  { range: '14d', label: '14d', buttonLabel: '14d', shortLabel: '14d', days: 14 },
  { range: '30d', label: '30d', buttonLabel: '30d', shortLabel: '30d', days: 30 },
  { range: '90d', label: '90d', buttonLabel: '90d', shortLabel: '90d', days: 90 },
  { range: '1y', label: '1y', buttonLabel: '1y', shortLabel: '1y', days: 365 },
  { range: '2y', label: '2y', buttonLabel: '2y', shortLabel: '2y', days: 365 * 2 },
  { range: '3y', label: '3y', buttonLabel: '3y', shortLabel: '3y', days: 365 * 3 },
  { range: '4y', label: '4y', buttonLabel: '4y', shortLabel: '4y', days: 365 * 4 },
  { range: 'all', label: 'All', buttonLabel: 'All', shortLabel: 'All' },
];

const VALID_TILE_EVENT_RANGES = new Set<AppDashboardTileEventFilterRange>(
  DASHBOARD_TILE_EVENT_RANGE_OPTIONS.map(option => option.range),
);
const VALID_EVENT_TABLE_DATE_RANGES = new Set<number>(
  Object.values(DateRanges).filter((value): value is number => typeof value === 'number'),
);
const VALID_ACTIVITY_TYPES = new Set<string>(
  Object.values(ActivityTypes)
    .filter(value => typeof value === 'string')
    .map(value => `${value}`),
);

export function normalizeDashboardTileEventFilterRange(
  value: unknown,
  fallback: AppDashboardTileEventFilterRange = DASHBOARD_TILE_EVENT_DEFAULT_RANGE,
): AppDashboardTileEventFilterRange {
  const stringValue = `${value || ''}`;
  return VALID_TILE_EVENT_RANGES.has(stringValue as AppDashboardTileEventFilterRange)
    ? stringValue as AppDashboardTileEventFilterRange
    : fallback;
}

export function normalizeDashboardTileEventFilters(
  value: unknown,
  fallbackRange: AppDashboardTileEventFilterRange = DASHBOARD_TILE_EVENT_DEFAULT_RANGE,
  fallbackActivityTypes: ActivityTypes[] = [],
): AppDashboardTileEventFiltersInterface {
  const filters = (value || {}) as Partial<AppDashboardTileEventFiltersInterface>;
  return {
    range: normalizeDashboardTileEventFilterRange(filters.range, fallbackRange),
    activityTypes: normalizeActivityTypes(filters.activityTypes, fallbackActivityTypes),
  };
}

export function normalizeDashboardEventTableFilters(
  value: unknown,
  legacyFilters: Partial<AppDashboardEventTableFiltersInterface> = {},
): AppDashboardEventTableFiltersInterface {
  const filters = (value || {}) as Partial<AppDashboardEventTableFiltersInterface>;
  const dateRange = normalizeDashboardEventTableDateRange(
    filters.dateRange,
    normalizeDashboardEventTableDateRange(legacyFilters.dateRange, DASHBOARD_EVENT_TABLE_DEFAULT_DATE_RANGE),
  );
  return {
    searchTerm: typeof filters.searchTerm === 'string'
      ? filters.searchTerm
      : (typeof legacyFilters.searchTerm === 'string' ? legacyFilters.searchTerm : null),
    dateRange,
    startDate: finiteNumberOrNull(filters.startDate, finiteNumberOrNull(legacyFilters.startDate, null)),
    endDate: finiteNumberOrNull(filters.endDate, finiteNumberOrNull(legacyFilters.endDate, null)),
    activityTypes: normalizeActivityTypes(filters.activityTypes, normalizeActivityTypes(legacyFilters.activityTypes, [])),
    includeMergedEvents: filters.includeMergedEvents !== undefined
      ? filters.includeMergedEvents !== false
      : legacyFilters.includeMergedEvents !== false,
  };
}

export function normalizeDashboardEventTableDateRange(
  value: unknown,
  fallback: DateRanges = DASHBOARD_EVENT_TABLE_DEFAULT_DATE_RANGE,
): DateRanges {
  return typeof value === 'number' && VALID_EVENT_TABLE_DATE_RANGES.has(value)
    ? value as DateRanges
    : fallback;
}

export function resolveLegacyDashboardTileEventFilterRange(
  dateRange: DateRanges | null | undefined,
  startDate?: number | null,
  endDate?: number | null,
): AppDashboardTileEventFilterRange {
  switch (dateRange) {
    case DateRanges.thisWeek:
      return 'thisWeek';
    case DateRanges.thisMonth:
      return 'thisMonth';
    case DateRanges.lastSevenDays:
    case DateRanges.lastWeek:
      return '14d';
    case DateRanges.lastThirtyDays:
    case DateRanges.lastMonth:
      return '30d';
    case DateRanges.thisYear:
    case DateRanges.lastYear:
      return '1y';
    case DateRanges.custom:
      return resolveDurationRangeFromCustomDates(startDate, endDate);
    case DateRanges.all:
      return DASHBOARD_TILE_EVENT_LEGACY_ALL_RANGE;
    default:
      return DASHBOARD_TILE_EVENT_DEFAULT_RANGE;
  }
}

export function dashboardTileEventRangeDays(range: AppDashboardTileEventFilterRange): number | null {
  return DASHBOARD_TILE_EVENT_RANGE_OPTIONS.find(option => option.range === range)?.days ?? null;
}

export function isDashboardTileEventDurationRange(range: AppDashboardTileEventFilterRange): boolean {
  return dashboardTileEventRangeDays(range) !== null;
}

export function resolveDashboardTileEventWindow(
  filters: AppDashboardTileEventFiltersInterface | null | undefined,
  startOfTheWeek: DaysOfTheWeek = DaysOfTheWeek.Monday,
  anchorEndMs: number | null = null,
  nowMs = Date.now(),
): DashboardTileEventWindow {
  const range = normalizeDashboardTileEventFilterRange(filters?.range);
  if (range === 'all') {
    return { range, startMs: null, endMs: null };
  }

  if (range === 'thisWeek' || range === 'thisMonth') {
    const resolvedDateRange = range === 'thisWeek' ? DateRanges.thisWeek : DateRanges.thisMonth;
    const resolved = getDatesForDateRange(resolvedDateRange, startOfTheWeek);
    return {
      range,
      startMs: resolveDateMs(resolved.startDate),
      endMs: resolveDateMs(resolved.endDate),
    };
  }

  const days = dashboardTileEventRangeDays(range) ?? 90;
  const windowMs = days * 24 * 60 * 60 * 1000;
  const effectiveAnchorEndMs = Number.isFinite(anchorEndMs) && anchorEndMs !== null
    ? Math.min(anchorEndMs, nowMs)
    : nowMs;
  return {
    range,
    startMs: Math.max(0, effectiveAnchorEndMs - windowMs),
    endMs: effectiveAnchorEndMs,
  };
}

export function navigateDashboardTileEventWindow(
  filters: AppDashboardTileEventFiltersInterface | null | undefined,
  direction: DashboardTileEventNavigationDirection,
  currentAnchorEndMs: number | null,
  nowMs = Date.now(),
): number | null {
  const range = normalizeDashboardTileEventFilterRange(filters?.range);
  const days = dashboardTileEventRangeDays(range);
  if (days === null) {
    return null;
  }

  const windowMs = days * 24 * 60 * 60 * 1000;
  const currentWindow = resolveDashboardTileEventWindow(filters, DaysOfTheWeek.Monday, currentAnchorEndMs, nowMs);
  if (direction === 'older') {
    return Math.max(windowMs, (currentWindow.endMs ?? nowMs) - windowMs);
  }

  const nextEndMs = (currentWindow.endMs ?? nowMs) + windowMs;
  return nextEndMs >= nowMs ? null : nextEndMs;
}

export function filterDashboardTileEventsByActivityTypes(
  events: EventInterface[],
  activityTypes: ActivityTypes[] | null | undefined,
): EventInterface[] {
  const normalizedActivityTypes = normalizeActivityTypes(activityTypes, []);
  if (!normalizedActivityTypes.length) {
    return events;
  }
  return events.filter(event => eventMatchesDashboardActivityTypes(event, normalizedActivityTypes));
}

export function eventMatchesDashboardActivityTypes(
  event: EventInterface,
  activityTypes: ActivityTypes[] | null | undefined,
): boolean {
  const normalizedActivityTypes = normalizeActivityTypes(activityTypes, []);
  if (!normalizedActivityTypes.length) {
    return true;
  }

  const eventActivityTypes = typeof event?.getActivityTypesAsArray === 'function'
    ? event.getActivityTypesAsArray()
    : [];
  return eventActivityTypes.some(activityType => normalizedActivityTypes.includes(normalizeActivityType(activityType)));
}

export function normalizeActivityTypes(
  activityTypes: ActivityTypes[] | null | undefined,
  fallback: ActivityTypes[] = [],
): ActivityTypes[] {
  const values = Array.isArray(activityTypes) ? activityTypes : fallback;
  return values
    .map(activityType => normalizeActivityType(activityType))
    .filter((activityType, index, normalized) => (
      VALID_ACTIVITY_TYPES.has(`${activityType}`)
      && normalized.indexOf(activityType) === index
    ));
}

export function cloneDashboardTileEventFilters(
  filters: AppDashboardTileEventFiltersInterface | null | undefined,
): AppDashboardTileEventFiltersInterface | undefined {
  if (!filters) {
    return undefined;
  }
  return normalizeDashboardTileEventFilters(filters);
}

function resolveDurationRangeFromCustomDates(
  startDate?: number | null,
  endDate?: number | null,
): AppDashboardTileEventFilterRange {
  const startMs = finiteNumberOrNull(startDate, null);
  const endMs = finiteNumberOrNull(endDate, null);
  if (startMs === null || endMs === null || endMs <= startMs) {
    return DASHBOARD_TILE_EVENT_DEFAULT_RANGE;
  }

  const durationDays = Math.ceil((endMs - startMs) / (24 * 60 * 60 * 1000));
  if (durationDays <= 14) {
    return '14d';
  }
  if (durationDays <= 30) {
    return '30d';
  }
  if (durationDays <= 90) {
    return '90d';
  }
  if (durationDays <= 365) {
    return '1y';
  }
  if (durationDays <= 365 * 2) {
    return '2y';
  }
  if (durationDays <= 365 * 3) {
    return '3y';
  }
  return '4y';
}

function finiteNumberOrNull(value: unknown, fallback: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeActivityType(value: unknown): ActivityTypes {
  const keyMappedValue = ActivityTypes[value as keyof typeof ActivityTypes];
  const candidate = typeof keyMappedValue === 'string' ? keyMappedValue : value;
  return candidate as ActivityTypes;
}

function resolveDateMs(value: unknown): number | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  return null;
}
