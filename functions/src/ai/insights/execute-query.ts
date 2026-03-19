import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import {
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ActivityTypesHelper,
  EventImporterJSON,
  EventJSONInterface,
  EventInterface,
  TimeIntervals,
} from '@sports-alliance/sports-lib';

import type { NormalizedInsightQuery } from '../../../../shared/ai-insights.types';
import type { FirestoreEventJSON } from '../../../../shared/app-event.interface';
import {
  buildEventStatAggregation,
  resolveAggregationCategoryKey,
} from '../../../../shared/event-stat-aggregation';
import type { EventStatAggregationResult } from '../../../../shared/event-stat-aggregation.types';

interface FirestoreEventDocumentLike {
  id: string;
  data: () => FirestoreEventJSON | Record<string, unknown> | undefined;
}

interface ExecuteQueryDependencies {
  fetchEventDocs: (params: {
    userID: string;
    startDate?: Date;
    endDate?: Date;
  }) => Promise<FirestoreEventDocumentLike[]>;
  fetchDebugEventSnapshot: (userID: string) => Promise<{
    totalEventsCount: number | null;
    recentEventsSample: Array<{
      id: string;
      startDateRaw: unknown;
      startDateType: string;
    }>;
  }>;
  importEvent: (eventJSON: EventJSONInterface, eventID: string) => EventInterface;
  logger: Pick<typeof logger, 'info' | 'warn' | 'error'>;
}

interface RankedInsightEvent {
  eventId: string;
  startDate: string;
  aggregateValue: number;
}

interface AggregateExecutionResult {
  resultKind: 'aggregate';
  aggregation: EventStatAggregationResult;
  matchedEventsCount: number;
  matchedActivityTypeCounts: Array<{
    activityType: string;
    eventCount: number;
  }>;
}

interface EventLookupExecutionResult {
  resultKind: 'event_lookup';
  matchedEventsCount: number;
  matchedActivityTypeCounts: Array<{
    activityType: string;
    eventCount: number;
  }>;
  eventLookup: {
    primaryEventId: string | null;
    topEventIds: string[];
    rankedEvents: RankedInsightEvent[];
  };
}

export type AiInsightsExecutionResult =
  | AggregateExecutionResult
  | EventLookupExecutionResult;

const defaultExecuteQueryDependencies: ExecuteQueryDependencies = {
  fetchEventDocs: async ({ userID, startDate, endDate }) => {
    const eventsCollection = admin.firestore()
      .collection('users')
      .doc(userID)
      .collection('events');

    if (!startDate || !endDate) {
      const snapshot = await eventsCollection.get();
      return snapshot.docs;
    }

    const [dateSnapshot, millisSnapshot] = await Promise.all([
      eventsCollection
        .where('startDate', '>=', startDate)
        .where('startDate', '<=', endDate)
        .orderBy('startDate', 'asc')
        .get(),
      eventsCollection
        .where('startDate', '>=', startDate.getTime())
        .where('startDate', '<=', endDate.getTime())
        .orderBy('startDate', 'asc')
        .get(),
    ]);

    const docsByID = new Map<string, FirestoreEventDocumentLike>();
    for (const doc of dateSnapshot.docs) {
      docsByID.set(doc.id, doc);
    }
    for (const doc of millisSnapshot.docs) {
      docsByID.set(doc.id, doc);
    }

    return [...docsByID.values()];
  },
  fetchDebugEventSnapshot: async (userID) => {
    const eventsCollection = admin.firestore()
      .collection('users')
      .doc(userID)
      .collection('events');

    const [countSnapshot, recentSnapshot] = await Promise.all([
      eventsCollection.count().get().catch(() => null),
      eventsCollection.orderBy('startDate', 'desc').limit(5).get().catch(() => null),
    ]);

    return {
      totalEventsCount: countSnapshot?.data().count ?? null,
      recentEventsSample: recentSnapshot?.docs.map(doc => {
        const rawData = doc.data() as Record<string, unknown> | undefined;
        const startDateRaw = rawData?.startDate;
        return {
          id: doc.id,
          startDateRaw,
          startDateType: startDateRaw === null
            ? 'null'
            : Array.isArray(startDateRaw)
              ? 'array'
              : typeof startDateRaw,
        };
      }) ?? [],
    };
  },
  importEvent: (eventJSON, eventID) => EventImporterJSON.getEventFromJSON(eventJSON).setID(eventID),
  logger,
};

let executeQueryDependencies: ExecuteQueryDependencies = defaultExecuteQueryDependencies;

function isMergedEventDocument(rawEventData: Record<string, unknown>): boolean {
  if (rawEventData.isMerge === true) {
    return true;
  }

  if (typeof rawEventData.mergeType === 'string' && rawEventData.mergeType.trim().length > 0) {
    return true;
  }

  return Array.isArray(rawEventData.originalFiles) && rawEventData.originalFiles.length > 1;
}

function toFirestoreTimestampDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof (value as { toDate?: unknown })?.toDate === 'function') {
    return toFirestoreTimestampDate((value as { toDate: () => Date }).toDate());
  }
  if (typeof (value as { toMillis?: unknown })?.toMillis === 'function') {
    return toFirestoreTimestampDate(new Date((value as { toMillis: () => number }).toMillis()));
  }
  if (typeof value === 'object' && value !== null && 'seconds' in (value as Record<string, unknown>)) {
    const seconds = Number((value as Record<string, unknown>).seconds);
    const nanoseconds = Number((value as Record<string, unknown>).nanoseconds || 0);
    if (!Number.isFinite(seconds) || !Number.isFinite(nanoseconds)) {
      return null;
    }
    return new Date((seconds * 1000) + Math.floor(nanoseconds / 1000000));
  }
  return null;
}

function toEventDate(value: unknown): Date | null {
  const firestoreTimestampDate = toFirestoreTimestampDate(value);
  if (firestoreTimestampDate) {
    return firestoreTimestampDate;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

export function normalizeFirestoreValue(value: unknown): unknown {
  const date = toFirestoreTimestampDate(value);
  if (date) {
    return date;
  }
  if (Array.isArray(value)) {
    return value.map(item => normalizeFirestoreValue(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, normalizeFirestoreValue(item)]),
  );
}

function resolveCanonicalEventActivityTypes(event: EventInterface): ActivityTypes[] {
  const activityTypes = event.getActivityTypesAsArray()
    .map(activityType => ActivityTypesHelper.resolveActivityType(activityType))
    .filter((activityType): activityType is ActivityTypes => Boolean(activityType));

  return Array.from(new Set(activityTypes));
}

function eventMatchesActivitySelection(
  event: EventInterface,
  selectedActivityTypes: readonly ActivityTypes[],
): boolean {
  if (!selectedActivityTypes.length) {
    return true;
  }

  const eventActivityTypes = resolveCanonicalEventActivityTypes(event);
  return eventActivityTypes.some(activityType => selectedActivityTypes.includes(activityType));
}

function hasRequestedStat(event: EventInterface, dataType: string): boolean {
  return resolveRequestedStatValue(event, dataType) !== null;
}

function resolveRequestedStatValue(event: EventInterface, dataType: string): number | null {
  const stat = event.getStat?.(dataType);
  const rawValue = stat?.getValue?.();
  return typeof rawValue === 'number' && Number.isFinite(rawValue) ? rawValue : null;
}

function buildMatchedActivityTypeCounts(
  events: EventInterface[],
  log: ExecuteQueryDependencies['logger'],
): Array<{ activityType: string; eventCount: number }> {
  const counts = new Map<string, number>();

  for (const event of events) {
    const activityKey = resolveAggregationCategoryKey(
      event,
      ChartDataCategoryTypes.ActivityType,
      TimeIntervals.Daily,
      log,
    );

    if (typeof activityKey !== 'string' || !activityKey.trim()) {
      continue;
    }

    counts.set(activityKey, (counts.get(activityKey) || 0) + 1);
  }

  return [...counts.entries()]
    .map(([activityType, eventCount]) => ({ activityType, eventCount }))
    .sort((left, right) => (
      right.eventCount - left.eventCount
      || left.activityType.localeCompare(right.activityType)
    ));
}

function summarizeError(error: unknown): {
  errorName?: string;
  errorMessage?: string;
  errorStackTop?: string;
  errorString?: string;
} {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
      errorStackTop: error.stack?.split('\n').slice(0, 3).join('\n'),
    };
  }

  return {
    errorString: typeof error === 'string' ? error : JSON.stringify(error),
  };
}

function compareRankedEvents(
  left: RankedInsightEvent,
  right: RankedInsightEvent,
  valueType: NormalizedInsightQuery['valueType'],
): number {
  const valueDelta = valueType === ChartDataValueTypes.Minimum
    ? left.aggregateValue - right.aggregateValue
    : right.aggregateValue - left.aggregateValue;
  if (valueDelta !== 0) {
    return valueDelta;
  }

  const timeDelta = new Date(right.startDate).getTime() - new Date(left.startDate).getTime();
  if (timeDelta !== 0) {
    return timeDelta;
  }

  return left.eventId.localeCompare(right.eventId);
}

function buildRankedEvents(
  events: EventInterface[],
  query: NormalizedInsightQuery,
): RankedInsightEvent[] {
  return events
    .map((event) => {
      const aggregateValue = resolveRequestedStatValue(event, query.dataType);
      const eventId = event.getID?.();
      const startDate = event.startDate instanceof Date ? event.startDate.toISOString() : null;
      if (aggregateValue === null || !eventId || !startDate) {
        return null;
      }

      return {
        eventId,
        startDate,
        aggregateValue,
      } satisfies RankedInsightEvent;
    })
    .filter((event): event is RankedInsightEvent => event !== null)
    .sort((left, right) => compareRankedEvents(left, right, query.valueType));
}

function summarizeEventShape(rawEventData: Record<string, unknown>, normalized: Record<string, unknown>): Record<string, unknown> {
  const rawStartDate = rawEventData.startDate;
  const rawStats = rawEventData.stats as Record<string, unknown> | undefined;
  const rawStreams = rawEventData.streams;
  const rawEvents = rawEventData.events;
  const rawActivities = rawEventData.activities;

  return {
    topLevelKeys: Object.keys(rawEventData).sort(),
    rawStartDateType: rawStartDate === null ? 'null' : Array.isArray(rawStartDate) ? 'array' : typeof rawStartDate,
    rawStartDatePreview: rawStartDate,
    normalizedStartDateISO: normalized.startDate instanceof Date ? normalized.startDate.toISOString() : normalized.startDate,
    statsKeysSample: rawStats ? Object.keys(rawStats).sort().slice(0, 20) : [],
    streamsShape: Array.isArray(rawStreams) ? `array:${rawStreams.length}` : typeof rawStreams,
    eventsShape: Array.isArray(rawEvents) ? `array:${rawEvents.length}` : typeof rawEvents,
    activitiesShape: Array.isArray(rawActivities) ? `array:${rawActivities.length}` : typeof rawActivities,
  };
}

export function rehydrateAiInsightsEvent(
  eventID: string,
  rawEventData: FirestoreEventJSON | Record<string, unknown> | undefined,
  importEvent: ExecuteQueryDependencies['importEvent'] = defaultExecuteQueryDependencies.importEvent,
  log: ExecuteQueryDependencies['logger'] = defaultExecuteQueryDependencies.logger,
): EventInterface | null {
  if (!rawEventData) {
    return null;
  }

  const normalized = normalizeFirestoreValue(rawEventData) as EventJSONInterface & Record<string, unknown>;
  const normalizedStartDate = toEventDate(normalized.startDate);
  if (!normalizedStartDate) {
    log.warn('[aiInsights] Skipping event with invalid startDate', { eventID });
    return null;
  }
  const normalizedEventJson = {
    ...normalized,
    startDate: normalizedStartDate,
  } as unknown as EventJSONInterface;

  try {
    const event = importEvent(normalizedEventJson, eventID);
    const eventAsMergeAware = event as { isMerge?: boolean };
    eventAsMergeAware.isMerge = eventAsMergeAware.isMerge === true || isMergedEventDocument(rawEventData);

    if (!(event.startDate instanceof Date) || Number.isNaN(event.startDate.getTime())) {
      event.startDate = normalizedStartDate;
    }

    return event;
  } catch (error) {
    log.warn('[aiInsights] Failed to rehydrate event snapshot', {
      eventID,
      ...summarizeError(error),
      ...summarizeEventShape(rawEventData, normalized),
    });
    return null;
  }
}

export function setExecuteQueryDependenciesForTesting(
  dependencies?: Partial<ExecuteQueryDependencies>,
): void {
  executeQueryDependencies = dependencies
    ? { ...defaultExecuteQueryDependencies, ...dependencies }
    : defaultExecuteQueryDependencies;
}

export async function executeAiInsightsQuery(
  userID: string,
  query: NormalizedInsightQuery,
  prompt?: string,
): Promise<AiInsightsExecutionResult> {
  const dependencies = executeQueryDependencies;
  const startDate = query.dateRange.kind === 'bounded'
    ? new Date(query.dateRange.startDate)
    : undefined;
  const endDate = query.dateRange.kind === 'bounded'
    ? new Date(query.dateRange.endDate)
    : undefined;
  const docs = await dependencies.fetchEventDocs({ userID, startDate, endDate });

  const rehydratedEvents = docs
    .map(doc => rehydrateAiInsightsEvent(doc.id, doc.data(), dependencies.importEvent, dependencies.logger))
    .filter((event): event is EventInterface => event !== null);
  const nonMergedEvents = rehydratedEvents
    .filter(event => (event as { isMerge?: boolean }).isMerge !== true);
  const matchedEvents = nonMergedEvents
    .filter(event => eventMatchesActivitySelection(event, query.activityTypes));
  const eventsWithRequestedStat = matchedEvents
    .filter(event => hasRequestedStat(event, query.dataType));
  const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST || null;
  const debugEventSnapshot = docs.length === 0
    ? await dependencies.fetchDebugEventSnapshot(userID)
    : null;

  dependencies.logger.info('[aiInsights] Query execution summary', {
    prompt: prompt || null,
    userID,
    dataType: query.dataType,
    valueType: query.valueType,
    categoryType: query.categoryType,
    activityTypes: query.activityTypes,
    dateRange: query.dateRange,
    fetchedDocsCount: docs.length,
    rehydratedEventsCount: rehydratedEvents.length,
    mergedEventsExcludedCount: rehydratedEvents.length - nonMergedEvents.length,
    activityFilteredOutCount: nonMergedEvents.length - matchedEvents.length,
    matchedEventsCount: matchedEvents.length,
    eventsWithRequestedStatCount: eventsWithRequestedStat.length,
    matchedEventIDsSample: matchedEvents.slice(0, 10).map(event => event.getID?.()),
    firestoreTarget: firestoreEmulatorHost ? 'emulator' : 'default',
    firestoreEmulatorHost,
    debugTotalEventsCount: debugEventSnapshot?.totalEventsCount ?? null,
    debugRecentEventsSample: debugEventSnapshot?.recentEventsSample ?? [],
  });

  if (query.resultKind === 'event_lookup') {
    const rankedEvents = buildRankedEvents(eventsWithRequestedStat, query);

    dependencies.logger.info('[aiInsights] Event lookup summary', {
      prompt: prompt || null,
      userID,
      dataType: query.dataType,
      valueType: query.valueType,
      rankedEventCount: rankedEvents.length,
      primaryEventId: rankedEvents[0]?.eventId ?? null,
      topEventIds: rankedEvents.slice(0, 10).map(event => event.eventId),
    });

    return {
      resultKind: 'event_lookup',
      matchedEventsCount: eventsWithRequestedStat.length,
      matchedActivityTypeCounts: buildMatchedActivityTypeCounts(matchedEvents, dependencies.logger),
      eventLookup: {
        primaryEventId: rankedEvents[0]?.eventId ?? null,
        topEventIds: rankedEvents.slice(0, 10).map(event => event.eventId),
        rankedEvents,
      },
    };
  }

  const aggregation = buildEventStatAggregation(matchedEvents, {
    dataType: query.dataType,
    valueType: query.valueType,
    categoryType: query.categoryType,
    requestedTimeInterval: query.requestedTimeInterval,
  }, dependencies.logger);

  dependencies.logger.info('[aiInsights] Aggregation summary', {
    prompt: prompt || null,
    userID,
    dataType: query.dataType,
    valueType: query.valueType,
    categoryType: query.categoryType,
    requestedTimeInterval: query.requestedTimeInterval,
    resolvedTimeInterval: aggregation.resolvedTimeInterval,
    bucketCount: aggregation.buckets.length,
  });

  return {
    resultKind: 'aggregate',
    aggregation,
    matchedEventsCount: matchedEvents.length,
    matchedActivityTypeCounts: buildMatchedActivityTypeCounts(matchedEvents, dependencies.logger),
  };
}
