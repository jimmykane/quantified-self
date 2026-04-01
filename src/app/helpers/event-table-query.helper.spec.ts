import { describe, expect, it } from 'vitest';
import {
  eventMatchesSearchTerms,
  sortEventsForTable,
  tokenizeEventTableSearchTerms,
} from './event-table-query.helper';
import {
  DataDistance,
  DataDuration,
  DataPowerAvg,
} from '@sports-alliance/sports-lib';

class MockStat {
  constructor(
    private readonly type: string,
    private readonly value: unknown,
    private readonly displayValue: string = String(value),
    private readonly displayUnit: string = '',
  ) {
  }

  getType() {
    return this.type;
  }

  getValue() {
    return this.value;
  }

  getDisplayValue() {
    return this.displayValue;
  }

  getDisplayUnit() {
    return this.displayUnit;
  }
}

class MockEvent {
  constructor(
    public readonly id: string,
    public name: string,
    public description: string,
    public startDate: Date,
    private readonly stats: MockStat[] = [],
  ) {
  }

  privacy = 'public';
  isMerge = false;

  getStat(type: string) {
    return this.stats.find((stat) => stat.getType() === type) || null;
  }

  getStatsAsArray() {
    return this.stats;
  }

  getActivityTypesAsString() {
    return 'Run';
  }

  getActivityTypesAsArray() {
    return ['Run'];
  }

  getDeviceNamesAsString() {
    return 'Garmin';
  }
}

describe('event-table-query.helper', () => {
  it('tokenizes comma-separated search terms', () => {
    expect(tokenizeEventTableSearchTerms('  run , 12k,   ')).toEqual(['run', '12k']);
  });

  it('matches terms against metadata and stats corpus', () => {
    const event = new MockEvent(
      'e1',
      'Tempo Run',
      'Afternoon training',
      new Date('2024-01-15T10:00:00.000Z'),
      [
        new MockStat(DataDistance.type, 12000, '12', 'km'),
        new MockStat(DataPowerAvg.type, 280, '280', 'w'),
      ],
    ) as any;

    expect(eventMatchesSearchTerms(event, ['tempo'])).toBe(true);
    expect(eventMatchesSearchTerms(event, ['garmin'])).toBe(true);
    expect(eventMatchesSearchTerms(event, ['12 km'])).toBe(true);
    expect(eventMatchesSearchTerms(event, ['unknown'])).toBe(false);
  });

  it('sorts globally using numeric stat columns', () => {
    const events = [
      new MockEvent('e1', 'A', '', new Date('2024-01-01T00:00:00.000Z'), [new MockStat(DataDistance.type, 5000)]),
      new MockEvent('e2', 'B', '', new Date('2024-01-01T00:00:00.000Z'), [new MockStat(DataDistance.type, 10000)]),
      new MockEvent('e3', 'C', '', new Date('2024-01-01T00:00:00.000Z'), [new MockStat(DataDistance.type, 2000)]),
    ] as any;

    const sortedAsc = sortEventsForTable(events, DataDistance.type, 'asc').map((event: MockEvent) => event.id);
    const sortedDesc = sortEventsForTable(events, DataDistance.type, 'desc').map((event: MockEvent) => event.id);

    expect(sortedAsc).toEqual(['e3', 'e1', 'e2']);
    expect(sortedDesc).toEqual(['e2', 'e1', 'e3']);
  });

  it('sorts start date and preserves source order for equal keys', () => {
    const events = [
      new MockEvent('e1', 'B', '', new Date('2024-01-02T00:00:00.000Z'), [new MockStat(DataDuration.type, 10)]),
      new MockEvent('e2', 'A', '', new Date('2024-01-01T00:00:00.000Z'), [new MockStat(DataDuration.type, 10)]),
      new MockEvent('e3', 'C', '', new Date('2024-01-03T00:00:00.000Z'), [new MockStat(DataDuration.type, 10)]),
    ] as any;

    expect(sortEventsForTable(events, 'Start Date', 'asc').map((event: MockEvent) => event.id)).toEqual(['e2', 'e1', 'e3']);
    expect(sortEventsForTable(events, DataDuration.type, 'asc').map((event: MockEvent) => event.id)).toEqual(['e1', 'e2', 'e3']);
  });
});
