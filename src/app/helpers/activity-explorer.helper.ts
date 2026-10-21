import type { EventTagsContainer } from '@shared/event-tags';
import { getEventTags } from '@shared/event-tags';
import { resolveCompatibleActivityType } from '@shared/activity-type-compatibility';
import { filterEventsByTag } from './event-tag-library.helper';

export type ActivityExplorerPeriod = 'all' | 'week';

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

export function activityExplorerSports(events: readonly ActivityExplorerEvent[], selected = ''): string[] {
  return [...new Set([...events.flatMap(event => event.getActivityTypesAsArray()), selected]
    .map(normalizeActivityExplorerSport).filter(Boolean))]
    .sort((first, second) => first.localeCompare(second));
}

/** Filters the loaded history only; multi-sport events match any recorded sport. */
export function filterActivityExplorerEvents<T extends ActivityExplorerEvent>(
  events: readonly T[], filters: ActivityExplorerFilters, now = new Date(),
): T[] {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 6);
  const end = new Date(now);
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() + 1);
  const sport = normalizeActivityExplorerSport(filters.sport);
  return filterEventsByTag(events, filters.tag).filter(event => (
    (!filters.untagged || getEventTags(event).length === 0)
    && (!sport || event.getActivityTypesAsArray().some(type => normalizeActivityExplorerSport(type) === sport))
    && (filters.period === 'all' || (
      event.startDate instanceof Date
      && event.startDate >= start && event.startDate < end
    ))
  ));
}
