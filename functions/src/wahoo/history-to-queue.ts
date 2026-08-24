import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import * as crypto from 'crypto';
import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { ServiceNames, WahooAPIAuth2ServiceTokenInterface } from '@sports-alliance/sports-lib';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { getNextAllowedHistoryImportDate, HistoryImportResult } from '../history';
import { isServiceDisconnectPendingForUser } from '../service-disconnect-pending';
import {
  getUserDeletionGuardState,
  getUserDeletionGuardStateInTransaction,
  UserDeletionGuardReadError,
} from '../shared/user-deletion-guard';
import { getTokenData } from '../tokens';
import { ALLOWED_CORS_ORIGINS, enforceAppCheck, generateIDFromParts, hasProAccess, PRO_REQUIRED_MESSAGE } from '../utils';
import { requestWahooAPI, WahooAPIRequestError } from './auth/api';
import { SERVICE_NAME } from './constants';
import { upsertWahooWorkoutQueueItem } from './queue-store';
import { parseWahooWorkout } from './workout-payload';
import { ParsedWahooWorkout } from './workout-payload';
import { getWahooErrorLogDetails } from './error-details';
import { FUNCTION_SECRET_BINDINGS } from '../secrets';
import {
  assertWahooActiveAccountGuardCurrent,
  assertWahooActiveAccountGuardCurrentInTransaction,
  captureWahooActiveAccountGuard,
  getActiveWahooTokenSnapshot,
  normalizeWahooUserID,
  type WahooActiveAccountGuard,
} from './account';
import {
  assertWahooConnectionAvailable,
  isWahooRefreshContentionError,
  isWahooReconnectRequiredError,
  isWahooRefreshBackoffError,
} from './refresh-recovery';
import { isTerminalServiceAuthError } from '../shared/provider-operation-error';

const PAGE_SIZE = 100;
const HISTORY_LEASE_MS = 15 * 60 * 1000;

interface HistoryToQueueRequest {
  startDate: string;
  endDate: string;
}

interface WahooWorkoutsResponse {
  workouts?: unknown[];
  total?: number;
  page?: number;
  per_page?: number;
}

export interface WahooHistoryImportResult extends HistoryImportResult {
  skippedCount: number;
  pagesFetched: number;
}

export function toWahooHistoryCallableError(error: unknown): HttpsError | null {
  if (isWahooReconnectRequiredError(error) || isTerminalServiceAuthError(error)) {
    return new HttpsError('unauthenticated', 'Reconnect Wahoo before importing history.');
  }
  if (isWahooRefreshBackoffError(error)) {
    return new HttpsError(
      'unavailable',
      'Wahoo token refresh is temporarily paused. Please retry later.',
      { retryAt: error.retryAt },
    );
  }
  if (isWahooRefreshContentionError(error)) {
    return new HttpsError('unavailable', 'Wahoo credentials are being refreshed. Please retry shortly.');
  }
  return null;
}

/** Recheck mutable lifecycle state immediately before each Wahoo history page. */
async function assertWahooHistoryProviderActionAllowed(userID: string): Promise<void> {
  const deletionGuard = await getUserDeletionGuardState(admin.firestore(), userID);
  if (deletionGuard.shouldSkip) {
    throw new HttpsError('failed-precondition', 'Account deletion is in progress.');
  }
  if (await isServiceDisconnectPendingForUser(userID, SERVICE_NAME)) {
    throw new HttpsError('failed-precondition', 'Wahoo disconnect is pending.');
  }
  await assertWahooConnectionAvailable(userID);
}

export function selectWahooHistoryPage(
  wahooUserID: string,
  workouts: unknown[],
  startDate: Date,
  endDate: Date,
): { items: ParsedWahooWorkout[]; skippedCount: number; reachedStart: boolean } {
  const items: ParsedWahooWorkout[] = [];
  let skippedCount = 0;
  let reachedStart = false;
  for (const workout of workouts) {
    const startsValue = workout && typeof workout === 'object'
      ? (workout as Record<string, unknown>).starts
      : undefined;
    const startsMs = typeof startsValue === 'string' ? Date.parse(startsValue) : Number.NaN;
    if (!Number.isFinite(startsMs)) {
      skippedCount++;
      continue;
    }
    if (startsMs < startDate.getTime()) {
      reachedStart = true;
      break;
    }
    if (startsMs > endDate.getTime()) continue;
    const parsed = parseWahooWorkout(wahooUserID, workout);
    if (!parsed) {
      skippedCount++;
      continue;
    }
    items.push(parsed);
  }
  return { items, skippedCount, reachedStart };
}

async function acquireHistoryLease(userID: string, leaseOwner: string): Promise<void> {
  const db = admin.firestore();
  const metaRef = db.collection('users').doc(userID).collection('meta').doc(SERVICE_NAME);
  const now = Date.now();
  await db.runTransaction(async (transaction) => {
    let deletionGuard;
    try {
      deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, userID, now);
    } catch (error) {
      throw new UserDeletionGuardReadError(userID, 'wahoo_history_lease', error);
    }
    if (deletionGuard.shouldSkip) {
      throw new HttpsError('failed-precondition', 'Account deletion is in progress.');
    }
    const meta = await transaction.get(metaRef);
    const currentOwner = `${meta.data()?.historyImportLeaseOwner || ''}`;
    const currentExpiry = Number(meta.data()?.historyImportLeaseExpiresAt || 0);
    if (currentOwner && currentOwner !== leaseOwner && currentExpiry > now) {
      throw new HttpsError('already-exists', 'A Wahoo history import is already running.');
    }
    transaction.set(metaRef, {
      historyImportLeaseOwner: leaseOwner,
      historyImportLeaseExpiresAt: now + HISTORY_LEASE_MS,
    }, { merge: true });
  });
}

export async function finishWahooHistoryLease(
  userID: string,
  leaseOwner: string,
  startDate: Date,
  endDate: Date,
  processedCount: number,
  completed: boolean,
  accountGuard?: WahooActiveAccountGuard | null,
): Promise<void> {
  const db = admin.firestore();
  const metaRef = db.collection('users').doc(userID).collection('meta').doc(SERVICE_NAME);
  await db.runTransaction(async (transaction) => {
    let deletionGuard;
    try {
      deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, userID);
    } catch (error) {
      throw new UserDeletionGuardReadError(userID, 'wahoo_history_finish', error);
    }
    if (deletionGuard.shouldSkip) return;

    const snapshot = await transaction.get(metaRef);
    if (`${snapshot.data()?.historyImportLeaseOwner || ''}` !== leaseOwner) return;
    let accountIsCurrent = true;
    if (accountGuard) {
      try {
        await assertWahooActiveAccountGuardCurrentInTransaction(
          transaction,
          userID,
          accountGuard,
        );
      } catch {
        accountIsCurrent = false;
      }
    }
    const update: Record<string, unknown> = {
      historyImportLeaseOwner: FieldValue.delete(),
      historyImportLeaseExpiresAt: FieldValue.delete(),
    };
    if (completed && accountIsCurrent) {
      update.didLastHistoryImport = Date.now();
      update.lastHistoryImportStartDate = startDate.getTime();
      update.lastHistoryImportEndDate = endDate.getTime();
      update.processedActivitiesFromLastHistoryImportCount = processedCount;
    }
    transaction.set(metaRef, update, { merge: true });
  });
}

export async function importWahooHistory(
  userID: string,
  startDate: Date,
  endDate: Date,
): Promise<WahooHistoryImportResult> {
  if (await isServiceDisconnectPendingForUser(userID, SERVICE_NAME)) {
    throw new HttpsError('failed-precondition', 'Wahoo disconnect is pending.');
  }
  const leaseOwner = crypto.randomUUID();
  await acquireHistoryLease(userID, leaseOwner);
  const stats: WahooHistoryImportResult = {
    successCount: 0,
    failureCount: 0,
    processedBatches: 0,
    failedBatches: 0,
    skippedCount: 0,
    pagesFetched: 0,
  };
  let completed = false;
  let historyAccountGuard: WahooActiveAccountGuard | null = null;
  try {
    const initialTokenSnapshot = await getActiveWahooTokenSnapshot(userID);
    const providerUserId = initialTokenSnapshot.id;
    {
      let page = 1;
      let reachedStart = false;
      while (!reachedStart) {
        // Wahoo rotates refresh tokens and limits unrevoked tokens. Re-read and refresh
        // immediately before the API request so this call always uses the newest token.
        const currentTokenSnapshot = await getActiveWahooTokenSnapshot(userID, providerUserId);
        const token = await getTokenData(currentTokenSnapshot, ServiceNames.WahooAPI, false) as WahooAPIAuth2ServiceTokenInterface;
        if (normalizeWahooUserID(token.wahooUserID) !== providerUserId) {
          throw new HttpsError('unauthenticated', 'Reconnect Wahoo before importing history.');
        }
        const pageAccountGuard = await captureWahooActiveAccountGuard(userID, providerUserId);
        historyAccountGuard = pageAccountGuard;
        const providerRequestGuard = await captureWahooActiveAccountGuard(
          userID,
          providerUserId,
          token.accessToken,
        );
        await assertWahooHistoryProviderActionAllowed(userID);
        await assertWahooActiveAccountGuardCurrent(userID, providerRequestGuard);
        let response: WahooWorkoutsResponse;
        try {
          response = (await requestWahooAPI<WahooWorkoutsResponse>(
            token.accessToken,
            `/v1/workouts?page=${page}&per_page=${PAGE_SIZE}`,
          )).data;
        } catch (error) {
          if (error instanceof WahooAPIRequestError && error.statusCode === 429) {
            throw new HttpsError('resource-exhausted', 'Wahoo rate limit reached. Try again after the reset window.', {
              retryAfterSeconds: error.resetAfterSeconds,
            });
          }
          throw error;
        }
        await assertWahooActiveAccountGuardCurrent(userID, pageAccountGuard);
        stats.pagesFetched++;
        const workouts = Array.isArray(response.workouts) ? response.workouts : [];
        const selectedPage = selectWahooHistoryPage(token.wahooUserID, workouts, startDate, endDate);
        stats.skippedCount += selectedPage.skippedCount;
        reachedStart = selectedPage.reachedStart;
        for (const parsed of selectedPage.items) {
          const id = await generateIDFromParts([parsed.wahooUserID, parsed.workoutID]);
          try {
            const queued = await upsertWahooWorkoutQueueItem({
              ...parsed,
              id,
              firebaseUserID: userID,
              fromHistory: true,
            }, 'deferred', async transaction => {
              await assertWahooActiveAccountGuardCurrentInTransaction(
                transaction,
                userID,
                pageAccountGuard,
              );
            });
            if (queued.queued) stats.successCount++;
            else stats.skippedCount++;
          } catch (error) {
            // A queue transaction can lose the account generation after the
            // page-level check. Do not reduce that lifecycle fence to an
            // ordinary per-item failure and continue through the old page.
            await assertWahooActiveAccountGuardCurrent(userID, pageAccountGuard);
            stats.failureCount++;
            logger.error('Could not queue a Wahoo history item', {
              userID,
              workoutID: parsed.workoutID,
              error: getWahooErrorLogDetails(error),
            });
          }
        }
        stats.processedBatches++;
        const total = Number(response.total || 0);
        const isLastPage = workouts.length < PAGE_SIZE || (total > 0 && page * PAGE_SIZE >= total);
        if (isLastPage) break;
        page++;
      }
    }
    completed = true;
    return stats;
  } finally {
    await finishWahooHistoryLease(
      userID,
      leaseOwner,
      startDate,
      endDate,
      stats.successCount,
      completed,
      historyAccountGuard,
    );
  }
}

export const addWahooAPIHistoryToQueue = onCall({
  region: FUNCTIONS_MANIFEST.addWahooAPIHistoryToQueue.region,
  secrets: FUNCTION_SECRET_BINDINGS.addWahooAPIHistoryToQueue,
  cors: ALLOWED_CORS_ORIGINS,
  memory: '512MiB',
  timeoutSeconds: 540,
  maxInstances: 10,
}, async (request): Promise<{ result: string; stats: WahooHistoryImportResult }> => {
  enforceAppCheck(request);
  if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated.');
  if (!(await hasProAccess(request.auth.uid))) throw new HttpsError('permission-denied', PRO_REQUIRED_MESSAGE);
  const { startDate: startValue, endDate: endValue } = request.data as HistoryToQueueRequest;
  const startDate = new Date(startValue);
  const endDate = new Date(endValue);
  if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime())) {
    throw new HttpsError('invalid-argument', 'No valid start and/or end date was provided.');
  }
  if (startDate > endDate) throw new HttpsError('invalid-argument', 'Start date is after the end date.');
  const nextAllowedDate = await getNextAllowedHistoryImportDate(request.auth.uid, SERVICE_NAME);
  if (nextAllowedDate && nextAllowedDate > new Date()) {
    throw new HttpsError('permission-denied', `History import is not allowed until ${nextAllowedDate.toISOString()}`);
  }
  let stats: WahooHistoryImportResult;
  try {
    stats = await importWahooHistory(request.auth.uid, startDate, endDate);
  } catch (error) {
    const callableError = toWahooHistoryCallableError(error);
    if (callableError) throw callableError;
    throw error;
  }
  return { result: 'Wahoo history items added to queue', stats };
});
