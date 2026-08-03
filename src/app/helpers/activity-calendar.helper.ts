import type { EventInterface } from '@sports-alliance/sports-lib';
import {
  ActivityTypeGroups,
  ActivityTypes,
  ActivityTypesHelper,
  DataDuration,
  DaysOfTheWeek,
  type ActivityTypeGroup,
} from '@sports-alliance/sports-lib';
import { getActivityTypeGroupLabel } from '@shared/activity-type-group.metadata';
import { AppActivityTypeGroupColors } from '../services/color/app.activity-type-group.colors';

export type ActivityCalendarView = 'week' | 'month' | 'year';

export interface ActivityCalendarRouteState {
  view: ActivityCalendarView;
  anchorDate: Date;
}

export interface ActivityCalendarQueryWindow {
  startMs: number;
  endExclusiveMs: number;
}

export interface ActivityCalendarFamilySummary {
  id: string;
  activityTypeGroup: ActivityTypeGroup;
  label: string;
  color: string;
  durationSeconds: number;
  durationLabel: string;
  eventCount: number;
  hasUnknownDuration: boolean;
  sizePercent: number;
  diameterPx: number;
  compactDiameterPx: number;
}

export interface ActivityCalendarDayViewModel {
  date: Date;
  dateKey: string;
  dayNumber: number;
  inPrimaryPeriod: boolean;
  isToday: boolean;
  eventCount: number;
  totalDurationSeconds: number;
  durationLabel: string;
  families: ActivityCalendarFamilySummary[];
  visibleFamilies: ActivityCalendarFamilySummary[];
  overflowFamilyCount: number;
  events: EventInterface[];
  tooltip: string;
  ariaLabel: string;
}

export interface ActivityCalendarMonthViewModel {
  id: string;
  label: string;
  weekdayLabels: string[];
  days: ActivityCalendarDayViewModel[];
}

export interface ActivityCalendarViewModel {
  view: ActivityCalendarView;
  periodLabel: string;
  months: ActivityCalendarMonthViewModel[];
}

export interface BuildActivityCalendarViewModelOptions {
  view: ActivityCalendarView;
  anchorDate: Date;
  startOfWeek?: DaysOfTheWeek | number | null;
  locale?: string;
  now?: Date;
}

interface ActivityCalendarFamilyIdentity {
  id: string;
  activityTypeGroup: ActivityTypeGroup;
  label: string;
  color: string;
}

interface ActivityCalendarFamilyAccumulator extends ActivityCalendarFamilyIdentity {
  durationSeconds: number;
  eventCount: number;
  hasUnknownDuration: boolean;
}

const VALID_CALENDAR_VIEWS = new Set<ActivityCalendarView>(['week', 'month', 'year']);
const CALENDAR_MONTH_GRID_DAYS = 42;
const MAX_VISIBLE_FAMILIES = 3;
const MAX_MARKER_DURATION_SECONDS = 3 * 60 * 60;
const MIN_MARKER_SIZE_PERCENT = 24;
const MIN_CONCENTRIC_SIZE_DIFFERENCE_PERCENT = 14;

export function normalizeActivityCalendarView(
  value: unknown,
  fallback: ActivityCalendarView = 'month',
): ActivityCalendarView {
  const normalized = `${value || ''}`.toLowerCase() as ActivityCalendarView;
  return VALID_CALENDAR_VIEWS.has(normalized) ? normalized : fallback;
}

export function parseActivityCalendarDate(value: unknown, fallback = new Date()): Date {
  if (typeof value !== 'string') {
    return startOfLocalDay(fallback);
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    return startOfLocalDay(fallback);
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const parsed = new Date(year, monthIndex, day);
  if (
    parsed.getFullYear() !== year
    || parsed.getMonth() !== monthIndex
    || parsed.getDate() !== day
  ) {
    return startOfLocalDay(fallback);
  }
  return parsed;
}

export function formatActivityCalendarDateParam(date: Date): string {
  const normalized = isValidDate(date) ? date : new Date();
  return [
    normalized.getFullYear(),
    `${normalized.getMonth() + 1}`.padStart(2, '0'),
    `${normalized.getDate()}`.padStart(2, '0'),
  ].join('-');
}

export function navigateActivityCalendarDate(
  anchorDate: Date,
  view: ActivityCalendarView,
  direction: -1 | 1,
): Date {
  const anchor = startOfLocalDay(isValidDate(anchorDate) ? anchorDate : new Date());
  if (view === 'week') {
    return addLocalDays(anchor, direction * 7);
  }

  const targetMonthIndex = view === 'month'
    ? anchor.getMonth() + direction
    : anchor.getMonth();
  const targetYear = view === 'year'
    ? anchor.getFullYear() + direction
    : anchor.getFullYear() + Math.floor(targetMonthIndex / 12);
  const normalizedMonthIndex = view === 'year'
    ? anchor.getMonth()
    : ((targetMonthIndex % 12) + 12) % 12;
  const lastTargetDay = new Date(targetYear, normalizedMonthIndex + 1, 0).getDate();
  return new Date(targetYear, normalizedMonthIndex, Math.min(anchor.getDate(), lastTargetDay));
}

export function resolveActivityCalendarQueryWindow(
  view: ActivityCalendarView,
  anchorDate: Date,
  startOfWeek?: DaysOfTheWeek | number | null,
): ActivityCalendarQueryWindow {
  const anchor = startOfLocalDay(isValidDate(anchorDate) ? anchorDate : new Date());
  if (view === 'week') {
    const start = startOfCalendarWeek(anchor, startOfWeek);
    return {
      startMs: start.getTime(),
      endExclusiveMs: addLocalDays(start, 7).getTime(),
    };
  }

  if (view === 'year') {
    const start = new Date(anchor.getFullYear(), 0, 1);
    return {
      startMs: start.getTime(),
      endExclusiveMs: new Date(anchor.getFullYear() + 1, 0, 1).getTime(),
    };
  }

  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = startOfCalendarWeek(monthStart, startOfWeek);
  return {
    startMs: gridStart.getTime(),
    endExclusiveMs: addLocalDays(gridStart, CALENDAR_MONTH_GRID_DAYS).getTime(),
  };
}

export function buildActivityCalendarViewModel(
  events: EventInterface[] | null | undefined,
  options: BuildActivityCalendarViewModelOptions,
): ActivityCalendarViewModel {
  const view = normalizeActivityCalendarView(options.view);
  const anchorDate = startOfLocalDay(isValidDate(options.anchorDate) ? options.anchorDate : new Date());
  const locale = options.locale;
  const now = startOfLocalDay(options.now && isValidDate(options.now) ? options.now : new Date());
  const eventsByDay = groupEventsByLocalDay(events || []);
  const weekdayLabels = buildWeekdayLabels(options.startOfWeek, locale);

  if (view === 'year') {
    const year = anchorDate.getFullYear();
    return {
      view,
      periodLabel: `${year}`,
      months: Array.from({ length: 12 }, (_, monthIndex) => buildMonthViewModel(
        new Date(year, monthIndex, 1),
        eventsByDay,
        weekdayLabels,
        options.startOfWeek,
        locale,
        now,
      )),
    };
  }

  if (view === 'week') {
    const weekStart = startOfCalendarWeek(anchorDate, options.startOfWeek);
    const days = Array.from({ length: 7 }, (_, dayIndex) => buildDayViewModel(
      addLocalDays(weekStart, dayIndex),
      eventsByDay,
      true,
      locale,
      now,
    ));
    return {
      view,
      periodLabel: formatWeekRange(weekStart, addLocalDays(weekStart, 6), locale),
      months: [{
        id: `week-${formatActivityCalendarDateParam(weekStart)}`,
        label: formatWeekRange(weekStart, addLocalDays(weekStart, 6), locale),
        weekdayLabels,
        days,
      }],
    };
  }

  const monthStart = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
  return {
    view,
    periodLabel: formatMonthLabel(monthStart, locale),
    months: [buildMonthViewModel(
      monthStart,
      eventsByDay,
      weekdayLabels,
      options.startOfWeek,
      locale,
      now,
    )],
  };
}

export function formatActivityCalendarDuration(durationSeconds: number, unknown = false): string {
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0 || (durationSeconds === 0 && unknown)) {
    return 'Duration unavailable';
  }
  if (durationSeconds < 60) {
    return durationSeconds === 0 ? '0m' : '<1m';
  }

  const totalMinutes = Math.round(durationSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!hours) {
    return `${minutes}m`;
  }
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

export function resolveActivityCalendarEventDurationSeconds(event: EventInterface): number | null {
  const durationStat = event?.getStat?.(DataDuration.type);
  const rawValue = durationStat
    ? (durationStat as { getValue?: () => unknown }).getValue?.()
    : null;
  if (rawValue === null || rawValue === undefined || rawValue === '') {
    return null;
  }
  const durationSeconds = Number(rawValue);
  return Number.isFinite(durationSeconds) && durationSeconds >= 0 ? durationSeconds : null;
}

export function resolveActivityCalendarEventLabel(event: EventInterface): string {
  const candidateLabels = [
    event?.name,
    event?.description,
    event?.getActivityTypesAsString?.(),
  ];
  for (const candidate of candidateLabels) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return 'Activity';
}

function buildMonthViewModel(
  monthStart: Date,
  eventsByDay: Map<string, EventInterface[]>,
  weekdayLabels: string[],
  startOfWeek: DaysOfTheWeek | number | null | undefined,
  locale: string | undefined,
  now: Date,
): ActivityCalendarMonthViewModel {
  const gridStart = startOfCalendarWeek(monthStart, startOfWeek);
  return {
    id: `${monthStart.getFullYear()}-${`${monthStart.getMonth() + 1}`.padStart(2, '0')}`,
    label: formatMonthLabel(monthStart, locale),
    weekdayLabels,
    days: Array.from({ length: CALENDAR_MONTH_GRID_DAYS }, (_, dayIndex) => {
      const date = addLocalDays(gridStart, dayIndex);
      return buildDayViewModel(
        date,
        eventsByDay,
        date.getMonth() === monthStart.getMonth() && date.getFullYear() === monthStart.getFullYear(),
        locale,
        now,
      );
    }),
  };
}

function buildDayViewModel(
  date: Date,
  eventsByDay: Map<string, EventInterface[]>,
  inPrimaryPeriod: boolean,
  locale: string | undefined,
  now: Date,
): ActivityCalendarDayViewModel {
  const dateKey = formatActivityCalendarDateParam(date);
  const events = [...(eventsByDay.get(dateKey) || [])].sort((left, right) => (
    (resolveEventStartDate(left)?.getTime() || 0) - (resolveEventStartDate(right)?.getTime() || 0)
  ));
  const familyAccumulators = new Map<string, ActivityCalendarFamilyAccumulator>();
  events.forEach((event) => {
    const family = resolveEventFamilyIdentity(event);
    const durationSeconds = resolveActivityCalendarEventDurationSeconds(event);
    const accumulator = familyAccumulators.get(family.id) || {
      ...family,
      durationSeconds: 0,
      eventCount: 0,
      hasUnknownDuration: false,
    };
    accumulator.durationSeconds += durationSeconds || 0;
    accumulator.eventCount += 1;
    accumulator.hasUnknownDuration = accumulator.hasUnknownDuration || durationSeconds === null;
    familyAccumulators.set(family.id, accumulator);
  });

  const sortedAccumulators = [...familyAccumulators.values()].sort((left, right) => (
    right.durationSeconds - left.durationSeconds
    || right.eventCount - left.eventCount
    || left.label.localeCompare(right.label)
  ));
  let maximumSizePercent = 100;
  const families = sortedAccumulators.map<ActivityCalendarFamilySummary>((family) => {
    const targetSize = calculateMarkerSizePercent(family.durationSeconds);
    const sizePercent = Math.max(MIN_MARKER_SIZE_PERCENT, Math.min(targetSize, maximumSizePercent));
    maximumSizePercent = Math.max(
      MIN_MARKER_SIZE_PERCENT,
      sizePercent - MIN_CONCENTRIC_SIZE_DIFFERENCE_PERCENT,
    );
    return {
      ...family,
      durationLabel: formatActivityCalendarDuration(family.durationSeconds, family.hasUnknownDuration),
      sizePercent,
      diameterPx: Math.round(8 + ((30 - 8) * sizePercent / 100)),
      compactDiameterPx: Math.round(4 + ((18 - 4) * sizePercent / 100)),
    };
  });
  const totalDurationSeconds = families.reduce((total, family) => total + family.durationSeconds, 0);
  const hasUnknownDuration = families.some(family => family.hasUnknownDuration);
  const durationLabel = formatActivityCalendarDuration(totalDurationSeconds, hasUnknownDuration && totalDurationSeconds === 0);
  const dateLabel = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
  const familySummary = families
    .map(family => `${family.label} ${family.durationLabel}`)
    .join(', ');
  const activitySummary = events.length
    ? `${events.length} ${events.length === 1 ? 'activity' : 'activities'}, ${durationLabel}`
    : 'No activities';
  const tooltip = familySummary ? `${dateLabel}\n${familySummary}` : `${dateLabel}\nNo activities`;

  return {
    date,
    dateKey,
    dayNumber: date.getDate(),
    inPrimaryPeriod,
    isToday: date.getTime() === now.getTime(),
    eventCount: events.length,
    totalDurationSeconds,
    durationLabel,
    families,
    visibleFamilies: families.slice(0, MAX_VISIBLE_FAMILIES),
    overflowFamilyCount: Math.max(0, families.length - MAX_VISIBLE_FAMILIES),
    events,
    tooltip,
    ariaLabel: `${dateLabel}. ${activitySummary}${familySummary ? `. ${familySummary}` : ''}`,
  };
}

function groupEventsByLocalDay(events: EventInterface[]): Map<string, EventInterface[]> {
  const eventsByDay = new Map<string, EventInterface[]>();
  events.forEach((event) => {
    const startDate = resolveEventStartDate(event);
    if (!startDate) {
      return;
    }
    const key = formatActivityCalendarDateParam(startDate);
    eventsByDay.set(key, [...(eventsByDay.get(key) || []), event]);
  });
  return eventsByDay;
}

function resolveEventStartDate(event: EventInterface): Date | null {
  const rawStartDate = (event as { startDate?: unknown } | null)?.startDate;
  if (rawStartDate instanceof Date && isValidDate(rawStartDate)) {
    return rawStartDate;
  }
  if (typeof rawStartDate === 'number' || typeof rawStartDate === 'string') {
    const parsed = new Date(rawStartDate);
    return isValidDate(parsed) ? parsed : null;
  }
  if (rawStartDate && typeof (rawStartDate as { toDate?: () => unknown }).toDate === 'function') {
    const parsed = (rawStartDate as { toDate: () => unknown }).toDate();
    return parsed instanceof Date && isValidDate(parsed) ? parsed : null;
  }
  return null;
}

function resolveEventFamilyIdentity(event: EventInterface): ActivityCalendarFamilyIdentity {
  const groups = new Set<ActivityTypeGroup>();
  const activityTypes = Array.isArray(event?.getActivityTypesAsArray?.())
    ? event.getActivityTypesAsArray()
    : [];
  activityTypes.forEach((activityType) => {
    const group = resolveActivityTypeGroup(activityType);
    if (group) {
      groups.add(group);
    }
  });

  if (groups.size > 1) {
    return {
      id: 'multisport',
      activityTypeGroup: ActivityTypeGroups.UnspecifiedGroup,
      label: 'Multisport',
      color: AppActivityTypeGroupColors[ActivityTypeGroups.UnspecifiedGroup],
    };
  }

  const group = [...groups][0] || ActivityTypeGroups.UnspecifiedGroup;
  return {
    id: `${group}`,
    activityTypeGroup: group,
    label: getActivityTypeGroupLabel(group),
    color: AppActivityTypeGroupColors[group],
  };
}

function resolveActivityTypeGroup(activityType: unknown): ActivityTypeGroup | null {
  if (activityType === ActivityTypes.Trekking) {
    return ActivityTypeGroups.OutdoorAdventuresGroup;
  }
  try {
    return ActivityTypesHelper.getActivityGroupForActivityType(activityType as ActivityTypes)
      || ActivityTypeGroups.UnspecifiedGroup;
  } catch {
    return ActivityTypeGroups.UnspecifiedGroup;
  }
}

function calculateMarkerSizePercent(durationSeconds: number): number {
  if (durationSeconds <= 0) {
    return MIN_MARKER_SIZE_PERCENT;
  }
  const ratio = Math.sqrt(Math.min(durationSeconds, MAX_MARKER_DURATION_SECONDS) / MAX_MARKER_DURATION_SECONDS);
  return MIN_MARKER_SIZE_PERCENT + ((100 - MIN_MARKER_SIZE_PERCENT) * ratio);
}

function buildWeekdayLabels(
  startOfWeek: DaysOfTheWeek | number | null | undefined,
  locale: string | undefined,
): string[] {
  const normalizedStart = normalizeStartOfWeek(startOfWeek);
  const referenceSunday = new Date(2024, 0, 7);
  const formatter = new Intl.DateTimeFormat(locale, { weekday: 'short' });
  return Array.from({ length: 7 }, (_, index) => (
    formatter.format(addLocalDays(referenceSunday, (normalizedStart + index) % 7))
  ));
}

function formatMonthLabel(date: Date, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(date);
}

function formatWeekRange(start: Date, end: Date, locale?: string): string {
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  const startLabel = new Intl.DateTimeFormat(locale, sameMonth
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: start.getFullYear() !== end.getFullYear() ? 'numeric' : undefined }
  ).format(start);
  const endLabel = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric' }).format(end);
  return `${startLabel} - ${endLabel}`;
}

function startOfCalendarWeek(
  date: Date,
  startOfWeek: DaysOfTheWeek | number | null | undefined,
): Date {
  const normalizedDate = startOfLocalDay(date);
  const normalizedStart = normalizeStartOfWeek(startOfWeek);
  const dayOffset = (normalizedDate.getDay() - normalizedStart + 7) % 7;
  return addLocalDays(normalizedDate, -dayOffset);
}

function normalizeStartOfWeek(value: DaysOfTheWeek | number | null | undefined): number {
  const numericValue = Number(value);
  return Number.isInteger(numericValue) && numericValue >= 0 && numericValue <= 6
    ? numericValue
    : Number(DaysOfTheWeek.Monday);
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addLocalDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function isValidDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}
