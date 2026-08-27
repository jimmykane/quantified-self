import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import * as logger from 'firebase-functions/logger';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { SLEEP_PROVIDERS } from '../../../shared/sleep';
import { isServiceUnavailableForSyncConnection } from '../../../shared/service-connection';
import {
  SUUNTO_HEALTH_WEBHOOK_INGRESS_COLLECTION_NAME,
} from '../sleep/constants';
import { addSleepSyncQueueItem } from '../sleep/queue';
import {
  isProviderQueueSkippedWithoutRetryError,
} from '../queue/provider-queue-errors';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import { getExpireAtTimestamp, TTL_CONFIG } from '../shared/ttl-config';
import { isServiceDisconnectPendingData } from '../service-disconnect-pending-state';
import {
  doesServiceDisconnectOperationPermitTokenUse,
  SERVICE_DISCONNECT_OPERATION_GENERATION_FIELD,
} from '../service-token-store';
import {
  ACTIVE_OAUTH_CREDENTIAL_GENERATION_FIELD,
} from '../token-refresh-coordinator';
import {
  SUUNTO_HEALTH_MAX_PROVIDER_ACCOUNT_ID_LENGTH,
  SUUNTO_HEALTH_MAX_SUPPORTED_TIMESTAMP_MS,
  SUUNTO_HEALTH_MAX_WINDOW_DAYS,
} from './health';
import { isSuuntoHealthSyncEnabled } from './health-flags';
import {
  isSuuntoHealthSyncUserAllowed,
  SUUNTO_HEALTH_SYNC_ALLOWED_USER_IDS,
} from './health-rollout';
import { SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME } from './constants';
import {
  doesSuuntoHealthWebhookBindingMatch,
  getSuuntoHealthWebhookAccountBindingRef,
  normalizeSuuntoTokenCredentialGeneration,
  parseSuuntoHealthWebhookAccountBinding,
  type SuuntoHealthWebhookAccountBinding,
} from './health-webhook-binding';

const DAY_MS = 24 * 60 * 60 * 1000;
const FIREBASE_UID_MAX_LENGTH = 128;
const SUUNTO_HEALTH_WEBHOOK_INGRESS_SCHEMA_VERSION = 5;
export const SUUNTO_HEALTH_WEBHOOK_MAX_WINDOWS = 16;

export type SuuntoHealthWebhookNotificationType =
  | 'SUUNTO_247_ACTIVITY_CREATED'
  | 'SUUNTO_247_RECOVERY_CREATED';

export interface SuuntoHealthWebhookWindow {
  startMs: number;
  endMs: number;
}

export interface PersistSuuntoHealthWebhookIngressInput {
  notificationDigest: string;
  notificationType: SuuntoHealthWebhookNotificationType;
  providerUserId: string;
  windows: readonly SuuntoHealthWebhookWindow[];
  receivedAtMs?: number;
}

interface SuuntoHealthWebhookIngressRecord {
  schemaVersion: typeof SUUNTO_HEALTH_WEBHOOK_INGRESS_SCHEMA_VERSION;
  userID: string;
  notificationType: SuuntoHealthWebhookNotificationType;
  providerUserId: string;
  tokenCredentialGeneration: string | null;
  rootOAuthCredentialGeneration: string | null;
  connectionState: string | null;
  connectionStateGeneration: string | null;
  windows: SuuntoHealthWebhookWindow[];
  receivedAtMs: number;
  processed: boolean;
}

type IngressDiscardReason =
  | 'invalid_ingress'
  | 'provider_disabled'
  | 'user_not_allowed_or_disconnected'
  | 'user_deleted_or_deleting'
  | 'queue_skipped';

export interface PersistSuuntoHealthWebhookIngressDependencies {
  candidateUserIDs?: readonly string[];
  db?: admin.firestore.Firestore;
  isUserAllowed?: (uid: string) => boolean;
  nowMs?: () => number;
}

export interface SuuntoHealthWebhookIngressDependencies {
  addQueueItem?: typeof addSleepSyncQueueItem;
  db?: admin.firestore.Firestore;
  isHealthEnabled?: () => boolean;
  isUserAllowed?: (uid: string) => boolean;
  nowMs?: () => number;
}

function isNotificationType(value: unknown): value is SuuntoHealthWebhookNotificationType {
  return value === 'SUUNTO_247_ACTIVITY_CREATED'
    || value === 'SUUNTO_247_RECOVERY_CREATED';
}

function isValidWindow(value: unknown): value is SuuntoHealthWebhookWindow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const startMs = Number(candidate.startMs);
  const endMs = Number(candidate.endMs);
  return Number.isSafeInteger(startMs)
    && Number.isSafeInteger(endMs)
    && startMs >= 0
    && endMs > startMs
    && endMs <= SUUNTO_HEALTH_MAX_SUPPORTED_TIMESTAMP_MS
    && endMs - startMs <= SUUNTO_HEALTH_MAX_WINDOW_DAYS * DAY_MS;
}

function validateWindows(value: unknown): SuuntoHealthWebhookWindow[] {
  if (!Array.isArray(value)
    || value.length === 0
    || value.length > SUUNTO_HEALTH_WEBHOOK_MAX_WINDOWS
    || value.some(window => !isValidWindow(window))) {
    throw new Error('Invalid Suunto Health webhook ingress windows.');
  }

  const windows = value.map(window => ({
    startMs: Number((window as SuuntoHealthWebhookWindow).startMs),
    endMs: Number((window as SuuntoHealthWebhookWindow).endMs),
  }));
  for (let index = 1; index < windows.length; index += 1) {
    if (windows[index].startMs < windows[index - 1].endMs) {
      throw new Error('Overlapping Suunto Health webhook ingress windows.');
    }
  }
  return windows;
}

function validateProviderUserId(value: unknown): string {
  const providerUserId = typeof value === 'string' ? value.trim() : '';
  if (!providerUserId
    || providerUserId !== value
    || providerUserId.length > SUUNTO_HEALTH_MAX_PROVIDER_ACCOUNT_ID_LENGTH) {
    throw new Error('Invalid Suunto Health webhook ingress provider account.');
  }
  return providerUserId;
}

function validateFirebaseUserID(value: unknown): string {
  const userID = typeof value === 'string' ? value.trim() : '';
  if (!userID || userID !== value || userID.length > FIREBASE_UID_MAX_LENGTH) {
    throw new Error('Invalid Suunto Health webhook ingress user.');
  }
  return userID;
}

function normalizeOptionalString(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized.length > 0 ? normalized : null;
}

function validateOptionalLifecycleString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized !== value || normalized.length > 128) {
    throw new Error('Invalid Suunto Health webhook ingress lifecycle fence.');
  }
  return normalized;
}

function parseIngressRecord(value: unknown): SuuntoHealthWebhookIngressRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Suunto Health webhook ingress record.');
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== SUUNTO_HEALTH_WEBHOOK_INGRESS_SCHEMA_VERSION
    || !isNotificationType(record.notificationType)
    || record.processed !== false
    || !Number.isSafeInteger(record.receivedAtMs)
    || Number(record.receivedAtMs) < 0) {
    throw new Error('Invalid Suunto Health webhook ingress record.');
  }
  return {
    schemaVersion: SUUNTO_HEALTH_WEBHOOK_INGRESS_SCHEMA_VERSION,
    userID: validateFirebaseUserID(record.userID),
    notificationType: record.notificationType,
    providerUserId: validateProviderUserId(record.providerUserId),
    tokenCredentialGeneration: validateOptionalLifecycleString(
      record.tokenCredentialGeneration,
    ),
    rootOAuthCredentialGeneration: validateOptionalLifecycleString(
      record.rootOAuthCredentialGeneration,
    ),
    connectionState: validateOptionalLifecycleString(record.connectionState),
    connectionStateGeneration: validateOptionalLifecycleString(record.connectionStateGeneration),
    windows: validateWindows(record.windows),
    receivedAtMs: Number(record.receivedAtMs),
    processed: false,
  };
}

function isNotFoundError(error: unknown): boolean {
  const code = error && typeof error === 'object'
    ? (error as { code?: unknown }).code
    : undefined;
  return code === 5 || code === 'not-found' || code === 'NOT_FOUND';
}

function tokenAndRootStillAuthorizeBinding(
  tokenSnapshot: admin.firestore.DocumentSnapshot,
  tokenRootSnapshot: admin.firestore.DocumentSnapshot,
  providerUserId: string,
  binding: SuuntoHealthWebhookAccountBinding,
  nowMs: number,
): boolean {
  if (!tokenSnapshot.exists || !tokenRootSnapshot.exists) return false;
  const tokenData = tokenSnapshot.data() as Record<string, unknown> | undefined;
  const tokenRootData = tokenRootSnapshot.data() as Record<string, unknown> | undefined;
  return tokenData?.userName === providerUserId
    && (!tokenData.serviceName || tokenData.serviceName === ServiceNames.SuuntoApp)
    && doesSuuntoHealthWebhookBindingMatch(
      binding,
      binding.userID,
      providerUserId,
      normalizeSuuntoTokenCredentialGeneration(tokenData?.tokenCredentialGeneration),
    )
    && !isServiceDisconnectPendingData(tokenRootData)
    && doesServiceDisconnectOperationPermitTokenUse(tokenRootData, undefined, nowMs);
}

interface ActiveIngressBinding {
  binding: SuuntoHealthWebhookAccountBinding;
  bindingRef: admin.firestore.DocumentReference;
  tokenRef: admin.firestore.DocumentReference;
  tokenRootRef: admin.firestore.DocumentReference;
  serviceMetaRef: admin.firestore.DocumentReference;
  connectionState: string | null;
  connectionStateGeneration: string | null;
  rootOAuthCredentialGeneration: string | null;
  bindingExpectedFields: Readonly<Record<string, unknown>>;
  tokenExpectedFields: Readonly<Record<string, unknown>>;
  tokenRootExpectedFields: Readonly<Record<string, unknown>>;
  serviceMetaExpectedFields: Readonly<Record<string, unknown>>;
}

async function getActiveIngressBindingInTransaction(
  db: admin.firestore.Firestore,
  transaction: admin.firestore.Transaction,
  providerUserId: string,
  userID: string,
  isUserAllowed: (uid: string) => boolean,
  nowMs: number,
): Promise<ActiveIngressBinding | null> {
  if (!isUserAllowed(userID)) return null;
  const bindingRef = getSuuntoHealthWebhookAccountBindingRef(db, providerUserId, userID);
  const bindingSnapshot = await transaction.get(bindingRef);
  const binding = parseSuuntoHealthWebhookAccountBinding(bindingSnapshot.data());
  if (!binding || binding.userID !== userID) return null;

  const tokenRootRef = db.collection(SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME).doc(binding.userID);
  const tokenRef = tokenRootRef.collection('tokens').doc(providerUserId);
  const serviceMetaRef = db.collection('users').doc(binding.userID)
    .collection('meta').doc(ServiceNames.SuuntoApp);
  const [tokenSnapshot, tokenRootSnapshot, serviceMetaSnapshot, deletionGuard] =
    await Promise.all([
      transaction.get(tokenRef),
      transaction.get(tokenRootRef),
      transaction.get(serviceMetaRef),
      getUserDeletionGuardStateInTransaction(db, transaction, binding.userID, nowMs),
    ]);
  const serviceMeta = serviceMetaSnapshot.data() as Record<string, unknown> | undefined;
  if (deletionGuard.shouldSkip
    || !serviceMetaSnapshot.exists
    || isServiceUnavailableForSyncConnection(serviceMeta)
    || !tokenAndRootStillAuthorizeBinding(
      tokenSnapshot,
      tokenRootSnapshot,
      providerUserId,
      binding,
      nowMs,
    )) {
    return null;
  }

  const tokenData = tokenSnapshot.data() as Record<string, unknown>;
  const tokenRootData = tokenRootSnapshot.data() as Record<string, unknown>;
  const connectionState = normalizeOptionalString(serviceMeta?.connectionState);
  const connectionStateGeneration = normalizeOptionalString(
    serviceMeta?.connectionStateGeneration,
  );
  const rootOAuthCredentialGeneration = normalizeOptionalString(
    tokenRootData[ACTIVE_OAUTH_CREDENTIAL_GENERATION_FIELD],
  );
  return {
    binding,
    bindingRef,
    tokenRef,
    tokenRootRef,
    serviceMetaRef,
    connectionState,
    connectionStateGeneration,
    rootOAuthCredentialGeneration,
    bindingExpectedFields: {
      schemaVersion: binding.schemaVersion,
      userID: binding.userID,
      providerAccountDigest: binding.providerAccountDigest,
      tokenCredentialGeneration: binding.tokenCredentialGeneration,
    },
    tokenExpectedFields: {
      userName: providerUserId,
      serviceName: tokenData.serviceName,
      tokenCredentialGeneration: tokenData.tokenCredentialGeneration,
    },
    tokenRootExpectedFields: {
      [ACTIVE_OAUTH_CREDENTIAL_GENERATION_FIELD]:
        tokenRootData[ACTIVE_OAUTH_CREDENTIAL_GENERATION_FIELD],
      [SERVICE_DISCONNECT_OPERATION_GENERATION_FIELD]:
        tokenRootData[SERVICE_DISCONNECT_OPERATION_GENERATION_FIELD],
    },
    serviceMetaExpectedFields: {
      connectionState: serviceMeta?.connectionState,
      connectionStateGeneration: serviceMeta?.connectionStateGeneration,
    },
  };
}

function getIngressDocumentID(notificationDigest: string, userID: string): string {
  return crypto
    .createHash('sha256')
    .update(notificationDigest)
    .update('\0')
    .update(userID)
    .digest('hex');
}

function getCandidateUserIDs(
  values: readonly string[],
  isUserAllowed: (uid: string) => boolean,
): string[] {
  const candidateUserIDs = new Set<string>();
  for (const value of values) {
    const userID = typeof value === 'string' ? value.trim() : '';
    if (userID && userID === value && userID.length <= FIREBASE_UID_MAX_LENGTH
      && isUserAllowed(userID)) {
      candidateUserIDs.add(userID);
    }
  }
  return [...candidateUserIDs];
}

export async function persistSuuntoHealthWebhookIngress(
  input: PersistSuuntoHealthWebhookIngressInput,
  dependencies: PersistSuuntoHealthWebhookIngressDependencies = {},
): Promise<'created' | 'duplicate' | 'permanent_skip'> {
  if (!/^[a-f0-9]{64}$/.test(input.notificationDigest)) {
    throw new Error('Invalid Suunto Health webhook notification digest.');
  }
  const providerUserId = validateProviderUserId(input.providerUserId);
  const windows = validateWindows(input.windows);
  if (!isNotificationType(input.notificationType)) {
    throw new Error('Invalid Suunto Health webhook notification type.');
  }
  const nowMs = (dependencies.nowMs || Date.now)();
  const receivedAtMs = input.receivedAtMs ?? nowMs;
  if (!Number.isSafeInteger(receivedAtMs) || receivedAtMs < 0) {
    throw new Error('Invalid Suunto Health webhook receive time.');
  }

  const db = dependencies.db || admin.firestore();
  const isUserAllowed = dependencies.isUserAllowed || isSuuntoHealthSyncUserAllowed;
  const expireAt = getExpireAtTimestamp(TTL_CONFIG.QUEUE_ITEM_IN_DAYS);
  return db.runTransaction(async transaction => {
    const candidateUserIDs = getCandidateUserIDs(
      dependencies.candidateUserIDs || SUUNTO_HEALTH_SYNC_ALLOWED_USER_IDS,
      isUserAllowed,
    );
    const resolvedBindings = await Promise.all(
      candidateUserIDs.map(userID => getActiveIngressBindingInTransaction(
        db,
        transaction,
        providerUserId,
        userID,
        isUserAllowed,
        nowMs,
      )),
    );
    const activeBindings = resolvedBindings.filter(
      (binding): binding is ActiveIngressBinding => binding !== null,
    );
    if (activeBindings.length === 0) return 'permanent_skip';

    const ingressTargets = await Promise.all(activeBindings.map(async activeBinding => {
      const ref = db
        .collection(SUUNTO_HEALTH_WEBHOOK_INGRESS_COLLECTION_NAME)
        .doc(getIngressDocumentID(input.notificationDigest, activeBinding.binding.userID));
      return {
        activeBinding,
        ref,
        snapshot: await transaction.get(ref),
      };
    }));
    let created = false;
    for (const target of ingressTargets) {
      if (target.snapshot.exists) continue;
      transaction.create(target.ref, {
        schemaVersion: SUUNTO_HEALTH_WEBHOOK_INGRESS_SCHEMA_VERSION,
        userID: target.activeBinding.binding.userID,
        notificationType: input.notificationType,
        providerUserId,
        tokenCredentialGeneration: target.activeBinding.binding.tokenCredentialGeneration,
        rootOAuthCredentialGeneration:
          target.activeBinding.rootOAuthCredentialGeneration,
        connectionState: target.activeBinding.connectionState,
        connectionStateGeneration: target.activeBinding.connectionStateGeneration,
        windows,
        receivedAtMs,
        processed: false,
        expireAt,
      });
      created = true;
    }
    return created ? 'created' : 'duplicate';
  });
}

async function markIngressProcessed(
  ref: admin.firestore.DocumentReference,
  nowMs: number,
  windowsQueued: number,
): Promise<void> {
  try {
    await ref.update({
      processed: true,
      processedAtMs: nowMs,
      resultStatus: 'queued',
      windowsQueued,
    });
  } catch (error) {
    // Account/service cleanup may recursively delete the short-lived ingress
    // while its worker is finishing. Never recreate a deleted operational row.
    if (!isNotFoundError(error)) throw error;
  }
}

async function recursivelyDiscardIngress(
  db: admin.firestore.Firestore,
  ref: admin.firestore.DocumentReference,
  reason: IngressDiscardReason,
): Promise<void> {
  await db.recursiveDelete(ref);
  logger.info('[HealthSync][Suunto] Discarded non-retryable webhook ingress.', { reason });
}

export async function processSuuntoHealthWebhookIngressDocument(
  eventSnapshot: admin.firestore.QueryDocumentSnapshot,
  dependencies: SuuntoHealthWebhookIngressDependencies = {},
): Promise<void> {
  const db = dependencies.db || admin.firestore();
  const nowMs = (dependencies.nowMs || Date.now)();
  const currentSnapshot = await eventSnapshot.ref.get();
  if (!currentSnapshot.exists) return;
  const currentData = currentSnapshot.data() as Record<string, unknown> | undefined;
  if (currentData?.processed === true) return;

  let ingress: SuuntoHealthWebhookIngressRecord;
  try {
    if (!/^[a-f0-9]{64}$/.test(eventSnapshot.id)) {
      throw new Error('Invalid Suunto Health webhook ingress identity.');
    }
    ingress = parseIngressRecord(currentData);
  } catch {
    logger.warn('[HealthSync][Suunto] Ignoring malformed webhook ingress.');
    await recursivelyDiscardIngress(db, eventSnapshot.ref, 'invalid_ingress');
    return;
  }

  const isHealthEnabled = dependencies.isHealthEnabled || isSuuntoHealthSyncEnabled;
  if (!isHealthEnabled()) {
    await recursivelyDiscardIngress(db, eventSnapshot.ref, 'provider_disabled');
    return;
  }

  const isUserAllowed = dependencies.isUserAllowed || isSuuntoHealthSyncUserAllowed;
  const activeBinding = await db.runTransaction(transaction =>
    getActiveIngressBindingInTransaction(
      db,
      transaction,
      ingress.providerUserId,
      ingress.userID,
      isUserAllowed,
      nowMs,
    ));
  if (!activeBinding
    || activeBinding.binding.userID !== ingress.userID
    || activeBinding.binding.tokenCredentialGeneration !== ingress.tokenCredentialGeneration
    || activeBinding.rootOAuthCredentialGeneration
      !== ingress.rootOAuthCredentialGeneration
    || activeBinding.connectionState !== ingress.connectionState
    || activeBinding.connectionStateGeneration !== ingress.connectionStateGeneration) {
    await recursivelyDiscardIngress(
      db,
      eventSnapshot.ref,
      'user_not_allowed_or_disconnected',
    );
    return;
  }

  const addQueueItem = dependencies.addQueueItem || addSleepSyncQueueItem;
  try {
    await Promise.all(ingress.windows.map(window => addQueueItem({
      type: 'suunto_health_poll',
      provider: SLEEP_PROVIDERS.SuuntoApp,
      userID: ingress.userID,
      providerUserId: ingress.providerUserId,
      rangeStartMs: window.startMs,
      rangeEndMs: window.endMs,
      healthTrigger: 'webhook',
      dedupeKey: `suunto-health-webhook:${ingress.userID}:${ingress.providerUserId}:${window.startMs}:${window.endMs}:${eventSnapshot.id}`,
      dispatchImmediately: true,
      suuntoHealthTokenCredentialGeneration: ingress.tokenCredentialGeneration,
      suuntoHealthRootOAuthCredentialGeneration:
        ingress.rootOAuthCredentialGeneration,
      suuntoHealthConnectionStateGeneration: ingress.connectionStateGeneration,
      requiredDocumentFieldValues: [
        {
          documentRef: activeBinding.bindingRef,
          expectedFields: activeBinding.bindingExpectedFields,
        },
        {
          documentRef: activeBinding.tokenRef,
          expectedFields: activeBinding.tokenExpectedFields,
        },
        {
          documentRef: activeBinding.tokenRootRef,
          expectedFields: activeBinding.tokenRootExpectedFields,
        },
        {
          documentRef: activeBinding.serviceMetaRef,
          expectedFields: activeBinding.serviceMetaExpectedFields,
        },
      ],
    })));
  } catch (error) {
    if (!isProviderQueueSkippedWithoutRetryError(error)) throw error;
    logger.info('[HealthSync][Suunto] Webhook ingress fan-out skipped by account lifecycle.');
    await recursivelyDiscardIngress(db, eventSnapshot.ref, 'queue_skipped');
    return;
  }

  await markIngressProcessed(eventSnapshot.ref, nowMs, ingress.windows.length);
  logger.info('[HealthSync][Suunto] Fanned out durable webhook ingress.', {
    windows: ingress.windows.length,
  });
}

export const fanOutSuuntoHealthWebhookIngress = onDocumentCreated({
  document: `${SUUNTO_HEALTH_WEBHOOK_INGRESS_COLLECTION_NAME}/{ingressID}`,
  region: 'europe-west2',
  timeoutSeconds: 120,
  memory: '256MiB',
  maxInstances: 50,
  concurrency: 1,
  retry: true,
}, async (event) => {
  if (!event.data) return;
  await processSuuntoHealthWebhookIngressDocument(event.data);
});
