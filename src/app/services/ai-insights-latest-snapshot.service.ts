import { EnvironmentInjector, Injectable, inject, runInInjectionContext } from '@angular/core';
import {
  Firestore,
  deleteDoc,
  doc,
  getDoc,
  setDoc,
} from '@angular/fire/firestore';
import type {
  AiInsightPresentation,
  AiInsightSummary,
  AiInsightSummaryActivityMix,
  AiInsightSummaryBucket,
  AiInsightSummaryCoverage,
  AiInsightSummaryTrend,
  AiInsightsLatestSnapshot,
  AiInsightsResponse,
  NormalizedInsightDateRange,
  NormalizedInsightQuery,
} from '@shared/ai-insights.types';
import type {
  EventStatAggregationBucket,
  EventStatAggregationResult,
} from '@shared/event-stat-aggregation.types';
import { LoggerService } from './logger.service';

const AI_INSIGHTS_LATEST_DOC_ID = 'latest';
const AI_INSIGHTS_LATEST_SNAPSHOT_VERSION = 1;
const AI_INSIGHTS_LATEST_SNAPSHOT_MAX_BYTES = 850 * 1024;

export type AiInsightsLatestSnapshotSaveResult =
  | 'saved'
  | 'skipped_too_large'
  | 'failed';

type UnknownRecord = Record<string, unknown>;
type SnapshotValidationFailure = {
  reason: string;
  details?: UnknownRecord;
};

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
      const validationFailure = getAiInsightsLatestSnapshotValidationFailure(data);
      if (validationFailure) {
        this.logger.warn('[AiInsightsLatestSnapshotService] Clearing invalid latest AI insight snapshot.', {
          userID,
          reason: validationFailure.reason,
          ...validationFailure.details,
        });
        await this.deleteLatest(userID);
        return null;
      }

      if (!isAiInsightsLatestSnapshot(data)) {
        return null;
      }

      return normalizeAiInsightsLatestSnapshot(data);
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

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isEnumPrimitive(value: unknown): value is number | string {
  return typeof value === 'number' || typeof value === 'string';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isNumberRecord(value: unknown): value is Record<string, number> {
  return isRecord(value) && Object.values(value).every(isFiniteNumber);
}

function isNormalizedInsightDateRange(value: unknown): value is NormalizedInsightDateRange {
  if (!isRecord(value) || typeof value.timezone !== 'string') {
    return false;
  }

  if (value.kind === 'all_time') {
    return value.source === 'prompt';
  }

  if (value.kind === 'bounded') {
    return (
      typeof value.startDate === 'string'
      && typeof value.endDate === 'string'
      && (value.source === 'prompt' || value.source === 'default')
    );
  }

  return false;
}

function isNormalizedInsightQuery(value: unknown): value is NormalizedInsightQuery {
  return (
    isRecord(value)
    && typeof value.dataType === 'string'
    && isEnumPrimitive(value.valueType)
    && isEnumPrimitive(value.categoryType)
    && (value.requestedTimeInterval === undefined || isEnumPrimitive(value.requestedTimeInterval))
    && isStringArray(value.activityTypeGroups)
    && isStringArray(value.activityTypes)
    && isNormalizedInsightDateRange(value.dateRange)
    && isEnumPrimitive(value.chartType)
  );
}

function isAggregationBucket(value: unknown): value is EventStatAggregationBucket {
  return (
    isRecord(value)
    && (typeof value.bucketKey === 'string' || isFiniteNumber(value.bucketKey))
    && (value.time === undefined || isFiniteNumber(value.time))
    && isFiniteNumber(value.totalCount)
    && isFiniteNumber(value.aggregateValue)
    && isNumberRecord(value.seriesValues)
    && isNumberRecord(value.seriesCounts)
  );
}

function isAggregationResult(value: unknown): value is EventStatAggregationResult {
  return (
    isRecord(value)
    && typeof value.dataType === 'string'
    && isEnumPrimitive(value.valueType)
    && isEnumPrimitive(value.categoryType)
    && isEnumPrimitive(value.resolvedTimeInterval)
    && Array.isArray(value.buckets)
    && value.buckets.every(isAggregationBucket)
  );
}

function isSummaryBucket(value: unknown): value is AiInsightSummaryBucket {
  return (
    isRecord(value)
    && (typeof value.bucketKey === 'string' || isFiniteNumber(value.bucketKey))
    && (value.time === undefined || isFiniteNumber(value.time))
    && isFiniteNumber(value.aggregateValue)
    && isFiniteNumber(value.totalCount)
  );
}

function isSummaryActivityMix(value: unknown): value is AiInsightSummaryActivityMix {
  return (
    isRecord(value)
    && Array.isArray(value.topActivityTypes)
    && value.topActivityTypes.every((entry) =>
      isRecord(entry)
      && typeof entry.activityType === 'string'
      && isFiniteNumber(entry.eventCount)
    )
    && isFiniteNumber(value.remainingActivityTypeCount)
  );
}

function isSummaryCoverage(value: unknown): value is AiInsightSummaryCoverage {
  return (
    isRecord(value)
    && isFiniteNumber(value.nonEmptyBucketCount)
    && isFiniteNumber(value.totalBucketCount)
  );
}

function isSummaryTrend(value: unknown): value is AiInsightSummaryTrend {
  return (
    isRecord(value)
    && isSummaryBucket(value.previousBucket)
    && isFiniteNumber(value.deltaAggregateValue)
  );
}

function isSummary(value: unknown): value is AiInsightSummary {
  return (
    isRecord(value)
    && isFiniteNumber(value.matchedEventCount)
    && (value.overallAggregateValue === null || isFiniteNumber(value.overallAggregateValue))
    && (value.peakBucket === null || isSummaryBucket(value.peakBucket))
    && (value.lowestBucket === null || isSummaryBucket(value.lowestBucket))
    && (value.latestBucket === null || isSummaryBucket(value.latestBucket))
    && (value.activityMix === null || isSummaryActivityMix(value.activityMix))
    && (value.bucketCoverage === null || isSummaryCoverage(value.bucketCoverage))
    && (value.trend === null || isSummaryTrend(value.trend))
  );
}

function isPresentation(value: unknown): value is AiInsightPresentation {
  return (
    isRecord(value)
    && typeof value.title === 'string'
    && isEnumPrimitive(value.chartType)
    && (value.emptyState === undefined || value.emptyState === null || typeof value.emptyState === 'string')
    && (value.warnings === undefined || value.warnings === null || isStringArray(value.warnings))
  );
}

function isCompletedInsightResponse(value: unknown): value is Extract<AiInsightsResponse, { status: 'ok' | 'empty' }> {
  return (
    isRecord(value)
    && (value.status === 'ok' || value.status === 'empty')
    && typeof value.narrative === 'string'
    && isNormalizedInsightQuery(value.query)
    && isAggregationResult(value.aggregation)
    && isSummary(value.summary)
    && isPresentation(value.presentation)
    && (value.status !== 'empty' || typeof value.presentation.emptyState === 'string')
  );
}

function isUnsupportedInsightResponse(value: unknown): value is Extract<AiInsightsResponse, { status: 'unsupported' }> {
  return (
    isRecord(value)
    && value.status === 'unsupported'
    && typeof value.narrative === 'string'
    && typeof value.reasonCode === 'string'
    && isStringArray(value.suggestedPrompts)
  );
}

function isAiInsightsResponse(value: unknown): value is AiInsightsResponse {
  return isCompletedInsightResponse(value) || isUnsupportedInsightResponse(value);
}

function isAiInsightsLatestSnapshot(value: unknown): value is AiInsightsLatestSnapshot {
  return (
    isRecord(value)
    && value.version === AI_INSIGHTS_LATEST_SNAPSHOT_VERSION
    && typeof value.savedAt === 'string'
    && typeof value.prompt === 'string'
    && isAiInsightsResponse(value.response)
  );
}

function getAiInsightsLatestSnapshotValidationFailure(value: unknown): SnapshotValidationFailure | null {
  if (!isRecord(value)) {
    return {
      reason: 'snapshot_not_object',
      details: {
        actualType: describeValueType(value),
      },
    };
  }

  if (value.version !== AI_INSIGHTS_LATEST_SNAPSHOT_VERSION) {
    return {
      reason: 'version_mismatch',
      details: {
        actualVersion: value.version ?? null,
        expectedVersion: AI_INSIGHTS_LATEST_SNAPSHOT_VERSION,
        topLevelKeys: Object.keys(value),
      },
    };
  }

  if (typeof value.savedAt !== 'string') {
    return {
      reason: 'savedAt_invalid',
      details: {
        actualType: describeValueType(value.savedAt),
        topLevelKeys: Object.keys(value),
      },
    };
  }

  if (typeof value.prompt !== 'string') {
    return {
      reason: 'prompt_invalid',
      details: {
        actualType: describeValueType(value.prompt),
        topLevelKeys: Object.keys(value),
      },
    };
  }

  const responseFailure = getAiInsightsResponseValidationFailure(value.response);
  if (responseFailure) {
    return {
      reason: `response_${responseFailure.reason}`,
      details: {
        topLevelKeys: Object.keys(value),
        ...responseFailure.details,
      },
    };
  }

  return null;
}

function getAiInsightsResponseValidationFailure(value: unknown): SnapshotValidationFailure | null {
  if (!isRecord(value)) {
    return {
      reason: 'not_object',
      details: {
        actualType: describeValueType(value),
      },
    };
  }

  if (value.status !== 'ok' && value.status !== 'empty' && value.status !== 'unsupported') {
    return {
      reason: 'status_invalid',
      details: {
        actualStatus: value.status ?? null,
        responseKeys: Object.keys(value),
      },
    };
  }

  if (value.status === 'unsupported') {
    if (!isUnsupportedInsightResponse(value)) {
      return {
        reason: 'unsupported_shape_invalid',
        details: {
          responseKeys: Object.keys(value),
          unsupportedReasonCode: value.unsupportedReasonCode ?? null,
          suggestionsType: describeValueType(value.suggestions),
        },
      };
    }

    return null;
  }

  if (typeof value.narrative !== 'string') {
    return {
      reason: 'narrative_invalid',
      details: {
        responseKeys: Object.keys(value),
        actualType: describeValueType(value.narrative),
      },
    };
  }

  if (!isNormalizedInsightQuery(value.query)) {
    return {
      reason: 'query_invalid',
      details: {
        responseKeys: Object.keys(value),
        ...describeNormalizedInsightQuery(value.query),
      },
    };
  }

  if (!isAggregationResult(value.aggregation)) {
    return {
      reason: 'aggregation_invalid',
      details: {
        responseKeys: Object.keys(value),
        ...describeAggregationResult(value.aggregation),
      },
    };
  }

  if (!isSummary(value.summary)) {
    return {
      reason: 'summary_invalid',
      details: {
        responseKeys: Object.keys(value),
        ...describeSummary(value.summary),
      },
    };
  }

  if (!isPresentation(value.presentation)) {
    return {
      reason: 'presentation_invalid',
      details: {
        responseKeys: Object.keys(value),
        ...describePresentation(value.presentation),
      },
    };
  }

  return null;
}

function describeNormalizedInsightQuery(value: unknown): UnknownRecord {
  if (!isRecord(value)) {
    return {
      queryType: describeValueType(value),
    };
  }

  return {
    queryKeys: Object.keys(value),
    dataTypeType: describeValueType(value.dataType),
    valueTypeType: describeValueType(value.valueType),
    categoryTypeType: describeValueType(value.categoryType),
    requestedTimeIntervalType: describeValueType(value.requestedTimeInterval),
    activityTypeGroupsType: describeValueType(value.activityTypeGroups),
    activityTypesType: describeValueType(value.activityTypes),
    chartTypeType: describeValueType(value.chartType),
    dateRange: describeDateRange(value.dateRange),
  };
}

function describeDateRange(value: unknown): UnknownRecord {
  if (!isRecord(value)) {
    return {
      actualType: describeValueType(value),
    };
  }

  return {
    kind: value.kind ?? null,
    source: value.source ?? null,
    timezoneType: describeValueType(value.timezone),
    startDateType: describeValueType(value.startDate),
    endDateType: describeValueType(value.endDate),
  };
}

function describeAggregationResult(value: unknown): UnknownRecord {
  if (!isRecord(value)) {
    return {
      aggregationType: describeValueType(value),
    };
  }

  return {
    aggregationKeys: Object.keys(value),
    dataTypeType: describeValueType(value.dataType),
    valueTypeType: describeValueType(value.valueType),
    categoryTypeType: describeValueType(value.categoryType),
    resolvedTimeIntervalType: describeValueType(value.resolvedTimeInterval),
    bucketsType: describeValueType(value.buckets),
    bucketCount: Array.isArray(value.buckets) ? value.buckets.length : null,
  };
}

function describeSummary(value: unknown): UnknownRecord {
  if (!isRecord(value)) {
    return {
      summaryType: describeValueType(value),
    };
  }

  return {
    summaryKeys: Object.keys(value),
    matchedEventCountType: describeValueType(value.matchedEventCount),
    overallAggregateValueType: describeValueType(value.overallAggregateValue),
    peakBucketType: describeValueType(value.peakBucket),
    lowestBucketType: describeValueType(value.lowestBucket),
    latestBucketType: describeValueType(value.latestBucket),
    activityMixType: describeValueType(value.activityMix),
    bucketCoverageType: describeValueType(value.bucketCoverage),
    trendType: describeValueType(value.trend),
  };
}

function describePresentation(value: unknown): UnknownRecord {
  if (!isRecord(value)) {
    return {
      presentationType: describeValueType(value),
    };
  }

  return {
    presentationKeys: Object.keys(value),
    titleType: describeValueType(value.title),
    chartTypeType: describeValueType(value.chartType),
    emptyStateType: describeValueType(value.emptyState),
    warningsType: describeValueType(value.warnings),
  };
}

function describeValueType(value: unknown): string {
  if (Array.isArray(value)) {
    return 'array';
  }

  if (value === null) {
    return 'null';
  }

  return typeof value;
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
    return response;
  }

  if (response.status === 'empty') {
    return {
      ...response,
      presentation: {
        ...normalizePresentation(response.presentation),
        emptyState: response.presentation.emptyState,
      },
    };
  }

  return {
    ...response,
    presentation: normalizePresentation(response.presentation),
  };
}

function normalizePresentation(presentation: AiInsightPresentation): AiInsightPresentation {
  return {
    title: presentation.title,
    chartType: presentation.chartType,
    ...(presentation.emptyState == null ? {} : { emptyState: presentation.emptyState }),
    ...(presentation.warnings == null ? {} : { warnings: presentation.warnings }),
  };
}
