import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { ServiceNames } from '@sports-alliance/sports-lib';

import {
  isDisconnectPendingServiceConnection,
  isReconnectRequiredServiceConnection,
} from '../../../shared/service-connection';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import { clearRevisionProcessingLeaseUpdate } from './revision-processing-lease';
import { QUEUE_DEFERRED_REASONS } from '../queue-utils';
import { ACTIVITY_SYNC_QUEUE_COLLECTION_NAME } from '../activity-sync/constants';
import { ROUTE_DELIVERY_SYNC_QUEUE_COLLECTION_NAME } from '../route-delivery-sync/constants';
import type { QueueItemInterface } from './queue-item.interface';
import { getServiceTokenRootDocumentRef } from '../service-token-store';
import {
  doesRootMatchServiceDisconnectLifecycleGuard,
  type ServiceDisconnectLifecycleGuard,
} from '../service-disconnect-pending-state';

export type SyncRouteSettingsKind = 'activitySyncRoutes' | 'routeDeliverySyncRoutes';

export enum DisabledSyncRouteTransitionResult {
  Enabled = 'enabled',
  DeferredForRestore = 'deferred_for_restore',
  DisconnectPending = 'disconnect_pending',
  ReconnectRequired = 'reconnect_required',
  ProcessedAsDisabled = 'processed_as_disabled',
  NotCurrent = 'not_current',
  SkippedDeletedUser = 'skipped_deleted_user',
}

export interface DisabledSyncRouteTransition {
  result: DisabledSyncRouteTransitionResult;
  serviceName?: ServiceNames;
}

interface FinalizeDisabledSyncRouteParams {
  queueItem: QueueItemInterface;
  userID: string;
  routeId: string;
  settingsKind: SyncRouteSettingsKind;
  serviceNames: readonly ServiceNames[];
  isCurrent: (queueItem: Record<string, unknown>) => boolean;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

interface RouteRestoreDeferredContext {
  serviceName: ServiceNames;
  settingsKind: SyncRouteSettingsKind;
  routeId: string;
}

function routeRestoreDeferredContext(context: RouteRestoreDeferredContext): string {
  return JSON.stringify({
    serviceName: context.serviceName,
    settingsKind: context.settingsKind,
    routeId: context.routeId,
  });
}

function parseRouteRestoreDeferredContext(value: unknown): RouteRestoreDeferredContext | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as Partial<RouteRestoreDeferredContext>;
    if (
      typeof parsed.serviceName !== 'string'
      || (parsed.settingsKind !== 'activitySyncRoutes' && parsed.settingsKind !== 'routeDeliverySyncRoutes')
      || typeof parsed.routeId !== 'string'
      || !parsed.routeId.trim()
    ) return null;
    return parsed as RouteRestoreDeferredContext;
  } catch {
    return null;
  }
}

/**
 * Resolves the last route-disabled decision in the same transaction that
 * finalizes the queue row. Route restoration updates its settings and clears
 * `routeRestorePending` atomically, so a worker can neither combine an old
 * disabled setting with a recovered connection nor finalize while recovery is
 * still incomplete.
 */
export async function finalizeDisabledSyncRouteIfCurrent(
  params: FinalizeDisabledSyncRouteParams,
): Promise<DisabledSyncRouteTransition> {
  const queueItemRef = params.queueItem.ref;
  if (!queueItemRef) {
    throw new Error(`No document reference supplied for queue item ${params.queueItem.id}`);
  }

  const db = admin.firestore();
  const settingsRef = db.collection('users').doc(params.userID).collection('config').doc('settings');
  const uniqueServiceNames = Array.from(new Set(params.serviceNames));
  const metaRefs = uniqueServiceNames
    .map(serviceName => db.collection('users').doc(params.userID).collection('meta').doc(`${serviceName}`));

  return db.runTransaction(async transaction => {
    const deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, params.userID);
    if (deletionGuard.shouldSkip) {
      return { result: DisabledSyncRouteTransitionResult.SkippedDeletedUser };
    }

    const [queueSnapshot, settingsSnapshot, ...metaSnapshots] = await Promise.all([
      transaction.get(queueItemRef),
      transaction.get(settingsRef),
      ...metaRefs.map(ref => transaction.get(ref)),
    ]);
    const currentQueueItem = queueSnapshot.exists
      ? queueSnapshot.data() as Record<string, unknown>
      : null;
    if (!currentQueueItem || !params.isCurrent(currentQueueItem)) {
      return { result: DisabledSyncRouteTransitionResult.NotCurrent };
    }

    for (let index = 0; index < metaSnapshots.length; index += 1) {
      const meta = metaSnapshots[index].data();
      if (isDisconnectPendingServiceConnection(meta)) {
        return {
          result: DisabledSyncRouteTransitionResult.DisconnectPending,
          serviceName: uniqueServiceNames[index],
        };
      }
      if (isReconnectRequiredServiceConnection(meta)) {
        return {
          result: DisabledSyncRouteTransitionResult.ReconnectRequired,
          serviceName: uniqueServiceNames[index],
        };
      }
    }

    const settings = asRecord(settingsSnapshot.data());
    const serviceSyncSettings = asRecord(settings.serviceSyncSettings);
    const routeSettings = asRecord(asRecord(serviceSyncSettings[params.settingsKind])[params.routeId]);
    if (routeSettings.enabled === true) {
      return { result: DisabledSyncRouteTransitionResult.Enabled };
    }

    const routeRestoreServiceIndex = metaSnapshots.findIndex(
      snapshot => {
        const meta = asRecord(snapshot.data());
        return meta.routeRestorePending === true && meta.routeRestoreParkingClosed !== true;
      },
    );
    if (routeRestoreServiceIndex >= 0) {
      const routeRestoreServiceName = uniqueServiceNames[routeRestoreServiceIndex];
      transaction.update(queueItemRef, {
        // Keep restoration work outside the dispatcher's processed=false
        // query. The lifecycle repair path reopens it once settings and the
        // routeRestorePending marker are committed.
        processed: true,
        processedAt: Date.now(),
        resultStatus: 'deferred',
        skippedReason: FieldValue.delete(),
        deferredReason: QUEUE_DEFERRED_REASONS.RouteRestorePending,
        deferredContext: routeRestoreDeferredContext({
          serviceName: routeRestoreServiceName,
          settingsKind: params.settingsKind,
          routeId: params.routeId,
        }),
        dispatchedToCloudTask: null,
        providerOperationStartedAt: null,
        ...clearRevisionProcessingLeaseUpdate(),
      });
      return { result: DisabledSyncRouteTransitionResult.DeferredForRestore };
    }

    transaction.update(queueItemRef, {
      processed: true,
      processedAt: Date.now(),
      resultStatus: 'skipped',
      skippedReason: 'route_disabled',
      deferredReason: FieldValue.delete(),
      deferredContext: FieldValue.delete(),
      ...(params.settingsKind === 'activitySyncRoutes'
        ? { destinationUploadContinuation: null }
        : {}),
      ...clearRevisionProcessingLeaseUpdate(),
    });
    return { result: DisabledSyncRouteTransitionResult.ProcessedAsDisabled };
  });
}

/** Reopens queue rows parked while route settings were being restored. */
export async function releaseQueueItemsDeferredForRouteRestore(
  userID: string,
  serviceName: ServiceNames,
  expectedConnectionStateGeneration: string,
  expectedDisconnectLifecycleGuard?: ServiceDisconnectLifecycleGuard,
): Promise<number> {
  const db = admin.firestore();
  const metaRef = db.collection('users').doc(userID).collection('meta').doc(`${serviceName}`);
  const settingsRef = db.collection('users').doc(userID).collection('config').doc('settings');
  const queueSnapshots = await Promise.all([
    db.collection(ACTIVITY_SYNC_QUEUE_COLLECTION_NAME).where('userID', '==', userID).get(),
    db.collection(ROUTE_DELIVERY_SYNC_QUEUE_COLLECTION_NAME).where('userID', '==', userID).get(),
  ]);
  const candidates = queueSnapshots.flatMap(snapshot => snapshot.docs).filter(doc => {
    const data = doc.data();
    const context = parseRouteRestoreDeferredContext(data.deferredContext);
    return data.processed === true
      && data.resultStatus === 'deferred'
      && data.deferredReason === QUEUE_DEFERRED_REASONS.RouteRestorePending
      && context?.serviceName === serviceName;
  });

  const results = await Promise.all(candidates.map(doc => db.runTransaction(async transaction => {
    const deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, userID);
    if (deletionGuard.shouldSkip) return false;
    const [metaSnapshot, settingsSnapshot, queueSnapshot, tokenRootSnapshot] = await Promise.all([
      transaction.get(metaRef),
      transaction.get(settingsRef),
      transaction.get(doc.ref),
      expectedDisconnectLifecycleGuard
        ? transaction.get(getServiceTokenRootDocumentRef(userID, serviceName))
        : Promise.resolve(null),
    ]);
    const meta = asRecord(metaSnapshot.data());
    const queueData = asRecord(queueSnapshot.data());
    const context = parseRouteRestoreDeferredContext(queueData.deferredContext);
    if (
      meta.connectionStateGeneration !== expectedConnectionStateGeneration
      || meta.routeRestorePending !== true
      || meta.routeRestoreParkingClosed !== true
      || (expectedDisconnectLifecycleGuard && tokenRootSnapshot
        && !doesRootMatchServiceDisconnectLifecycleGuard(
          tokenRootSnapshot.exists
            ? tokenRootSnapshot.data() as Record<string, unknown>
            : null,
          expectedDisconnectLifecycleGuard,
        ))
      || !queueSnapshot.exists
      || queueData.processed !== true
      || queueData.resultStatus !== 'deferred'
      || queueData.deferredReason !== QUEUE_DEFERRED_REASONS.RouteRestorePending
      || context?.serviceName !== serviceName
    ) return false;

    const settings = asRecord(settingsSnapshot.data());
    const serviceSyncSettings = asRecord(settings.serviceSyncSettings);
    const routeSettings = asRecord(asRecord(serviceSyncSettings[context.settingsKind])[context.routeId]);
    if (routeSettings.enabled === true) {
      transaction.update(doc.ref, {
        processed: false,
        processedAt: FieldValue.delete(),
        resultStatus: FieldValue.delete(),
        deferredReason: FieldValue.delete(),
        deferredContext: FieldValue.delete(),
        dispatchedToCloudTask: null,
      });
    } else {
      transaction.update(doc.ref, {
        processed: true,
        processedAt: Date.now(),
        resultStatus: 'skipped',
        skippedReason: 'route_disabled',
        deferredReason: FieldValue.delete(),
        deferredContext: FieldValue.delete(),
        ...(context.settingsKind === 'activitySyncRoutes'
          ? { destinationUploadContinuation: null }
          : {}),
      });
    }
    return true;
  })));
  return results.filter(Boolean).length;
}
