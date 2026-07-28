import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import { MCP_OAUTH_COLLECTIONS } from './oauth.service';

const CONNECTION_REQUESTS_PER_MINUTE = 6;
const USER_REQUESTS_PER_MINUTE = 12;
const DOCUMENT_LIFETIME_MS = 5 * 60 * 1000;

export class McpActivityChartRateLimitError extends Error {
  constructor() {
    super('The activity chart parsing rate limit was exceeded.');
    this.name = 'McpActivityChartRateLimitError';
  }
}

interface CounterSnapshot {
  exists: boolean;
  data: () => { count?: unknown } | undefined;
}

interface CounterTransaction {
  get: (reference: unknown) => Promise<CounterSnapshot>;
  set: (reference: unknown, value: Record<string, unknown>) => void;
  assertUserAvailable: (uid: string, nowMs: number) => Promise<void>;
}

export interface ActivityChartRateLimitDependencies {
  now: () => number;
  document: (documentId: string) => unknown;
  runTransaction: (
    operation: (transaction: CounterTransaction) => Promise<void>,
  ) => Promise<void>;
  timestampFromMillis: (value: number) => unknown;
}

const defaultDependencies: ActivityChartRateLimitDependencies = {
  now: Date.now,
  document: documentId => admin.firestore()
    .collection(MCP_OAUTH_COLLECTIONS.rateLimits)
    .doc(documentId),
  runTransaction: (operation) => {
    const db = admin.firestore();
    return db.runTransaction(async transaction => operation({
      get: async reference => {
        const snapshot = await transaction.get(
          reference as admin.firestore.DocumentReference,
        );
        return {
          exists: snapshot.exists,
          data: () => snapshot.data(),
        };
      },
      set: (reference, value) => {
        transaction.set(reference as admin.firestore.DocumentReference, value);
      },
      assertUserAvailable: async (uid, nowMs) => {
        const guard = await getUserDeletionGuardStateInTransaction(
          db,
          transaction,
          uid,
          nowMs,
        );
        if (guard.shouldSkip) {
          throw new McpActivityChartRateLimitError();
        }
      },
    }));
  },
  timestampFromMillis: value => Timestamp.fromMillis(value),
};

export function buildActivityChartRateLimitBucketId(
  subjectKind: 'connection' | 'user',
  uid: string,
  connectionId: string,
  windowStartMs: number,
): string {
  const subject = subjectKind === 'connection' ? `${uid}:${connectionId}` : uid;
  return createHash('sha256')
    .update(`activity-chart:${subjectKind}:${subject}:${windowStartMs}`, 'utf8')
    .digest('base64url');
}

function nextCount(snapshot: CounterSnapshot): number {
  const previous = snapshot.exists ? Number(snapshot.data()?.count || 0) : 0;
  return Number.isSafeInteger(previous) && previous >= 0 ? previous + 1 : 1;
}

export async function consumeActivityChartRateLimit(
  uid: string,
  connectionId: string,
  dependencies: Partial<ActivityChartRateLimitDependencies> = {},
): Promise<void> {
  const resolved = { ...defaultDependencies, ...dependencies };
  const nowMs = resolved.now();
  const windowStartMs = Math.floor(nowMs / 60_000) * 60_000;
  const counters = [
    {
      kind: 'connection' as const,
      maximum: CONNECTION_REQUESTS_PER_MINUTE,
      reference: resolved.document(buildActivityChartRateLimitBucketId(
        'connection',
        uid,
        connectionId,
        windowStartMs,
      )),
    },
    {
      kind: 'user' as const,
      maximum: USER_REQUESTS_PER_MINUTE,
      reference: resolved.document(buildActivityChartRateLimitBucketId(
        'user',
        uid,
        connectionId,
        windowStartMs,
      )),
    },
  ];

  await resolved.runTransaction(async (transaction) => {
    await transaction.assertUserAvailable(uid, nowMs);
    const snapshots = await Promise.all(
      counters.map(counter => transaction.get(counter.reference)),
    );
    const counts = snapshots.map(nextCount);
    if (counts.some((count, index) => count > counters[index].maximum)) {
      throw new McpActivityChartRateLimitError();
    }
    counters.forEach((counter, index) => transaction.set(counter.reference, {
      rateLimitType: 'activity_chart',
      subjectKind: counter.kind,
      windowStartMs,
      count: counts[index],
      expireAt: resolved.timestampFromMillis(windowStartMs + DOCUMENT_LIFETIME_MS),
    }));
  });
}
