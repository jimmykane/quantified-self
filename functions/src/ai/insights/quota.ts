import { randomUUID } from 'node:crypto';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { HttpsError } from 'firebase-functions/v2/https';
import type {
  AiInsightsQuotaPeriodKind,
  AiInsightsQuotaResetMode,
  AiInsightsQuotaStatus,
} from '../../../../shared/ai-insights.types';
import { getAiInsightsRequestLimitForRole } from '../../../../shared/limits';
import { getUserRoleAndGracePeriod, isGracePeriodActive } from '../../utils';

const AI_INSIGHTS_USAGE_COLLECTION = 'aiInsightsUsage';
const AI_INSIGHTS_USAGE_DOC_VERSION = 2;
const AI_INSIGHTS_RESERVATION_TTL_MS = 10 * 60 * 1000;

export const AI_INSIGHTS_LIMIT_REACHED_MESSAGE = 'AI Insights limit reached for this billing period.';

interface SubscriptionPeriod {
  role: 'basic' | 'pro';
  startDate: string;
  endDate: string;
}

interface AiInsightsQuotaUsageDoc {
  version: number;
  role: 'free' | 'basic' | 'pro';
  limit: number;
  periodStart: string;
  periodEnd: string;
  periodKind: AiInsightsQuotaPeriodKind;
  successfulRequestCount: number;
  reservationMap: Record<string, number>;
  lastSuccessfulRequestAt?: string;
}

interface ResolvedAiInsightsQuotaWindow {
  status: Omit<AiInsightsQuotaStatus, 'successfulRequestCount' | 'activeRequestCount' | 'remainingCount' | 'blockedReason'>;
  periodDocId: string | null;
}

export interface AiInsightsQuotaReservation {
  userID: string;
  reservationID: string;
  periodDocId: string;
  role: 'free' | 'basic' | 'pro';
  limit: number;
  periodStart: string;
  periodEnd: string;
  periodKind: AiInsightsQuotaPeriodKind;
  resetMode: AiInsightsQuotaResetMode;
  isEligible: boolean;
}

export interface AiInsightsUserRoleContext {
  role: string;
  gracePeriodUntil?: number;
}

export interface AiInsightsQuotaDependencies {
  now: () => Date;
  createReservationId: () => string;
  db: () => FirebaseFirestore.Firestore;
  getUserRoleAndGracePeriod: typeof getUserRoleAndGracePeriod;
  isGracePeriodActive: typeof isGracePeriodActive;
  getActiveSubscriptionPeriod: (userID: string) => Promise<SubscriptionPeriod | null>;
  getLatestPaidSubscriptionPeriod: (userID: string) => Promise<SubscriptionPeriod | null>;
}

export interface AiInsightsQuotaApi {
  getAiInsightsQuotaStatus: (
    userID: string,
    userRoleContext?: AiInsightsUserRoleContext,
  ) => Promise<AiInsightsQuotaStatus>;
  reserveAiInsightsQuotaForRequest: (
    userID: string,
    userRoleContext?: AiInsightsUserRoleContext,
  ) => Promise<AiInsightsQuotaReservation>;
  finalizeAiInsightsQuotaReservation: (
    reservation: AiInsightsQuotaReservation,
  ) => Promise<AiInsightsQuotaStatus>;
  releaseAiInsightsQuotaReservation: (
    reservation: AiInsightsQuotaReservation,
  ) => Promise<AiInsightsQuotaStatus>;
}

const defaultAiInsightsQuotaDependencies: AiInsightsQuotaDependencies = {
  now: () => new Date(),
  createReservationId: () => randomUUID(),
  db: () => admin.firestore(),
  getUserRoleAndGracePeriod,
  isGracePeriodActive,
  getActiveSubscriptionPeriod: async (userID) => getActiveSubscriptionPeriodFromFirestore(userID),
  getLatestPaidSubscriptionPeriod: async (userID) => getLatestPaidSubscriptionPeriodFromFirestore(userID),
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

function getUsageDocRef(
  userID: string,
  periodDocId: string,
  dependencies: AiInsightsQuotaDependencies,
): FirebaseFirestore.DocumentReference {
  return dependencies.db()
    .collection('users')
    .doc(userID)
    .collection(AI_INSIGHTS_USAGE_COLLECTION)
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
): AiInsightsQuotaUsageDoc {
  const data = snapshot.data() as Record<string, unknown> | undefined;
  const successfulRequestCount = typeof data?.successfulRequestCount === 'number'
    && Number.isFinite(data.successfulRequestCount)
    ? Math.max(0, Math.floor(data.successfulRequestCount))
    : 0;

  return {
    version: AI_INSIGHTS_USAGE_DOC_VERSION,
    role: normalizeUsageDocRole(data?.role),
    limit: typeof data?.limit === 'number' && Number.isFinite(data.limit)
      ? Math.max(0, Math.floor(data.limit))
      : 0,
    periodStart: typeof data?.periodStart === 'string' ? data.periodStart : '',
    periodEnd: typeof data?.periodEnd === 'string' ? data.periodEnd : '',
    periodKind: data?.periodKind === 'subscription' || data?.periodKind === 'grace_hold' || data?.periodKind === 'no_billing_period'
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
  baseStatus: ResolvedAiInsightsQuotaWindow['status'],
  successfulRequestCount: number,
  activeRequestCount: number,
): AiInsightsQuotaStatus {
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
  baseStatus: ResolvedAiInsightsQuotaWindow['status'],
  successfulRequestCount: number,
  reservationMap: Record<string, number>,
  dependencies: AiInsightsQuotaDependencies,
  lastSuccessfulRequestAt?: string,
): FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData> {
  const updatedAt = dependencies.now().toISOString();

  return {
    version: AI_INSIGHTS_USAGE_DOC_VERSION,
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

async function resolveAiInsightsQuotaWindow(
  userID: string,
  dependencies: AiInsightsQuotaDependencies,
  userRoleContext?: AiInsightsUserRoleContext,
): Promise<ResolvedAiInsightsQuotaWindow> {
  const { role, gracePeriodUntil } = userRoleContext
    ?? await dependencies.getUserRoleAndGracePeriod(userID);
  const hasGrace = dependencies.isGracePeriodActive(gracePeriodUntil);
  const currentPaidRole = resolvePaidSubscriptionRole(role);

  const activePeriod = await dependencies.getActiveSubscriptionPeriod(userID);
  if (activePeriod) {
    return {
      status: {
        role: activePeriod.role,
        limit: getAiInsightsRequestLimitForRole(activePeriod.role),
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
          limit: getAiInsightsRequestLimitForRole(latestPaidPeriod.role),
          periodStart: latestPaidPeriod.startDate,
          periodEnd: latestPaidPeriod.endDate,
          periodKind: 'grace_hold',
          resetMode: 'next_successful_payment',
          isEligible: true,
        },
        periodDocId: buildUsageDocId(latestPaidPeriod.startDate, latestPaidPeriod.endDate),
      };
    }

    logger.warn('[aiInsightsQuota] Missing last paid subscription period for grace AI user', {
      userID,
      role,
      hasGrace,
    });
  }

  if (!currentPaidRole) {
    return {
      status: {
        role: 'free',
        limit: getAiInsightsRequestLimitForRole('free'),
        periodStart: null,
        periodEnd: null,
        periodKind: 'no_billing_period',
        resetMode: 'next_successful_payment',
        isEligible: false,
      },
      periodDocId: null,
    };
  }

  logger.warn('[aiInsightsQuota] Missing subscription period for paid AI user; marking ineligible', {
    userID,
    role,
    hasGrace,
  });

  return {
    status: {
      role: currentPaidRole,
      limit: getAiInsightsRequestLimitForRole(currentPaidRole),
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
  baseStatus: ResolvedAiInsightsQuotaWindow['status'],
  dependencies: AiInsightsQuotaDependencies,
  handler: (
    transaction: FirebaseFirestore.Transaction,
    usageDoc: AiInsightsQuotaUsageDoc,
    nowMs: number,
    nowIso: string,
  ) => Promise<T> | T,
): Promise<T> {
  const docRef = getUsageDocRef(userID, periodDocId, dependencies);
  return dependencies.db().runTransaction(async (transaction) => {
    const now = dependencies.now();
    const snapshot = await transaction.get(docRef);
    const usageDoc = normalizeUsageDoc(snapshot, now.getTime());
    return handler(transaction, usageDoc, now.getTime(), now.toISOString());
  });
}

export async function getAiInsightsQuotaStatus(
  userID: string,
  userRoleContext?: AiInsightsUserRoleContext,
  dependencies: AiInsightsQuotaDependencies = defaultAiInsightsQuotaDependencies,
): Promise<AiInsightsQuotaStatus> {
  const resolvedWindow = await resolveAiInsightsQuotaWindow(userID, dependencies, userRoleContext);
  if (!resolvedWindow.status.isEligible || !resolvedWindow.periodDocId) {
    return buildQuotaStatus(resolvedWindow.status, 0, 0);
  }

  const snapshot = await getUsageDocRef(userID, resolvedWindow.periodDocId, dependencies).get();
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

export async function reserveAiInsightsQuotaForRequest(
  userID: string,
  userRoleContext?: AiInsightsUserRoleContext,
  dependencies: AiInsightsQuotaDependencies = defaultAiInsightsQuotaDependencies,
): Promise<AiInsightsQuotaReservation> {
  const resolvedWindow = await resolveAiInsightsQuotaWindow(userID, dependencies, userRoleContext);
  if (!resolvedWindow.status.isEligible) {
    throw new HttpsError('permission-denied', 'AI Insights is available to Basic and Pro members.');
  }

  if (!resolvedWindow.periodDocId || !resolvedWindow.status.periodStart || !resolvedWindow.status.periodEnd) {
    throw new HttpsError('internal', 'Could not resolve an AI Insights billing period for this account.');
  }

  const reservationID = dependencies.createReservationId();

  await withQuotaDocumentTransaction(
    userID,
    resolvedWindow.periodDocId,
    resolvedWindow.status,
    dependencies,
    async (transaction, usageDoc, nowMs) => {
    const reservationMap = { ...usageDoc.reservationMap };
    const activeRequestCount = Object.keys(reservationMap).length;
    if (usageDoc.successfulRequestCount + activeRequestCount >= resolvedWindow.status.limit) {
      logger.warn('[aiInsightsQuota] Reservation denied because limit was reached', {
        userID,
        periodDocId: resolvedWindow.periodDocId,
        successfulRequestCount: usageDoc.successfulRequestCount,
        activeRequestCount,
        limit: resolvedWindow.status.limit,
      });
      throw new HttpsError('resource-exhausted', AI_INSIGHTS_LIMIT_REACHED_MESSAGE);
    }

    reservationMap[reservationID] = nowMs + AI_INSIGHTS_RESERVATION_TTL_MS;
    transaction.set(
      getUsageDocRef(userID, resolvedWindow.periodDocId as string, dependencies),
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

  logger.info('[aiInsightsQuota] Reserved quota slot', {
    userID,
    reservationID,
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

export async function finalizeAiInsightsQuotaReservation(
  reservation: AiInsightsQuotaReservation,
  dependencies: AiInsightsQuotaDependencies = defaultAiInsightsQuotaDependencies,
): Promise<AiInsightsQuotaStatus> {
  const reservationStatus: ResolvedAiInsightsQuotaWindow['status'] = {
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
    reservationStatus,
    dependencies,
    async (transaction, usageDoc, _nowMs, nowIso) => {
      const reservationMap = { ...usageDoc.reservationMap };
      delete reservationMap[reservation.reservationID];
      const successfulRequestCount = usageDoc.successfulRequestCount + 1;

      transaction.set(
        getUsageDocRef(reservation.userID, reservation.periodDocId, dependencies),
        buildUsageDocPayload(reservationStatus, successfulRequestCount, reservationMap, dependencies, nowIso),
        { merge: true },
      );

      return buildQuotaStatus(reservationStatus, successfulRequestCount, Object.keys(reservationMap).length);
    },
  );

  logger.info('[aiInsightsQuota] Finalized successful AI request quota usage', {
    userID: reservation.userID,
    reservationID: reservation.reservationID,
    periodDocId: reservation.periodDocId,
  });

  return result;
}

export async function releaseAiInsightsQuotaReservation(
  reservation: AiInsightsQuotaReservation,
  dependencies: AiInsightsQuotaDependencies = defaultAiInsightsQuotaDependencies,
): Promise<AiInsightsQuotaStatus> {
  const reservationStatus: ResolvedAiInsightsQuotaWindow['status'] = {
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
    reservationStatus,
    dependencies,
    async (transaction, usageDoc) => {
      const reservationMap = { ...usageDoc.reservationMap };
      delete reservationMap[reservation.reservationID];

      transaction.set(
        getUsageDocRef(reservation.userID, reservation.periodDocId, dependencies),
        buildUsageDocPayload(
          reservationStatus,
          usageDoc.successfulRequestCount,
          reservationMap,
          dependencies,
          usageDoc.lastSuccessfulRequestAt,
        ),
        { merge: true },
      );

      return buildQuotaStatus(reservationStatus, usageDoc.successfulRequestCount, Object.keys(reservationMap).length);
    },
  );

  logger.info('[aiInsightsQuota] Released quota reservation', {
    userID: reservation.userID,
    reservationID: reservation.reservationID,
    periodDocId: reservation.periodDocId,
  });

  return result;
}

export function createAiInsightsQuota(
  dependencies: Partial<AiInsightsQuotaDependencies> = {},
): AiInsightsQuotaApi {
  const resolvedDependencies: AiInsightsQuotaDependencies = {
    ...defaultAiInsightsQuotaDependencies,
    ...dependencies,
  };

  return {
    getAiInsightsQuotaStatus: (userID, userRoleContext) => (
      getAiInsightsQuotaStatus(userID, userRoleContext, resolvedDependencies)
    ),
    reserveAiInsightsQuotaForRequest: (userID, userRoleContext) => (
      reserveAiInsightsQuotaForRequest(userID, userRoleContext, resolvedDependencies)
    ),
    finalizeAiInsightsQuotaReservation: (reservation) => (
      finalizeAiInsightsQuotaReservation(reservation, resolvedDependencies)
    ),
    releaseAiInsightsQuotaReservation: (reservation) => (
      releaseAiInsightsQuotaReservation(reservation, resolvedDependencies)
    ),
  };
}

export async function withAiInsightsQuotaDependenciesForTesting<T>(
  dependencies: Partial<AiInsightsQuotaDependencies>,
  run: (api: AiInsightsQuotaApi) => Promise<T> | T,
): Promise<T> {
  return run(createAiInsightsQuota(dependencies));
}
