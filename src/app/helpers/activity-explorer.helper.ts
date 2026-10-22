import type { EventTagsContainer } from '@shared/event-tags';
import { getEventTags } from '@shared/event-tags';
import { CompatibleTrainingActivityTypes, resolveCompatibleActivityType } from '@shared/activity-type-compatibility';
import { ActivityTypes } from '@sports-alliance/sports-lib';

export const ACTIVITY_EXPLORER_PERIODS = [
  { value: 'month', label: 'Last 30 days' },
  { value: 'week', label: 'Last 7 days' },
  { value: 'quarter', label: 'Last 90 days' },
  { value: 'year', label: 'This year' },
  { value: 'custom', label: 'Custom dates' },
  { value: 'all', label: 'All dates' },
] as const;
export type ActivityExplorerPeriod = typeof ACTIVITY_EXPLORER_PERIODS[number]['value'];

export interface ActivityExplorerCustomDates {
  startDate: string;
  endDate: string;
}

function parseLocalDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

export function normalizeActivityExplorerCustomDates(startDate: unknown, endDate: unknown): ActivityExplorerCustomDates | null {
  const start = parseLocalDate(startDate);
  const end = parseLocalDate(endDate);
  return start && end && start <= end ? { startDate: startDate as string, endDate: endDate as string } : null;
}

export function activityExplorerDateRange(
  period: ActivityExplorerPeriod, now: Date, customDates?: ActivityExplorerCustomDates | null,
): { start: Date; end: Date } | null | undefined {
  if (period === 'all') return null;
  if (period === 'custom') {
    const dates = normalizeActivityExplorerCustomDates(customDates?.startDate, customDates?.endDate);
    if (!dates) return undefined;
    const start = parseLocalDate(dates.startDate)!;
    const end = parseLocalDate(dates.endDate)!;
    end.setDate(end.getDate() + 1);
    return { start, end };
  }
  const end = new Date(now);
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() + 1);
  const start = new Date(end);
  if (period === 'year') start.setFullYear(now.getFullYear(), 0, 1);
  else start.setDate(start.getDate() - (period === 'week' ? 7 : period === 'quarter' ? 90 : 30));
  return { start, end };
}

interface ActivityExplorerEvent extends EventTagsContainer {
  startDate?: Date;
  getActivityTypesAsArray(): string[];
}

export interface ActivityExplorerFilters {
  tags: readonly string[];
  untagged: boolean;
  sports: readonly string[];
  period: ActivityExplorerPeriod;
  customDates?: ActivityExplorerCustomDates | null;
}

export function normalizeActivityExplorerSport(value: string): string {
  return resolveCompatibleActivityType(value) || value.trim();
}

export function normalizeActivityExplorerSports(values: readonly string[]): string[] {
  return [...new Set(values.map(value => normalizeActivityExplorerSport(value.trim().slice(0, 100))).filter(Boolean))]
    .sort((first, second) => first.localeCompare(second));
}

export function activityExplorerSports(events: readonly ActivityExplorerEvent[], selected: readonly string[] = [], includeCatalog = false): string[] {
  return [...new Set([...(includeCatalog ? [...Object.values(ActivityTypes), ...Object.values(CompatibleTrainingActivityTypes)] : []),
    ...events.flatMap(event => event.getActivityTypesAsArray()), ...selected]
    .map(normalizeActivityExplorerSport).filter(Boolean))]
    .sort((first, second) => first.localeCompare(second));
}

/** Multisport events match any recorded sport within the selected local date range. */
export function filterActivityExplorerEvents<T extends ActivityExplorerEvent>(
  events: readonly T[], filters: ActivityExplorerFilters, now = new Date(),
): T[] {
  const range = activityExplorerDateRange(filters.period, now, filters.customDates);
  if (range === undefined) return [];
  const sports = new Set(normalizeActivityExplorerSports(filters.sports));
  const tags = new Set(filters.tags.map(tag => tag.toLowerCase()));
  return events.filter(event => (
    ((!tags.size && !filters.untagged)
      || getEventTags(event).some(tag => tags.has(tag.toLowerCase()))
      || (filters.untagged && getEventTags(event).length === 0))
    && (!sports.size || event.getActivityTypesAsArray().some(type => sports.has(normalizeActivityExplorerSport(type))))
    && (!range || (
      event.startDate instanceof Date
      && event.startDate >= range.start && event.startDate < range.end
    ))
  ));
}
