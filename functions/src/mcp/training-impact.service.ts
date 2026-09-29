import * as admin from 'firebase-admin';
import { FieldPath } from 'firebase-admin/firestore';
import {
  DERIVED_METRIC_KINDS,
  DERIVED_METRIC_SCHEMA_VERSION,
  DERIVED_METRICS_ENTRY_TYPES,
  type DerivedFormMetricPayload,
} from '../../../shared/derived-metrics';
import { isBenchmarkEventForTrainingMetrics } from '../../../shared/event-classification';
import { isValidIanaTimeZone } from '../../../shared/event-stat-aggregation';
import {
  buildTrainingLoadPoints,
  buildTrainingSessionLoadImpact,
  resolveTrainingLoadDayImpact,
  TRAINING_LOAD_ATL_TIME_CONSTANT_DAYS,
  TRAINING_LOAD_CTL_TIME_CONSTANT_DAYS,
  TRAINING_LOAD_DAY_MS,
  type TrainingLoadContribution,
  type TrainingLoadDayImpact,
  type TrainingSessionLoadImpact,
} from '../../../shared/training-load';
import { getUserDeletionGuardState } from '../shared/user-deletion-guard';
import { MCP_DERIVED_PAYLOAD_SCHEMAS } from './derived-output-schemas';

const CURRENT_TSS_TYPE = 'Training Stress Score';
const LEGACY_TSS_TYPE = 'Power Training Stress Score';
const FIRESTORE_IN_LIMIT = 30;
const TRAINING_IMPACT_RESPONSE_MAX_BYTES = 16 * 1024;

export const MCP_TRAINING_IMPACT_MAX_ACTIVITIES = 32;
export const MCP_TRAINING_IMPACT_SCHEMA_VERSION = 1 as const;

export type McpTrainingImpactMode = 'session' | 'day';
export type McpTrainingImpactStatus =
  | 'ready'
  | 'partial'
  | 'updating'
  | 'unavailable'
  | 'excluded';
export type McpTrainingImpactReason =
  | 'partial_coverage'
  | 'form_updating'
  | 'form_failed'
  | 'missing_tss'
  | 'benchmark_or_merge'
  | 'not_completed'
  | 'no_usable_sessions'
  | 'training_day_not_available';

export type McpTrainingImpactErrorCode =
  | 'invalid_request'
  | 'detail_not_available'
  | 'query_too_large'
  | 'temporarily_unavailable';

export class McpTrainingImpactError extends Error {
  constructor(
    readonly code: McpTrainingImpactErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'McpTrainingImpactError';
  }
}

export interface McpTrainingImpactReference {
  activityId: string;
  eventId: string;
}

export interface McpTrainingImpactInput {
  uid: string;
  mode: McpTrainingImpactMode;
  references: readonly McpTrainingImpactReference[];
  localDate: string | null;
  timeZone: string | null;
  nowMs: number;
}

export interface McpTrainingImpactDocument {
  id: string;
  data: Record<string, unknown>;
}

export interface McpTrainingImpactReads {
  activeOwner(uid: string): Promise<boolean>;
  fetchActivities(
    uid: string,
    activityIds: readonly string[],
  ): Promise<McpTrainingImpactDocument[]>;
  fetchEvents(
    uid: string,
    eventIds: readonly string[],
  ): Promise<McpTrainingImpactDocument[]>;
  fetchFormSnapshot(uid: string): Promise<Record<string, unknown> | null>;
}

export interface McpTrainingImpactContribution {
  trainingStressScore: number;
  fitnessLoadCtlContribution: number;
  fatigueLoadAtlContribution: number;
  freshnessFormContribution: number;
}

export interface McpTrainingImpactOutcome {
  trainingDay: string;
  trainingStressScore: number;
  previousFitnessLoadCtl: number;
  fitnessLoadCtl: number;
  fitnessLoadCtlChange: number;
  previousFatigueLoadAtl: number;
  fatigueLoadAtl: number;
  fatigueLoadAtlChange: number;
  previousFreshnessForm: number;
  freshnessForm: number;
  freshnessFormChange: number;
  fitnessLoadOutcome: TrainingLoadDayImpact['outcome'];
}

export interface McpTrainingImpactResult {
  schemaVersion: typeof MCP_TRAINING_IMPACT_SCHEMA_VERSION;
  mode: McpTrainingImpactMode;
  localDate: string | null;
  timeZone: string | null;
  status: McpTrainingImpactStatus;
  reason: McpTrainingImpactReason | null;
  model: {
    basis: 'TSS';
    ctlTimeConstantDays: typeof TRAINING_LOAD_CTL_TIME_CONSTANT_DAYS;
    atlTimeConstantDays: typeof TRAINING_LOAD_ATL_TIME_CONSTANT_DAYS;
    measuresPhysiologicalAdaptation: false;
  };
  coverage: {
    requestedSessionCount: number;
    eligibleSessionCount: number;
    modeledSessionCount: number;
    missingTssSessionCount: number;
    excludedSessionCount: number;
    benchmarkOrMergeSessionCount: number;
    notCompletedSessionCount: number;
    unavailableSessionCount: number;
  };
  contribution: McpTrainingImpactContribution | null;
  sessionRole: TrainingSessionLoadImpact['role'] | null;
  outcomes: McpTrainingImpactOutcome[];
}

interface ResolvedTrainingImpactCandidate {
  trainingStressScore: number | null;
  dayMs: number;
  exclusion: 'benchmark_or_merge' | 'not_completed' | null;
}

interface TrainingImpactCounts {
  requestedSessionCount: number;
  eligibleSessionCount: number;
  modeledSessionCount: number;
  missingTssSessionCount: number;
  excludedSessionCount: number;
  benchmarkOrMergeSessionCount: number;
  notCompletedSessionCount: number;
  unavailableSessionCount: number;
}

function chunkValues<T>(values: readonly T[]): T[][] {
  const chunks: T[][] = [];
  for (let offset = 0; offset < values.length; offset += FIRESTORE_IN_LIMIT) {
    chunks.push(values.slice(offset, offset + FIRESTORE_IN_LIMIT));
  }
  return chunks;
}

export const firestoreTrainingImpactReads: McpTrainingImpactReads = {
  activeOwner: async uid => !(await getUserDeletionGuardState(
    admin.firestore(),
    uid,
  )).shouldSkip,
  fetchActivities: async (uid, activityIds) => {
    const uniqueIds = [...new Set(activityIds)];
    const snapshots = await Promise.all(chunkValues(uniqueIds).map(ids => (
      admin.firestore()
        .collection('users')
        .doc(uid)
        .collection('activities')
        .where(FieldPath.documentId(), 'in', ids)
        .select(
          'eventID',
          'startDate',
          'endDate',
          new FieldPath('stats', CURRENT_TSS_TYPE),
          new FieldPath('stats', LEGACY_TSS_TYPE),
        )
        .get()
    )));
    return snapshots.flatMap(snapshot => snapshot.docs.map(doc => ({
      id: doc.id,
      data: doc.data() as Record<string, unknown>,
    })));
  },
  fetchEvents: async (uid, eventIds) => {
    const uniqueIds = [...new Set(eventIds)];
    const snapshots = await Promise.all(chunkValues(uniqueIds).map(ids => (
      admin.firestore()
        .collection('users')
        .doc(uid)
        .collection('events')
        .where(FieldPath.documentId(), 'in', ids)
        .select('mergeType', 'isMerge')
        .get()
    )));
    return snapshots.flatMap(snapshot => snapshot.docs.map(doc => ({
      id: doc.id,
      data: doc.data() as Record<string, unknown>,
    })));
  },
  fetchFormSnapshot: async uid => {
    const snapshot = await admin.firestore()
      .collection('users')
      .doc(uid)
      .collection('derivedMetrics')
      .doc(DERIVED_METRIC_KINDS.Form)
      .get();
    return snapshot.exists
      ? snapshot.data() as Record<string, unknown>
      : null;
  },
};

function requireRealLocalDate(value: string | null): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  if (!match) {
    throw new McpTrainingImpactError(
      'invalid_request',
      'Day Training impact requires a real localDate in YYYY-MM-DD format.',
    );
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    throw new McpTrainingImpactError(
      'invalid_request',
      'Day Training impact requires a real localDate in YYYY-MM-DD format.',
    );
  }
  return value as string;
}

function requireTimeZone(value: string | null): string {
  const normalized = `${value || ''}`.trim();
  if (!isValidIanaTimeZone(normalized)) {
    throw new McpTrainingImpactError(
      'invalid_request',
      'Day Training impact requires a valid IANA timeZone.',
    );
  }
  return normalized;
}

function localDateForTime(timeMs: number, timeZone: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(timeMs).map(part => [part.type, part.value]));
  if (!parts.year || !parts.month || !parts.day) {
    throw new McpTrainingImpactError(
      'temporarily_unavailable',
      'Training impact could not resolve the selected calendar date.',
    );
  }
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function timestampMs(value: unknown): number | null {
  if (value instanceof Date) {
    return Number.isSafeInteger(value.getTime()) ? value.getTime() : null;
  }
  if (
    value
    && typeof value === 'object'
    && typeof (value as { toMillis?: unknown }).toMillis === 'function'
  ) {
    const result = Number((value as { toMillis: () => unknown }).toMillis());
    return Number.isSafeInteger(result) ? result : null;
  }
  return typeof value === 'number' && Number.isSafeInteger(value)
    ? value
    : null;
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(numeric) ? numeric : null;
}

function persistedStatNumber(stats: unknown, statType: string): number | null {
  if (!stats || typeof stats !== 'object' || Array.isArray(stats)) return null;
  const rawValue = (stats as Record<string, unknown>)[statType];
  const direct = finiteNumber(rawValue);
  if (direct !== null) return direct;
  if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) return null;
  const record = rawValue as Record<string, unknown>;
  return finiteNumber(record.value)
    ?? finiteNumber(record.rawValue)
    ?? finiteNumber(record._value);
}

function resolveTrainingStressScore(stats: unknown): number | null {
  const current = persistedStatNumber(stats, CURRENT_TSS_TYPE);
  if (current !== null && current >= 0) return current;
  const legacy = persistedStatNumber(stats, LEGACY_TSS_TYPE);
  return legacy !== null && legacy >= 0 ? legacy : null;
}

function utcDayMs(timeMs: number): number {
  const date = new Date(timeMs);
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
}

function utcDay(dayMs: number): string {
  return new Date(dayMs).toISOString().slice(0, 10);
}

function roundMetric(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function projectContribution(
  contribution: TrainingLoadContribution,
): McpTrainingImpactContribution {
  return {
    trainingStressScore: roundMetric(contribution.trainingStressScore),
    fitnessLoadCtlContribution: roundMetric(contribution.ctlContribution),
    fatigueLoadAtlContribution: roundMetric(contribution.atlContribution),
    freshnessFormContribution: roundMetric(contribution.formContribution),
  };
}

function projectOutcome(day: TrainingLoadDayImpact): McpTrainingImpactOutcome {
  return {
    trainingDay: utcDay(day.dayMs),
    trainingStressScore: roundMetric(day.trainingStressScore),
    previousFitnessLoadCtl: roundMetric(day.previousCtl),
    fitnessLoadCtl: roundMetric(day.ctl),
    fitnessLoadCtlChange: roundMetric(day.ctlChange),
    previousFatigueLoadAtl: roundMetric(day.previousAtl),
    fatigueLoadAtl: roundMetric(day.atl),
    fatigueLoadAtlChange: roundMetric(day.atlChange),
    previousFreshnessForm: roundMetric(day.formPriorDay),
    freshnessForm: roundMetric(day.formSameDay),
    freshnessFormChange: roundMetric(day.formChange),
    fitnessLoadOutcome: day.outcome,
  };
}

function result(
  input: Pick<McpTrainingImpactInput, 'mode' | 'localDate' | 'timeZone'>,
  status: McpTrainingImpactStatus,
  reason: McpTrainingImpactReason | null,
  coverage: TrainingImpactCounts,
  contribution: McpTrainingImpactContribution | null = null,
  sessionRole: TrainingSessionLoadImpact['role'] | null = null,
  outcomes: McpTrainingImpactOutcome[] = [],
): McpTrainingImpactResult {
  const output: McpTrainingImpactResult = {
    schemaVersion: MCP_TRAINING_IMPACT_SCHEMA_VERSION,
    mode: input.mode,
    localDate: input.mode === 'day' ? input.localDate : null,
    timeZone: input.mode === 'day' ? input.timeZone : null,
    status,
    reason,
    model: {
      basis: 'TSS',
      ctlTimeConstantDays: TRAINING_LOAD_CTL_TIME_CONSTANT_DAYS,
      atlTimeConstantDays: TRAINING_LOAD_ATL_TIME_CONSTANT_DAYS,
      measuresPhysiologicalAdaptation: false,
    },
    coverage,
    contribution,
    sessionRole,
    outcomes,
  };
  if (Buffer.byteLength(JSON.stringify(output), 'utf8') > TRAINING_IMPACT_RESPONSE_MAX_BYTES) {
    throw new McpTrainingImpactError(
      'query_too_large',
      'The Training impact response exceeds the processing limit.',
    );
  }
  return output;
}

function emptyCounts(requestedSessionCount: number): TrainingImpactCounts {
  return {
    requestedSessionCount,
    eligibleSessionCount: 0,
    modeledSessionCount: 0,
    missingTssSessionCount: 0,
    excludedSessionCount: 0,
    benchmarkOrMergeSessionCount: 0,
    notCompletedSessionCount: 0,
    unavailableSessionCount: 0,
  };
}

function formSnapshotState(snapshot: Record<string, unknown> | null):
  | { status: 'ready'; payload: DerivedFormMetricPayload }
  | { status: 'updating' | 'failed'; payload: null } {
  if (snapshot?.status === 'failed') return { status: 'failed', payload: null };
  if (
    !snapshot
    || snapshot.status !== 'ready'
    || snapshot.entryType !== DERIVED_METRICS_ENTRY_TYPES.Snapshot
    || snapshot.metricKind !== DERIVED_METRIC_KINDS.Form
    || snapshot.schemaVersion !== DERIVED_METRIC_SCHEMA_VERSION
  ) {
    return { status: 'updating', payload: null };
  }
  const parsed = MCP_DERIVED_PAYLOAD_SCHEMAS[DERIVED_METRIC_KINDS.Form]
    .safeParse(snapshot.payload);
  if (!parsed.success || parsed.data.excludesMergedEvents !== true) {
    return { status: 'updating', payload: null };
  }
  const { dailyLoads, rangeStartDayMs, rangeEndDayMs } = parsed.data;
  const validDailyLoads = dailyLoads.every((entry, index) => (
    Number.isSafeInteger(entry.dayMs)
    && entry.dayMs >= 0
    && entry.dayMs % TRAINING_LOAD_DAY_MS === 0
    && Number.isFinite(entry.load)
    && entry.load >= 0
    && (index === 0 || dailyLoads[index - 1].dayMs < entry.dayMs)
  ));
  const validRange = dailyLoads.length === 0
    ? rangeStartDayMs === null && rangeEndDayMs === null
    : rangeStartDayMs === dailyLoads[0].dayMs
      && rangeEndDayMs === dailyLoads[dailyLoads.length - 1].dayMs;
  if (!validDailyLoads || !validRange) {
    return { status: 'updating', payload: null };
  }
  return {
    status: 'ready',
    payload: parsed.data as DerivedFormMetricPayload,
  };
}

function validateInput(input: McpTrainingImpactInput): {
  localDate: string | null;
  timeZone: string | null;
} {
  if (
    !Number.isSafeInteger(input.nowMs)
    || input.nowMs < 0
    || !Array.isArray(input.references)
    || input.references.length < 1
    || input.references.length > MCP_TRAINING_IMPACT_MAX_ACTIVITIES
  ) {
    throw new McpTrainingImpactError(
      'invalid_request',
      `Choose between 1 and ${MCP_TRAINING_IMPACT_MAX_ACTIVITIES} completed activities.`,
    );
  }
  const uniqueReferences = new Set(input.references.map(reference => (
    `${reference.activityId}\0${reference.eventId}`
  )));
  if (uniqueReferences.size !== input.references.length) {
    throw new McpTrainingImpactError(
      'invalid_request',
      'Training impact activity references must be unique.',
    );
  }
  if (input.mode === 'session') {
    if (
      input.references.length !== 1
      || input.localDate !== null
      || input.timeZone !== null
    ) {
      throw new McpTrainingImpactError(
        'invalid_request',
        'Session Training impact requires exactly one activity and no day fields.',
      );
    }
    return { localDate: null, timeZone: null };
  }
  return {
    localDate: requireRealLocalDate(input.localDate),
    timeZone: requireTimeZone(input.timeZone),
  };
}

async function loadCandidates(
  input: McpTrainingImpactInput,
  reads: McpTrainingImpactReads,
  localDate: string | null,
  timeZone: string | null,
): Promise<ResolvedTrainingImpactCandidate[]> {
  const [activityDocuments, eventDocuments] = await Promise.all([
    reads.fetchActivities(input.uid, input.references.map(reference => reference.activityId)),
    reads.fetchEvents(input.uid, input.references.map(reference => reference.eventId)),
  ]);
  const activities = new Map(activityDocuments.map(document => [document.id, document.data]));
  const events = new Map(eventDocuments.map(document => [document.id, document.data]));
  return input.references.map((reference) => {
    const activity = activities.get(reference.activityId);
    const event = events.get(reference.eventId);
    if (!activity || !event || activity.eventID !== reference.eventId) {
      throw new McpTrainingImpactError(
        'detail_not_available',
        'The selected completed activity is not available.',
      );
    }
    const startTimeMs = timestampMs(activity.startDate);
    const endTimeMs = timestampMs(activity.endDate);
    if (startTimeMs === null) {
      throw new McpTrainingImpactError(
        'detail_not_available',
        'The selected completed activity has no usable Training day.',
      );
    }
    if (endTimeMs !== null && endTimeMs < startTimeMs) {
      throw new McpTrainingImpactError(
        'detail_not_available',
        'The selected completed activity has no usable completion time.',
      );
    }
    if (
      input.mode === 'day'
      && localDateForTime(startTimeMs, timeZone as string) !== localDate
    ) {
      throw new McpTrainingImpactError(
        'invalid_request',
        'Every day Training impact activity must belong to the selected localDate and timeZone.',
      );
    }
    return {
      trainingStressScore: resolveTrainingStressScore(activity.stats),
      dayMs: utcDayMs(startTimeMs),
      exclusion: isBenchmarkEventForTrainingMetrics(event)
        ? 'benchmark_or_merge'
        : endTimeMs === null || endTimeMs > input.nowMs
          ? 'not_completed'
          : null,
    };
  });
}

export async function getMcpTrainingImpact(
  input: McpTrainingImpactInput,
  reads: McpTrainingImpactReads,
): Promise<McpTrainingImpactResult> {
  const normalized = validateInput(input);
  if (!await reads.activeOwner(input.uid)) {
    throw new McpTrainingImpactError(
      'temporarily_unavailable',
      'Training impact is unavailable for this account.',
    );
  }
  const candidates = await loadCandidates(
    input,
    reads,
    normalized.localDate,
    normalized.timeZone,
  );
  const counts = emptyCounts(candidates.length);
  const eligible = candidates.filter((candidate) => {
    if (candidate.exclusion) {
      counts.excludedSessionCount += 1;
      if (candidate.exclusion === 'benchmark_or_merge') {
        counts.benchmarkOrMergeSessionCount += 1;
      } else {
        counts.notCompletedSessionCount += 1;
      }
      return false;
    }
    if (candidate.trainingStressScore === null) {
      counts.missingTssSessionCount += 1;
      return false;
    }
    counts.eligibleSessionCount += 1;
    return true;
  }) as Array<ResolvedTrainingImpactCandidate & { trainingStressScore: number }>;

  if (!eligible.length) {
    const onlyExcluded = counts.excludedSessionCount === counts.requestedSessionCount;
    const onlyMissing = counts.missingTssSessionCount === counts.requestedSessionCount;
    const onlyBenchmarkOrMerge = counts.benchmarkOrMergeSessionCount
      === counts.requestedSessionCount;
    const onlyNotCompleted = counts.notCompletedSessionCount
      === counts.requestedSessionCount;
    const reason: McpTrainingImpactReason = onlyBenchmarkOrMerge
      ? 'benchmark_or_merge'
      : onlyNotCompleted
        ? 'not_completed'
      : onlyMissing && input.mode === 'session'
        ? 'missing_tss'
        : 'no_usable_sessions';
    if (!await reads.activeOwner(input.uid)) {
      throw new McpTrainingImpactError(
        'temporarily_unavailable',
        'Training impact is unavailable for this account.',
      );
    }
    return result(
      { ...input, ...normalized },
      onlyExcluded ? 'excluded' : 'unavailable',
      reason,
      counts,
    );
  }

  const snapshot = formSnapshotState(await reads.fetchFormSnapshot(input.uid));
  if (snapshot.status !== 'ready') {
    counts.unavailableSessionCount = counts.eligibleSessionCount;
    if (!await reads.activeOwner(input.uid)) {
      throw new McpTrainingImpactError(
        'temporarily_unavailable',
        'Training impact is unavailable for this account.',
      );
    }
    return result(
      { ...input, ...normalized },
      snapshot.status === 'failed' ? 'unavailable' : 'updating',
      snapshot.status === 'failed' ? 'form_failed' : 'form_updating',
      counts,
    );
  }

  const requestedDays = eligible.map(candidate => candidate.dayMs);
  const latestRequestedDay = Math.max(...requestedDays);
  const points = buildTrainingLoadPoints(
    snapshot.payload.dailyLoads,
    Math.max(snapshot.payload.rangeEndDayMs ?? latestRequestedDay, latestRequestedDay),
  );
  const selectedLoadByDay = eligible.reduce((totals, candidate) => {
    totals.set(
      candidate.dayMs,
      (totals.get(candidate.dayMs) || 0) + candidate.trainingStressScore,
    );
    return totals;
  }, new Map<number, number>());
  const impacts: TrainingSessionLoadImpact[] = [];
  let hasUpdatingUnavailable = false;
  for (const candidate of eligible) {
    const outsideEarlierRange = snapshot.payload.rangeStartDayMs !== null
      && candidate.dayMs < snapshot.payload.rangeStartDayMs;
    const outsideLaterRange = snapshot.payload.rangeEndDayMs !== null
      && candidate.dayMs > snapshot.payload.rangeEndDayMs;
    if (outsideEarlierRange) {
      counts.unavailableSessionCount += 1;
      continue;
    }
    if (outsideLaterRange) {
      counts.unavailableSessionCount += 1;
      hasUpdatingUnavailable = true;
      continue;
    }
    const dayImpact = resolveTrainingLoadDayImpact(points, candidate.dayMs);
    if (
      dayImpact
      && (selectedLoadByDay.get(candidate.dayMs) || 0)
        > dayImpact.trainingStressScore + Number.EPSILON
    ) {
      counts.unavailableSessionCount += 1;
      hasUpdatingUnavailable = true;
      continue;
    }
    const impact = dayImpact
      ? buildTrainingSessionLoadImpact(candidate.trainingStressScore, dayImpact)
      : null;
    if (!impact) {
      counts.unavailableSessionCount += 1;
      hasUpdatingUnavailable = true;
      continue;
    }
    impacts.push(impact);
  }
  counts.modeledSessionCount = impacts.length;
  if (!impacts.length) {
    const unavailableReason: McpTrainingImpactReason = hasUpdatingUnavailable
      ? 'form_updating'
      : 'training_day_not_available';
    if (!await reads.activeOwner(input.uid)) {
      throw new McpTrainingImpactError(
        'temporarily_unavailable',
        'Training impact is unavailable for this account.',
      );
    }
    return result(
      { ...input, ...normalized },
      unavailableReason === 'form_updating' ? 'updating' : 'unavailable',
      unavailableReason,
      counts,
    );
  }

  const total = impacts.reduce<TrainingLoadContribution>((sum, impact) => ({
    trainingStressScore: sum.trainingStressScore + impact.trainingStressScore,
    ctlContribution: sum.ctlContribution + impact.ctlContribution,
    atlContribution: sum.atlContribution + impact.atlContribution,
    formContribution: sum.formContribution + impact.formContribution,
  }), {
    trainingStressScore: 0,
    ctlContribution: 0,
    atlContribution: 0,
    formContribution: 0,
  });
  const outcomes = [...new Map(impacts.map(impact => [
    impact.day.dayMs,
    impact.day,
  ])).values()]
    .sort((left, right) => left.dayMs - right.dayMs)
    .map(projectOutcome);
  const partial = counts.modeledSessionCount < counts.requestedSessionCount;
  if (!await reads.activeOwner(input.uid)) {
    throw new McpTrainingImpactError(
      'temporarily_unavailable',
      'Training impact is unavailable for this account.',
    );
  }
  return result(
    { ...input, ...normalized },
    partial ? 'partial' : 'ready',
    partial ? 'partial_coverage' : null,
    counts,
    projectContribution(total),
    input.mode === 'session' ? impacts[0].role : null,
    outcomes,
  );
}
