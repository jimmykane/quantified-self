import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { ServiceNames } from '@sports-alliance/sports-lib';

import {
  isDisconnectPendingServiceConnection,
  isReconnectRequiredServiceConnection,
} from '../../../shared/service-connection';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import { clearRevisionProcessingLeaseUpdate } from './revision-processing-lease';
import type { QueueItemInterface } from './queue-item.interface';

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

    const routeRestorePending = metaSnapshots.some(snapshot => asRecord(snapshot.data()).routeRestorePending === true);
    if (routeRestorePending) {
      transaction.update(queueItemRef, {
        processed: false,
        processedAt: FieldValue.delete(),
        resultStatus: 'deferred',
        skippedReason: FieldValue.delete(),
        deferredReason: 'route_restore_pending',
        deferredContext: `${params.settingsKind}:${params.routeId}`,
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
