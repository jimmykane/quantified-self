import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { FieldPath } from 'firebase-admin/firestore';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { ACTIVITY_SYNC_ROUTES, ActivitySyncRouteId } from '../../../shared/activity-sync-routes';
import {
  isServiceUnavailableForSyncConnection,
  SERVICE_CONNECTION_STATES,
} from '../../../shared/service-connection';
import { enqueueActivitySyncJobsForImportedEvent } from '../activity-sync/enqueue-imported-event';
import { getActivitySyncMetadataDocId } from '../activity-sync/metadata';
import { isActivitySyncRouteEnabledForUser } from '../activity-sync/settings';
import { getWorkoutQueueItems } from '../history';
import { addToQueueForSuunto } from '../queue';
import { getUserDeletionGuardState, getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import { getServiceWorkoutQueueName } from '../shared/queue-names';
import { isServiceDisconnectPendingData } from '../service-disconnect-pending-state';
import {
  doesServiceDisconnectOperationPermitTokenUse,
  getServiceTokenRootDocumentRef,
} from '../service-token-store';
import {
  doesSuuntoHealthWebhookBindingMatch,
  getSuuntoHealthWebhookAccountBindingRef,
  parseSuuntoHealthWebhookAccountBinding,
} from '../suunto/health-webhook-binding';
import {
  repairSuuntoLegacyWebhookBindingForProviderVerifiedToken,
  resolveActiveSuuntoWebhookUserIDs,
  SUUNTO_LEGACY_WEBHOOK_BINDING_REPAIR_FIELDS,
  SUUNTO_LEGACY_WEBHOOK_BINDING_REPAIR_VERSION,
} from '../suunto/health-webhook-binding-lifecycle';
import { SUUNTO_HEALTH_MAX_PROVIDER_ACCOUNT_ID_LENGTH } from '../suunto/health';
import {
  ACTIVE_OAUTH_CREDENTIAL_GENERATION_FIELD,
  areTokenCredentialSnapshotsEqual,
  getTokenCredentialSnapshot,
} from '../token-refresh-coordinator';
import { getTokenData, TerminalServiceAuthError } from '../tokens';
import { generateIDFromParts } from '../utils';

type RepairStage = 'audit' | 'repair' | 'backfill' | 'reconcile' | 'verify';

const LOG_PREFIX = '[suunto-legacy-webhook-repair]';
const DEFAULT_USER_LIMIT = 100;
const MAX_USER_LIMIT = 500;
const MAX_TOKENS_PER_USER = 8;
const FIRESTORE_GET_ALL_BATCH_SIZE = 100;
const DEFAULT_EVENT_PAGE_SIZE = 200;
const MAX_EVENT_PAGE_SIZE = 500;
const MAX_WORKOUTS_PER_TOKEN = 1000;
const MAX_EVENTS_PER_TOKEN = 2000;
const LEGACY_REPAIR_VERSION = SUUNTO_LEGACY_WEBHOOK_BINDING_REPAIR_VERSION;
const INCIDENT_START_MS = Date.parse('2026-08-28T00:00:00.000Z');
const REPAIR_VERSION_FIELD = SUUNTO_LEGACY_WEBHOOK_BINDING_REPAIR_FIELDS.Version;
const REPAIRED_AT_FIELD = SUUNTO_LEGACY_WEBHOOK_BINDING_REPAIR_FIELDS.RepairedAtMs;
const BACKFILL_THROUGH_FIELD = 'suuntoLegacyWebhookBindingRepairBackfillThroughMs';
const BACKFILL_QUEUED_AT_FIELD = 'suuntoLegacyWebhookBindingRepairBackfillQueuedAtMs';
const RECONCILED_THROUGH_FIELD = 'suuntoLegacyWebhookBindingRepairReconciledThroughMs';
const RECONCILED_AT_FIELD = 'suuntoLegacyWebhookBindingRepairReconciledAtMs';

interface ScriptOptions {
  execute: boolean;
  stage: RepairStage;
  uid?: string;
  startAfterUID?: string;
  userLimit: number;
  eventPageSize: number;
  throughMs: number;
}

interface RepairToken {
  userID: string;
  providerUserId: string;
  tokenSnapshot: admin.firestore.DocumentSnapshot;
  reasons: string[];
}

interface UserInspection {
  tokens: RepairToken[];
  maintenanceTokens: RepairToken[];
  scannedTokenCount: number;
  alreadyCurrentCount: number;
  skipped: Record<string, number>;
}

interface CanonicalUserPage {
  docs: admin.firestore.QueryDocumentSnapshot[];
  hasMore: boolean;
  nextStartAfterUID: string | null;
}

interface QueueDrainStatus {
  processed: number;
  pending: number;
  failed: number;
  missing: number;
}

const VALUE_ARGUMENTS = new Set([
  '--stage',
  '--uid',
  '--start-after-uid',
  '--limit',
  '--event-page-size',
  '--through',
]);
const BOOLEAN_ARGUMENTS = new Set(['--apply', '--execute']);

export interface SuuntoLegacyWebhookRepairSummary {
  dryRun: boolean;
  stage: RepairStage;
  incidentStart: string;
  through: string;
  scannedUsers: number;
  scannedTokens: number;
  repairCandidates: number;
  alreadyCurrent: number;
  repairedMarkerTokens: number;
  skipped: Record<string, number>;
  repair: {
    attempted: number;
    repaired: number;
    inactive: number;
    unverified: number;
    refreshRejected: number;
    failed: number;
    contactUserIDs: string[];
  };
  backfill: {
    attemptedTokens: number;
    providerWorkoutsFound: number;
    queueAttempts: number;
    completedTokens: number;
    failedTokens: number;
  };
  reconcile: {
    attemptedTokens: number;
    queueProcessed: number;
    queuePending: number;
    queueFailed: number;
    queueMissing: number;
    scannedEvents: number;
    eligibleEvents: number;
    queuedRoutes: number;
    skippedSuccessfulRoutes: number;
    completedTokens: number;
    failedTokens: number;
  };
  verification: {
    backfillIncompleteTokens: number;
    reconciliationIncompleteTokens: number;
    fullyRecoveredTokens: number;
  };
  page: {
    hasMoreUsers: boolean;
    nextStartAfterUID: string | null;
  };
}

function readArgValue(argv: string[], key: string): string | undefined {
  const equalsPrefix = `${key}=`;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === key) return argv[index + 1];
    if (argv[index].startsWith(equalsPrefix)) return argv[index].slice(equalsPrefix.length);
  }
  return undefined;
}

function validateArguments(argv: string[]): void {
  const seen = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const equalsIndex = argument.indexOf('=');
    const key = equalsIndex >= 0 ? argument.slice(0, equalsIndex) : argument;
    if (BOOLEAN_ARGUMENTS.has(key)) {
      if (equalsIndex >= 0) throw new Error(`${key} does not accept a value.`);
      if (seen.has(key)) throw new Error(`Duplicate argument: ${key}`);
      seen.add(key);
      continue;
    }
    if (!VALUE_ARGUMENTS.has(key)) throw new Error(`Unknown argument: ${argument}`);
    if (seen.has(key)) throw new Error(`Duplicate argument: ${key}`);
    seen.add(key);
    if (equalsIndex >= 0) {
      if (argument.slice(equalsIndex + 1).length === 0) {
        throw new Error(`${key} requires a value.`);
      }
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${key} requires a value.`);
    index += 1;
  }
}

function parseBoundedInteger(value: string | undefined, fallback: number, maximum: number): number {
  if (!value) return fallback;
  const parsed = /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maximum) {
    throw new Error(`Expected a positive integer no greater than ${maximum}, received ${value}.`);
  }
  return parsed;
}

function parseOptionalUID(value: string | undefined, key: string): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized || normalized !== value || normalized.length > 128 || normalized.includes('/')) {
    throw new Error(`${key} must be a canonical Firebase user ID.`);
  }
  return normalized;
}

function parseStage(value: string | undefined): RepairStage {
  const stage = `${value || 'audit'}`.trim();
  if (stage === 'audit'
    || stage === 'repair'
    || stage === 'backfill'
    || stage === 'reconcile'
    || stage === 'verify') return stage;
  throw new Error(`Invalid --stage ${value}. Expected audit, repair, backfill, reconcile, or verify.`);
}

function parseDateMs(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed)) throw new Error(`Invalid date value: ${value}`);
  return parsed;
}

export function parseSuuntoLegacyWebhookRepairOptions(
  argv: string[],
  nowMs = Date.now(),
): ScriptOptions {
  validateArguments(argv);
  const stage = parseStage(readArgValue(argv, '--stage'));
  const execute = argv.includes('--apply') || argv.includes('--execute');
  if (execute && (stage === 'audit' || stage === 'verify')) {
    throw new Error(`${stage} is read-only and must not be run with --apply.`);
  }
  if (!execute && (stage === 'repair' || stage === 'backfill' || stage === 'reconcile')) {
    throw new Error(`${stage} requires the explicit --apply flag.`);
  }
  const throughMs = parseDateMs(readArgValue(argv, '--through'), nowMs);
  if (throughMs < INCIDENT_START_MS || throughMs > nowMs + 60_000) {
    throw new Error('--through must be between the incident start and the current time.');
  }
  const uid = parseOptionalUID(readArgValue(argv, '--uid'), '--uid');
  const startAfterUID = parseOptionalUID(
    readArgValue(argv, '--start-after-uid'),
    '--start-after-uid',
  );
  if (uid && startAfterUID) throw new Error('Use either --uid or --start-after-uid, not both.');
  return {
    execute,
    stage,
    uid: uid || undefined,
    startAfterUID: startAfterUID || undefined,
    userLimit: parseBoundedInteger(readArgValue(argv, '--limit'), DEFAULT_USER_LIMIT, MAX_USER_LIMIT),
    eventPageSize: parseBoundedInteger(
      readArgValue(argv, '--event-page-size'),
      DEFAULT_EVENT_PAGE_SIZE,
      MAX_EVENT_PAGE_SIZE,
    ),
    throughMs,
  };
}

function initialSummary(options: ScriptOptions): SuuntoLegacyWebhookRepairSummary {
  return {
    dryRun: !options.execute,
    stage: options.stage,
    incidentStart: new Date(INCIDENT_START_MS).toISOString(),
    through: new Date(options.throughMs).toISOString(),
    scannedUsers: 0,
    scannedTokens: 0,
    repairCandidates: 0,
    alreadyCurrent: 0,
    repairedMarkerTokens: 0,
    skipped: {},
    repair: {
      attempted: 0,
      repaired: 0,
      inactive: 0,
      unverified: 0,
      refreshRejected: 0,
      failed: 0,
      contactUserIDs: [],
    },
    backfill: {
      attemptedTokens: 0,
      providerWorkoutsFound: 0,
      queueAttempts: 0,
      completedTokens: 0,
      failedTokens: 0,
    },
    reconcile: {
      attemptedTokens: 0,
      queueProcessed: 0,
      queuePending: 0,
      queueFailed: 0,
      queueMissing: 0,
      scannedEvents: 0,
      eligibleEvents: 0,
      queuedRoutes: 0,
      skippedSuccessfulRoutes: 0,
      completedTokens: 0,
      failedTokens: 0,
    },
    verification: {
      backfillIncompleteTokens: 0,
      reconciliationIncompleteTokens: 0,
      fullyRecoveredTokens: 0,
    },
    page: {
      hasMoreUsers: false,
      nextStartAfterUID: null,
    },
  };
}

function increment(target: Record<string, number>, key: string, count = 1): void {
  target[key] = (target[key] || 0) + count;
}

function normalizedString(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized && normalized === value ? normalized : null;
}

function normalizedGeneration(value: unknown): string | null {
  const normalized = normalizedString(value);
  return normalized && normalized.length <= 128 ? normalized : null;
}

function markerVersion(data: Record<string, unknown> | undefined): number {
  return data?.[REPAIR_VERSION_FIELD] === LEGACY_REPAIR_VERSION
    ? LEGACY_REPAIR_VERSION
    : 0;
}

function markerThrough(data: Record<string, unknown> | undefined, field: string): number {
  const value = data?.[field];
  return typeof value === 'number' && Number.isFinite(value) && value >= INCIDENT_START_MS
    ? value
    : 0;
}

async function getCanonicalUserPage(
  db: admin.firestore.Firestore,
  options: Pick<ScriptOptions, 'uid' | 'startAfterUID' | 'userLimit'>,
): Promise<CanonicalUserPage> {
  if (options.uid) {
    const snapshot = await db.collection('users').doc(options.uid).get();
    return {
      docs: snapshot.exists ? [snapshot as admin.firestore.QueryDocumentSnapshot] : [],
      hasMore: false,
      nextStartAfterUID: null,
    };
  }
  let query: admin.firestore.Query = db.collection('users').orderBy(FieldPath.documentId());
  if (options.startAfterUID) query = query.startAfter(options.startAfterUID);
  const snapshot = await query.limit(options.userLimit + 1).get();
  const docs = snapshot.docs.slice(0, options.userLimit);
  return {
    docs,
    hasMore: snapshot.docs.length > options.userLimit,
    nextStartAfterUID: snapshot.docs.length > options.userLimit
      ? docs[docs.length - 1]?.id || null
      : null,
  };
}

function isTerminalRefreshRejection(error: unknown): boolean {
  return error instanceof TerminalServiceAuthError;
}

function recordTerminalRefreshContact(
  summary: SuuntoLegacyWebhookRepairSummary,
  userID: string,
  error: unknown,
): boolean {
  if (!isTerminalRefreshRejection(error)) return false;
  summary.repair.refreshRejected += 1;
  summary.repair.contactUserIDs.push(userID);
  return true;
}

function suuntoSourceRouteIDs(): ActivitySyncRouteId[] {
  return Object.values(ACTIVITY_SYNC_ROUTES)
    .filter(route => route.sourceServiceName === ServiceNames.SuuntoApp)
    .map(route => route.id);
}

async function inspectCanonicalUser(
  db: admin.firestore.Firestore,
  userSnapshot: admin.firestore.QueryDocumentSnapshot,
  nowMs: number,
): Promise<UserInspection> {
  const userID = userSnapshot.id;
  const tokenRootRef = getServiceTokenRootDocumentRef(userID, ServiceNames.SuuntoApp);
  const serviceMetaRef = db.collection('users').doc(userID).collection('meta').doc(ServiceNames.SuuntoApp);
  const [deletionGuard, tokenRootSnapshot, serviceMetaSnapshot, tokenPage] = await Promise.all([
    getUserDeletionGuardState(db, userID, nowMs),
    tokenRootRef.get(),
    serviceMetaRef.get(),
    tokenRootRef.collection('tokens')
      .orderBy(FieldPath.documentId())
      .limit(MAX_TOKENS_PER_USER + 1)
      .get(),
  ]);
  const skipped: Record<string, number> = {};
  if (deletionGuard.shouldSkip) {
    increment(skipped, 'user_deleted_or_deleting');
    return {
      tokens: [], maintenanceTokens: [], scannedTokenCount: tokenPage.size, alreadyCurrentCount: 0, skipped,
    };
  }
  if (tokenPage.size > MAX_TOKENS_PER_USER) {
    increment(skipped, 'too_many_retained_tokens');
    return {
      tokens: [], maintenanceTokens: [], scannedTokenCount: tokenPage.size, alreadyCurrentCount: 0, skipped,
    };
  }

  const tokenRootData = tokenRootSnapshot.data() as Record<string, unknown> | undefined;
  const serviceMeta = serviceMetaSnapshot.data() as Record<string, unknown> | undefined;
  if (!serviceMetaSnapshot.exists
    || serviceMeta?.connectionState !== SERVICE_CONNECTION_STATES.Connected
    || isServiceUnavailableForSyncConnection(serviceMeta)) {
    increment(skipped, 'service_not_connected');
    return {
      tokens: [], maintenanceTokens: [], scannedTokenCount: tokenPage.size, alreadyCurrentCount: 0, skipped,
    };
  }
  if (isServiceDisconnectPendingData(tokenRootData)
    || !doesServiceDisconnectOperationPermitTokenUse(tokenRootData, undefined, nowMs)) {
    increment(skipped, 'disconnect_pending', tokenPage.size || 1);
    return {
      tokens: [], maintenanceTokens: [], scannedTokenCount: tokenPage.size, alreadyCurrentCount: 0, skipped,
    };
  }

  const tokens: RepairToken[] = [];
  const maintenanceTokens: RepairToken[] = [];
  let alreadyCurrentCount = 0;
  for (const tokenSnapshot of tokenPage.docs) {
    const tokenData = tokenSnapshot.data() as Record<string, unknown>;
    const providerUserId = normalizedString(tokenData.userName);
    if (tokenData.serviceName !== ServiceNames.SuuntoApp
      || !providerUserId
      || providerUserId !== tokenSnapshot.id
      || providerUserId.length > SUUNTO_HEALTH_MAX_PROVIDER_ACCOUNT_ID_LENGTH
      || !normalizedString(tokenData.refreshToken)) {
      increment(skipped, 'malformed_token');
      continue;
    }
    const bindingRef = getSuuntoHealthWebhookAccountBindingRef(db, providerUserId, userID);
    const bindingSnapshot = await bindingRef.get();
    const binding = parseSuuntoHealthWebhookAccountBinding(bindingSnapshot.data());
    const tokenGeneration = normalizedGeneration(tokenData.tokenCredentialGeneration);
    const rootGeneration = normalizedGeneration(
      tokenRootData?.[ACTIVE_OAUTH_CREDENTIAL_GENERATION_FIELD],
    );
    const connectionGeneration = normalizedGeneration(serviceMeta.connectionStateGeneration);
    const reasons: string[] = [];
    if (!tokenRootSnapshot.exists) reasons.push('missing_token_root');
    if (!tokenGeneration) reasons.push('missing_or_malformed_token_generation');
    if (!rootGeneration) reasons.push('missing_or_malformed_root_generation');
    if (!connectionGeneration) reasons.push('missing_or_malformed_connection_generation');
    if (!doesSuuntoHealthWebhookBindingMatch(
      binding,
      userID,
      providerUserId,
      tokenGeneration,
    )) reasons.push('missing_or_stale_binding');
    const inspectedToken = { userID, providerUserId, tokenSnapshot, reasons };
    maintenanceTokens.push(inspectedToken);
    if (reasons.length === 0) {
      alreadyCurrentCount += 1;
      continue;
    }
    tokens.push(inspectedToken);
  }
  return { tokens, maintenanceTokens, scannedTokenCount: tokenPage.size, alreadyCurrentCount, skipped };
}

async function setRepairMarkerIfLifecycleCurrent(params: {
  db: admin.firestore.Firestore;
  userID: string;
  providerUserId: string;
  expectedTokenSnapshot: admin.firestore.DocumentSnapshot;
  patch: Record<string, unknown>;
  nowMs: number;
}): Promise<boolean> {
  const tokenRootRef = getServiceTokenRootDocumentRef(params.userID, ServiceNames.SuuntoApp);
  const tokenRef = tokenRootRef.collection('tokens').doc(params.providerUserId);
  const serviceMetaRef = params.db.collection('users').doc(params.userID)
    .collection('meta').doc(ServiceNames.SuuntoApp);
  const bindingRef = getSuuntoHealthWebhookAccountBindingRef(
    params.db,
    params.providerUserId,
    params.userID,
  );
  const expectedCredential = getTokenCredentialSnapshot(
    params.expectedTokenSnapshot.data() as Record<string, unknown> | undefined,
  );
  return params.db.runTransaction(async transaction => {
    const [tokenSnapshot, tokenRootSnapshot, serviceMetaSnapshot, bindingSnapshot, deletionGuard] =
      await Promise.all([
        transaction.get(tokenRef),
        transaction.get(tokenRootRef),
        transaction.get(serviceMetaRef),
        transaction.get(bindingRef),
        getUserDeletionGuardStateInTransaction(
          params.db,
          transaction,
          params.userID,
          params.nowMs,
        ),
      ]);
    const tokenData = tokenSnapshot.data() as Record<string, unknown> | undefined;
    const tokenRootData = tokenRootSnapshot.data() as Record<string, unknown> | undefined;
    const serviceMeta = serviceMetaSnapshot.data() as Record<string, unknown> | undefined;
    const tokenGeneration = normalizedGeneration(tokenData?.tokenCredentialGeneration);
    if (deletionGuard.shouldSkip
      || !tokenSnapshot.exists
      || !tokenRootSnapshot.exists
      || !serviceMetaSnapshot.exists
      || tokenData?.serviceName !== ServiceNames.SuuntoApp
      || tokenData.userName !== params.providerUserId
      || !areTokenCredentialSnapshotsEqual(getTokenCredentialSnapshot(tokenData), expectedCredential)
      || !normalizedGeneration(tokenRootData?.[ACTIVE_OAUTH_CREDENTIAL_GENERATION_FIELD])
      || serviceMeta?.connectionState !== SERVICE_CONNECTION_STATES.Connected
      || isServiceUnavailableForSyncConnection(serviceMeta)
      || !normalizedGeneration(serviceMeta.connectionStateGeneration)
      || isServiceDisconnectPendingData(tokenRootData)
      || !doesServiceDisconnectOperationPermitTokenUse(tokenRootData, undefined, params.nowMs)
      || !doesSuuntoHealthWebhookBindingMatch(
        parseSuuntoHealthWebhookAccountBinding(bindingSnapshot.data()),
        params.userID,
        params.providerUserId,
        tokenGeneration,
      )) return false;
    transaction.set(tokenRef, params.patch, { merge: true });
    return true;
  });
}

async function runRepair(
  db: admin.firestore.Firestore,
  candidate: RepairToken,
  summary: SuuntoLegacyWebhookRepairSummary,
): Promise<void> {
  summary.repair.attempted += 1;
  try {
    const liveTokenSnapshot = await candidate.tokenSnapshot.ref.get();
    if (!liveTokenSnapshot.exists) {
      summary.repair.inactive += 1;
      return;
    }
    const repairedAtMs = Date.now();
    const status = await repairSuuntoLegacyWebhookBindingForProviderVerifiedToken(
      db,
      candidate.userID,
      liveTokenSnapshot,
      INCIDENT_START_MS,
      repairedAtMs,
    );
    if (status === 'inactive') {
      summary.repair.inactive += 1;
      return;
    }
    if (status === 'unverified') {
      summary.repair.unverified += 1;
      return;
    }
    summary.repair.repaired += 1;
  } catch (error) {
    if (recordTerminalRefreshContact(summary, candidate.userID, error)) {
      return;
    }
    summary.repair.failed += 1;
    logger.error(`${LOG_PREFIX} Repair failed.`, {
      userID: candidate.userID,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
  }
}

function isRepairedToken(token: RepairToken): boolean {
  return markerVersion(token.tokenSnapshot.data() as Record<string, unknown> | undefined)
    === LEGACY_REPAIR_VERSION;
}

async function assertTokenBindingActive(
  db: admin.firestore.Firestore,
  token: RepairToken,
): Promise<boolean> {
  const resolved = await resolveActiveSuuntoWebhookUserIDs(
    db,
    token.providerUserId,
    [token.userID],
  );
  return resolved.length === 1 && resolved[0] === token.userID;
}

async function listRepairWindowWorkouts(token: RepairToken, throughMs: number): Promise<Array<{
  userName: string;
  workoutID: string;
}>> {
  const liveSnapshot = await token.tokenSnapshot.ref.get();
  if (!liveSnapshot.exists) throw new Error('Suunto repair token no longer exists.');
  const serviceToken = await getTokenData(liveSnapshot, ServiceNames.SuuntoApp, false, {
    opaqueTelemetry: true,
  });
  const queueItems = await getWorkoutQueueItems(
    ServiceNames.SuuntoApp,
    serviceToken as never,
    new Date(INCIDENT_START_MS),
    new Date(throughMs),
    // Fetch one sentinel row beyond the accepted maximum so truncation is
    // detected instead of silently treating a partial provider page as full.
    { suuntoResultLimit: MAX_WORKOUTS_PER_TOKEN + 1 },
  ) as unknown;
  if (!Array.isArray(queueItems)) throw new Error('Suunto history response was not a list.');
  const workouts = queueItems.flatMap(item => {
    const record = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const userName = normalizedString(record.userName);
    const workoutID = normalizedString(record.workoutID);
    return userName === token.providerUserId && workoutID ? [{ userName, workoutID }] : [];
  });
  if (workouts.length > MAX_WORKOUTS_PER_TOKEN) {
    throw new Error(`Suunto repair window exceeded ${MAX_WORKOUTS_PER_TOKEN} workouts.`);
  }
  return workouts;
}

async function runBackfill(
  db: admin.firestore.Firestore,
  token: RepairToken,
  options: ScriptOptions,
  summary: SuuntoLegacyWebhookRepairSummary,
): Promise<void> {
  const tokenData = token.tokenSnapshot.data() as Record<string, unknown> | undefined;
  if (markerThrough(tokenData, BACKFILL_THROUGH_FIELD) >= options.throughMs) return;
  summary.backfill.attemptedTokens += 1;
  try {
    if (!(await assertTokenBindingActive(db, token))) {
      increment(summary.skipped, 'backfill_binding_inactive');
      summary.backfill.failedTokens += 1;
      return;
    }
    const workouts = await listRepairWindowWorkouts(token, options.throughMs);
    summary.backfill.providerWorkoutsFound += workouts.length;
    for (const workout of workouts) {
      await addToQueueForSuunto({
        ...workout,
        firebaseUserID: token.userID,
      });
      summary.backfill.queueAttempts += 1;
    }
    const currentTokenSnapshot = await token.tokenSnapshot.ref.get();
    const completedAtMs = Date.now();
    const marked = currentTokenSnapshot.exists && await setRepairMarkerIfLifecycleCurrent({
      db,
      userID: token.userID,
      providerUserId: token.providerUserId,
      expectedTokenSnapshot: currentTokenSnapshot,
      nowMs: completedAtMs,
      patch: {
        [BACKFILL_THROUGH_FIELD]: options.throughMs,
        [BACKFILL_QUEUED_AT_FIELD]: completedAtMs,
      },
    });
    if (!marked) throw new Error('Suunto lifecycle changed before backfill completion was recorded.');
    summary.backfill.completedTokens += 1;
  } catch (error) {
    recordTerminalRefreshContact(summary, token.userID, error);
    summary.backfill.failedTokens += 1;
    logger.error(`${LOG_PREFIX} Backfill failed.`, {
      userID: token.userID,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
  }
}

async function getQueueDrainStatus(
  db: admin.firestore.Firestore,
  token: RepairToken,
  workouts: readonly { userName: string; workoutID: string }[],
): Promise<QueueDrainStatus> {
  const queueCollection = db.collection(getServiceWorkoutQueueName(ServiceNames.SuuntoApp));
  const failedCollection = db.collection('failed_jobs');
  const queueIDs = await Promise.all(workouts.map(workout => generateIDFromParts([
    workout.userName,
    workout.workoutID,
    token.userID,
  ])));
  const result: QueueDrainStatus = { processed: 0, pending: 0, failed: 0, missing: 0 };
  for (let index = 0; index < queueIDs.length; index += FIRESTORE_GET_ALL_BATCH_SIZE) {
    const ids = queueIDs.slice(index, index + FIRESTORE_GET_ALL_BATCH_SIZE);
    const queueSnapshots = await db.getAll(...ids.map(id => queueCollection.doc(id)));
    const missingIDs: string[] = [];
    for (let offset = 0; offset < queueSnapshots.length; offset += 1) {
      const snapshot = queueSnapshots[offset];
      if (!snapshot.exists) {
        missingIDs.push(ids[offset]);
      } else if (snapshot.data()?.processed === true) {
        result.processed += 1;
      } else {
        result.pending += 1;
      }
    }
    if (missingIDs.length === 0) continue;
    const failedSnapshots = await db.getAll(...missingIDs.map(id => failedCollection.doc(id)));
    for (const snapshot of failedSnapshots) {
      if (snapshot.exists
        && snapshot.data()?.originalCollection === getServiceWorkoutQueueName(ServiceNames.SuuntoApp)) {
        result.failed += 1;
      } else {
        result.missing += 1;
      }
    }
  }
  return result;
}

function toOriginalFiles(eventData: Record<string, unknown>): Array<{
  path: string;
  bucket?: string;
  startDate?: unknown;
  originalFilename?: string;
}> {
  const candidates = Array.isArray(eventData.originalFiles)
    ? eventData.originalFiles
    : (eventData.originalFile ? [eventData.originalFile] : []);
  return candidates.flatMap(candidate => {
    const value = candidate && typeof candidate === 'object'
      ? candidate as Record<string, unknown>
      : null;
    const path = normalizedString(value?.path);
    if (!value || !path) return [];
    return [{
      path,
      ...(normalizedString(value.bucket) ? { bucket: normalizedString(value.bucket)! } : {}),
      ...(value.startDate !== undefined ? { startDate: value.startDate } : {}),
      ...(normalizedString(value.originalFilename)
        ? { originalFilename: normalizedString(value.originalFilename)! }
        : {}),
    }];
  });
}

function sourceActivityID(sourceMetaData: Record<string, unknown>): string | undefined {
  return normalizedString(sourceMetaData.workoutID)
    || normalizedString(sourceMetaData.activityFileID)
    || undefined;
}

async function reconcileEnabledActivitySyncRoutes(
  db: admin.firestore.Firestore,
  token: RepairToken,
  options: ScriptOptions,
  summary: SuuntoLegacyWebhookRepairSummary,
): Promise<void> {
  const enabledRouteIDs: ActivitySyncRouteId[] = [];
  for (const routeID of suuntoSourceRouteIDs()) {
    if (await isActivitySyncRouteEnabledForUser(token.userID, routeID)) enabledRouteIDs.push(routeID);
  }
  if (enabledRouteIDs.length === 0) return;

  let cursor: admin.firestore.QueryDocumentSnapshot | undefined;
  let scannedForToken = 0;
  while (true) {
    let query: admin.firestore.Query = db.collection('users').doc(token.userID)
      .collection('events')
      .where('startDate', '>=', INCIDENT_START_MS)
      .where('startDate', '<=', options.throughMs)
      .orderBy('startDate', 'asc')
      .limit(options.eventPageSize);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    if (page.empty) break;
    scannedForToken += page.size;
    if (scannedForToken > MAX_EVENTS_PER_TOKEN) {
      throw new Error(`Suunto repair window exceeded ${MAX_EVENTS_PER_TOKEN} events.`);
    }
    summary.reconcile.scannedEvents += page.size;
    for (const eventSnapshot of page.docs) {
      const eventData = eventSnapshot.data() as Record<string, unknown>;
      const sourceMetaSnapshot = await eventSnapshot.ref.collection('metaData')
        .doc(ServiceNames.SuuntoApp)
        .get();
      if (!sourceMetaSnapshot.exists) continue;
      const originalFiles = toOriginalFiles(eventData);
      if (originalFiles.length === 0) continue;
      summary.reconcile.eligibleEvents += 1;
      const sourceMetaData = sourceMetaSnapshot.data() as Record<string, unknown>;
      for (const routeID of enabledRouteIDs) {
        const existingMetadata = await eventSnapshot.ref.collection('metaData')
          .doc(getActivitySyncMetadataDocId(routeID))
          .get();
        if (existingMetadata.data()?.status === 'success') {
          summary.reconcile.skippedSuccessfulRoutes += 1;
          continue;
        }
        const result = await enqueueActivitySyncJobsForImportedEvent({
          userID: token.userID,
          eventID: eventSnapshot.id,
          sourceServiceName: ServiceNames.SuuntoApp,
          sourceActivityID: sourceActivityID(sourceMetaData),
          originalFiles,
          manual: true,
          routeIdFilter: routeID,
          // Recheck the route setting at enqueue time in case it changed
          // after the page-level eligibility lookup.
          respectRouteEnabled: true,
        });
        summary.reconcile.queuedRoutes += result.queued;
      }
    }
    if (page.size < options.eventPageSize) break;
    cursor = page.docs[page.docs.length - 1];
  }
}

async function runReconcile(
  db: admin.firestore.Firestore,
  token: RepairToken,
  options: ScriptOptions,
  summary: SuuntoLegacyWebhookRepairSummary,
): Promise<void> {
  const tokenData = token.tokenSnapshot.data() as Record<string, unknown> | undefined;
  if (markerThrough(tokenData, BACKFILL_THROUGH_FIELD) < options.throughMs) {
    increment(summary.skipped, 'reconcile_backfill_not_completed');
    return;
  }
  if (markerThrough(tokenData, RECONCILED_THROUGH_FIELD) >= options.throughMs) return;
  summary.reconcile.attemptedTokens += 1;
  try {
    if (!(await assertTokenBindingActive(db, token))) {
      throw new Error('Suunto binding is no longer active.');
    }
    const workouts = await listRepairWindowWorkouts(token, options.throughMs);
    const drain = await getQueueDrainStatus(db, token, workouts);
    summary.reconcile.queueProcessed += drain.processed;
    summary.reconcile.queuePending += drain.pending;
    summary.reconcile.queueFailed += drain.failed;
    summary.reconcile.queueMissing += drain.missing;
    if (drain.pending > 0 || drain.failed > 0 || drain.missing > 0) {
      increment(summary.skipped, 'reconcile_imports_not_drained');
      summary.reconcile.failedTokens += 1;
      return;
    }
    await reconcileEnabledActivitySyncRoutes(db, token, options, summary);
    const currentTokenSnapshot = await token.tokenSnapshot.ref.get();
    const completedAtMs = Date.now();
    const marked = currentTokenSnapshot.exists && await setRepairMarkerIfLifecycleCurrent({
      db,
      userID: token.userID,
      providerUserId: token.providerUserId,
      expectedTokenSnapshot: currentTokenSnapshot,
      nowMs: completedAtMs,
      patch: {
        [RECONCILED_THROUGH_FIELD]: options.throughMs,
        [RECONCILED_AT_FIELD]: completedAtMs,
      },
    });
    if (!marked) throw new Error('Suunto lifecycle changed before reconciliation was recorded.');
    summary.reconcile.completedTokens += 1;
  } catch (error) {
    recordTerminalRefreshContact(summary, token.userID, error);
    summary.reconcile.failedTokens += 1;
    logger.error(`${LOG_PREFIX} Activity-sync reconciliation failed.`, {
      userID: token.userID,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
  }
}

async function inspectPage(
  db: admin.firestore.Firestore,
  options: ScriptOptions,
  summary: SuuntoLegacyWebhookRepairSummary,
): Promise<RepairToken[]> {
  const page = await getCanonicalUserPage(db, options);
  summary.page.hasMoreUsers = page.hasMore;
  summary.page.nextStartAfterUID = page.nextStartAfterUID;
  const stageTokens: RepairToken[] = [];
  for (const userSnapshot of page.docs) {
    summary.scannedUsers += 1;
    const inspection = await inspectCanonicalUser(db, userSnapshot, Date.now());
    summary.scannedTokens += inspection.scannedTokenCount;
    summary.repairCandidates += inspection.tokens.length;
    summary.alreadyCurrent += inspection.alreadyCurrentCount;
    for (const [reason, count] of Object.entries(inspection.skipped)) {
      increment(summary.skipped, reason, count);
    }
    if (options.stage === 'repair' || options.stage === 'audit' || options.stage === 'verify') {
      stageTokens.push(...inspection.tokens);
    }
    for (const token of inspection.maintenanceTokens) {
      const tokenData = token.tokenSnapshot.data() as Record<string, unknown>;
      if (markerVersion(tokenData) !== LEGACY_REPAIR_VERSION) continue;
      summary.repairedMarkerTokens += 1;
      if (options.stage === 'verify') {
        const backfillComplete = markerThrough(tokenData, BACKFILL_THROUGH_FIELD)
          >= options.throughMs;
        const reconciliationComplete = markerThrough(tokenData, RECONCILED_THROUGH_FIELD)
          >= options.throughMs;
        if (!backfillComplete) summary.verification.backfillIncompleteTokens += 1;
        if (!reconciliationComplete) {
          summary.verification.reconciliationIncompleteTokens += 1;
        }
        if (backfillComplete && reconciliationComplete) {
          summary.verification.fullyRecoveredTokens += 1;
        }
      }
      if (options.stage === 'backfill' || options.stage === 'reconcile') {
        stageTokens.push(token);
      }
    }
  }
  return stageTokens;
}

export async function runSuuntoLegacyWebhookRepairScript(
  argv: string[],
): Promise<SuuntoLegacyWebhookRepairSummary> {
  const options = parseSuuntoLegacyWebhookRepairOptions(argv);
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();
  const summary = initialSummary(options);
  const stageTokens = await inspectPage(db, options, summary);

  if (options.stage === 'repair') {
    for (const token of stageTokens) await runRepair(db, token, summary);
  } else if (options.stage === 'backfill') {
    for (const token of stageTokens.filter(isRepairedToken)) {
      await runBackfill(db, token, options, summary);
    }
  } else if (options.stage === 'reconcile') {
    for (const token of stageTokens.filter(isRepairedToken)) {
      await runReconcile(db, token, options, summary);
    }
  }

  summary.repair.contactUserIDs = [...new Set(summary.repair.contactUserIDs)].sort();
  logger.info(`${LOG_PREFIX} Summary`, summary);
  return summary;
}

async function main(): Promise<void> {
  const summary = await runSuuntoLegacyWebhookRepairScript(process.argv.slice(2));
  process.stdout.write(`${LOG_PREFIX} Summary ${JSON.stringify(summary)}\n`);
  process.exitCode = getSummaryExitCode(summary) || undefined;
}

function getSummaryExitCode(summary: SuuntoLegacyWebhookRepairSummary): number {
  if ((summary.stage === 'audit' || summary.stage === 'verify')
    && summary.repairCandidates > 0) return 2;
  if (summary.stage === 'verify'
    && (summary.verification.backfillIncompleteTokens > 0
      || summary.verification.reconciliationIncompleteTokens > 0)) return 2;
  if (summary.dryRun) return 0;
  if (summary.stage === 'repair'
    && summary.repair.attempted !== summary.repair.repaired) return 1;
  if ((summary.stage === 'backfill' || summary.stage === 'reconcile')
    && summary.repairCandidates > 0) return 1;
  if (summary.backfill.failedTokens > 0 || summary.reconcile.failedTokens > 0) return 1;
  return 0;
}

if (require.main === module) {
  main().catch(error => {
    logger.error(`${LOG_PREFIX} Fatal error`, {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    process.exitCode = 1;
  });
}

export const suuntoLegacyWebhookRepairTestInternals = {
  INCIDENT_START_MS,
  LEGACY_REPAIR_VERSION,
  REPAIR_VERSION_FIELD,
  REPAIRED_AT_FIELD,
  BACKFILL_THROUGH_FIELD,
  RECONCILED_THROUGH_FIELD,
  getSummaryExitCode,
  getQueueDrainStatus,
  normalizedGeneration,
  toOriginalFiles,
};
