import type { EventTagsContainer } from '@shared/event-tags';
import { getEventTags } from '@shared/event-tags';
import { CompatibleTrainingActivityTypes, resolveCompatibleActivityType } from '@shared/activity-type-compatibility';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { filterEventsByTag } from './event-tag-library.helper';

export const ACTIVITY_EXPLORER_PERIODS = [
  { value: 'month', label: 'Last 30 days' },
  { value: 'week', label: 'Last 7 days' },
  { value: 'quarter', label: 'Last 90 days' },
  { value: 'year', label: 'This year' },
  { value: 'all', label: 'All dates' },
] as const;
export type ActivityExplorerPeriod = typeof ACTIVITY_EXPLORER_PERIODS[number]['value'];

export function activityExplorerDateRange(period: ActivityExplorerPeriod, now: Date): { start: Date; end: Date } | null {
  if (period === 'all') return null;
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
  tag: string;
  untagged: boolean;
  sport: string;
  period: ActivityExplorerPeriod;
}

export function normalizeActivityExplorerSport(value: string): string {
  return resolveCompatibleActivityType(value) || value.trim();
}

export function activityExplorerSports(events: readonly ActivityExplorerEvent[], selected = '', includeCatalog = false): string[] {
  return [...new Set([...(includeCatalog ? [...Object.values(ActivityTypes), ...Object.values(CompatibleTrainingActivityTypes)] : []),
    ...events.flatMap(event => event.getActivityTypesAsArray()), selected]
    .map(normalizeActivityExplorerSport).filter(Boolean))]
    .sort((first, second) => first.localeCompare(second));
}

/** Multisport events match any recorded sport within the selected local date range. */
export function filterActivityExplorerEvents<T extends ActivityExplorerEvent>(
  events: readonly T[], filters: ActivityExplorerFilters, now = new Date(),
): T[] {
  const range = activityExplorerDateRange(filters.period, now);
  const sport = normalizeActivityExplorerSport(filters.sport);
  return filterEventsByTag(events, filters.tag).filter(event => (
    (!filters.untagged || getEventTags(event).length === 0)
    && (!sport || event.getActivityTypesAsArray().some(type => normalizeActivityExplorerSport(type) === sport))
    && (!range || (
      event.startDate instanceof Date
      && event.startDate >= range.start && event.startDate < range.end
    ))
  ));
}
