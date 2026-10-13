import * as admin from 'firebase-admin';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { getSuuntoProviderUserIdFromTokenLike, getSuuntoRouteImportSourceKeyFromTokenLike, type SuuntoRouteImportStateEntry } from '../../../shared/suunto-route-import-state';
import { withHistoryExecution } from '../connection-history/context';
import { HistoryLifecycleChangedError, HistoryUnavailableError, type HistoryExecution } from '../connection-history/execution';
import { enqueueRouteSyncQueueItem } from '../routes/route-sync-queue';
import { listSuuntoRoutes, type SuuntoRouteUploadContext } from './routes';

export const SUUNTO_ROUTE_HISTORY_BATCH_SIZE = 100;
const MAX_ROUTE_LIBRARY_ITEMS = 10_000;

/** Reuses the account-scoped route listing and canonical queue/import worker. */
export async function queueSuuntoRouteHistory(
  userID: string,
  execution: HistoryExecution,
  afterRouteId?: string,
  countOffset = 0,
): Promise<{ count: number; hasMore: boolean; afterRouteId?: string }> {
  return withHistoryExecution(execution, () => queueSelectedSuuntoRouteHistory(userID, execution, afterRouteId, countOffset));
}

async function queueSelectedSuuntoRouteHistory(userID: string, execution: HistoryExecution, afterRouteId?: string, countOffset = 0) {
  if (execution.userID !== userID || execution.serviceName !== ServiceNames.SuuntoApp) throw new HistoryLifecycleChangedError();
  await execution.beforeRequest();
  const db = admin.firestore();
  const token = await db.doc(execution.tokenPath).get();
  if (!token.exists || getSuuntoProviderUserIdFromTokenLike(token.data()) !== execution.providerUserId) {
    throw new HistoryLifecycleChangedError();
  }
  const sourceKey = getSuuntoRouteImportSourceKeyFromTokenLike(token.data()) || `${execution.providerUserId}:unknown-created`;
  const context: SuuntoRouteUploadContext = {
    tokenRefs: [{ id: token.id, ref: token.ref, providerUserId: execution.providerUserId, sourceKey }],
    userNames: [execution.providerUserId],
  };
  let listing: Awaited<ReturnType<typeof listSuuntoRoutes>>;
  try {
    listing = await listSuuntoRoutes(userID, context, { timeout: 30_000, maxResponseBytes: 4 * 1024 * 1024, requireCompleteListing: true });
  } catch (error) {
    if (error instanceof Error && error.name === 'ResponseBodyTooLargeError') {
      throw new HistoryUnavailableError('The Suunto route library exceeds the supported connection-import size. Use Import existing routes.');
    }
    throw error;
  }
  await execution.beforeRequest();
  if (listing.failedProviderSourceKeys.length || !listing.successfulProviderSourceKeys.includes(sourceKey)) {
    throw new Error('The selected Suunto route library could not be read completely.');
  }
  if (listing.routes.length > MAX_ROUTE_LIBRARY_ITEMS) {
    throw new HistoryUnavailableError('The Suunto route library exceeds the supported connection-import size. Use Import existing routes.');
  }
  if (listing.routes.some(route => route.providerUserId !== execution.providerUserId
    || route.providerSourceKey !== sourceKey || !route.id || route.id.length > 512)) {
    throw new Error('The selected Suunto route library has invalid source data.');
  }
  // Keyset paging keeps earlier removals and arbitrary provider response order
  // from moving the next batch. New/updated routes still have their normal webhook.
  const remaining = listing.routes.filter(route => afterRouteId === undefined || route.id > afterRouteId)
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const batch = remaining.slice(0, SUUNTO_ROUTE_HISTORY_BATCH_SIZE);
  for (const route of batch) {
    await enqueueRouteSyncQueueItem({ sourceServiceName: ServiceNames.SuuntoApp,
      providerUserId: route.providerUserId, providerRouteId: route.id,
      providerRouteName: route.description || null, providerRouteCreatedAt: route.created ?? null,
      providerRouteModifiedAt: route.modified ?? null, manual: true, firebaseUserID: userID });
  }
  const hasMore = remaining.length > batch.length;
  if (!hasMore) {
    // Match manual catch-up's admission marker, not a claim of route persistence.
    // Preserve other connected-account markers and fence this post-request write.
    const metaRef = db.doc(`users/${userID}/meta/${ServiceNames.SuuntoApp}`);
    await db.runTransaction(async transaction => {
      const meta = (await transaction.get(metaRef)).data();
      await execution.inTransaction(transaction);
      const previous = Array.isArray(meta?.routeImportStatesByProviderSourceKey)
        ? meta.routeImportStatesByProviderSourceKey as SuuntoRouteImportStateEntry[] : [];
      const completedAt = Date.now();
      transaction.set(metaRef, { routeImportStatesByProviderSourceKey: [
        ...previous.filter(state => state.sourceKey !== sourceKey),
        { sourceKey, providerUserId: execution.providerUserId, didLastRouteImport: completedAt,
          updatedAt: completedAt, queuedCount: countOffset + batch.length, skippedCount: 0,
          failureCount: 0, totalCount: listing.routes.length },
      ] }, { merge: true });
    });
  }
  const lastId = batch[batch.length - 1]?.id ?? afterRouteId;
  return { count: batch.length, hasMore, ...(lastId === undefined ? {} : { afterRouteId: lastId }) };
}
