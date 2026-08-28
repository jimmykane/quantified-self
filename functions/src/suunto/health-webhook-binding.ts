import * as admin from 'firebase-admin';
import * as crypto from 'crypto';

// Permanent-leaf schema: binding documents never own subcollections. This
// lets lifecycle transactions delete an exact binding atomically without a
// post-transaction recursive delete racing a reconnect-created replacement.
export const SUUNTO_HEALTH_WEBHOOK_ACCOUNT_BINDINGS_COLLECTION_NAME =
  'suuntoHealthWebhookAccountBindings';
export const SUUNTO_HEALTH_WEBHOOK_ACCOUNT_BINDING_SCHEMA_VERSION = 3;
export const SUUNTO_WEBHOOK_MAX_MATCHING_ACCOUNT_BINDINGS = 32;
export const SUUNTO_WEBHOOK_BINDING_AUTHORIZATION_SOURCES = {
  OAuthCallback: 'oauth_callback',
  ProviderRefresh: 'provider_refresh',
} as const;

export type SuuntoWebhookBindingAuthorizationSource =
  typeof SUUNTO_WEBHOOK_BINDING_AUTHORIZATION_SOURCES[keyof
    typeof SUUNTO_WEBHOOK_BINDING_AUTHORIZATION_SOURCES];

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

export interface SuuntoHealthWebhookAccountBinding {
  schemaVersion: typeof SUUNTO_HEALTH_WEBHOOK_ACCOUNT_BINDING_SCHEMA_VERSION;
  authorizationSource: SuuntoWebhookBindingAuthorizationSource;
  userID: string;
  providerAccountDigest: string;
  tokenCredentialGeneration: string | null;
}

function normalizedRequiredString(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized.length > 0 ? normalized : null;
}

export function normalizeSuuntoTokenCredentialGeneration(value: unknown): string | null {
  return normalizedRequiredString(value);
}

export function getSuuntoWebhookProviderAccountDigest(providerUserId: string): string {
  const normalizedProviderUserId = normalizedRequiredString(providerUserId);
  if (!normalizedProviderUserId || normalizedProviderUserId !== providerUserId) {
    throw new Error('Invalid Suunto webhook provider account identifier.');
  }
  return crypto.createHash('sha256').update(providerUserId).digest('hex');
}

export function getSuuntoHealthWebhookAccountBindingRef(
  db: admin.firestore.Firestore,
  providerUserId: string,
  userID: string,
): admin.firestore.DocumentReference {
  const digest = crypto
    .createHash('sha256')
    .update(providerUserId)
    .update('\0')
    .update(userID)
    .digest('hex');
  return db
    .collection(SUUNTO_HEALTH_WEBHOOK_ACCOUNT_BINDINGS_COLLECTION_NAME)
    .doc(digest);
}

export function buildSuuntoHealthWebhookAccountBinding(
  userID: string,
  providerUserId: string,
  tokenCredentialGeneration: string | null,
  authorizationSource: SuuntoWebhookBindingAuthorizationSource,
): SuuntoHealthWebhookAccountBinding {
  return {
    schemaVersion: SUUNTO_HEALTH_WEBHOOK_ACCOUNT_BINDING_SCHEMA_VERSION,
    authorizationSource,
    userID,
    providerAccountDigest: getSuuntoWebhookProviderAccountDigest(providerUserId),
    tokenCredentialGeneration: normalizeSuuntoTokenCredentialGeneration(
      tokenCredentialGeneration,
    ),
  };
}

export function parseSuuntoHealthWebhookAccountBinding(
  value: unknown,
): SuuntoHealthWebhookAccountBinding | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  const userID = normalizedRequiredString(data.userID);
  const providerAccountDigest = normalizedRequiredString(data.providerAccountDigest);
  const tokenCredentialGeneration = normalizeSuuntoTokenCredentialGeneration(
    data.tokenCredentialGeneration,
  );
  const authorizationSource = Object.values(SUUNTO_WEBHOOK_BINDING_AUTHORIZATION_SOURCES)
    .find(source => source === data.authorizationSource);
  if (data.schemaVersion !== SUUNTO_HEALTH_WEBHOOK_ACCOUNT_BINDING_SCHEMA_VERSION
    || !authorizationSource
    || !userID
    || userID !== data.userID
    || userID.length > 128
    || (
      !providerAccountDigest
      || providerAccountDigest !== data.providerAccountDigest
      || !SHA256_HEX_PATTERN.test(providerAccountDigest)
    )
    || (data.tokenCredentialGeneration !== null
      && data.tokenCredentialGeneration !== undefined
      && (!tokenCredentialGeneration
        || tokenCredentialGeneration !== data.tokenCredentialGeneration
        || tokenCredentialGeneration.length > 128))) {
    return null;
  }
  return {
    schemaVersion: SUUNTO_HEALTH_WEBHOOK_ACCOUNT_BINDING_SCHEMA_VERSION,
    authorizationSource,
    userID,
    providerAccountDigest,
    tokenCredentialGeneration,
  };
}

export function doesSuuntoHealthWebhookBindingMatch(
  binding: SuuntoHealthWebhookAccountBinding | null,
  userID: string,
  providerUserId: string,
  tokenCredentialGeneration: string | null,
): boolean {
  return binding?.userID === userID
    && binding.providerAccountDigest === getSuuntoWebhookProviderAccountDigest(providerUserId)
    && binding.tokenCredentialGeneration
      === normalizeSuuntoTokenCredentialGeneration(tokenCredentialGeneration);
}

function normalizeCandidateUserIDs(values: readonly string[]): string[] {
  const userIDs = new Set<string>();
  for (const value of values) {
    const userID = normalizedRequiredString(value);
    if (userID && userID === value && userID.length <= 128) userIDs.add(userID);
  }
  return [...userIDs];
}

/**
 * Resolves bounded candidate owners from the server-only binding index. Tests
 * and tightly scoped maintenance callers may provide exact candidate UIDs for
 * direct document reads. Production-wide Sleep and Health delivery use the
 * indexed provider digest and never trust client-writable token documents as
 * the webhook identity authority.
 */
export async function findSuuntoWebhookAccountBindingUserIDs(
  db: admin.firestore.Firestore,
  providerUserId: string,
  candidateUserIDs: readonly string[] = [],
): Promise<string[]> {
  const providerAccountDigest = getSuuntoWebhookProviderAccountDigest(providerUserId);
  const normalizedCandidateUserIDs = normalizeCandidateUserIDs(candidateUserIDs);
  let snapshots: admin.firestore.DocumentSnapshot[];
  if (candidateUserIDs.length > 0) {
    snapshots = await Promise.all(normalizedCandidateUserIDs.map(userID =>
      getSuuntoHealthWebhookAccountBindingRef(db, providerUserId, userID).get()
    ));
  } else {
    const snapshot = await db
      .collection(SUUNTO_HEALTH_WEBHOOK_ACCOUNT_BINDINGS_COLLECTION_NAME)
      .where('providerAccountDigest', '==', providerAccountDigest)
      .limit(SUUNTO_WEBHOOK_MAX_MATCHING_ACCOUNT_BINDINGS + 1)
      .get();
    if (snapshot.docs.length > SUUNTO_WEBHOOK_MAX_MATCHING_ACCOUNT_BINDINGS) {
      throw new Error('Suunto webhook account binding fan-out exceeds the configured maximum.');
    }
    snapshots = snapshot.docs;
  }

  const allowedCandidates = new Set(normalizedCandidateUserIDs);
  const resolvedUserIDs = new Set<string>();
  for (const snapshot of snapshots) {
    const binding = parseSuuntoHealthWebhookAccountBinding(snapshot.data());
    if (!binding
      || binding.providerAccountDigest !== providerAccountDigest
      || (allowedCandidates.size > 0 && !allowedCandidates.has(binding.userID))) {
      continue;
    }
    const expectedRef = getSuuntoHealthWebhookAccountBindingRef(
      db,
      providerUserId,
      binding.userID,
    );
    if (snapshot.id !== expectedRef.id) continue;
    resolvedUserIDs.add(binding.userID);
  }
  return [...resolvedUserIDs].sort();
}
