import {
  isTrainingVisibleDiscipline,
  type DerivedTrainingDurabilityContext,
  type DerivedTrainingDurabilityContextSummary,
  type DerivedTrainingDurabilityCoverage,
  type DerivedTrainingDurabilityMetricPayload,
  type DerivedTrainingDurabilityScope,
  type DerivedTrainingDurabilityScopeComparison,
  type DerivedTrainingDurabilityWindow,
  type DerivedTrainingDurabilityWindowMetrics,
  type DerivedTrainingExplanationLoadCoverage,
  type DerivedTrainingExplanationMetricPayload,
  type DerivedTrainingExplanationRhythm,
  type DerivedTrainingExplanationSportBucket,
  type DerivedTrainingExplanationSportLoad,
  type DerivedTrainingExplanationWindow,
  type DerivedTrainingExplanationWindowMetrics,
} from '@shared/derived-metrics';

type UnknownRecord = Record<string, unknown>;

const DURABILITY_SCOPES: readonly DerivedTrainingDurabilityScope[] = [
  'running',
  'cycling',
  'pool-swimming',
  'open-water-swimming',
];
const EXPLANATION_SPORTS: readonly DerivedTrainingExplanationSportBucket[] = [
  'running',
  'cycling',
  'swimming',
  'other',
  'unclassified',
];

export function resolveTrainingExplanationMetricPayload(
  value: unknown,
): DerivedTrainingExplanationMetricPayload | null {
  const source = asRecord(value);
  if (
    !source
    || source.dayBoundary !== 'UTC'
    || source.currentWindowDays !== 28
    || source.baselineBlockCount !== 3
    || source.excludesMergedEvents !== true
    || source.excludesMissingDates !== true
    || source.excludesFutureEvents !== true
  ) {
    return null;
  }
  const asOfDayMs = finiteNumber(source.asOfDayMs);
  const current = normalizeExplanationWindow(source.current);
  const baselineMedian = normalizeExplanationWindowMetrics(source.baselineMedian);
  const baselineBlocks = Array.isArray(source.baselineBlocks)
    ? source.baselineBlocks.map(normalizeExplanationWindow)
    : [];
  const topContributors = Array.isArray(source.topContributors)
    ? source.topContributors.map((candidate) => {
      const contributor = asRecord(candidate);
      const eventId = nonEmptyString(contributor?.eventId);
      const startDayMs = finiteNumber(contributor?.startDayMs);
      const trainingStressScore = nonNegativeNumber(contributor?.trainingStressScore);
      const loadSharePercent = percentage(contributor?.loadSharePercent);
      const label = nullableString(contributor?.label);
      const childComposition = normalizeSportLoads(contributor?.childComposition);
      if (
        !contributor
        || !eventId
        || startDayMs === null
        || trainingStressScore === null
        || loadSharePercent === null
        || label === undefined
        || !childComposition
      ) {
        return null;
      }
      return { eventId, label, startDayMs, trainingStressScore, loadSharePercent, childComposition };
    })
    : [];
  if (
    asOfDayMs === null
    || !current
    || !baselineMedian
    || baselineBlocks.length !== 3
    || baselineBlocks.some(block => block === null)
    || topContributors.some(contributor => contributor === null)
  ) {
    return null;
  }
  return {
    dayBoundary: 'UTC', asOfDayMs, currentWindowDays: 28, baselineBlockCount: 3,
    excludesMergedEvents: true, excludesMissingDates: true, excludesFutureEvents: true,
    current,
    baselineBlocks: baselineBlocks as DerivedTrainingExplanationWindow[],
    baselineMedian,
    topContributors: topContributors as DerivedTrainingExplanationMetricPayload['topContributors'],
  };
}

export function resolveTrainingDurabilityMetricPayload(
  value: unknown,
): DerivedTrainingDurabilityMetricPayload | null {
  const source = asRecord(value);
  if (
    !source
    || source.dayBoundary !== 'UTC'
    || source.currentWindowDays !== 28
    || source.baselineBlockCount !== 3
    || source.weeklyPointCount !== 12
    || source.excludesMergedEvents !== true
    || source.excludesFutureEvents !== true
    || source.evidenceSource !== 'persisted-activity-stat'
    || !Array.isArray(source.scopes)
  ) {
    return null;
  }
  const asOfDayMs = finiteNumber(source.asOfDayMs);
  const scopes = source.scopes.map(normalizeDurabilityScopeComparison);
  const scopeNames = new Set(scopes.flatMap(scope => scope ? [scope.scope] : []));
  if (
    asOfDayMs === null
    || scopes.some(scope => scope === null)
    || scopes.length !== DURABILITY_SCOPES.length
    || scopeNames.size !== DURABILITY_SCOPES.length
    || DURABILITY_SCOPES.some(scope => !scopeNames.has(scope))
  ) {
    return null;
  }
  return {
    dayBoundary: 'UTC', asOfDayMs, currentWindowDays: 28, baselineBlockCount: 3, weeklyPointCount: 12,
    excludesMergedEvents: true, excludesFutureEvents: true, evidenceSource: 'persisted-activity-stat',
    scopes: scopes as DerivedTrainingDurabilityScopeComparison[],
  };
}

export function resolveTrainingDurabilityWindowMetrics(
  value: unknown,
): DerivedTrainingDurabilityWindowMetrics | null {
  return normalizeTrainingDurabilityWindowMetrics(value, false);
}

function normalizeTrainingDurabilityWindowMetrics(
  value: unknown,
  allowMedianCoverage: boolean,
): DerivedTrainingDurabilityWindowMetrics | null {
  const source = asRecord(value);
  const coverage = normalizeDurabilityCoverage(source?.coverage, allowMedianCoverage);
  const summaries = Array.isArray(source?.summaries)
    ? source.summaries.map(resolveTrainingDurabilityContextSummary)
    : [];
  const contextKeys = new Set(summaries.flatMap(summary => summary ? [summary.context.contextKey] : []));
  const summarizedSampleCount = summaries.reduce((sum, summary) => sum + (summary?.sampleCount || 0), 0);
  if (
    !source
    || !coverage
    || summaries.some(summary => summary === null)
    || contextKeys.size !== summaries.length
    || (!allowMedianCoverage && summarizedSampleCount !== coverage.eligibleActivityCount)
  ) {
    return null;
  }
  return { coverage, summaries: summaries as DerivedTrainingDurabilityContextSummary[] };
}

function normalizeExplanationWindow(value: unknown): DerivedTrainingExplanationWindow | null {
  const source = asRecord(value);
  const metrics = normalizeExplanationWindowMetrics(source);
  const windowStartDayMs = finiteNumber(source?.windowStartDayMs);
  const windowEndDayMs = finiteNumber(source?.windowEndDayMs);
  if (!source || source.periodDays !== 28 || !metrics || windowStartDayMs === null || windowEndDayMs === null || windowStartDayMs > windowEndDayMs) {
    return null;
  }
  return { periodDays: 28, windowStartDayMs, windowEndDayMs, ...metrics };
}

function normalizeExplanationWindowMetrics(value: unknown): DerivedTrainingExplanationWindowMetrics | null {
  const source = asRecord(value);
  const parentEventCount = nonNegativeInteger(source?.parentEventCount);
  const parentLoadEventCount = nonNegativeInteger(source?.parentLoadEventCount);
  const parentTrainingStressScore = nullableNonNegativeNumber(source?.parentTrainingStressScore);
  const parentLoadCoverage = normalizeLoadCoverage(source?.parentLoadCoverage);
  const childActivityCount = nonNegativeInteger(source?.childActivityCount);
  const childLoadActivityCount = nonNegativeInteger(source?.childLoadActivityCount);
  const childTrainingStressScore = nullableNonNegativeNumber(source?.childTrainingStressScore);
  const childLoadCoverage = normalizeLoadCoverage(source?.childLoadCoverage);
  const sportLoads = normalizeSportLoads(source?.sportLoads);
  const rhythms = Array.isArray(source?.rhythms) ? source.rhythms.map(normalizeRhythm) : [];
  if (
    !source || parentEventCount === null || parentLoadEventCount === null || parentTrainingStressScore === undefined
    || !parentLoadCoverage || childActivityCount === null || childLoadActivityCount === null
    || childTrainingStressScore === undefined || !childLoadCoverage || !sportLoads
    || rhythms.some(rhythm => rhythm === null)
  ) {
    return null;
  }
  return {
    parentEventCount, parentLoadEventCount, parentTrainingStressScore, parentLoadCoverage,
    childActivityCount, childLoadActivityCount, childTrainingStressScore, childLoadCoverage,
    sportLoads,
    rhythms: rhythms as DerivedTrainingExplanationRhythm[],
  };
}

function normalizeLoadCoverage(value: unknown): DerivedTrainingExplanationLoadCoverage | null {
  const source = asRecord(value);
  const totalCount = nonNegativeInteger(source?.totalCount);
  const loadedCount = nonNegativeInteger(source?.loadedCount);
  const classifiedCount = nonNegativeInteger(source?.classifiedCount);
  const unclassifiedCount = nonNegativeInteger(source?.unclassifiedCount);
  const ratio = boundedRatio(source?.ratio);
  if (
    !source || totalCount === null || loadedCount === null || classifiedCount === null
    || unclassifiedCount === null || ratio === null || loadedCount > totalCount
    || classifiedCount + unclassifiedCount !== totalCount
  ) {
    return null;
  }
  return { totalCount, loadedCount, classifiedCount, unclassifiedCount, ratio };
}

function normalizeSportLoads(value: unknown): DerivedTrainingExplanationSportLoad[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const loads = value.map((candidate) => {
    const source = asRecord(candidate);
    const sport = source?.sport;
    const label = nonEmptyString(source?.label);
    const activityCount = nonNegativeInteger(source?.activityCount);
    const loadActivityCount = nonNegativeInteger(source?.loadActivityCount);
    const trainingStressScore = nullableNonNegativeNumber(source?.trainingStressScore);
    const loadSharePercent = nullablePercentage(source?.loadSharePercent);
    if (
      !source || !EXPLANATION_SPORTS.includes(sport as DerivedTrainingExplanationSportBucket) || !label
      || activityCount === null || loadActivityCount === null || loadActivityCount > activityCount
      || trainingStressScore === undefined || loadSharePercent === undefined
    ) {
      return null;
    }
    return { sport: sport as DerivedTrainingExplanationSportBucket, label, activityCount, loadActivityCount, trainingStressScore, loadSharePercent };
  });
  return loads.some(load => load === null) ? null : loads as DerivedTrainingExplanationSportLoad[];
}

function normalizeRhythm(value: unknown): DerivedTrainingExplanationRhythm | null {
  const source = asRecord(value);
  const sessionCount = nonNegativeInteger(source?.sessionCount);
  const activeDayCount = nonNegativeInteger(source?.activeDayCount);
  const activeWeekCount = nonNegativeInteger(source?.activeWeekCount);
  const longestInactivityGapDays = nonNegativeInteger(source?.longestInactivityGapDays);
  const longestSessionDurationSeconds = nullableNonNegativeNumber(source?.longestSessionDurationSeconds);
  if (
    !source || !isTrainingVisibleDiscipline(source.discipline) || sessionCount === null || activeDayCount === null
    || activeWeekCount === null || longestInactivityGapDays === null || longestSessionDurationSeconds === undefined
  ) {
    return null;
  }
  return { discipline: source.discipline, sessionCount, activeDayCount, activeWeekCount, longestInactivityGapDays, longestSessionDurationSeconds };
}

function normalizeDurabilityScopeComparison(value: unknown): DerivedTrainingDurabilityScopeComparison | null {
  const source = asRecord(value);
  const scope = source?.scope;
  const current = normalizeDurabilityWindow(source?.current, 28);
  const usual = normalizeTrainingDurabilityWindowMetrics(source?.usual, true);
  const baselineBlocks = Array.isArray(source?.baselineBlocks)
    ? source.baselineBlocks.map(item => normalizeDurabilityWindow(item, 28))
    : [];
  const weeks = Array.isArray(source?.weeks)
    ? source.weeks.map(item => normalizeDurabilityWindow(item, 7))
    : [];
  const recentSupportingEvents = Array.isArray(source?.recentSupportingEvents)
    ? source.recentSupportingEvents.map(normalizeSupportingEvent)
    : [];
  if (
    !source || !DURABILITY_SCOPES.includes(scope as DerivedTrainingDurabilityScope) || !current || !usual
    || baselineBlocks.length !== 3 || baselineBlocks.some(item => item === null)
    || weeks.length !== 12 || weeks.some(item => item === null)
    || recentSupportingEvents.some(item => item === null)
  ) {
    return null;
  }
  return {
    scope: scope as DerivedTrainingDurabilityScope,
    current,
    baselineBlocks: baselineBlocks as DerivedTrainingDurabilityWindow[],
    usual,
    weeks: weeks as DerivedTrainingDurabilityWindow[],
    recentSupportingEvents: recentSupportingEvents as DerivedTrainingDurabilityScopeComparison['recentSupportingEvents'],
  };
}

function normalizeDurabilityWindow(value: unknown, periodDays: 28 | 7): DerivedTrainingDurabilityWindow | null {
  const source = asRecord(value);
  const metrics = resolveTrainingDurabilityWindowMetrics(source);
  const windowStartDayMs = finiteNumber(source?.windowStartDayMs);
  const windowEndDayMs = finiteNumber(source?.windowEndDayMs);
  if (!source || source.periodDays !== periodDays || !metrics || windowStartDayMs === null || windowEndDayMs === null || windowStartDayMs > windowEndDayMs) {
    return null;
  }
  return { periodDays, windowStartDayMs, windowEndDayMs, ...metrics };
}

function normalizeDurabilityCoverage(
  value: unknown,
  allowMedianCoverage: boolean,
): DerivedTrainingDurabilityCoverage | null {
  const source = asRecord(value);
  const candidateActivityCount = nonNegativeInteger(source?.candidateActivityCount);
  const evidenceActivityCount = nonNegativeInteger(source?.evidenceActivityCount);
  const eligibleActivityCount = nonNegativeInteger(source?.eligibleActivityCount);
  const missingEvidenceActivityCount = nonNegativeInteger(source?.missingEvidenceActivityCount);
  const excludedActivityCount = nonNegativeInteger(source?.excludedActivityCount);
  const eligibilityRatio = nullableBoundedRatio(source?.eligibilityRatio);
  const exclusions = Array.isArray(source?.exclusions) ? source.exclusions.map((candidate) => {
    const exclusion = asRecord(candidate);
    const reason = nonEmptyString(exclusion?.reason);
    const activityCount = nonNegativeInteger(exclusion?.activityCount);
    return exclusion && reason && activityCount !== null ? { reason, activityCount } : null;
  }) : [];
  const exclusionActivityCount = exclusions.reduce((sum, item) => sum + (item?.activityCount || 0), 0);
  const expectedEligibilityRatio = candidateActivityCount !== null && candidateActivityCount > 0 && eligibleActivityCount !== null
    ? eligibleActivityCount / candidateActivityCount
    : null;
  if (
    !source || candidateActivityCount === null || evidenceActivityCount === null || eligibleActivityCount === null
    || missingEvidenceActivityCount === null || excludedActivityCount === null || eligibilityRatio === undefined
    || exclusions.some(item => item === null)
    || evidenceActivityCount > candidateActivityCount
    || eligibleActivityCount > evidenceActivityCount
    || missingEvidenceActivityCount > candidateActivityCount
    || excludedActivityCount > evidenceActivityCount
    || (
      !allowMedianCoverage
      && (
        evidenceActivityCount + missingEvidenceActivityCount !== candidateActivityCount
        || eligibleActivityCount + excludedActivityCount !== evidenceActivityCount
        || exclusionActivityCount !== excludedActivityCount
        || (candidateActivityCount === 0 && eligibilityRatio !== null)
        || (
          expectedEligibilityRatio !== null
          && (eligibilityRatio === null || Math.abs(eligibilityRatio - expectedEligibilityRatio) > 0.0001)
        )
      )
    )
  ) {
    return null;
  }
  return {
    candidateActivityCount, evidenceActivityCount, eligibleActivityCount, missingEvidenceActivityCount,
    excludedActivityCount, eligibilityRatio,
    exclusions: exclusions as DerivedTrainingDurabilityCoverage['exclusions'],
  };
}

export function resolveTrainingDurabilityContextSummary(value: unknown): DerivedTrainingDurabilityContextSummary | null {
  const source = asRecord(value);
  const context = resolveTrainingDurabilityContext(source?.context);
  const sampleCount = nonNegativeInteger(source?.sampleCount);
  const medianDurationSeconds = nullableNonNegativeNumber(source?.medianDurationSeconds);
  const medianCoverageRatio = nullableBoundedRatio(source?.medianCoverageRatio);
  const medianDecouplingPercent = nullableFiniteNumber(source?.medianDecouplingPercent);
  const medianOutputRetentionPercent = nullableFiniteNumber(source?.medianOutputRetentionPercent);
  const medianHeartRateDriftBpm = nullableFiniteNumber(source?.medianHeartRateDriftBpm);
  const medianPaceRetentionPercent = nullableFiniteNumber(source?.medianPaceRetentionPercent);
  const medianSwolfChange = nullableFiniteNumber(source?.medianSwolfChange);
  if (
    !source || !context || sampleCount === null || medianDurationSeconds === undefined || medianCoverageRatio === undefined
    || medianDecouplingPercent === undefined || medianOutputRetentionPercent === undefined
    || medianHeartRateDriftBpm === undefined || medianPaceRetentionPercent === undefined || medianSwolfChange === undefined
  ) {
    return null;
  }
  return {
    context, sampleCount, medianDurationSeconds, medianCoverageRatio, medianDecouplingPercent,
    medianOutputRetentionPercent, medianHeartRateDriftBpm, medianPaceRetentionPercent, medianSwolfChange,
  };
}

export function resolveTrainingDurabilityContext(value: unknown): DerivedTrainingDurabilityContext | null {
  const source = asRecord(value);
  const contextKey = nonEmptyString(source?.contextKey);
  const scope = source?.scope;
  const outputSource = nonEmptyString(source?.outputSource);
  const outputUnit = nonEmptyString(source?.outputUnit);
  const poolLengthMeters = nullableNonNegativeNumber(source?.poolLengthMeters);
  const stroke = nullableString(source?.stroke);
  if (
    !source || !contextKey || !DURABILITY_SCOPES.includes(scope as DerivedTrainingDurabilityScope)
    || !outputSource || !outputUnit || poolLengthMeters === undefined || stroke === undefined
  ) {
    return null;
  }
  return { contextKey, scope: scope as DerivedTrainingDurabilityScope, outputSource, outputUnit, poolLengthMeters, stroke };
}

function normalizeSupportingEvent(value: unknown): DerivedTrainingDurabilityScopeComparison['recentSupportingEvents'][number] | null {
  const source = asRecord(value);
  const activityId = nonEmptyString(source?.activityId);
  const eventId = nonEmptyString(source?.eventId);
  const label = nullableString(source?.label);
  const startDayMs = finiteNumber(source?.startDayMs);
  const contextKey = nonEmptyString(source?.contextKey);
  const metrics = ['decouplingPercent', 'outputRetentionPercent', 'heartRateDriftBpm', 'paceRetentionPercent', 'swolfChange'] as const;
  const values = metrics.map(key => nullableFiniteNumber(source?.[key]));
  if (!source || !activityId || !eventId || label === undefined || startDayMs === null || !contextKey || values.some(item => item === undefined)) {
    return null;
  }
  return {
    activityId, eventId, label, startDayMs, contextKey,
    decouplingPercent: values[0] as number | null,
    outputRetentionPercent: values[1] as number | null,
    heartRateDriftBpm: values[2] as number | null,
    paceRetentionPercent: values[3] as number | null,
    swolfChange: values[4] as number | null,
  };
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}
function finiteNumber(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
function nonNegativeNumber(value: unknown): number | null { const n = finiteNumber(value); return n !== null && n >= 0 ? n : null; }
function nonNegativeInteger(value: unknown): number | null { const n = nonNegativeNumber(value); return n !== null && Number.isInteger(n) ? n : null; }
function boundedRatio(value: unknown): number | null { const n = finiteNumber(value); return n !== null && n >= 0 && n <= 1 ? n : null; }
function percentage(value: unknown): number | null { const n = finiteNumber(value); return n !== null && n >= 0 && n <= 100 ? n : null; }
function nonEmptyString(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function nullableString(value: unknown): string | null | undefined { return value === null ? null : nonEmptyString(value) ?? undefined; }
function nullableFiniteNumber(value: unknown): number | null | undefined { return value === null ? null : finiteNumber(value) ?? undefined; }
function nullableNonNegativeNumber(value: unknown): number | null | undefined { return value === null ? null : nonNegativeNumber(value) ?? undefined; }
function nullableBoundedRatio(value: unknown): number | null | undefined { return value === null ? null : boundedRatio(value) ?? undefined; }
function nullablePercentage(value: unknown): number | null | undefined { return value === null ? null : percentage(value) ?? undefined; }
