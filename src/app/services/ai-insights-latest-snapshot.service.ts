import { EnvironmentInjector, Injectable, inject, runInInjectionContext } from '@angular/core';
import {
  Firestore,
  deleteDoc,
  doc,
  getDoc,
  setDoc,
} from '@angular/fire/firestore';
import type {
  AiInsightEventLookup,
  AiInsightLatestEvent,
  AiInsightPresentation,
  AiInsightSummary,
  AiInsightSummaryBucket,
  AiInsightsAggregateOkResponse,
  AiInsightsEventLookupOkResponse,
  AiInsightsLatestEventOkResponse,
  AiInsightsLatestSnapshot,
  AiInsightsMultiMetricAggregateMetricResult,
  AiInsightsMultiMetricAggregateOkResponse,
  AiInsightsResultKind,
  AiInsightsResponse,
  NormalizedInsightQuery,
} from '@shared/ai-insights.types';
import type {
  EventStatAggregationResult,
} from '@shared/event-stat-aggregation.types';
import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import {
  resolveCompletedAiInsightsResponseResultKind,
  validateAiInsightsLatestSnapshot,
} from '@shared/ai-insights-latest-snapshot.validation';
import { LoggerService } from './logger.service';

const AI_INSIGHTS_LATEST_DOC_ID = 'latest';
const AI_INSIGHTS_LATEST_SNAPSHOT_VERSION = 1;
const AI_INSIGHTS_LATEST_SNAPSHOT_MAX_BYTES = 850 * 1024;

export type AiInsightsLatestSnapshotSaveResult =
  | 'saved'
  | 'skipped_too_large'
  | 'failed';

type UnknownRecord = Record<string, unknown>;
type NormalizedInsightQueryLike = UnknownRecord;
type AggregateNormalizedInsightQuery = Extract<NormalizedInsightQuery, { resultKind: 'aggregate' }>;
type EventLookupNormalizedInsightQuery = Extract<NormalizedInsightQuery, { resultKind: 'event_lookup' }>;
type LatestEventNormalizedInsightQuery = Extract<NormalizedInsightQuery, { resultKind: 'latest_event' }>;
type MultiMetricNormalizedInsightQuery = Extract<NormalizedInsightQuery, { resultKind: 'multi_metric_aggregate' }>;
type CompletedAiInsightsOkResponse = Extract<AiInsightsResponse, { status: 'ok' }>;
const KNOWN_CHART_DATA_CATEGORY_TYPES = buildEnumValueSet(ChartDataCategoryTypes);
const KNOWN_CHART_DATA_VALUE_TYPES = buildEnumValueSet(ChartDataValueTypes);
const KNOWN_CHART_TYPES = buildEnumValueSet(ChartTypes);
const KNOWN_TIME_INTERVALS = buildEnumValueSet(TimeIntervals);

@Injectable({
  providedIn: 'root',
})
export class AiInsightsLatestSnapshotService {
  private readonly firestore = inject(Firestore);
  private readonly injector = inject(EnvironmentInjector);
  private readonly logger = inject(LoggerService);

  async loadLatest(userID: string): Promise<AiInsightsLatestSnapshot | null> {
    try {
      const latestSnapshot = await runInInjectionContext(this.injector, () =>
        getDoc(doc(this.firestore, 'users', userID, 'aiInsightsRequests', AI_INSIGHTS_LATEST_DOC_ID)));
      if (!latestSnapshot.exists()) {
        return null;
      }

      const data = latestSnapshot.data();
      const validationResult = validateAiInsightsLatestSnapshot(
        data,
        AI_INSIGHTS_LATEST_SNAPSHOT_VERSION,
      );
      if ('failure' in validationResult) {
        this.logger.warn('[AiInsightsLatestSnapshotService] Clearing invalid latest AI insight snapshot.', {
          userID,
          reason: validationResult.failure.reason,
          ...validationResult.failure.details,
        });
        await this.deleteLatest(userID);
        return null;
      }

      try {
        return normalizeAiInsightsLatestSnapshot(validationResult.snapshot);
      } catch (error) {
        this.logger.warn('[AiInsightsLatestSnapshotService] Clearing latest AI insight snapshot because normalization failed.', {
          userID,
          reason: 'normalization_failed',
          error,
        });
        await this.deleteLatest(userID);
        return null;
      }
    } catch (error) {
      this.logger.error('[AiInsightsLatestSnapshotService] Failed to load latest AI insight snapshot.', { userID, error });
      return null;
    }
  }

  async saveLatest(
    userID: string,
    prompt: string,
    response: AiInsightsResponse,
  ): Promise<AiInsightsLatestSnapshotSaveResult> {
    const snapshot: AiInsightsLatestSnapshot = {
      version: AI_INSIGHTS_LATEST_SNAPSHOT_VERSION,
      savedAt: new Date().toISOString(),
      prompt,
      response,
    };

    const serializedSnapshot = JSON.stringify(snapshot);
    if (measureUtf8Bytes(serializedSnapshot) > AI_INSIGHTS_LATEST_SNAPSHOT_MAX_BYTES) {
      this.logger.warn('[AiInsightsLatestSnapshotService] Skipping latest AI insight snapshot because it exceeds the size guard.', {
        userID,
        bytes: measureUtf8Bytes(serializedSnapshot),
      });
      return 'skipped_too_large';
    }

    try {
      await runInInjectionContext(this.injector, () =>
        setDoc(doc(this.firestore, 'users', userID, 'aiInsightsRequests', AI_INSIGHTS_LATEST_DOC_ID), snapshot));
      return 'saved';
    } catch (error) {
      this.logger.error('[AiInsightsLatestSnapshotService] Failed to save latest AI insight snapshot.', { userID, error });
      return 'failed';
    }
  }

  private async deleteLatest(userID: string): Promise<void> {
    try {
      await runInInjectionContext(this.injector, () =>
        deleteDoc(doc(this.firestore, 'users', userID, 'aiInsightsRequests', AI_INSIGHTS_LATEST_DOC_ID)));
    } catch (error) {
      this.logger.error('[AiInsightsLatestSnapshotService] Failed to delete invalid latest AI insight snapshot.', { userID, error });
    }
  }
}

function measureUtf8Bytes(serializedValue: string): number {
  return new TextEncoder().encode(serializedValue).length;
}

function normalizeAiInsightsLatestSnapshot(snapshot: AiInsightsLatestSnapshot): AiInsightsLatestSnapshot {
  const response = normalizeAiInsightsResponse(snapshot.response);

  return {
    version: snapshot.version,
    savedAt: snapshot.savedAt,
    prompt: snapshot.prompt,
    response,
  };
}

function normalizeAiInsightsResponse(response: AiInsightsResponse): AiInsightsResponse {
  if (response.status === 'unsupported') {
    return {
      ...response,
      ...(response.quota ? { quota: response.quota } : {}),
    };
  }

  if (response.status === 'empty') {
    return {
      ...response,
      ...(response.quota ? { quota: response.quota } : {}),
      query: normalizeInsightQuery(response.query as unknown as NormalizedInsightQueryLike),
      aggregation: normalizeAggregationResult(response.aggregation),
      summary: normalizeSummary(response.summary),
      presentation: {
        ...normalizePresentation(response.presentation),
        emptyState: response.presentation.emptyState,
      },
    };
  }

  const resultKind = resolveCompletedAiInsightsResponseResultKind(response as unknown as UnknownRecord) ?? 'aggregate';
  const normalizer = OK_RESPONSE_NORMALIZERS_BY_RESULT_KIND[resultKind];

  return normalizer(response as never) as AiInsightsResponse;
}

function normalizeInsightQuery(query: NormalizedInsightQueryLike): NormalizedInsightQuery {
  const resultKind = resolveNormalizedInsightQueryResultKind(query);
  return INSIGHT_QUERY_NORMALIZERS_BY_RESULT_KIND[resultKind](query) as NormalizedInsightQuery;
}

function normalizeAggregateInsightQuery(query: NormalizedInsightQueryLike): AggregateNormalizedInsightQuery {
  const { requestedTimeInterval, ...rest } = query as NormalizedInsightQueryLike & {
    requestedTimeInterval?: unknown;
    resultKind?: unknown;
  };
  return {
    ...(rest as Omit<AggregateNormalizedInsightQuery, 'resultKind' | 'requestedTimeInterval'>),
    resultKind: 'aggregate',
    categoryType: normalizeChartDataCategoryType(rest.categoryType),
    valueType: normalizeChartDataValueType(rest.valueType),
    chartType: normalizeChartType(rest.chartType),
    ...(requestedTimeInterval == null ? {} : { requestedTimeInterval: normalizeTimeInterval(requestedTimeInterval) }),
  };
}

function normalizeEventLookupInsightQuery(query: NormalizedInsightQueryLike): EventLookupNormalizedInsightQuery {
  const { requestedTimeInterval, ...rest } = query as NormalizedInsightQueryLike & {
    requestedTimeInterval?: unknown;
    resultKind?: unknown;
  };
  return {
    ...(rest as Omit<EventLookupNormalizedInsightQuery, 'resultKind' | 'requestedTimeInterval' | 'categoryType'>),
    resultKind: 'event_lookup',
    categoryType: ChartDataCategoryTypes.DateType,
    valueType: normalizeChartDataValueType(rest.valueType),
    chartType: normalizeChartType(rest.chartType),
    ...(requestedTimeInterval == null ? {} : { requestedTimeInterval: normalizeTimeInterval(requestedTimeInterval) }),
  };
}

function normalizeLatestEventInsightQuery(query: NormalizedInsightQueryLike): LatestEventNormalizedInsightQuery {
  const { requestedTimeInterval, ...rest } = query as NormalizedInsightQueryLike & {
    requestedTimeInterval?: unknown;
    resultKind?: unknown;
  };
  return {
    ...(rest as Omit<LatestEventNormalizedInsightQuery, 'resultKind' | 'requestedTimeInterval' | 'categoryType'>),
    resultKind: 'latest_event',
    categoryType: ChartDataCategoryTypes.DateType,
    chartType: normalizeChartType(rest.chartType),
    ...(requestedTimeInterval == null ? {} : { requestedTimeInterval: normalizeTimeInterval(requestedTimeInterval) }),
  };
}

function normalizeMultiMetricInsightQuery(query: NormalizedInsightQueryLike): MultiMetricNormalizedInsightQuery {
  const { requestedTimeInterval, metricSelections, ...rest } = query as NormalizedInsightQueryLike & {
    requestedTimeInterval?: unknown;
    resultKind?: unknown;
    metricSelections?: unknown;
  };
  return {
    ...(rest as Omit<MultiMetricNormalizedInsightQuery, 'resultKind' | 'requestedTimeInterval' | 'metricSelections' | 'groupingMode' | 'categoryType'>),
    resultKind: 'multi_metric_aggregate',
    groupingMode: (rest.groupingMode === 'overall' ? 'overall' : 'date'),
    categoryType: ChartDataCategoryTypes.DateType,
    chartType: normalizeChartType(rest.chartType),
    ...(requestedTimeInterval == null ? {} : { requestedTimeInterval: normalizeTimeInterval(requestedTimeInterval) }),
    metricSelections: Array.isArray(metricSelections)
      ? metricSelections.map(selection => ({
        metricKey: `${(selection as UnknownRecord).metricKey}` as MultiMetricNormalizedInsightQuery['metricSelections'][number]['metricKey'],
        dataType: `${(selection as UnknownRecord).dataType ?? ''}`,
        valueType: normalizeChartDataValueType((selection as UnknownRecord).valueType),
      }))
      : [],
  };
}

type InsightQueryNormalizerMap = {
  [K in AiInsightsResultKind]: (query: NormalizedInsightQueryLike) => Extract<NormalizedInsightQuery, { resultKind: K }>;
};

export const INSIGHT_QUERY_NORMALIZERS_BY_RESULT_KIND = {
  aggregate: normalizeAggregateInsightQuery,
  event_lookup: normalizeEventLookupInsightQuery,
  latest_event: normalizeLatestEventInsightQuery,
  multi_metric_aggregate: normalizeMultiMetricInsightQuery,
} satisfies InsightQueryNormalizerMap;
export const INSIGHT_QUERY_NORMALIZER_RESULT_KIND_KEYS = Object.freeze(
  Object.keys(INSIGHT_QUERY_NORMALIZERS_BY_RESULT_KIND) as AiInsightsResultKind[],
);

type OkResponseNormalizerMap = {
  [K in AiInsightsResultKind]: (
    response: Extract<CompletedAiInsightsOkResponse, { resultKind: K }> & { query: NormalizedInsightQueryLike },
  ) => Extract<CompletedAiInsightsOkResponse, { resultKind: K }>;
};

export const OK_RESPONSE_NORMALIZERS_BY_RESULT_KIND = {
  aggregate: (response) => ({
    ...(response as AiInsightsAggregateOkResponse & { query: NormalizedInsightQueryLike }),
    resultKind: 'aggregate',
    ...(response.quota ? { quota: response.quota } : {}),
    query: normalizeAggregateInsightQuery(response.query),
    aggregation: normalizeAggregationResult(response.aggregation),
    summary: normalizeSummary(response.summary),
    ...(response.eventRanking ? { eventRanking: normalizeEventLookup(response.eventRanking) } : {}),
    presentation: normalizePresentation(response.presentation),
  }),
  event_lookup: (response) => ({
    ...(response as AiInsightsEventLookupOkResponse & { query: NormalizedInsightQueryLike }),
    resultKind: 'event_lookup',
    ...(response.quota ? { quota: response.quota } : {}),
    query: normalizeEventLookupInsightQuery(response.query),
    eventLookup: normalizeEventLookup(response.eventLookup),
    presentation: normalizePresentation(response.presentation),
  }),
  latest_event: (response) => ({
    ...(response as AiInsightsLatestEventOkResponse & { query: NormalizedInsightQueryLike }),
    resultKind: 'latest_event',
    ...(response.quota ? { quota: response.quota } : {}),
    query: normalizeLatestEventInsightQuery(response.query),
    latestEvent: normalizeLatestEvent(response.latestEvent),
    presentation: normalizePresentation(response.presentation),
  }),
  multi_metric_aggregate: (response) => ({
    ...(response as AiInsightsMultiMetricAggregateOkResponse & { query: NormalizedInsightQueryLike }),
    resultKind: 'multi_metric_aggregate',
    ...(response.quota ? { quota: response.quota } : {}),
    query: normalizeMultiMetricInsightQuery(response.query),
    metricResults: response.metricResults.map(normalizeMultiMetricMetricResult),
    presentation: normalizePresentation(response.presentation),
  }),
} satisfies OkResponseNormalizerMap;
export const OK_RESPONSE_NORMALIZER_RESULT_KIND_KEYS = Object.freeze(
  Object.keys(OK_RESPONSE_NORMALIZERS_BY_RESULT_KIND) as AiInsightsResultKind[],
);

function normalizeMultiMetricMetricResult(
  metricResult: AiInsightsMultiMetricAggregateMetricResult,
): AiInsightsMultiMetricAggregateMetricResult {
  return {
    metricKey: metricResult.metricKey,
    metricLabel: metricResult.metricLabel,
    query: normalizeAggregateInsightQuery(metricResult.query as unknown as NormalizedInsightQueryLike),
    aggregation: normalizeAggregationResult(metricResult.aggregation),
    summary: normalizeSummary(metricResult.summary),
    presentation: normalizePresentation(metricResult.presentation),
  };
}

function resolveNormalizedInsightQueryResultKind(
  query: NormalizedInsightQueryLike,
): AiInsightsResultKind {
  if (
    query.resultKind !== undefined
    && query.resultKind !== null
    && query.resultKind !== 'aggregate'
    && query.resultKind !== 'event_lookup'
    && query.resultKind !== 'latest_event'
    && query.resultKind !== 'multi_metric_aggregate'
  ) {
    throw new Error(`[AiInsightsLatestSnapshotService] Unsupported result kind in normalized query: ${String(query.resultKind)}`);
  }

  if (query.resultKind === 'multi_metric_aggregate' || Array.isArray(query.metricSelections)) {
    return 'multi_metric_aggregate';
  }

  if (query.resultKind === 'latest_event') {
    return 'latest_event';
  }

  return query.resultKind === 'event_lookup' ? 'event_lookup' : 'aggregate';
}

function normalizeEventLookup(eventLookup: AiInsightEventLookup): AiInsightEventLookup {
  return {
    primaryEventId: eventLookup.primaryEventId,
    topEventIds: eventLookup.topEventIds.slice(0, 10),
    matchedEventCount: eventLookup.matchedEventCount,
  };
}

function normalizeLatestEvent(latestEvent: AiInsightLatestEvent): AiInsightLatestEvent {
  return {
    eventId: latestEvent.eventId,
    startDate: latestEvent.startDate,
    matchedEventCount: latestEvent.matchedEventCount,
  };
}

function normalizePresentation(presentation: AiInsightPresentation): AiInsightPresentation {
  return {
    title: presentation.title,
    chartType: normalizeChartType(presentation.chartType),
    ...(presentation.emptyState == null ? {} : { emptyState: presentation.emptyState }),
    ...(presentation.warnings == null ? {} : { warnings: presentation.warnings }),
  };
}

function normalizeAggregationResult(aggregation: EventStatAggregationResult): EventStatAggregationResult {
  return {
    ...aggregation,
    valueType: normalizeChartDataValueType(aggregation.valueType),
    categoryType: normalizeChartDataCategoryType(aggregation.categoryType),
    resolvedTimeInterval: normalizeTimeInterval(aggregation.resolvedTimeInterval),
  };
}

function normalizeChartType(value: unknown): ChartTypes {
  return requireKnownEnumValue(value, KNOWN_CHART_TYPES, 'chartType') as ChartTypes;
}

function normalizeChartDataCategoryType(value: unknown): ChartDataCategoryTypes {
  return requireKnownEnumValue(value, KNOWN_CHART_DATA_CATEGORY_TYPES, 'categoryType') as ChartDataCategoryTypes;
}

function normalizeChartDataValueType(value: unknown): ChartDataValueTypes {
  return requireKnownEnumValue(value, KNOWN_CHART_DATA_VALUE_TYPES, 'valueType') as ChartDataValueTypes;
}

function normalizeTimeInterval(value: unknown): TimeIntervals {
  return requireKnownEnumValue(value, KNOWN_TIME_INTERVALS, 'timeInterval') as TimeIntervals;
}

function requireKnownEnumValue(
  value: unknown,
  allowedValues: ReadonlySet<string | number>,
  fieldName: string,
): string | number {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error(`[AiInsightsLatestSnapshotService] Unsupported ${fieldName}: ${String(value)}`);
  }

  if (!allowedValues.has(value)) {
    throw new Error(`[AiInsightsLatestSnapshotService] Unsupported ${fieldName}: ${String(value)}`);
  }

  return value;
}

function buildEnumValueSet(
  enumValue: Record<string, string | number>,
): ReadonlySet<string | number> {
  const enumValues = Object.values(enumValue).filter(
    (value): value is string | number => typeof value === 'string' || typeof value === 'number',
  );

  return new Set<string | number>(enumValues);
}

function normalizeSummaryBucket(
  bucket: AiInsightSummaryBucket | null,
): AiInsightSummaryBucket | null {
  if (!bucket) {
    return null;
  }

  const { time, ...rest } = bucket as AiInsightSummaryBucket & { time?: unknown };
  return {
    ...rest,
    ...(time == null ? {} : { time: time as number }),
  };
}

function normalizeSummary(summary: AiInsightSummary): AiInsightSummary {
  const activityMix = summary.activityMix
    ? {
      ...summary.activityMix,
      remainingActivityTypeCount: summary.activityMix.remainingActivityTypeCount ?? 0,
    }
    : null;

  return {
    ...summary,
    peakBucket: normalizeSummaryBucket(summary.peakBucket),
    lowestBucket: normalizeSummaryBucket(summary.lowestBucket),
    latestBucket: normalizeSummaryBucket(summary.latestBucket),
    activityMix,
  };
}
