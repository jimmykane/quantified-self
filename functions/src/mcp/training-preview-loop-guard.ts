import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import { MCP_OAUTH_COLLECTIONS } from './oauth.service';
import { TRAINING_WRITE_INPUTS, type TrainingWriteTool } from './training-plans.schemas';
import {
  type McpValidationIssueSummary,
  summarizeMcpValidationIssues,
} from './validation-issues';

const CONNECTION_FAILURES_PER_MINUTE = 3;
const USER_FAILURES_PER_MINUTE = 6;
const WINDOW_MS = 60 * 1000;
const BLOCK_MS = 10 * 60 * 1000;
const DOCUMENT_LIFETIME_MS = 15 * 60 * 1000;

export type GuardedTrainingPreviewTool = Extract<
  TrainingWriteTool,
  'preview_create_planned_workout' | 'preview_training_changes' | 'preview_strength_workout_change'
    | 'preview_planned_workout_v2_change'
>;

export interface InvalidTrainingPreviewCall {
  toolName: GuardedTrainingPreviewTool;
  validationIssues: McpValidationIssueSummary[];
}

export class McpTrainingPreviewLoopGuardError extends Error {
  constructor(
    readonly blockedForSeconds: number,
    readonly shouldLog = true,
  ) {
    super('Repeated invalid Training previews were refused.');
    this.name = 'McpTrainingPreviewLoopGuardError';
  }
}

interface CounterSnapshot {
  exists: boolean;
  data: () => {
    count?: unknown;
    windowStartMs?: unknown;
    blockedUntilMs?: unknown;
  } | undefined;
}

interface CounterTransaction {
  get: (reference: unknown) => Promise<CounterSnapshot>;
  set: (reference: unknown, value: Record<string, unknown>) => void;
  assertUserAvailable: (uid: string, nowMs: number) => Promise<void>;
}

export interface TrainingPreviewLoopGuardDependencies {
  now: () => number;
  document: (documentId: string) => unknown;
  runTransaction: (
    operation: (transaction: CounterTransaction) => Promise<void>,
  ) => Promise<void>;
  timestampFromMillis: (value: number) => unknown;
}

const defaultDependencies: TrainingPreviewLoopGuardDependencies = {
  now: Date.now,
  document: documentId => admin.firestore()
    .collection(MCP_OAUTH_COLLECTIONS.rateLimits)
    .doc(documentId),
  runTransaction: operation => {
    const db = admin.firestore();
    return db.runTransaction(async transaction => operation({
      get: async reference => {
        const snapshot = await transaction.get(reference as admin.firestore.DocumentReference);
        return { exists: snapshot.exists, data: () => snapshot.data() };
      },
      set: (reference, value) => {
        transaction.set(reference as admin.firestore.DocumentReference, value);
      },
      assertUserAvailable: async (uid, nowMs) => {
        const guard = await getUserDeletionGuardStateInTransaction(db, transaction, uid, nowMs);
        if (guard.shouldSkip) throw new Error('The MCP account is unavailable.');
      },
    }));
  },
  timestampFromMillis: value => Timestamp.fromMillis(value),
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function invalidTrainingPreviewTool(body: unknown): InvalidTrainingPreviewCall | null {
  const envelope = asRecord(body);
  if (envelope?.method !== 'tools/call') return null;
  const params = asRecord(envelope.params);
  const toolName = params?.name;
  const args = asRecord(params?.arguments) ?? {};
  if (toolName === 'preview_create_planned_workout') {
    const parsed = TRAINING_WRITE_INPUTS.preview_create_planned_workout.safeParse(args);
    return parsed.success ? null : {
      toolName,
      validationIssues: summarizeMcpValidationIssues(parsed.error) ?? [],
    };
  }
  if (toolName === 'preview_training_changes') {
    const parsed = TRAINING_WRITE_INPUTS.preview_training_changes.safeParse(args);
    return parsed.success ? null : {
      toolName,
      validationIssues: summarizeMcpValidationIssues(parsed.error) ?? [],
    };
  }
  if (toolName === 'preview_strength_workout_change') {
    const parsed = TRAINING_WRITE_INPUTS.preview_strength_workout_change.safeParse(args);
    return parsed.success ? null : { toolName,
      validationIssues: summarizeMcpValidationIssues(parsed.error) ?? [] };
  }
  if (toolName === 'preview_planned_workout_v2_change') {
    const parsed = TRAINING_WRITE_INPUTS.preview_planned_workout_v2_change.safeParse(args);
    return parsed.success ? null : { toolName,
      validationIssues: summarizeMcpValidationIssues(parsed.error) ?? [] };
  }
  return null;
}

export function buildTrainingPreviewLoopGuardBucketId(
  subjectKind: 'connection' | 'user',
  uid: string,
  connectionId: string,
): string {
  const subject = subjectKind === 'connection' ? `${uid}:${connectionId}` : uid;
  return createHash('sha256')
    .update(`training-preview-validation:${subjectKind}:${subject}`, 'utf8')
    .digest('base64url');
}

function safeNonNegativeInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function nextCounterState(
  snapshot: CounterSnapshot,
  nowMs: number,
  maximum: number,
): {
  count: number;
  windowStartMs: number;
  blockedUntilMs: number;
  blockedForSeconds: number;
  newlyBlocked: boolean;
} {
  const data = snapshot.exists ? snapshot.data() : undefined;
  const previousWindowStartMs = safeNonNegativeInteger(data?.windowStartMs);
  const previousBlockedUntilMs = safeNonNegativeInteger(data?.blockedUntilMs) ?? 0;
  if (previousBlockedUntilMs > nowMs) {
    return {
      count: safeNonNegativeInteger(data?.count) ?? maximum,
      windowStartMs: previousWindowStartMs ?? nowMs,
      blockedUntilMs: previousBlockedUntilMs,
      blockedForSeconds: Math.max(1, Math.ceil((previousBlockedUntilMs - nowMs) / 1000)),
      newlyBlocked: false,
    };
  }
  const withinWindow = previousWindowStartMs !== null
    && nowMs >= previousWindowStartMs
    && nowMs - previousWindowStartMs < WINDOW_MS;
  const windowStartMs = withinWindow ? previousWindowStartMs : nowMs;
  const previousCount = withinWindow ? safeNonNegativeInteger(data?.count) ?? 0 : 0;
  const count = previousCount + 1;
  if (count > maximum) {
    return {
      count: maximum,
      windowStartMs,
      blockedUntilMs: nowMs + BLOCK_MS,
      blockedForSeconds: Math.ceil(BLOCK_MS / 1000),
      newlyBlocked: true,
    };
  }
  return {
    count,
    windowStartMs,
    blockedUntilMs: 0,
    blockedForSeconds: 0,
    newlyBlocked: false,
  };
}

export async function consumeInvalidTrainingPreviewAttempt(
  uid: string,
  connectionId: string,
  dependencies: Partial<TrainingPreviewLoopGuardDependencies> = {},
): Promise<void> {
  const resolved = { ...defaultDependencies, ...dependencies };
  const nowMs = resolved.now();
  const counters = [
    {
      subjectKind: 'connection' as const,
      maximum: CONNECTION_FAILURES_PER_MINUTE,
      reference: resolved.document(buildTrainingPreviewLoopGuardBucketId(
        'connection', uid, connectionId,
      )),
    },
    {
      subjectKind: 'user' as const,
      maximum: USER_FAILURES_PER_MINUTE,
      reference: resolved.document(buildTrainingPreviewLoopGuardBucketId(
        'user', uid, connectionId,
      )),
    },
  ];

  let blockedForSeconds = 0;
  let shouldLog = false;
  await resolved.runTransaction(async transaction => {
    await transaction.assertUserAvailable(uid, nowMs);
    const snapshots = await Promise.all(counters.map(counter => transaction.get(counter.reference)));
    const states = snapshots.map((snapshot, index) => nextCounterState(
      snapshot,
      nowMs,
      counters[index].maximum,
    ));
    blockedForSeconds = Math.max(...states.map(state => state.blockedForSeconds));
    shouldLog = states[0].newlyBlocked
      || (states[0].blockedForSeconds === 0 && states[1].newlyBlocked);
    counters.forEach((counter, index) => transaction.set(counter.reference, {
      uid,
      ...(counter.subjectKind === 'connection' ? { connectionId } : {}),
      rateLimitType: 'training_preview_validation',
      subjectKind: counter.subjectKind,
      windowStartMs: states[index].windowStartMs,
      count: states[index].count,
      blockedUntilMs: states[index].blockedUntilMs,
      expireAt: resolved.timestampFromMillis(Math.max(
        nowMs + DOCUMENT_LIFETIME_MS,
        states[index].blockedUntilMs + 60_000,
      )),
    }));
  });
  if (blockedForSeconds > 0) {
    throw new McpTrainingPreviewLoopGuardError(blockedForSeconds, shouldLog);
  }
}
