import {
  DataAerobicTrainingEffect,
  DataAscent,
  DataDescent,
  DataDistance,
  DataDuration,
  DataEnergy,
  DataFeeling,
  DataHeartRateAvg,
  DataPeakEPOC,
  DataPowerAvg,
  DataPowerMax,
  DataRPE,
  DataRecoveryTime,
  DataSpeedAvg,
  DataVO2Max,
  EventInterface,
} from '@sports-alliance/sports-lib';

export type EventTableSortDirection = 'asc' | 'desc' | '';

const SORTABLE_NUMERIC_STAT_BY_COLUMN: Record<string, string> = {
  [DataDistance.type]: DataDistance.type,
  [DataDuration.type]: DataDuration.type,
  [DataAscent.type]: DataAscent.type,
  [DataDescent.type]: DataDescent.type,
  [DataEnergy.type]: DataEnergy.type,
  [DataVO2Max.type]: DataVO2Max.type,
  [DataPowerAvg.type]: DataPowerAvg.type,
  [DataPowerMax.type]: DataPowerMax.type,
  [DataSpeedAvg.type]: DataSpeedAvg.type,
  [DataHeartRateAvg.type]: DataHeartRateAvg.type,
  [DataPeakEPOC.type]: DataPeakEPOC.type,
  [DataRecoveryTime.type]: DataRecoveryTime.type,
  [DataAerobicTrainingEffect.type]: DataAerobicTrainingEffect.type,
};

const SORTABLE_STRING_GETTERS: Record<string, (event: EventInterface) => string> = {
  'Activity Types': (event: EventInterface) => safeEventString(() => event.getActivityTypesAsString()),
  'Description': (event: EventInterface) => event.description || '',
  'Device Names': (event: EventInterface) => safeEventString(() => event.getDeviceNamesAsString()),
};

export function tokenizeEventTableSearchTerms(searchTerm: string | null | undefined): string[] {
  return (searchTerm || '')
    .split(',')
    .map(term => term.trim().toLowerCase())
    .filter(term => term.length > 0);
}

export function eventMatchesSearchTerms(
  event: EventInterface,
  normalizedTerms: string[],
): boolean {
  if (!normalizedTerms.length) {
    return true;
  }
  const corpus = buildEventSearchCorpus(event);
  return normalizedTerms.some(term => corpus.includes(term));
}

export function sortEventsForTable(
  events: EventInterface[],
  activeSort: string,
  direction: EventTableSortDirection,
): EventInterface[] {
  if (!activeSort || !direction) {
    return events.slice();
  }

  const sorted = events.map((event, index) => ({
    event,
    index,
    sortValue: getEventSortValue(event, activeSort),
  }));

  sorted.sort((a, b) => {
    const compare = compareSortValues(a.sortValue, b.sortValue);
    if (compare !== 0) {
      return direction === 'desc' ? -compare : compare;
    }
    return a.index - b.index;
  });

  return sorted.map(entry => entry.event);
}

function getEventSortValue(event: EventInterface, activeSort: string): number | string {
  if (activeSort === 'Start Date') {
    const startDate = event.startDate instanceof Date && Number.isFinite(event.startDate.getTime())
      ? event.startDate.getTime()
      : 0;
    return startDate;
  }

  const stringResolver = SORTABLE_STRING_GETTERS[activeSort];
  if (stringResolver) {
    return stringResolver(event).toLowerCase();
  }

  const statType = SORTABLE_NUMERIC_STAT_BY_COLUMN[activeSort];
  if (statType) {
    return getNumericStatValue(event, statType);
  }

  return 0;
}

function getNumericStatValue(event: EventInterface, statType: string): number {
  const stat = safeEventCall(() => event.getStat(statType), null);
  const statValue = safeEventCall(() => stat?.getValue?.(), 0);
  return typeof statValue === 'number' && Number.isFinite(statValue) ? statValue : 0;
}

function compareSortValues(a: number | string, b: number | string): number {
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }
  return String(a).localeCompare(String(b));
}

function buildEventSearchCorpus(event: EventInterface): string {
  const searchableParts: string[] = [];
  const startDate = event.startDate instanceof Date && Number.isFinite(event.startDate.getTime())
    ? event.startDate
    : null;

  searchableParts.push(
    event.name || '',
    event.description || '',
    event.privacy || '',
    safeEventString(() => event.getActivityTypesAsString()),
    safeEventString(() => event.getActivityTypesAsArray().join(' ')),
    safeEventString(() => event.getDeviceNamesAsString()),
    event.isMerge ? 'merged event merged' : 'event single',
  );

  if (startDate) {
    searchableParts.push(
      String(startDate.getTime()),
      startDate.toISOString(),
      startDate.toISOString().slice(0, 10),
    );
  }

  const stats = safeEventCall(() => event.getStatsAsArray(), []);
  if (Array.isArray(stats)) {
    for (const stat of stats) {
      if (!stat) {
        continue;
      }
      searchableParts.push(
        safeEventString(() => stat.getType?.()),
        safeEventString(() => stat.getValue?.()),
        safeEventString(() => stat.getDisplayValue?.()),
        safeEventString(() => stat.getDisplayUnit?.()),
      );
    }
  }

  const rpe = safeEventCall(() => event.getStat(DataRPE.type), null);
  if (rpe) {
    searchableParts.push(safeEventString(() => rpe.getValue?.()));
  }

  const feeling = safeEventCall(() => event.getStat(DataFeeling.type), null);
  if (feeling) {
    searchableParts.push(safeEventString(() => feeling.getValue?.()));
  }

  return searchableParts
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function safeEventString(read: () => unknown): string {
  const result = safeEventCall(read, '');
  if (result == null) {
    return '';
  }
  if (typeof result === 'string') {
    return result;
  }
  if (typeof result === 'number' || typeof result === 'boolean') {
    return String(result);
  }
  return '';
}

function safeEventCall<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}
