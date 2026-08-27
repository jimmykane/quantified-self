import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { SLEEP_PROVIDERS } from '../../../shared/sleep';
import {
  SUUNTO_HEALTH_WEBHOOK_INGRESS_COLLECTION_NAME,
} from '../sleep/constants';
import { addSleepSyncQueueItem } from '../sleep/queue';
import {
  isProviderQueueSkippedWithoutRetryError,
} from '../queue/provider-queue-errors';
import {
  getUserDeletionGuardState,
  UserDeletionGuardState,
} from '../shared/user-deletion-guard';
import { getExpireAtTimestamp, TTL_CONFIG } from '../shared/ttl-config';
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

const DAY_MS = 24 * 60 * 60 * 1000;
const SUUNTO_HEALTH_WEBHOOK_INGRESS_SCHEMA_VERSION = 1;
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
  notificationType: SuuntoHealthWebhookNotificationType;
  providerUserId: string;
  windows: SuuntoHealthWebhookWindow[];
  receivedAtMs: number;
  processed: boolean;
}

type IngressResultStatus =
  | 'invalid_ingress'
  | 'provider_disabled'
  | 'user_not_allowed_or_disconnected'
  | 'user_deleted_or_deleting'
  | 'queue_skipped'
  | 'queued';

export interface SuuntoHealthWebhookIngressDependencies {
  addQueueItem?: typeof addSleepSyncQueueItem;
  db?: admin.firestore.Firestore;
  getDeletionGuard?: (
    db: admin.firestore.Firestore,
    uid: string,
  ) => Promise<UserDeletionGuardState>;
  isHealthEnabled?: () => boolean;
  isUserAllowed?: (uid: string) => boolean;
  nowMs?: () => number;
  resolveUserID?: (
    db: admin.firestore.Firestore,
    providerUserId: string,
  ) => Promise<string | null>;
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
    notificationType: record.notificationType,
    providerUserId: validateProviderUserId(record.providerUserId),
    windows: validateWindows(record.windows),
    receivedAtMs: Number(record.receivedAtMs),
    processed: false,
  };
}

function isAlreadyExistsError(error: unknown): boolean {
  const code = error && typeof error === 'object'
    ? (error as { code?: unknown }).code
    : undefined;
  return code === 6 || code === 'already-exists' || code === 'ALREADY_EXISTS';
}

function isNotFoundError(error: unknown): boolean {
  const code = error && typeof error === 'object'
    ? (error as { code?: unknown }).code
    : undefined;
  return code === 5 || code === 'not-found' || code === 'NOT_FOUND';
}

export async function persistSuuntoHealthWebhookIngress(
  input: PersistSuuntoHealthWebhookIngressInput,
  db: admin.firestore.Firestore = admin.firestore(),
): Promise<'created' | 'duplicate'> {
  if (!/^[a-f0-9]{64}$/.test(input.notificationDigest)) {
    throw new Error('Invalid Suunto Health webhook notification digest.');
  }
  const providerUserId = validateProviderUserId(input.providerUserId);
  const windows = validateWindows(input.windows);
  if (!isNotificationType(input.notificationType)) {
    throw new Error('Invalid Suunto Health webhook notification type.');
  }
  const receivedAtMs = input.receivedAtMs ?? Date.now();
  if (!Number.isSafeInteger(receivedAtMs) || receivedAtMs < 0) {
    throw new Error('Invalid Suunto Health webhook receive time.');
  }

  const ref = db
    .collection(SUUNTO_HEALTH_WEBHOOK_INGRESS_COLLECTION_NAME)
    .doc(input.notificationDigest);
  try {
    await ref.create({
      schemaVersion: SUUNTO_HEALTH_WEBHOOK_INGRESS_SCHEMA_VERSION,
      notificationType: input.notificationType,
      providerUserId,
      windows,
      receivedAtMs,
      processed: false,
      expireAt: getExpireAtTimestamp(TTL_CONFIG.QUEUE_ITEM_IN_DAYS),
    });
    return 'created';
  } catch (error) {
    if (isAlreadyExistsError(error)) return 'duplicate';
    throw error;
  }
}

async function resolveSuuntoHealthWebhookUserID(
  db: admin.firestore.Firestore,
  providerUserId: string,
): Promise<string | null> {
  for (const userID of SUUNTO_HEALTH_SYNC_ALLOWED_USER_IDS) {
    if (!isSuuntoHealthSyncUserAllowed(userID)) continue;
    const snapshot = await db
      .collection('suuntoAppAccessTokens')
      .doc(userID)
      .collection('tokens')
      .where('userName', '==', providerUserId)
      .limit(1)
      .get();
    if (!snapshot.empty) return userID;
  }
  return null;
}

async function markIngressProcessed(
  ref: admin.firestore.DocumentReference,
  resultStatus: IngressResultStatus,
  nowMs: number,
  userID?: string,
  windowsQueued = 0,
): Promise<void> {
  try {
    await ref.update({
      processed: true,
      processedAtMs: nowMs,
      resultStatus,
      windowsQueued,
      ...(userID ? { userID } : {}),
    });
  } catch (error) {
    // Account/service cleanup may recursively delete the short-lived ingress
    // while its worker is finishing. Never recreate a deleted operational row.
    if (!isNotFoundError(error)) throw error;
  }
}

export async function processSuuntoHealthWebhookIngressDocument(
  eventSnapshot: admin.firestore.QueryDocumentSnapshot,
  dependencies: SuuntoHealthWebhookIngressDependencies = {},
): Promise<void> {
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
    await markIngressProcessed(eventSnapshot.ref, 'invalid_ingress', nowMs);
    return;
  }

  const isHealthEnabled = dependencies.isHealthEnabled || isSuuntoHealthSyncEnabled;
  if (!isHealthEnabled()) {
    await markIngressProcessed(eventSnapshot.ref, 'provider_disabled', nowMs);
    return;
  }

  const db = dependencies.db || admin.firestore();
  const resolveUserID = dependencies.resolveUserID || resolveSuuntoHealthWebhookUserID;
  const userID = await resolveUserID(db, ingress.providerUserId);
  const isUserAllowed = dependencies.isUserAllowed || isSuuntoHealthSyncUserAllowed;
  if (!userID || !isUserAllowed(userID)) {
    await markIngressProcessed(eventSnapshot.ref, 'user_not_allowed_or_disconnected', nowMs);
    return;
  }

  const getDeletionGuard = dependencies.getDeletionGuard || getUserDeletionGuardState;
  const deletionGuard = await getDeletionGuard(db, userID);
  if (deletionGuard.shouldSkip) {
    await markIngressProcessed(
      eventSnapshot.ref,
      'user_deleted_or_deleting',
      nowMs,
      userID,
    );
    return;
  }

  const addQueueItem = dependencies.addQueueItem || addSleepSyncQueueItem;
  try {
    await Promise.all(ingress.windows.map(window => addQueueItem({
      type: 'suunto_health_poll',
      provider: SLEEP_PROVIDERS.SuuntoApp,
      userID,
      providerUserId: ingress.providerUserId,
      rangeStartMs: window.startMs,
      rangeEndMs: window.endMs,
      healthTrigger: 'webhook',
      dedupeKey: `suunto-health-webhook:${userID}:${ingress.providerUserId}:${window.startMs}:${window.endMs}:${eventSnapshot.id}`,
      dispatchImmediately: true,
    })));
  } catch (error) {
    if (!isProviderQueueSkippedWithoutRetryError(error)) throw error;
    logger.info('[HealthSync][Suunto] Webhook ingress fan-out skipped by account lifecycle.');
    await markIngressProcessed(eventSnapshot.ref, 'queue_skipped', nowMs, userID);
    return;
  }

  await markIngressProcessed(
    eventSnapshot.ref,
    'queued',
    nowMs,
    userID,
    ingress.windows.length,
  );
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
