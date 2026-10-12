import { describe, expect, it } from 'vitest';
import { buildEventTagLibrary, filterEventsByTag, reconcileTagLibraryEvents } from './event-tag-library.helper';

describe('Event tag library', () => {
  const events = [
    { getID: () => 'a', tags: ['endurance', 'Endurance', 'Outdoors'] },
    { getID: () => 'b', benchmarkReviewTags: ['ENDURANCE'] },
    { getID: () => 'c', tags: [], benchmarkReviewTags: ['Endurance'] },
  ];
  it('counts each event once per case-insensitive tag and preserves catalog spelling and empty saved tags', () => {
    expect(buildEventTagLibrary(events, ['Endurance', 'Race day'])).toEqual([
      { key: 'endurance', name: 'Endurance', count: 2 },
      { key: 'outdoors', name: 'Outdoors', count: 1 },
      { key: 'race day', name: 'Race day', count: 0 },
    ]);
  });
  it('keeps a deep-linked tag visible before membership or the catalog is loaded', () => {
    expect(buildEventTagLibrary([], [], '  Race   day ')).toEqual([{ key: 'race day', name: 'Race day', count: 0 }]);
  });
  it('filters all loaded history with legacy fallback and canonical empty-tag precedence', () => {
    expect(filterEventsByTag(events, ' ENDURANCE ')).toEqual(events.slice(0, 2));
    expect(filterEventsByTag(events, '')).toEqual(events);
    expect(filterEventsByTag(events, 'Race day')).toEqual([]);
  });
  it('reconciles deletions and replacements without removing events outside the selected tag', () => {
    const replacement = { ...events[0], tags: ['Recovery'] };
    const next = reconcileTagLibraryEvents(events, events.slice(0, 2), [replacement]);
    expect(next).toEqual([replacement, events[2]]);
    expect(events).toHaveLength(3);
  });
});
