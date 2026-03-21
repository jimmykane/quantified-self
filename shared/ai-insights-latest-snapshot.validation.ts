import type {
  AiInsightEventLookup,
  AiInsightPresentation,
  AiInsightSummary,
  AiInsightSummaryActivityMix,
  AiInsightSummaryBucket,
  AiInsightSummaryCoverage,
  AiInsightSummaryTrend,
  AiInsightsLatestSnapshot,
  AiInsightsMultiMetricAggregateMetricResult,
  AiInsightsQuotaStatus,
  AiInsightsResponse,
  AiInsightsResultKind,
  NormalizedInsightDateRange,
  NormalizedInsightQuery,
} from './ai-insights.types';
import type {
  EventStatAggregationBucket,
  EventStatAggregationResult,
} from './event-stat-aggregation.types';

type UnknownRecord = Record<string, unknown>;
type NormalizedInsightQueryLike = UnknownRecord;

export type AiInsightsLatestSnapshotValidationFailure = {
  reason: string;
  details?: UnknownRecord;
};

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

function isQuotaStatus(value: unknown): value is AiInsightsQuotaStatus {
  return (
    isRecord(value)
    && (value.role === 'free' || value.role === 'basic' || value.role === 'pro')
    && isFiniteNumber(value.limit)
    && isFiniteNumber(value.successfulRequestCount)
    && isFiniteNumber(value.activeRequestCount)
    && isFiniteNumber(value.remainingCount)
    && (value.periodStart === null || typeof value.periodStart === 'string')
    && (value.periodEnd === null || typeof value.periodEnd === 'string')
    && (value.periodKind === 'subscription' || value.periodKind === 'grace_hold' || value.periodKind === 'no_billing_period')
    && (value.resetMode === 'date' || value.resetMode === 'next_successful_payment')
    && typeof value.isEligible === 'boolean'
    && (value.blockedReason === null || value.blockedReason === 'requires_pro' || value.blockedReason === 'limit_reached')
  );
}

function isResultKind(value: unknown): value is AiInsightsResultKind {
  return value === 'aggregate' || value === 'event_lookup' || value === 'multi_metric_aggregate';
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

function isNormalizedInsightBoundedDateRange(value: unknown): boolean {
  return isNormalizedInsightDateRange(value)
    && isRecord(value)
    && value.kind === 'bounded';
}

function isNormalizedInsightQuery(value: unknown): value is NormalizedInsightQueryLike {
  if (
    !isRecord(value)
    || (value.resultKind !== undefined && value.resultKind !== null && !isResultKind(value.resultKind))
    || !isEnumPrimitive(value.categoryType)
    || (value.requestedTimeInterval !== undefined && value.requestedTimeInterval !== null && !isEnumPrimitive(value.requestedTimeInterval))
    || !isStringArray(value.activityTypeGroups)
    || !isStringArray(value.activityTypes)
    || !isNormalizedInsightDateRange(value.dateRange)
    || (value.requestedDateRanges !== undefined
      && (!Array.isArray(value.requestedDateRanges) || !value.requestedDateRanges.every(isNormalizedInsightBoundedDateRange)))
    || (value.periodMode !== undefined && value.periodMode !== 'combined' && value.periodMode !== 'compare')
    || !isEnumPrimitive(value.chartType)
  ) {
    return false;
  }

  if (value.resultKind === 'multi_metric_aggregate' || Array.isArray(value.metricSelections)) {
    return (
      (value.groupingMode === 'overall' || value.groupingMode === 'date')
      && Array.isArray(value.metricSelections)
      && value.metricSelections.every((selection) => (
        isRecord(selection)
        && typeof selection.metricKey === 'string'
        && typeof selection.dataType === 'string'
        && isEnumPrimitive(selection.valueType)
      ))
    );
  }

  return (
    typeof value.dataType === 'string'
    && isEnumPrimitive(value.valueType)
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
    && (value.time === undefined || value.time === null || isFiniteNumber(value.time))
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
    && (isFiniteNumber(value.remainingActivityTypeCount) || value.remainingActivityTypeCount === null)
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

function isEventLookup(value: unknown): value is AiInsightEventLookup {
  return (
    isRecord(value)
    && typeof value.primaryEventId === 'string'
    && isStringArray(value.topEventIds)
    && isFiniteNumber(value.matchedEventCount)
  );
}

function isMultiMetricAggregateMetricResult(value: unknown): value is AiInsightsMultiMetricAggregateMetricResult {
  return (
    isRecord(value)
    && typeof value.metricKey === 'string'
    && typeof value.metricLabel === 'string'
    && isNormalizedInsightQuery(value.query)
    && isAggregationResult(value.aggregation)
    && isSummary(value.summary)
    && isPresentation(value.presentation)
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

export function resolveCompletedAiInsightsResponseResultKind(
  value: UnknownRecord,
): AiInsightsResultKind | null {
  if (
    value.resultKind === 'multi_metric_aggregate'
    || (Array.isArray(value.metricResults) && value.metricResults.every(isMultiMetricAggregateMetricResult))
  ) {
    return 'multi_metric_aggregate';
  }

  if (isResultKind(value.resultKind)) {
    return value.resultKind;
  }

  if (isEventLookup(value.eventLookup)) {
    return 'event_lookup';
  }

  if (isAggregationResult(value.aggregation) && isSummary(value.summary)) {
    return 'aggregate';
  }

  return null;
}

function isCompletedInsightResponse(value: unknown): value is Extract<AiInsightsResponse, { status: 'ok' | 'empty' }> {
  if (!isRecord(value) || (value.status !== 'ok' && value.status !== 'empty')) {
    return false;
  }

  if (
    typeof value.narrative !== 'string'
    || (value.quota !== undefined && !isQuotaStatus(value.quota))
    || !isNormalizedInsightQuery(value.query)
    || !isPresentation(value.presentation)
  ) {
    return false;
  }

  if (value.status === 'empty') {
    return (
      isAggregationResult(value.aggregation)
      && isSummary(value.summary)
      && typeof value.presentation.emptyState === 'string'
    );
  }

  const resultKind = resolveCompletedAiInsightsResponseResultKind(value);
  if (resultKind === 'multi_metric_aggregate') {
    return Array.isArray(value.metricResults) && value.metricResults.every(isMultiMetricAggregateMetricResult);
  }

  if (resultKind === 'event_lookup') {
    return isEventLookup(value.eventLookup);
  }

  return (
    resultKind === 'aggregate'
    && isAggregationResult(value.aggregation)
    && isSummary(value.summary)
    && (value.eventRanking === undefined || isEventLookup(value.eventRanking))
  );
}

function isUnsupportedInsightResponse(value: unknown): value is Extract<AiInsightsResponse, { status: 'unsupported' }> {
  return (
    isRecord(value)
    && value.status === 'unsupported'
    && typeof value.narrative === 'string'
    && (value.quota === undefined || isQuotaStatus(value.quota))
    && typeof value.reasonCode === 'string'
    && isStringArray(value.suggestedPrompts)
  );
}

function isAiInsightsResponse(value: unknown): value is AiInsightsResponse {
  return isCompletedInsightResponse(value) || isUnsupportedInsightResponse(value);
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

function describeNormalizedInsightQuery(value: unknown): UnknownRecord {
  if (!isRecord(value)) {
    return {
      queryType: describeValueType(value),
    };
  }

  return {
    queryKeys: Object.keys(value),
    resultKindType: describeValueType(value.resultKind),
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

function describeQuotaStatus(value: unknown): UnknownRecord {
  if (!isRecord(value)) {
    return {
      quotaType: describeValueType(value),
    };
  }

  return {
    quotaKeys: Object.keys(value),
    roleType: describeValueType(value.role),
    limitType: describeValueType(value.limit),
    successfulRequestCountType: describeValueType(value.successfulRequestCount),
    activeRequestCountType: describeValueType(value.activeRequestCount),
    remainingCountType: describeValueType(value.remainingCount),
    periodStartType: describeValueType(value.periodStart),
    periodEndType: describeValueType(value.periodEnd),
    periodKindType: describeValueType(value.periodKind),
    resetModeType: describeValueType(value.resetMode),
    isEligibleType: describeValueType(value.isEligible),
    blockedReasonType: describeValueType(value.blockedReason),
  };
}

function getAiInsightsResponseValidationFailure(value: unknown): AiInsightsLatestSnapshotValidationFailure | null {
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

  if (value.quota !== undefined && !isQuotaStatus(value.quota)) {
    return {
      reason: 'quota_invalid',
      details: {
        responseKeys: Object.keys(value),
        ...describeQuotaStatus(value.quota),
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

  if (!isPresentation(value.presentation)) {
    return {
      reason: 'presentation_invalid',
      details: {
        responseKeys: Object.keys(value),
        ...describePresentation(value.presentation),
      },
    };
  }

  if (value.status === 'empty') {
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

    return null;
  }

  const resultKind = resolveCompletedAiInsightsResponseResultKind(value);
  if (resultKind === 'multi_metric_aggregate') {
    if (!Array.isArray(value.metricResults) || !value.metricResults.every(isMultiMetricAggregateMetricResult)) {
      return {
        reason: 'metric_results_invalid',
        details: {
          responseKeys: Object.keys(value),
          metricResultsType: describeValueType(value.metricResults),
        },
      };
    }

    return null;
  }

  if (resultKind === 'event_lookup') {
    if (!isEventLookup(value.eventLookup)) {
      return {
        reason: 'event_lookup_invalid',
        details: {
          responseKeys: Object.keys(value),
          eventLookupType: describeValueType(value.eventLookup),
        },
      };
    }

    return null;
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

  return null;
}

export function getAiInsightsLatestSnapshotValidationFailure(
  value: unknown,
  expectedVersion: number,
): AiInsightsLatestSnapshotValidationFailure | null {
  if (!isRecord(value)) {
    return {
      reason: 'snapshot_not_object',
      details: {
        actualType: describeValueType(value),
      },
    };
  }

  if (value.version !== expectedVersion) {
    return {
      reason: 'version_mismatch',
      details: {
        actualVersion: value.version ?? null,
        expectedVersion,
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

export function validateAiInsightsLatestSnapshot(
  value: unknown,
  expectedVersion: number,
): (
  { valid: true; snapshot: AiInsightsLatestSnapshot }
  | { valid: false; failure: AiInsightsLatestSnapshotValidationFailure }
) {
  const failure = getAiInsightsLatestSnapshotValidationFailure(value, expectedVersion);
  if (failure || !isRecord(value)) {
    return {
      valid: false,
      failure: failure ?? { reason: 'snapshot_not_object' },
    };
  }

  return {
    valid: true,
    snapshot: value as AiInsightsLatestSnapshot,
  };
}
