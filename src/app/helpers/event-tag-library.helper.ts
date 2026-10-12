import { getEventTags, normalizeEventTagSuggestions, type EventTagsContainer } from '@shared/event-tags';

export interface EventTagLibraryEntry {
  key: string;
  name: string;
  count: number;
}

export function buildEventTagLibrary(
  events: readonly EventTagsContainer[],
  catalog: readonly string[],
  selectedTag = '',
): EventTagLibraryEntry[] {
  const counts = new Map<string, number>();
  for (const event of events) {
    for (const tag of getEventTags(event)) {
      const key = tag.toLowerCase();
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return normalizeEventTagSuggestions([...catalog, ...events.flatMap(getEventTags), selectedTag])
    .map(name => ({ key: name.toLowerCase(), name, count: counts.get(name.toLowerCase()) || 0 }))
    .sort((first, second) => first.name.localeCompare(second.name));
}

export function filterEventsByTag<T extends EventTagsContainer>(events: readonly T[], tag: string): T[] {
  const [normalized] = normalizeEventTagSuggestions([tag]);
  if (!normalized) return [...events];
  return events.filter(event => getEventTags(event).some(value => value.toLowerCase() === normalized.toLowerCase()));
}
