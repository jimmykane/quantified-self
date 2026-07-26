import * as admin from 'firebase-admin';
import { createHash } from 'node:crypto';
import { MCP_OAUTH_COLLECTIONS } from './oauth.service';

const MCP_GEOCODING_REQUESTS_PER_MINUTE = 30;
const MCP_GEOCODING_RATE_LIMIT_DOCUMENT_LIFETIME_MS = 5 * 60 * 1000;

export class McpGeocodingRateLimitError extends Error {
  constructor() {
    super('The location lookup rate limit was exceeded.');
    this.name = 'McpGeocodingRateLimitError';
  }
}

interface RateLimitSnapshot {
  exists: boolean;
  data: () => { count?: unknown } | undefined;
}

interface RateLimitTransaction {
  get: (reference: unknown) => Promise<RateLimitSnapshot>;
  set: (reference: unknown, value: Record<string, unknown>) => void;
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
  runTransaction: operation => admin.firestore().runTransaction(
    operation as unknown as (
      transaction: admin.firestore.Transaction,
    ) => Promise<void>,
  ),
  timestampFromMillis: value => admin.firestore.Timestamp.fromMillis(value),
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
