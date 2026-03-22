import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { FieldPath } from 'firebase-admin/firestore';
import {
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ActivityTypesHelper,
  DataActivityTypes,
  EventImporterJSON,
  EventJSONInterface,
  EventInterface,
  TimeIntervals,
} from '@sports-alliance/sports-lib';

import type { NormalizedInsightQuery } from '../../../../shared/ai-insights.types';
import type { FirestoreEventJSON } from '../../../../shared/app-event.interface';
import {
  resolveAggregationCategoryKey,
} from '../../../../shared/event-stat-aggregation';
import type { EventStatAggregationResult } from '../../../../shared/event-stat-aggregation.types';
import { serializeErrorForLogging } from './error-logging';
import { buildExecutionPromptLogContext } from './execute-query.logging';
import { executeQueryByResultKind } from './execute-query.result-kind-handlers';

interface FirestoreEventDocumentLike {
  id: string;
  data: () => FirestoreEventJSON | Record<string, unknown> | undefined;
}

export interface ExecuteQueryDependencies {
  fetchEventDocs: (params: {
    userID: string;
    startDate?: Date;
    endDate?: Date;
    activityTypes: readonly ActivityTypes[];
  }) => Promise<FetchEventDocsResult | FirestoreEventDocumentLike[]>;
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

export interface ExecuteQueryApi {
  executeAiInsightsQuery: (
    userID: string,
    query: NormalizedInsightQuery,
    prompt?: string,
  ) => Promise<AiInsightsExecutionResult>;
}

export interface RankedInsightEvent {
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
  eventRanking?: {
    primaryEventId: string | null;
    topEventIds: string[];
    matchedEventCount: number;
    rankedEvents: RankedInsightEvent[];
  };
}

export interface MultiMetricAggregateExecutionMetricResult {
  metricKey: Extract<NormalizedInsightQuery, { resultKind: 'multi_metric_aggregate' }>['metricSelections'][number]['metricKey'];
  aggregation: EventStatAggregationResult;
  matchedEventsCount: number;
  matchedActivityTypeCounts: Array<{
    activityType: string;
    eventCount: number;
  }>;
}

interface MultiMetricAggregateExecutionResult {
  resultKind: 'multi_metric_aggregate';
  matchedEventsCount: number;
  matchedActivityTypeCounts: Array<{
    activityType: string;
    eventCount: number;
  }>;
  metricResults: MultiMetricAggregateExecutionMetricResult[];
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

interface LatestEventExecutionResult {
  resultKind: 'latest_event';
  matchedEventsCount: number;
  matchedActivityTypeCounts: Array<{
    activityType: string;
    eventCount: number;
  }>;
  latestEvent: {
    eventId: string | null;
    startDate: string | null;
  };
}

export type AiInsightsExecutionResult =
  | AggregateExecutionResult
  | EventLookupExecutionResult
  | LatestEventExecutionResult
  | MultiMetricAggregateExecutionResult;

type ActivityPrefilterMode = 'none' | 'contains' | 'contains_any' | 'chunked';

interface FetchEventDocsPrefilterDiagnostics {
  mode: ActivityPrefilterMode;
  chunkCount: number;
  dedupedCount: number;
}

interface FetchEventDocsResult {
  docs: FirestoreEventDocumentLike[];
  prefilterDiagnostics: FetchEventDocsPrefilterDiagnostics;
}

function chunkValues<T>(values: readonly T[], chunkSize: number): T[][] {
  if (chunkSize <= 0) {
    return [];
  }

  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize) as T[]);
  }
  return chunks;
}

function resolveDefaultPrefilterDiagnostics(
  activityTypes: readonly ActivityTypes[],
): FetchEventDocsPrefilterDiagnostics {
  if (!activityTypes.length) {
    return { mode: 'none', chunkCount: 0, dedupedCount: 0 };
  }
  if (activityTypes.length === 1) {
    return { mode: 'contains', chunkCount: 1, dedupedCount: 0 };
  }
  if (activityTypes.length <= 10) {
    return { mode: 'contains_any', chunkCount: 1, dedupedCount: 0 };
  }
  return {
    mode: 'chunked',
    chunkCount: Math.ceil(activityTypes.length / 10),
    dedupedCount: 0,
  };
}

function sortEventDocsByStartDateAndId(
  docs: FirestoreEventDocumentLike[],
): FirestoreEventDocumentLike[] {
  return [...docs].sort((left, right) => {
    const leftStartDateRaw = (left.data() as Record<string, unknown> | undefined)?.startDate;
    const rightStartDateRaw = (right.data() as Record<string, unknown> | undefined)?.startDate;
    const leftTime = toEventDate(leftStartDateRaw)?.getTime() ?? Number.NEGATIVE_INFINITY;
    const rightTime = toEventDate(rightStartDateRaw)?.getTime() ?? Number.NEGATIVE_INFINITY;
    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }
    return left.id.localeCompare(right.id);
  });
}

const defaultExecuteQueryDependencies: ExecuteQueryDependencies = {
  fetchEventDocs: async ({ userID, startDate, endDate, activityTypes }) => {
    const eventsCollection = admin.firestore()
      .collection('users')
      .doc(userID)
      .collection('events');

    const baseQuery = () => {
      let query: FirebaseFirestore.Query<FirebaseFirestore.DocumentData> = eventsCollection;
      if (startDate && endDate) {
        // EventWriter persists sports-lib event JSON as-is, and sports-lib exports top-level
        // event startDate/endDate as epoch milliseconds. The rest of the app, including the
        // dashboard event queries, also filters startDate numerically. Query the canonical
        // numeric field directly instead of double-reading a legacy Date/Timestamp path.
        query = query
          .where('startDate', '>=', startDate.getTime())
          .where('startDate', '<=', endDate.getTime())
          .orderBy('startDate', 'asc');
      }
      return query;
    };

    const canonicalActivityTypes = Array.from(
      new Set(
        activityTypes.filter((activityType): activityType is ActivityTypes => (
          typeof activityType === 'string' && activityType.trim().length > 0
        )),
      ),
    );
    const defaultPrefilterDiagnostics = resolveDefaultPrefilterDiagnostics(canonicalActivityTypes);
    const activityTypeFieldPath = new FieldPath('stats', DataActivityTypes.type);

    if (!canonicalActivityTypes.length) {
      const snapshot = await baseQuery().get();
      return {
        docs: snapshot.docs,
        prefilterDiagnostics: defaultPrefilterDiagnostics,
      };
    }

    if (canonicalActivityTypes.length === 1) {
      const snapshot = await baseQuery()
        .where(activityTypeFieldPath, 'array-contains', canonicalActivityTypes[0])
        .get();
      return {
        docs: snapshot.docs,
        prefilterDiagnostics: defaultPrefilterDiagnostics,
      };
    }

    if (canonicalActivityTypes.length <= 10) {
      const snapshot = await baseQuery()
        .where(activityTypeFieldPath, 'array-contains-any', canonicalActivityTypes)
        .get();
      return {
        docs: snapshot.docs,
        prefilterDiagnostics: defaultPrefilterDiagnostics,
      };
    }

    const activityTypeChunks = chunkValues(canonicalActivityTypes, 10);
    const chunkSnapshots = await Promise.all(
      activityTypeChunks.map(activityTypeChunk => (
        baseQuery()
          .where(activityTypeFieldPath, 'array-contains-any', activityTypeChunk)
          .get()
      )),
    );
    const mergedDocs = chunkSnapshots.flatMap(snapshot => snapshot.docs);
    const uniqueDocsById = new Map<string, FirestoreEventDocumentLike>();
    mergedDocs.forEach((doc) => {
      if (!uniqueDocsById.has(doc.id)) {
        uniqueDocsById.set(doc.id, doc);
      }
    });

    return {
      docs: sortEventDocsByStartDateAndId([...uniqueDocsById.values()]),
      prefilterDiagnostics: {
        mode: 'chunked',
        chunkCount: activityTypeChunks.length,
        dedupedCount: mergedDocs.length - uniqueDocsById.size,
      },
    };
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

interface ActivitySelectionEvaluation {
  matchesSelection: boolean;
  missingOrInvalid: boolean;
  normalizedNonCanonicalCount: number;
}

function eventMatchesActivitySelection(
  event: EventInterface,
  selectedActivityTypes: readonly ActivityTypes[],
): ActivitySelectionEvaluation {
  let rawActivityTypes: unknown;
  try {
    rawActivityTypes = event.getActivityTypesAsArray?.();
  } catch {
    return {
      matchesSelection: false,
      missingOrInvalid: true,
      normalizedNonCanonicalCount: 0,
    };
  }

  if (!Array.isArray(rawActivityTypes) || rawActivityTypes.length === 0) {
    return {
      matchesSelection: false,
      missingOrInvalid: true,
      normalizedNonCanonicalCount: 0,
    };
  }

  const canonicalActivityTypes: ActivityTypes[] = [];
  let normalizedNonCanonicalCount = 0;

  for (const rawActivityType of rawActivityTypes) {
    const resolvedActivityType = ActivityTypesHelper.resolveActivityType(rawActivityType);
    if (!resolvedActivityType) {
      continue;
    }

    const rawLabel = `${rawActivityType ?? ''}`.trim();
    if (rawLabel !== resolvedActivityType) {
      normalizedNonCanonicalCount += 1;
    }

    if (!canonicalActivityTypes.includes(resolvedActivityType)) {
      canonicalActivityTypes.push(resolvedActivityType);
    }
  }

  if (!canonicalActivityTypes.length) {
    return {
      matchesSelection: false,
      missingOrInvalid: true,
      normalizedNonCanonicalCount,
    };
  }

  return {
    matchesSelection: selectedActivityTypes.length === 0
      || canonicalActivityTypes.some(activityType => selectedActivityTypes.includes(activityType)),
    missingOrInvalid: false,
    normalizedNonCanonicalCount,
  };
}

function eventMatchesRequestedDateRanges(
  event: EventInterface,
  requestedDateRanges: NormalizedInsightQuery['requestedDateRanges'],
): boolean {
  if (!requestedDateRanges?.length) {
    return true;
  }

  const eventStartTime = event.startDate instanceof Date ? event.startDate.getTime() : NaN;
  if (!Number.isFinite(eventStartTime)) {
    return false;
  }

  return requestedDateRanges.some((dateRange) => {
    const startTime = Date.parse(dateRange.startDate);
    const endTime = Date.parse(dateRange.endDate);
    return Number.isFinite(startTime)
      && Number.isFinite(endTime)
      && eventStartTime >= startTime
      && eventStartTime <= endTime;
  });
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

function compareRankedEvents(
  left: RankedInsightEvent,
  right: RankedInsightEvent,
  valueType: ChartDataValueTypes,
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
  query: Extract<NormalizedInsightQuery, { resultKind: 'event_lookup' | 'aggregate' }>,
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

function buildLatestEvent(events: EventInterface[]): { eventId: string; startDate: string } | null {
  const latestEventCandidates = events
    .map((event) => {
      const eventId = event.getID?.();
      const startDate = event.startDate instanceof Date ? event.startDate.toISOString() : null;
      if (!eventId || !startDate) {
        return null;
      }

      return {
        eventId,
        startDate,
      };
    })
    .filter((event): event is { eventId: string; startDate: string } => event !== null)
    .sort((left, right) => {
      const timeDelta = new Date(right.startDate).getTime() - new Date(left.startDate).getTime();
      if (timeDelta !== 0) {
        return timeDelta;
      }

      return left.eventId.localeCompare(right.eventId);
    });

  return latestEventCandidates[0] ?? null;
}

function buildOverallAggregation(
  dataType: string,
  valueType: ChartDataValueTypes,
  events: EventInterface[],
): EventStatAggregationResult {
  const values = events
    .map(event => resolveRequestedStatValue(event, dataType))
    .filter((value): value is number => value !== null);
  if (!values.length) {
    return {
      dataType,
      valueType,
      categoryType: ChartDataCategoryTypes.DateType,
      resolvedTimeInterval: TimeIntervals.Auto,
      buckets: [],
    };
  }

  const aggregateValue = (() => {
    switch (valueType) {
      case ChartDataValueTypes.Total:
        return values.reduce((sum, value) => sum + value, 0);
      case ChartDataValueTypes.Minimum:
        return Math.min(...values);
      case ChartDataValueTypes.Maximum:
        return Math.max(...values);
      case ChartDataValueTypes.Average:
      default:
        return values.reduce((sum, value) => sum + value, 0) / values.length;
    }
  })();

  return {
    dataType,
    valueType,
    categoryType: ChartDataCategoryTypes.DateType,
    resolvedTimeInterval: TimeIntervals.Auto,
    buckets: [
      {
        bucketKey: 'overall',
        totalCount: values.length,
        aggregateValue,
        seriesValues: {},
        seriesCounts: {},
      },
    ],
  };
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
      ...serializeErrorForLogging(error),
      ...summarizeEventShape(rawEventData, normalized),
    });
    return null;
  }
}

export async function withExecuteQueryDependenciesForTesting<T>(
  dependencies: Partial<ExecuteQueryDependencies>,
  run: (api: ExecuteQueryApi) => Promise<T> | T,
): Promise<T> {
  return run(createExecuteQuery(dependencies));
}

export function createExecuteQuery(
  dependencies: Partial<ExecuteQueryDependencies> = {},
): ExecuteQueryApi {
  const resolvedDependencies: ExecuteQueryDependencies = {
    ...defaultExecuteQueryDependencies,
    ...dependencies,
  };

  return {
    executeAiInsightsQuery: async (
      userID: string,
      query: NormalizedInsightQuery,
      prompt?: string,
    ): Promise<AiInsightsExecutionResult> => {
      const dependencies = resolvedDependencies;
      const startDate = query.dateRange.kind === 'bounded'
        ? new Date(query.dateRange.startDate)
        : undefined;
      const endDate = query.dateRange.kind === 'bounded'
        ? new Date(query.dateRange.endDate)
        : undefined;
      const fetchEventDocsResult = await dependencies.fetchEventDocs({
        userID,
        startDate,
        endDate,
        activityTypes: query.activityTypes,
      });
      const {
        docs,
        prefilterDiagnostics,
      } = Array.isArray(fetchEventDocsResult)
        ? {
          docs: fetchEventDocsResult,
          prefilterDiagnostics: resolveDefaultPrefilterDiagnostics(query.activityTypes),
        }
        : fetchEventDocsResult;

      const rehydratedEvents = docs
        .map(doc => rehydrateAiInsightsEvent(doc.id, doc.data(), dependencies.importEvent, dependencies.logger))
        .filter((event): event is EventInterface => event !== null);
      const nonMergedEvents = rehydratedEvents
        .filter(event => (event as { isMerge?: boolean }).isMerge !== true);
      let skippedMissingActivityTypeCount = 0;
      let normalizedNonCanonicalActivityTypeCount = 0;
      const activityMatchedEvents = nonMergedEvents.filter((event) => {
        const activitySelectionEvaluation = eventMatchesActivitySelection(event, query.activityTypes);
        normalizedNonCanonicalActivityTypeCount += activitySelectionEvaluation.normalizedNonCanonicalCount;
        if (activitySelectionEvaluation.missingOrInvalid) {
          skippedMissingActivityTypeCount += 1;
          return false;
        }
        return activitySelectionEvaluation.matchesSelection;
      });
      const matchedEvents = activityMatchedEvents
        .filter(event => eventMatchesRequestedDateRanges(event, query.requestedDateRanges));
      const eventsWithRequestedStatCount = (
        query.resultKind === 'aggregate'
        || query.resultKind === 'event_lookup'
      )
        ? matchedEvents.filter(event => hasRequestedStat(event, query.dataType)).length
        : null;
      const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST || null;
      const debugEventSnapshot = docs.length === 0
        ? await dependencies.fetchDebugEventSnapshot(userID)
        : null;

      if (skippedMissingActivityTypeCount > 0) {
        dependencies.logger.warn('[aiInsights] Skipped events with missing or invalid activity type stats', {
          userID,
          skippedMissingActivityTypeCount,
          selectedActivityTypeCount: query.activityTypes.length,
        });
      }

      if (normalizedNonCanonicalActivityTypeCount > 0) {
        dependencies.logger.warn('[aiInsights] Normalized non-canonical activity types in AI filtering', {
          userID,
          normalizedNonCanonicalActivityTypeCount,
          selectedActivityTypeCount: query.activityTypes.length,
        });
      }

      dependencies.logger.info('[aiInsights] Query execution summary', {
        ...buildExecutionPromptLogContext(prompt),
        userID,
        dataType: (
          query.resultKind === 'aggregate'
          || query.resultKind === 'event_lookup'
        ) ? query.dataType : null,
        valueType: (
          query.resultKind === 'aggregate'
          || query.resultKind === 'event_lookup'
        ) ? query.valueType : null,
        categoryType: query.categoryType,
        activityTypes: query.activityTypes,
        dateRange: query.dateRange,
        requestedDateRanges: query.requestedDateRanges ?? null,
        periodMode: query.periodMode ?? null,
        prefilterMode: prefilterDiagnostics.mode,
        prefilterChunkCount: prefilterDiagnostics.chunkCount,
        prefilterDedupedCount: prefilterDiagnostics.dedupedCount,
        fetchedDocsCount: docs.length,
        rehydratedEventsCount: rehydratedEvents.length,
        mergedEventsExcludedCount: rehydratedEvents.length - nonMergedEvents.length,
        activityFilteredOutCount: nonMergedEvents.length - activityMatchedEvents.length,
        skippedMissingActivityTypeCount,
        normalizedNonCanonicalActivityTypeCount,
        requestedDateRangeFilteredOutCount: activityMatchedEvents.length - matchedEvents.length,
        matchedEventsCount: matchedEvents.length,
        eventsWithRequestedStatCount,
        metricSelectionCount: query.resultKind === 'multi_metric_aggregate'
          ? query.metricSelections.length
          : query.resultKind === 'latest_event'
            ? 0
            : 1,
        matchedEventIDsSample: matchedEvents.slice(0, 10).map(event => event.getID?.()),
        firestoreTarget: firestoreEmulatorHost ? 'emulator' : 'default',
        firestoreEmulatorHost,
        debugTotalEventsCount: debugEventSnapshot?.totalEventsCount ?? null,
        debugRecentEventsSample: debugEventSnapshot?.recentEventsSample ?? [],
      });

      return executeQueryByResultKind({
        userID,
        prompt,
        query,
        matchedEvents,
        dependencies,
        helpers: {
          buildLatestEvent,
          buildMatchedActivityTypeCounts,
          buildOverallAggregation,
          buildRankedEvents,
          hasRequestedStat,
        },
      });
    },
  };
}

const executeQueryRuntime = createExecuteQuery();

export async function executeAiInsightsQuery(
  userID: string,
  query: NormalizedInsightQuery,
  prompt?: string,
): Promise<AiInsightsExecutionResult> {
  return executeQueryRuntime.executeAiInsightsQuery(userID, query, prompt);
}
