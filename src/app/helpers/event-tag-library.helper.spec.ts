import { describe, expect, it } from 'vitest';
import { buildEventTagLibrary, filterEventsByTag, getTagLibraryActivityName } from './event-tag-library.helper';

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
  it('hides only an ISO name equal to the recorded start time, preserving the stored fields', () => {
    const event = { name: '2026-10-11T08:15:00.000Z', startDate: new Date('2026-10-11T08:15:00.000Z'), description: 'Recorded description' };
    expect(getTagLibraryActivityName(event)).toBe('');
    expect(event.name).toBe('2026-10-11T08:15:00.000Z');
    expect(event.description).toBe('Recorded description');
  });
  it.each(['Sunday long run', 'Race 2026-10-11', '2026-10-11', '2026-10-12T08:15:00.000Z'])('preserves the custom name %s', name => {
    expect(getTagLibraryActivityName({ name, startDate: new Date('2026-10-11T08:15:00.000Z') })).toBe(name);
  });
  it('retains timestamp names when there is no valid start time to identify a generated name', () => {
    const name = '2026-10-11T08:15:00.000Z';
    expect(getTagLibraryActivityName({ name })).toBe(name);
    expect(getTagLibraryActivityName({ name, startDate: new Date(NaN) })).toBe(name);
  });
  it('keeps the existing description and untitled fallbacks when the name is missing', () => {
    expect(getTagLibraryActivityName({ description: 'Morning ride' })).toBe('Morning ride');
    expect(getTagLibraryActivityName({})).toBe('Untitled activity');
  });
});
