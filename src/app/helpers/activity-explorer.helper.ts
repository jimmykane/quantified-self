import { resolveActivityDateRange } from './activity-date-range.helper';
export { normalizeActivityRangeDates as normalizeActivityExplorerCustomDates } from './activity-date-range.helper';
import type { EventTagsContainer } from '@shared/event-tags';
import { getEventTags } from '@shared/event-tags';
import { CompatibleTrainingActivityTypes, resolveCompatibleActivityType } from '@shared/activity-type-compatibility';
import { ActivityTypes } from '@sports-alliance/sports-lib';

export const ACTIVITY_EXPLORER_PERIODS = [
  { value: 'month', label: '30 days' },
  { value: 'week', label: '7 days' },
  { value: 'calendar-week', label: 'Week' },
  { value: 'quarter', label: '90 days' },
  { value: 'year', label: 'Year' },
  { value: 'custom', label: 'Custom dates' },
  { value: 'all', label: 'All dates' },
] as const;
export type ActivityExplorerPeriod = typeof ACTIVITY_EXPLORER_PERIODS[number]['value'];

export interface ActivityExplorerCustomDates {
  startDate: string;
  endDate: string;
}

export function activityExplorerDateRange(
  period: ActivityExplorerPeriod, now: Date, customDates?: ActivityExplorerCustomDates | null, startOfWeek = 1, anchor?: string | null,
): { start: Date; end: Date } | null | undefined {
  return resolveActivityDateRange(period, now, customDates, startOfWeek, anchor);
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
