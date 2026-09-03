import * as admin from 'firebase-admin';
import { FieldPath, FieldValue } from 'firebase-admin/firestore';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { COROSAPI_ACCESS_TOKENS_COLLECTION_NAME } from './coros/constants';
import { GARMIN_API_TOKENS_COLLECTION_NAME } from './garmin/constants';
import { SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME } from './suunto/constants';
import { WAHOO_API_ACCESS_TOKENS_COLLECTION_NAME } from './wahoo/constants';
import {
  OAUTH_FLOW_CREATED_AT_FIELD,
  OAUTH_FLOW_EXPIRES_AT_FIELD,
  OAUTH_FLOW_GENERATION_FIELD,
  SERVICE_DISCONNECT_OPERATION_GENERATION_FIELD,
  SERVICE_DISCONNECT_OPERATION_LEASE_EXPIRES_AT_FIELD,
} from './service-token-store';
import { isServiceDisconnectPendingData } from './service-disconnect-pending-state';
import {
  getUserDeletionGuardState,
  getUserDeletionGuardStateInTransaction,
} from './shared/user-deletion-guard';
import { ACTIVE_OAUTH_CREDENTIAL_GENERATION_FIELD } from './token-refresh-coordinator';

export const SERVICE_OAUTH_ROOT_RECONCILIATION_BATCH_LIMIT = 50;
export const SERVICE_OAUTH_ROOT_RECONCILIATION_CURSOR_COLLECTION = 'serviceOAuthRootReconciliationCursors';

export interface ServiceOAuthRootCollectionConfig {
  serviceName: ServiceNames;
  collectionName: string;
}

export const SERVICE_OAUTH_ROOT_COLLECTIONS: readonly ServiceOAuthRootCollectionConfig[] = [
  {
    serviceName: ServiceNames.SuuntoApp,
    collectionName: SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME,
  },
  {
    serviceName: ServiceNames.COROSAPI,
    collectionName: COROSAPI_ACCESS_TOKENS_COLLECTION_NAME,
  },
  {
    serviceName: ServiceNames.GarminAPI,
    collectionName: GARMIN_API_TOKENS_COLLECTION_NAME,
  },
  {
    serviceName: ServiceNames.WahooAPI,
    collectionName: WAHOO_API_ACCESS_TOKENS_COLLECTION_NAME,
  },
];

export type ServiceOAuthRootReconciliationOutcome =
  | 'cleaned_fields'
  | 'would_clean'
  | 'legacy_unbounded_oauth_context'
  | 'legacy_unbounded_disconnect_fence'
  | 'active_oauth_flow'
  | 'active_disconnect_fence'
  | 'pending_disconnect'
  | 'token_present'
  | 'missing_or_deleting_user'
  | 'lifecycle_changed'
  | 'no_action';

interface ServiceOAuthRootLifecycleSnapshot {
  oauthFlowGeneration: string | null;
  oauthFlowExpiresAt: number | null;
  disconnectOperationGeneration: string | null;
  disconnectOperationLeaseExpiresAt: number | null;
}

interface ServiceOAuthRootCleanupDecision {
  outcome: ServiceOAuthRootReconciliationOutcome;
  expiredOAuthFlow: boolean;
  expiredDisconnectFence: boolean;
  lifecycle: ServiceOAuthRootLifecycleSnapshot;
}

export interface ServiceOAuthRootReconciliationSummary {
  rootsScanned: number;
  cleaned: number;
  wouldClean: number;
  failed: number;
  byOutcome: Partial<Record<ServiceOAuthRootReconciliationOutcome, number>>;
  byService: Partial<Record<ServiceNames, {
    rootsScanned: number;
    cleaned: number;
    wouldClean: number;
    failed: number;
    byOutcome: Partial<Record<ServiceOAuthRootReconciliationOutcome, number>>;
  }>>;
}

function nonEmptyString(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || null;
}

function timestampMillis(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) ? millis : null;
  }
  if (value && typeof value === 'object' && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    const millis = (value as { toMillis: () => number }).toMillis();
    return Number.isFinite(millis) ? millis : null;
  }
  return null;
}

function hasOAuthFlowContext(data: Record<string, unknown>): boolean {
  return !!(
    nonEmptyString(data.state)
    || nonEmptyString(data.codeVerifier)
    || nonEmptyString(data[OAUTH_FLOW_GENERATION_FIELD])
    || timestampMillis(data[OAUTH_FLOW_CREATED_AT_FIELD]) !== null
    || timestampMillis(data[OAUTH_FLOW_EXPIRES_AT_FIELD]) !== null
  );
}

function hasPendingDisconnectLifecycle(data: Record<string, unknown>): boolean {
  if (isServiceDisconnectPendingData(data)) return true;
  return [
    'disconnectGeneration',
    'disconnectState',
    'disconnectReason',
    'disconnectAttemptCount',
    'disconnectNextAttemptAt',
    'disconnectLastAttemptAt',
    'disconnectRetryExpiresAt',
    'disconnectLastStatusCode',
    'disconnectLastErrorMessage',
    'disconnectManualReviewRequired',
  ].some(fieldName => data[fieldName] !== undefined && data[fieldName] !== null);
}

function lifecycleSnapshot(data: Record<string, unknown>): ServiceOAuthRootLifecycleSnapshot {
  return {
    oauthFlowGeneration: nonEmptyString(data[OAUTH_FLOW_GENERATION_FIELD]),
    oauthFlowExpiresAt: timestampMillis(data[OAUTH_FLOW_EXPIRES_AT_FIELD]),
    disconnectOperationGeneration: nonEmptyString(data[SERVICE_DISCONNECT_OPERATION_GENERATION_FIELD]),
    disconnectOperationLeaseExpiresAt: timestampMillis(
      data[SERVICE_DISCONNECT_OPERATION_LEASE_EXPIRES_AT_FIELD],
    ),
  };
}

function lifecyclesEqual(
  left: ServiceOAuthRootLifecycleSnapshot,
  right: ServiceOAuthRootLifecycleSnapshot,
): boolean {
  return left.oauthFlowGeneration === right.oauthFlowGeneration
    && left.oauthFlowExpiresAt === right.oauthFlowExpiresAt
    && left.disconnectOperationGeneration === right.disconnectOperationGeneration
    && left.disconnectOperationLeaseExpiresAt === right.disconnectOperationLeaseExpiresAt;
}

export function classifyServiceOAuthRootForReconciliation(
  data: Record<string, unknown>,
  nowMs = Date.now(),
): ServiceOAuthRootCleanupDecision {
  const lifecycle = lifecycleSnapshot(data);
  const hasOAuthContext = hasOAuthFlowContext(data);
  const hasDisconnectFence = !!lifecycle.disconnectOperationGeneration;
  const activeOAuthFlow = hasOAuthContext
    && lifecycle.oauthFlowExpiresAt !== null
    && lifecycle.oauthFlowExpiresAt > nowMs;
  const expiredOAuthFlow = hasOAuthContext
    && lifecycle.oauthFlowExpiresAt !== null
    && lifecycle.oauthFlowExpiresAt <= nowMs;
  const activeDisconnectFence = hasDisconnectFence
    && lifecycle.disconnectOperationLeaseExpiresAt !== null
    && lifecycle.disconnectOperationLeaseExpiresAt > nowMs;
  const expiredDisconnectFence = hasDisconnectFence
    && lifecycle.disconnectOperationLeaseExpiresAt !== null
    && lifecycle.disconnectOperationLeaseExpiresAt <= nowMs;

  if (hasPendingDisconnectLifecycle(data)) {
    return { outcome: 'pending_disconnect', expiredOAuthFlow, expiredDisconnectFence, lifecycle };
  }
  if (activeDisconnectFence) {
    return { outcome: 'active_disconnect_fence', expiredOAuthFlow, expiredDisconnectFence, lifecycle };
  }
  if (activeOAuthFlow) {
    return { outcome: 'active_oauth_flow', expiredOAuthFlow, expiredDisconnectFence, lifecycle };
  }
  if (expiredOAuthFlow || expiredDisconnectFence) {
    return { outcome: 'would_clean', expiredOAuthFlow, expiredDisconnectFence, lifecycle };
  }
  if (hasDisconnectFence && lifecycle.disconnectOperationLeaseExpiresAt === null) {
    return {
      outcome: 'legacy_unbounded_disconnect_fence',
      expiredOAuthFlow,
      expiredDisconnectFence,
      lifecycle,
    };
  }
  if (hasOAuthContext && lifecycle.oauthFlowExpiresAt === null) {
    return {
      outcome: 'legacy_unbounded_oauth_context',
      expiredOAuthFlow,
      expiredDisconnectFence,
      lifecycle,
    };
  }
  return { outcome: 'no_action', expiredOAuthFlow, expiredDisconnectFence, lifecycle };
}

async function reconcileServiceOAuthRootSnapshot(
  db: admin.firestore.Firestore,
  rootSnapshot: admin.firestore.QueryDocumentSnapshot,
  nowMs: number,
  dryRun: boolean,
): Promise<ServiceOAuthRootReconciliationOutcome> {
  const initialData = rootSnapshot.data() as Record<string, unknown>;
  const initialDecision = classifyServiceOAuthRootForReconciliation(initialData, nowMs);
  const isLegacyDryRunCandidate = dryRun && (
    initialDecision.outcome === 'legacy_unbounded_oauth_context'
    || initialDecision.outcome === 'legacy_unbounded_disconnect_fence'
  );
  if (initialDecision.outcome !== 'would_clean' && !isLegacyDryRunCandidate) {
    return initialDecision.outcome;
  }

  if (dryRun) {
    const [deletionGuard, tokenSnapshot] = await Promise.all([
      getUserDeletionGuardState(db, rootSnapshot.id, nowMs),
      rootSnapshot.ref.collection('tokens').limit(1).get(),
    ]);
    if (deletionGuard.shouldSkip) return 'missing_or_deleting_user';
    if (!tokenSnapshot.empty) return 'token_present';
    return initialDecision.outcome;
  }

  return db.runTransaction(async transaction => {
    const deletionGuard = await getUserDeletionGuardStateInTransaction(
      db,
      transaction,
      rootSnapshot.id,
      nowMs,
    );
    if (deletionGuard.shouldSkip) return 'missing_or_deleting_user';

    const [currentRootSnapshot, tokenSnapshot] = await Promise.all([
      transaction.get(rootSnapshot.ref),
      transaction.get(rootSnapshot.ref.collection('tokens').limit(1)),
    ]);
    if (!currentRootSnapshot.exists) return 'no_action';
    if (!tokenSnapshot.empty) return 'token_present';

    const currentData = currentRootSnapshot.data() as Record<string, unknown>;
    const currentDecision = classifyServiceOAuthRootForReconciliation(currentData, nowMs);
    if (!lifecyclesEqual(initialDecision.lifecycle, currentDecision.lifecycle)) {
      return 'lifecycle_changed';
    }
    if (currentDecision.outcome !== 'would_clean') return currentDecision.outcome;

    const cleanupUpdate: Record<string, FieldValue> = {};
    const markDeleted = (fieldName: string) => {
      cleanupUpdate[fieldName] = FieldValue.delete();
    };

    if (currentDecision.expiredOAuthFlow) {
      markDeleted('state');
      markDeleted('codeVerifier');
      markDeleted(OAUTH_FLOW_GENERATION_FIELD);
      markDeleted(OAUTH_FLOW_CREATED_AT_FIELD);
      markDeleted(OAUTH_FLOW_EXPIRES_AT_FIELD);
      if (
        nonEmptyString(currentData[ACTIVE_OAUTH_CREDENTIAL_GENERATION_FIELD])
        === currentDecision.lifecycle.oauthFlowGeneration
      ) {
        markDeleted(ACTIVE_OAUTH_CREDENTIAL_GENERATION_FIELD);
      }
    }

    if (currentDecision.expiredDisconnectFence) {
      markDeleted(SERVICE_DISCONNECT_OPERATION_GENERATION_FIELD);
      markDeleted(SERVICE_DISCONNECT_OPERATION_LEASE_EXPIRES_AT_FIELD);
      // Explicit disconnect uses the OAuth generation as a lifecycle fence,
      // but clears OAuth expiry fields. Once its own lease expires and no
      // token or pending retry remains, that generation has no live owner.
      if (currentDecision.lifecycle.oauthFlowExpiresAt === null) {
        markDeleted(OAUTH_FLOW_GENERATION_FIELD);
      }
    }

    // Keep an empty root after clearing its last lifecycle field. At least one
    // legacy maintenance writer can create a token child without reading the
    // root, so deleting only the parent document could orphan that credential.
    transaction.update(rootSnapshot.ref, cleanupUpdate);
    return 'cleaned_fields';
  });
}

function emptySummary(): ServiceOAuthRootReconciliationSummary {
  return {
    rootsScanned: 0,
    cleaned: 0,
    wouldClean: 0,
    failed: 0,
    byOutcome: {},
    byService: {},
  };
}

function recordOutcome(
  summary: ServiceOAuthRootReconciliationSummary,
  config: ServiceOAuthRootCollectionConfig,
  outcome: ServiceOAuthRootReconciliationOutcome,
): void {
  const serviceSummary = summary.byService[config.serviceName] || {
    rootsScanned: 0,
    cleaned: 0,
    wouldClean: 0,
    failed: 0,
    byOutcome: {},
  };
  summary.byService[config.serviceName] = serviceSummary;
  summary.byOutcome[outcome] = (summary.byOutcome[outcome] || 0) + 1;
  serviceSummary.byOutcome[outcome] = (serviceSummary.byOutcome[outcome] || 0) + 1;
  if (outcome === 'cleaned_fields') {
    summary.cleaned += 1;
    serviceSummary.cleaned += 1;
  }
  if (outcome === 'would_clean') {
    summary.wouldClean += 1;
    serviceSummary.wouldClean += 1;
  }
}

function cursorRef(
  db: admin.firestore.Firestore,
  config: ServiceOAuthRootCollectionConfig,
): admin.firestore.DocumentReference {
  return db.collection(SERVICE_OAUTH_ROOT_RECONCILIATION_CURSOR_COLLECTION).doc(config.collectionName);
}

async function getScheduledRootPage(
  db: admin.firestore.Firestore,
  config: ServiceOAuthRootCollectionConfig,
  pageSize: number,
): Promise<admin.firestore.QueryDocumentSnapshot[]> {
  const reconciliationCursorRef = cursorRef(db, config);
  const cursorSnapshot = await reconciliationCursorRef.get();
  const documentId = cursorSnapshot.exists
    ? nonEmptyString(cursorSnapshot.data()?.documentId)
    : null;
  const runQuery = async (startAfterDocumentId: string | null) => {
    let query: admin.firestore.Query = db.collection(config.collectionName)
      .orderBy(FieldPath.documentId())
      .limit(pageSize);
    if (startAfterDocumentId) query = query.startAfter(startAfterDocumentId);
    return query.get();
  };

  let page = await runQuery(documentId);
  if (page.empty && documentId) {
    // Cursor documents are flat scheduler checkpoints with no descendants.
    await reconciliationCursorRef.delete();
    page = await runQuery(null);
  }
  return page.docs;
}

async function checkpointScheduledRootPage(
  db: admin.firestore.Firestore,
  config: ServiceOAuthRootCollectionConfig,
  docs: readonly admin.firestore.QueryDocumentSnapshot[],
  pageSize: number,
): Promise<void> {
  const reconciliationCursorRef = cursorRef(db, config);
  if (docs.length < pageSize) {
    // Cursor documents are flat scheduler checkpoints with no descendants.
    await reconciliationCursorRef.delete();
    return;
  }
  await reconciliationCursorRef.set({ documentId: docs[docs.length - 1].id }, { merge: true });
}

/** Processes one bounded, checkpointed page per provider for the scheduler. */
export async function reconcileExpiredServiceOAuthRoots(
  db: admin.firestore.Firestore = admin.firestore(),
  nowMs = Date.now(),
  pageSize = SERVICE_OAUTH_ROOT_RECONCILIATION_BATCH_LIMIT,
): Promise<ServiceOAuthRootReconciliationSummary> {
  const summary = emptySummary();
  for (const config of SERVICE_OAUTH_ROOT_COLLECTIONS) {
    const serviceSummary = {
      rootsScanned: 0,
      cleaned: 0,
      wouldClean: 0,
      failed: 0,
      byOutcome: {},
    };
    summary.byService[config.serviceName] = serviceSummary;
    const roots = await getScheduledRootPage(db, config, pageSize);
    for (const root of roots) {
      summary.rootsScanned += 1;
      serviceSummary.rootsScanned += 1;
      try {
        const outcome = await reconcileServiceOAuthRootSnapshot(db, root, nowMs, false);
        recordOutcome(summary, config, outcome);
      } catch {
        summary.failed += 1;
        serviceSummary.failed += 1;
      }
    }
    await checkpointScheduledRootPage(db, config, roots, pageSize);
  }
  return summary;
}

/**
 * Read-only bounded audit used before any approved legacy cleanup. It never
 * writes cursor or root documents and returns aggregate reason counts only.
 */
export async function auditServiceOAuthRoots(
  db: admin.firestore.Firestore = admin.firestore(),
  nowMs = Date.now(),
  pageSize = 100,
  maxRootsPerService = 2_000,
): Promise<ServiceOAuthRootReconciliationSummary> {
  const summary = emptySummary();
  for (const config of SERVICE_OAUTH_ROOT_COLLECTIONS) {
    const serviceSummary = {
      rootsScanned: 0,
      cleaned: 0,
      wouldClean: 0,
      failed: 0,
      byOutcome: {},
    };
    summary.byService[config.serviceName] = serviceSummary;
    let lastSnapshot: admin.firestore.QueryDocumentSnapshot | null = null;

    while (serviceSummary.rootsScanned < maxRootsPerService) {
      const remaining = maxRootsPerService - serviceSummary.rootsScanned;
      let query: admin.firestore.Query = db.collection(config.collectionName)
        .orderBy(FieldPath.documentId())
        .limit(Math.min(pageSize, remaining));
      if (lastSnapshot) query = query.startAfter(lastSnapshot);
      const page = await query.get();
      if (page.empty) break;

      for (const root of page.docs) {
        summary.rootsScanned += 1;
        serviceSummary.rootsScanned += 1;
        try {
          const outcome = await reconcileServiceOAuthRootSnapshot(db, root, nowMs, true);
          recordOutcome(summary, config, outcome);
        } catch {
          summary.failed += 1;
          serviceSummary.failed += 1;
        }
      }
      lastSnapshot = page.docs[page.docs.length - 1];
      if (page.size < Math.min(pageSize, remaining)) break;
    }
  }
  return summary;
}

export const serviceOAuthRootReconciliationTestInternals = {
  reconcileServiceOAuthRootSnapshot,
};
