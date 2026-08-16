import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';

import { getUserDeletionGuardStateInTransaction, UserDeletionGuardReadError } from '../shared/user-deletion-guard';

const DIRECT_UPLOAD_COUNT_IDEMPOTENCY_WINDOW = 100;

export interface SuccessfulActivityUploadCountContext {
  userID: string;
  serviceName: ServiceNames;
  uploadId: string;
  queueItemRef?: admin.firestore.DocumentReference;
}

/** Records a provider-confirmed activity upload exactly once for direct and queued flows. */
export async function recordSuccessfulActivityUpload(
  context: SuccessfulActivityUploadCountContext,
): Promise<boolean> {
  const db = admin.firestore();
  const metaRef = db.collection('users').doc(context.userID).collection('meta').doc(context.serviceName);

  return db.runTransaction(async (transaction) => {
    let deletionGuard;
    try {
      deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, context.userID);
    } catch (error) {
      throw new UserDeletionGuardReadError(context.userID, 'activity_upload_count', error);
    }
    if (deletionGuard.shouldSkip) {
      logger.warn('[ActivityUploadCount] Skipping count because the user is missing or being deleted.', {
        userID: context.userID,
        serviceName: context.serviceName,
      });
      return false;
    }

    const metaUpdate: Record<string, unknown> = {
      uploadedActivitiesCount: FieldValue.increment(1),
    };

    if (context.queueItemRef) {
      const queueSnapshot = await transaction.get(context.queueItemRef);
      const queueData = queueSnapshot.data() as Record<string, unknown> | undefined;
      if (!queueSnapshot.exists || `${queueData?.destinationUploadID || ''}` !== context.uploadId) {
        return false;
      }
      const countedUploadId = `${queueData?.destinationUploadCountedID || ''}`.trim();
      if (countedUploadId === context.uploadId) {
        return false;
      }
      if (countedUploadId) {
        logger.error('[ActivityUploadCount] Queue item already counted a different provider operation.', {
          userID: context.userID,
          serviceName: context.serviceName,
          queueItemId: context.queueItemRef.id,
        });
        return false;
      }
      transaction.update(context.queueItemRef, {
        destinationUploadCountedID: context.uploadId,
        destinationUploadCountedAt: Date.now(),
      });
    } else {
      const metaSnapshot = await transaction.get(metaRef);
      const recentUploadIds = Array.isArray(metaSnapshot.data()?.recentDirectActivityUploadCountedIDs)
        ? metaSnapshot.data()?.recentDirectActivityUploadCountedIDs
          .filter((value: unknown): value is string => typeof value === 'string' && value.length > 0)
        : [];
      if (recentUploadIds.includes(context.uploadId)) {
        return false;
      }
      metaUpdate.recentDirectActivityUploadCountedIDs = [
        ...recentUploadIds.filter((uploadId: string) => uploadId !== context.uploadId),
        context.uploadId,
      ].slice(-DIRECT_UPLOAD_COUNT_IDEMPOTENCY_WINDOW);
    }

    transaction.set(metaRef, metaUpdate, { merge: true });
    return true;
  });
}
