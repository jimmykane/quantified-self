import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import {
  getUserDeletionGuardStateInTransaction,
} from '../shared/user-deletion-guard';
import { MCP_OAUTH_COLLECTIONS } from './oauth.service';

const MCP_GEOCODING_REQUESTS_PER_MINUTE = 30;
const MCP_GEOCODING_RATE_LIMIT_DOCUMENT_LIFETIME_MS = 5 * 60 * 1000;

export class McpGeocodingRateLimitError extends Error {
  constructor() {
    super('The location lookup rate limit was exceeded.');
    this.name = 'McpGeocodingRateLimitError';
  }
}

export class McpGeocodingUnavailableError extends Error {
  constructor() {
    super('The MCP account is no longer available.');
    this.name = 'McpGeocodingUnavailableError';
  }
}

interface RateLimitSnapshot {
  exists: boolean;
  data: () => { count?: unknown } | undefined;
}

interface RateLimitTransaction {
  get: (reference: unknown) => Promise<RateLimitSnapshot>;
  set: (reference: unknown, value: Record<string, unknown>) => void;
  assertUserAvailable: (uid: string, nowMs: number) => Promise<void>;
}

export interface McpGeocodingRateLimitDependencies {
  now: () => number;
  document: (documentId: string) => unknown;
  runTransaction: (
    operation: (transaction: RateLimitTransaction) => Promise<void>,
  ) => Promise<void>;
  timestampFromMillis: (value: number) => unknown;
}

const defaultDependencies: McpGeocodingRateLimitDependencies = {
  now: () => Date.now(),
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
        transaction.set(
          reference as admin.firestore.DocumentReference,
          value,
        );
      },
      assertUserAvailable: async (uid, nowMs) => {
        const guard = await getUserDeletionGuardStateInTransaction(
          db,
          transaction,
          uid,
          nowMs,
        );
        if (guard.shouldSkip) {
          throw new McpGeocodingUnavailableError();
        }
      },
    }));
  },
  timestampFromMillis: value => Timestamp.fromMillis(value),
};

export function buildMcpGeocodingRateLimitBucketId(
  uid: string,
  connectionId: string,
  windowStartMs: number,
): string {
  return createHash('sha256')
    .update(`geocoding:${uid}:${connectionId}:${windowStartMs}`, 'utf8')
    .digest('base64url');
}

export async function consumeMcpGeocodingRateLimit(
  uid: string,
  connectionId: string,
  dependencies: Partial<McpGeocodingRateLimitDependencies> = {},
): Promise<void> {
  const resolvedDependencies = {
    ...defaultDependencies,
    ...dependencies,
  };
  const nowMs = resolvedDependencies.now();
  const windowStartMs = Math.floor(nowMs / 60_000) * 60_000;
  const document = resolvedDependencies.document(
    buildMcpGeocodingRateLimitBucketId(uid, connectionId, windowStartMs),
  );

  await resolvedDependencies.runTransaction(async (transaction) => {
    await transaction.assertUserAvailable(uid, nowMs);
    const snapshot = await transaction.get(document);
    const previousCount = snapshot.exists ? Number(snapshot.data()?.count || 0) : 0;
    const nextCount = Number.isSafeInteger(previousCount) && previousCount >= 0
      ? previousCount + 1
      : 1;
    if (nextCount > MCP_GEOCODING_REQUESTS_PER_MINUTE) {
      throw new McpGeocodingRateLimitError();
    }
    transaction.set(document, {
      uid,
      connectionId,
      rateLimitType: 'geocoding',
      windowStartMs,
      count: nextCount,
      expireAt: resolvedDependencies.timestampFromMillis(
        windowStartMs + MCP_GEOCODING_RATE_LIMIT_DOCUMENT_LIFETIME_MS,
      ),
    });
  });
}
