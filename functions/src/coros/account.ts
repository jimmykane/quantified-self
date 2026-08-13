import * as admin from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';
import { ServiceNames } from '@sports-alliance/sports-lib';

import { getServiceConnectionMeta, setServiceConnectionProviderUserId } from '../service-connection-meta';
import { COROSAPI_ACCESS_TOKENS_COLLECTION_NAME } from './constants';

type COROSTokenSnapshot = admin.firestore.QueryDocumentSnapshot | admin.firestore.DocumentSnapshot;

function finiteTimestamp(value: unknown): number {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function tokenSortValue(snapshot: COROSTokenSnapshot): [number, number, string] {
  const data = snapshot.data() as Record<string, unknown> | undefined;
  return [
    finiteTimestamp(data?.dateRefreshed),
    finiteTimestamp(data?.dateCreated),
    snapshot.id,
  ];
}

/** Selects one legacy COROS connection deterministically when metadata was not pinned yet. */
export function selectActiveCOROSTokenSnapshot<T extends COROSTokenSnapshot>(snapshots: T[]): T | null {
  return [...snapshots].sort((left, right) => {
    const leftValue = tokenSortValue(left);
    const rightValue = tokenSortValue(right);
    return rightValue[0] - leftValue[0]
      || rightValue[1] - leftValue[1]
      || rightValue[2].localeCompare(leftValue[2]);
  })[0] || null;
}

function snapshotMatchesOpenId(snapshot: COROSTokenSnapshot, openId: string): boolean {
  const tokenOpenId = `${(snapshot.data() as Record<string, unknown> | undefined)?.openId || ''}`.trim();
  return snapshot.id === openId && (!tokenOpenId || tokenOpenId === openId);
}

/**
 * Resolves the single active COROS account. Once pinned, a missing token fails
 * closed instead of silently delivering to another connected account.
 */
export async function getActiveCOROSTokenSnapshot(userID: string): Promise<COROSTokenSnapshot> {
  const tokenCollection = admin.firestore()
    .collection(COROSAPI_ACCESS_TOKENS_COLLECTION_NAME)
    .doc(userID)
    .collection('tokens');
  const connectionMeta = await getServiceConnectionMeta(userID, ServiceNames.COROSAPI);
  const pinnedOpenId = `${connectionMeta?.providerUserId || ''}`.trim();

  if (pinnedOpenId) {
    const pinnedSnapshot = await tokenCollection.doc(pinnedOpenId).get();
    if (!pinnedSnapshot.exists || !snapshotMatchesOpenId(pinnedSnapshot, pinnedOpenId)) {
      throw new HttpsError('unauthenticated', 'Reconnect COROS before sending data.');
    }
    return pinnedSnapshot;
  }

  const tokenSnapshots = await tokenCollection.get();
  const selectedSnapshot = selectActiveCOROSTokenSnapshot(tokenSnapshots.docs);
  if (!selectedSnapshot) {
    throw new HttpsError('unauthenticated', 'Connect COROS before sending data.');
  }

  const selectedOpenId = `${(selectedSnapshot.data() as Record<string, unknown> | undefined)?.openId || selectedSnapshot.id}`.trim();
  if (!selectedOpenId || !snapshotMatchesOpenId(selectedSnapshot, selectedOpenId)) {
    throw new HttpsError('unauthenticated', 'Reconnect COROS before sending data.');
  }

  const didPinAccount = await setServiceConnectionProviderUserId(userID, ServiceNames.COROSAPI, selectedOpenId);
  if (!didPinAccount) {
    throw new HttpsError('failed-precondition', 'Account is being deleted or no longer exists.');
  }
  return selectedSnapshot;
}
