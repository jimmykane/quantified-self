import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import {
  ActivityTypes,
  ActivityTypesHelper,
  EventImporterJSON,
  EventJSONInterface,
  EventInterface,
} from '@sports-alliance/sports-lib';

import type { NormalizedInsightQuery } from '../../../../shared/ai-insights.types';
import type { FirestoreEventJSON } from '../../../../shared/app-event.interface';
import {
  buildEventStatAggregation,
} from '../../../../shared/event-stat-aggregation';
import type { EventStatAggregationResult } from '../../../../shared/event-stat-aggregation.types';

interface FirestoreEventDocumentLike {
  id: string;
  data: () => FirestoreEventJSON | Record<string, unknown> | undefined;
}

interface ExecuteQueryDependencies {
  fetchEventDocs: (params: {
    userID: string;
    startDate: Date;
    endDate: Date;
  }) => Promise<FirestoreEventDocumentLike[]>;
  importEvent: (eventJSON: EventJSONInterface, eventID: string) => EventInterface;
  logger: Pick<typeof logger, 'warn' | 'error'>;
}

export interface AiInsightsExecutionResult {
  aggregation: EventStatAggregationResult;
  matchedEventsCount: number;
}

const defaultExecuteQueryDependencies: ExecuteQueryDependencies = {
  fetchEventDocs: async ({ userID, startDate, endDate }) => {
    const snapshot = await admin.firestore()
      .collection('users')
      .doc(userID)
      .collection('events')
      .where('startDate', '>=', startDate)
      .where('startDate', '<=', endDate)
      .orderBy('startDate', 'asc')
      .get();

    return snapshot.docs;
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

function toDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof (value as { toDate?: unknown })?.toDate === 'function') {
    return toDate((value as { toDate: () => Date }).toDate());
  }
  if (typeof (value as { toMillis?: unknown })?.toMillis === 'function') {
    return toDate(new Date((value as { toMillis: () => number }).toMillis()));
  }
  if (typeof value === 'object' && value !== null && 'seconds' in (value as Record<string, unknown>)) {
    const seconds = Number((value as Record<string, unknown>).seconds);
    const nanoseconds = Number((value as Record<string, unknown>).nanoseconds || 0);
    if (!Number.isFinite(seconds) || !Number.isFinite(nanoseconds)) {
      return null;
    }
    return new Date((seconds * 1000) + Math.floor(nanoseconds / 1000000));
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

export function normalizeFirestoreValue(value: unknown): unknown {
  const date = toDate(value);
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
  const normalizedStartDate = toDate(normalized.startDate);
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
    log.warn('[aiInsights] Failed to rehydrate event snapshot', { eventID, error });
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
): Promise<AiInsightsExecutionResult> {
  const dependencies = executeQueryDependencies;
  const startDate = new Date(query.dateRange.startDate);
  const endDate = new Date(query.dateRange.endDate);
  const docs = await dependencies.fetchEventDocs({ userID, startDate, endDate });

  const events = docs
    .map(doc => rehydrateAiInsightsEvent(doc.id, doc.data(), dependencies.importEvent, dependencies.logger))
    .filter((event): event is EventInterface => event !== null)
    .filter(event => (event as { isMerge?: boolean }).isMerge !== true)
    .filter(event => eventMatchesActivitySelection(event, query.activityTypes));

  return {
    aggregation: buildEventStatAggregation(events, {
      dataType: query.dataType,
      valueType: query.valueType,
      categoryType: query.categoryType,
      requestedTimeInterval: query.requestedTimeInterval,
    }, dependencies.logger),
    matchedEventsCount: events.length,
  };
}
