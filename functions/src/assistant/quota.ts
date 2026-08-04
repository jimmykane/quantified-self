import { randomUUID } from 'node:crypto';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { HttpsError } from 'firebase-functions/v2/https';
import type {
  AssistantQuotaPeriodKind,
  AssistantQuotaResetMode,
  AssistantQuotaStatus,
} from '../../../shared/assistant.types';
import { getAssistantRequestLimitForRole } from '../../../shared/limits';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import { getUserRoleAndGracePeriod, isGracePeriodActive } from '../utils';

// Preserve the deployed storage key so replacing AI Insights with the Assistant
// does not reset an account's current-period request count.
const ASSISTANT_USAGE_COLLECTION = 'aiInsightsUsage';
const ASSISTANT_USAGE_DOC_VERSION = 2;
const ASSISTANT_RESERVATION_TTL_MS = 10 * 60 * 1000;

export const ASSISTANT_LIMIT_REACHED_MESSAGE = 'Assistant limit reached for this billing period.';

interface SubscriptionPeriod {
  role: 'basic' | 'pro';
  startDate: string;
  endDate: string;
}

interface CalendarMonthPeriod {
  startDate: string;
  endDate: string;
}

interface AssistantQuotaUsageDoc {
  version: number;
  role: 'free' | 'basic' | 'pro';
  limit: number;
  periodStart: string;
  periodEnd: string;
  periodKind: AssistantQuotaPeriodKind;
  successfulRequestCount: number;
  reservationMap: Record<string, number>;
  lastSuccessfulRequestAt?: string;
}

interface ResolvedAssistantQuotaWindow {
  status: Omit<AssistantQuotaStatus, 'successfulRequestCount' | 'activeRequestCount' | 'remainingCount' | 'blockedReason'>;
  periodDocId: string | null;
}

export interface AssistantQuotaReservation {
  userID: string;
  reservationID: string;
  periodDocId: string;
  role: 'free' | 'basic' | 'pro';
  limit: number;
  periodStart: string;
  periodEnd: string;
  periodKind: AssistantQuotaPeriodKind;
  resetMode: AssistantQuotaResetMode;
  isEligible: boolean;
}

export interface AssistantUserRoleContext {
  role: string;
  gracePeriodUntil?: number;
}

export interface AssistantQuotaDependencies {
  now: () => Date;
  createReservationId: () => string;
  db: () => FirebaseFirestore.Firestore;
  getUserRoleAndGracePeriod: typeof getUserRoleAndGracePeriod;
  isGracePeriodActive: typeof isGracePeriodActive;
  getActiveSubscriptionPeriod: (userID: string) => Promise<SubscriptionPeriod | null>;
  getLatestPaidSubscriptionPeriod: (userID: string) => Promise<SubscriptionPeriod | null>;
  getDeletionGuard: typeof getUserDeletionGuardStateInTransaction;
}

export interface AssistantQuotaApi {
  getAssistantQuotaStatus: (
    userID: string,
    userRoleContext?: AssistantUserRoleContext,
  ) => Promise<AssistantQuotaStatus>;
  reserveAssistantQuotaForRequest: (
    userID: string,
    userRoleContext?: AssistantUserRoleContext,
  ) => Promise<AssistantQuotaReservation>;
  finalizeAssistantQuotaReservation: (
    reservation: AssistantQuotaReservation,
  ) => Promise<AssistantQuotaStatus>;
  releaseAssistantQuotaReservation: (
    reservation: AssistantQuotaReservation,
  ) => Promise<AssistantQuotaStatus>;
}

const defaultAssistantQuotaDependencies: AssistantQuotaDependencies = {
  now: () => new Date(),
  createReservationId: () => randomUUID(),
  db: () => admin.firestore(),
  getUserRoleAndGracePeriod,
  isGracePeriodActive,
  getActiveSubscriptionPeriod: async (userID) => getActiveSubscriptionPeriodFromFirestore(userID),
  getLatestPaidSubscriptionPeriod: async (userID) => getLatestPaidSubscriptionPeriodFromFirestore(userID),
  getDeletionGuard: getUserDeletionGuardStateInTransaction,
};

function toDate(value: unknown): Date | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  if (value && typeof value === 'object') {
    const timestampLike = value as {
      toDate?: () => Date;
      seconds?: number;
      nanoseconds?: number;
    };

    if (typeof timestampLike.toDate === 'function') {
      const date = timestampLike.toDate();
      return Number.isFinite(date.getTime()) ? date : null;
    }

    if (typeof timestampLike.seconds === 'number') {
      const date = new Date((timestampLike.seconds * 1000) + Math.floor((timestampLike.nanoseconds || 0) / 1_000_000));
      return Number.isFinite(date.getTime()) ? date : null;
    }
  }

  return null;
}

function resolvePaidSubscriptionRole(value: unknown): 'basic' | 'pro' | null {
  return value === 'basic' || value === 'pro' ? value : null;
}

function selectPreferredActiveSubscriptionPeriod(
  periods: SubscriptionPeriod[],
): SubscriptionPeriod | null {
  if (!periods.length) {
    return null;
  }

  return periods.slice().sort((left, right) => {
    if (left.role !== right.role) {
      return left.role === 'pro' ? -1 : 1;
    }

    return Date.parse(right.endDate) - Date.parse(left.endDate);
  })[0] ?? null;
}

function selectLatestPaidSubscriptionPeriod(
  periods: SubscriptionPeriod[],
): SubscriptionPeriod | null {
  if (!periods.length) {
    return null;
  }

  return periods.slice().sort((left, right) => {
    const endDifference = Date.parse(right.endDate) - Date.parse(left.endDate);
    if (endDifference !== 0) {
      return endDifference;
    }

    if (left.role !== right.role) {
      return left.role === 'pro' ? -1 : 1;
    }

    return Date.parse(right.startDate) - Date.parse(left.startDate);
  })[0] ?? null;
}

async function getActiveSubscriptionPeriodFromFirestore(userID: string): Promise<SubscriptionPeriod | null> {
  const snapshot = await admin.firestore()
    .collection('customers')
    .doc(userID)
    .collection('subscriptions')
    .where('status', 'in', ['active', 'trialing'])
    .orderBy('created', 'desc')
    .limit(10)
    .get();

  const periods: SubscriptionPeriod[] = [];
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const role = resolvePaidSubscriptionRole(data.role);
    if (!role) {
      continue;
    }

    const startDate = toDate(data.current_period_start);
    const endDate = toDate(data.current_period_end);
    if (startDate && endDate) {
      periods.push({
        role,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      });
    }
  }

  return selectPreferredActiveSubscriptionPeriod(periods);
}

async function getLatestPaidSubscriptionPeriodFromFirestore(userID: string): Promise<SubscriptionPeriod | null> {
  const snapshot = await admin.firestore()
    .collection('customers')
    .doc(userID)
    .collection('subscriptions')
    .orderBy('current_period_end', 'desc')
    .limit(20)
    .get();

  const periods: SubscriptionPeriod[] = [];
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const role = resolvePaidSubscriptionRole(data.role);
    if (!role) {
      continue;
    }

    const startDate = toDate(data.current_period_start);
    const endDate = toDate(data.current_period_end);
    if (startDate && endDate) {
      periods.push({
        role,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      });
    }
  }

  return selectLatestPaidSubscriptionPeriod(periods);
}

function buildUsageDocId(periodStart: string, periodEnd: string): string {
  return `period_${Date.parse(periodStart)}_${Date.parse(periodEnd)}`;
}

function buildCalendarMonthPeriod(now: Date): CalendarMonthPeriod {
  return {
    startDate: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(),
    endDate: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(),
  };
}

function getUsageDocRef(
  db: FirebaseFirestore.Firestore,
  userID: string,
  periodDocId: string,
): FirebaseFirestore.DocumentReference {
  return db
    .collection('users')
    .doc(userID)
    .collection(ASSISTANT_USAGE_COLLECTION)
    .doc(periodDocId);
}

function normalizeReservationMap(
  value: unknown,
  nowMs: number,
): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const reservationMap = value as Record<string, unknown>;
  const normalized: Record<string, number> = {};
  for (const [reservationID, expiresAt] of Object.entries(reservationMap)) {
    if (typeof expiresAt === 'number' && Number.isFinite(expiresAt) && expiresAt > nowMs) {
      normalized[reservationID] = expiresAt;
    }
  }

  return normalized;
}

export function normalizeUsageDocRole(
  value: unknown,
): 'free' | 'basic' | 'pro' {
  if (value === 'free' || value === 'basic' || value === 'pro') {
    return value;
  }

  return 'free';
}

function normalizeUsageDoc(
  snapshot: FirebaseFirestore.DocumentSnapshot,
  nowMs: number,
): AssistantQuotaUsageDoc {
  const data = snapshot.data() as Record<string, unknown> | undefined;
  const successfulRequestCount = typeof data?.successfulRequestCount === 'number'
    && Number.isFinite(data.successfulRequestCount)
    ? Math.max(0, Math.floor(data.successfulRequestCount))
    : 0;

  return {
    version: ASSISTANT_USAGE_DOC_VERSION,
    role: normalizeUsageDocRole(data?.role),
    limit: typeof data?.limit === 'number' && Number.isFinite(data.limit)
      ? Math.max(0, Math.floor(data.limit))
      : 0,
    periodStart: typeof data?.periodStart === 'string' ? data.periodStart : '',
    periodEnd: typeof data?.periodEnd === 'string' ? data.periodEnd : '',
    periodKind: data?.periodKind === 'subscription' || data?.periodKind === 'grace_hold' || data?.periodKind === 'calendar_month' || data?.periodKind === 'no_billing_period'
      ? data.periodKind
      : 'subscription',
    successfulRequestCount,
    reservationMap: normalizeReservationMap(data?.reservationMap, nowMs),
    lastSuccessfulRequestAt: typeof data?.lastSuccessfulRequestAt === 'string'
      ? data.lastSuccessfulRequestAt
      : undefined,
  };
}

function buildQuotaStatus(
  baseStatus: ResolvedAssistantQuotaWindow['status'],
  successfulRequestCount: number,
  activeRequestCount: number,
): AssistantQuotaStatus {
  const remainingCount = baseStatus.isEligible
    ? Math.max(0, baseStatus.limit - successfulRequestCount - activeRequestCount)
    : 0;

  return {
    ...baseStatus,
    successfulRequestCount,
    activeRequestCount,
    remainingCount,
    blockedReason: !baseStatus.isEligible
      ? 'requires_pro'
      : remainingCount <= 0
        ? 'limit_reached'
        : null,
  };
}

function buildUsageDocPayload(
  baseStatus: ResolvedAssistantQuotaWindow['status'],
  successfulRequestCount: number,
  reservationMap: Record<string, number>,
  dependencies: AssistantQuotaDependencies,
  lastSuccessfulRequestAt?: string,
): FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData> {
  const updatedAt = dependencies.now().toISOString();

  return {
    version: ASSISTANT_USAGE_DOC_VERSION,
    role: baseStatus.role,
    limit: baseStatus.limit,
    periodStart: baseStatus.periodStart,
    periodEnd: baseStatus.periodEnd,
    periodKind: baseStatus.periodKind,
    successfulRequestCount,
    reservationMap,
    ...(lastSuccessfulRequestAt ? { lastSuccessfulRequestAt } : {}),
    updatedAt,
  };
}

async function resolveAssistantQuotaWindow(
  userID: string,
  dependencies: AssistantQuotaDependencies,
  userRoleContext?: AssistantUserRoleContext,
): Promise<ResolvedAssistantQuotaWindow> {
  const { role, gracePeriodUntil } = userRoleContext
    ?? await dependencies.getUserRoleAndGracePeriod(userID);
  const hasGrace = dependencies.isGracePeriodActive(gracePeriodUntil);
  const currentPaidRole = resolvePaidSubscriptionRole(role);

  const activePeriod = await dependencies.getActiveSubscriptionPeriod(userID);
  if (activePeriod) {
    return {
      status: {
        role: activePeriod.role,
        limit: getAssistantRequestLimitForRole(activePeriod.role),
        periodStart: activePeriod.startDate,
        periodEnd: activePeriod.endDate,
        periodKind: 'subscription',
        resetMode: 'date',
        isEligible: true,
      },
      periodDocId: buildUsageDocId(activePeriod.startDate, activePeriod.endDate),
    };
  }

  if (hasGrace) {
    const latestPaidPeriod = await dependencies.getLatestPaidSubscriptionPeriod(userID);
    if (latestPaidPeriod) {
      return {
        status: {
          role: latestPaidPeriod.role,
          limit: getAssistantRequestLimitForRole(latestPaidPeriod.role),
          periodStart: latestPaidPeriod.startDate,
          periodEnd: latestPaidPeriod.endDate,
          periodKind: 'grace_hold',
          resetMode: 'next_successful_payment',
          isEligible: true,
        },
        periodDocId: buildUsageDocId(latestPaidPeriod.startDate, latestPaidPeriod.endDate),
      };
    }

    logger.warn('[assistantQuota] Missing last paid subscription period for Assistant user in grace', {
      role,
      hasGrace,
    });
  }

  if (!currentPaidRole) {
    const freePeriod = buildCalendarMonthPeriod(dependencies.now());
    return {
      status: {
        role: 'free',
        limit: getAssistantRequestLimitForRole('free'),
        periodStart: freePeriod.startDate,
        periodEnd: freePeriod.endDate,
        periodKind: 'calendar_month',
        resetMode: 'date',
        isEligible: true,
      },
      periodDocId: buildUsageDocId(freePeriod.startDate, freePeriod.endDate),
    };
  }

  logger.warn('[assistantQuota] Missing subscription period for paid Assistant user; marking ineligible', {
    role,
    hasGrace,
  });

  return {
    status: {
      role: currentPaidRole,
      limit: getAssistantRequestLimitForRole(currentPaidRole),
      periodStart: null,
      periodEnd: null,
      periodKind: hasGrace ? 'grace_hold' : 'no_billing_period',
      resetMode: 'next_successful_payment',
      isEligible: false,
    },
    periodDocId: null,
  };
}

async function withQuotaDocumentTransaction<T>(
  userID: string,
  periodDocId: string,
  dependencies: AssistantQuotaDependencies,
  handler: (
    transaction: FirebaseFirestore.Transaction,
    docRef: FirebaseFirestore.DocumentReference,
    usageDoc: AssistantQuotaUsageDoc,
    nowMs: number,
    nowIso: string,
  ) => Promise<T> | T,
): Promise<T> {
  const db = dependencies.db();
  const docRef = getUsageDocRef(db, userID, periodDocId);
  return db.runTransaction(async (transaction) => {
    const now = dependencies.now();
    const deletionGuard = await dependencies.getDeletionGuard(
      db,
      transaction,
      userID,
      now.getTime(),
    );
    if (deletionGuard.shouldSkip) {
      throw new HttpsError(
        'permission-denied',
        'Assistant request quota is unavailable for this account.',
      );
    }
    const snapshot = await transaction.get(docRef);
    const usageDoc = normalizeUsageDoc(snapshot, now.getTime());
    return handler(transaction, docRef, usageDoc, now.getTime(), now.toISOString());
  });
}

export async function getAssistantQuotaStatus(
  userID: string,
  userRoleContext?: AssistantUserRoleContext,
  dependencies: AssistantQuotaDependencies = defaultAssistantQuotaDependencies,
): Promise<AssistantQuotaStatus> {
  const resolvedWindow = await resolveAssistantQuotaWindow(userID, dependencies, userRoleContext);
  if (!resolvedWindow.status.isEligible || !resolvedWindow.periodDocId) {
    return buildQuotaStatus(resolvedWindow.status, 0, 0);
  }

  const db = dependencies.db();
  const snapshot = await getUsageDocRef(db, userID, resolvedWindow.periodDocId).get();
  const usageDoc = normalizeUsageDoc(
    snapshot as FirebaseFirestore.DocumentSnapshot,
    dependencies.now().getTime(),
  );

  return buildQuotaStatus(
    resolvedWindow.status,
    usageDoc.successfulRequestCount,
    Object.keys(usageDoc.reservationMap).length,
  );
}

export async function reserveAssistantQuotaForRequest(
  userID: string,
  userRoleContext?: AssistantUserRoleContext,
  dependencies: AssistantQuotaDependencies = defaultAssistantQuotaDependencies,
): Promise<AssistantQuotaReservation> {
  const resolvedWindow = await resolveAssistantQuotaWindow(userID, dependencies, userRoleContext);
  if (!resolvedWindow.status.isEligible) {
    throw new HttpsError('permission-denied', 'Assistant is unavailable for this account.');
  }

  if (!resolvedWindow.periodDocId || !resolvedWindow.status.periodStart || !resolvedWindow.status.periodEnd) {
    throw new HttpsError('internal', 'Could not resolve an Assistant billing period for this account.');
  }

  const reservationID = dependencies.createReservationId();

  await withQuotaDocumentTransaction(
    userID,
    resolvedWindow.periodDocId,
    dependencies,
    async (transaction, docRef, usageDoc, nowMs) => {
      const reservationMap = { ...usageDoc.reservationMap };
      const activeRequestCount = Object.keys(reservationMap).length;
      if (usageDoc.successfulRequestCount + activeRequestCount >= resolvedWindow.status.limit) {
        logger.warn('[assistantQuota] Reservation denied because limit was reached', {
          periodDocId: resolvedWindow.periodDocId,
          successfulRequestCount: usageDoc.successfulRequestCount,
          activeRequestCount,
          limit: resolvedWindow.status.limit,
        });
        throw new HttpsError('resource-exhausted', ASSISTANT_LIMIT_REACHED_MESSAGE);
      }

      reservationMap[reservationID] = nowMs + ASSISTANT_RESERVATION_TTL_MS;
      transaction.set(
        docRef,
        buildUsageDocPayload(
          resolvedWindow.status,
          usageDoc.successfulRequestCount,
          reservationMap,
          dependencies,
          usageDoc.lastSuccessfulRequestAt,
        ),
        { merge: true },
      );
    },
  );

  logger.info('[assistantQuota] Reserved quota slot', {
    periodDocId: resolvedWindow.periodDocId,
  });

  return {
    userID,
    reservationID,
    periodDocId: resolvedWindow.periodDocId,
    role: resolvedWindow.status.role,
    limit: resolvedWindow.status.limit,
    periodStart: resolvedWindow.status.periodStart as string,
    periodEnd: resolvedWindow.status.periodEnd as string,
    periodKind: resolvedWindow.status.periodKind,
    resetMode: resolvedWindow.status.resetMode,
    isEligible: resolvedWindow.status.isEligible,
  };
}

export async function finalizeAssistantQuotaReservation(
  reservation: AssistantQuotaReservation,
  dependencies: AssistantQuotaDependencies = defaultAssistantQuotaDependencies,
): Promise<AssistantQuotaStatus> {
  const reservationStatus: ResolvedAssistantQuotaWindow['status'] = {
    role: reservation.role,
    limit: reservation.limit,
    periodStart: reservation.periodStart,
    periodEnd: reservation.periodEnd,
    periodKind: reservation.periodKind,
    resetMode: reservation.resetMode,
    isEligible: reservation.isEligible,
  };
  const result = await withQuotaDocumentTransaction(
    reservation.userID,
    reservation.periodDocId,
    dependencies,
    async (transaction, docRef, usageDoc, _nowMs, nowIso) => {
      const reservationMap = { ...usageDoc.reservationMap };
      if (!Object.prototype.hasOwnProperty.call(
        reservationMap,
        reservation.reservationID,
      )) {
        throw new HttpsError(
          'unavailable',
          'The Assistant request quota reservation expired. Please try again.',
        );
      }
      delete reservationMap[reservation.reservationID];
      const successfulRequestCount = usageDoc.successfulRequestCount + 1;

      transaction.set(
        docRef,
        buildUsageDocPayload(reservationStatus, successfulRequestCount, reservationMap, dependencies, nowIso),
        { merge: true },
      );

      return buildQuotaStatus(reservationStatus, successfulRequestCount, Object.keys(reservationMap).length);
    },
  );

  logger.info('[assistantQuota] Finalized successful Assistant request quota usage', {
    periodDocId: reservation.periodDocId,
  });

  return result;
}

export async function releaseAssistantQuotaReservation(
  reservation: AssistantQuotaReservation,
  dependencies: AssistantQuotaDependencies = defaultAssistantQuotaDependencies,
): Promise<AssistantQuotaStatus> {
  const reservationStatus: ResolvedAssistantQuotaWindow['status'] = {
    role: reservation.role,
    limit: reservation.limit,
    periodStart: reservation.periodStart,
    periodEnd: reservation.periodEnd,
    periodKind: reservation.periodKind,
    resetMode: reservation.resetMode,
    isEligible: reservation.isEligible,
  };
  const result = await withQuotaDocumentTransaction(
    reservation.userID,
    reservation.periodDocId,
    dependencies,
    async (transaction, docRef, usageDoc) => {
      const reservationMap = { ...usageDoc.reservationMap };
      if (!Object.prototype.hasOwnProperty.call(
        reservationMap,
        reservation.reservationID,
      )) {
        return {
          status: buildQuotaStatus(
            reservationStatus,
            usageDoc.successfulRequestCount,
            Object.keys(reservationMap).length,
          ),
          released: false,
        };
      }
      delete reservationMap[reservation.reservationID];

      transaction.set(
        docRef,
        buildUsageDocPayload(
          reservationStatus,
          usageDoc.successfulRequestCount,
          reservationMap,
          dependencies,
          usageDoc.lastSuccessfulRequestAt,
        ),
        { merge: true },
      );

      return {
        status: buildQuotaStatus(
          reservationStatus,
          usageDoc.successfulRequestCount,
          Object.keys(reservationMap).length,
        ),
        released: true,
      };
    },
  );

  if (result.released) {
    logger.info('[assistantQuota] Released quota reservation', {
      periodDocId: reservation.periodDocId,
    });
  }

  return result.status;
}

export function createAssistantQuota(
  dependencies: Partial<AssistantQuotaDependencies> = {},
): AssistantQuotaApi {
  const resolvedDependencies: AssistantQuotaDependencies = {
    ...defaultAssistantQuotaDependencies,
    ...dependencies,
  };

  return {
    getAssistantQuotaStatus: (userID, userRoleContext) => (
      getAssistantQuotaStatus(userID, userRoleContext, resolvedDependencies)
    ),
    reserveAssistantQuotaForRequest: (userID, userRoleContext) => (
      reserveAssistantQuotaForRequest(userID, userRoleContext, resolvedDependencies)
    ),
    finalizeAssistantQuotaReservation: (reservation) => (
      finalizeAssistantQuotaReservation(reservation, resolvedDependencies)
    ),
    releaseAssistantQuotaReservation: (reservation) => (
      releaseAssistantQuotaReservation(reservation, resolvedDependencies)
    ),
  };
}

export async function withAssistantQuotaDependenciesForTesting<T>(
  dependencies: Partial<AssistantQuotaDependencies>,
  run: (api: AssistantQuotaApi) => Promise<T> | T,
): Promise<T> {
  return run(createAssistantQuota(dependencies));
}
