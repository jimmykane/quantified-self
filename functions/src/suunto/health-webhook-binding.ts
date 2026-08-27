import * as admin from 'firebase-admin';
import * as crypto from 'crypto';

export const SUUNTO_HEALTH_WEBHOOK_ACCOUNT_BINDINGS_COLLECTION_NAME =
  'suuntoHealthWebhookAccountBindings';
export const SUUNTO_HEALTH_WEBHOOK_ACCOUNT_BINDING_SCHEMA_VERSION = 1;

export interface SuuntoHealthWebhookAccountBinding {
  schemaVersion: typeof SUUNTO_HEALTH_WEBHOOK_ACCOUNT_BINDING_SCHEMA_VERSION;
  userID: string;
  tokenCredentialGeneration: string | null;
}

function normalizedRequiredString(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized.length > 0 ? normalized : null;
}

export function normalizeSuuntoTokenCredentialGeneration(value: unknown): string | null {
  return normalizedRequiredString(value);
}

export function getSuuntoHealthWebhookAccountBindingRef(
  db: admin.firestore.Firestore,
  providerUserId: string,
): admin.firestore.DocumentReference {
  const digest = crypto.createHash('sha256').update(providerUserId).digest('hex');
  return db.collection(SUUNTO_HEALTH_WEBHOOK_ACCOUNT_BINDINGS_COLLECTION_NAME).doc(digest);
}

export function buildSuuntoHealthWebhookAccountBinding(
  userID: string,
  tokenCredentialGeneration: string | null,
): SuuntoHealthWebhookAccountBinding {
  return {
    schemaVersion: SUUNTO_HEALTH_WEBHOOK_ACCOUNT_BINDING_SCHEMA_VERSION,
    userID,
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
  const tokenCredentialGeneration = normalizeSuuntoTokenCredentialGeneration(
    data.tokenCredentialGeneration,
  );
  if (data.schemaVersion !== SUUNTO_HEALTH_WEBHOOK_ACCOUNT_BINDING_SCHEMA_VERSION
    || !userID
    || userID !== data.userID
    || userID.length > 128
    || (data.tokenCredentialGeneration !== null
      && data.tokenCredentialGeneration !== undefined
      && (!tokenCredentialGeneration
        || tokenCredentialGeneration !== data.tokenCredentialGeneration
        || tokenCredentialGeneration.length > 128))) {
    return null;
  }
  return buildSuuntoHealthWebhookAccountBinding(
    userID,
    tokenCredentialGeneration,
  );
}

export function doesSuuntoHealthWebhookBindingMatch(
  binding: SuuntoHealthWebhookAccountBinding | null,
  userID: string,
  tokenCredentialGeneration: string | null,
): boolean {
  return binding?.userID === userID
    && binding.tokenCredentialGeneration
      === normalizeSuuntoTokenCredentialGeneration(tokenCredentialGeneration);
}
