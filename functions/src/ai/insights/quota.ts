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
const AI_INSIGHTS_USAGE_DOC_VERSION = 1;
const AI_INSIGHTS_RESERVATION_TTL_MS = 10 * 60 * 1000;

export const AI_INSIGHTS_LIMIT_REACHED_MESSAGE = 'AI Insights limit reached for this billing period.';

interface SubscriptionPeriod {
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
  successfulGenkitCount: number;
  reservationMap: Record<string, number>;
  lastSuccessfulGenkitAt?: string;
}

interface ResolvedAiInsightsQuotaWindow {
  status: Omit<AiInsightsQuotaStatus, 'successfulGenkitCount' | 'activeReservationCount' | 'remainingCount' | 'blockedReason'>;
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

interface AiInsightsQuotaDependencies {
  now: () => Date;
  createReservationId: () => string;
  db: () => FirebaseFirestore.Firestore;
  getUserRoleAndGracePeriod: typeof getUserRoleAndGracePeriod;
  isGracePeriodActive: typeof isGracePeriodActive;
  getActiveSubscriptionPeriod: (userID: string) => Promise<SubscriptionPeriod | null>;
  getLatestProSubscriptionPeriod: (userID: string) => Promise<SubscriptionPeriod | null>;
}

const defaultAiInsightsQuotaDependencies: AiInsightsQuotaDependencies = {
  now: () => new Date(),
  createReservationId: () => randomUUID(),
  db: () => admin.firestore(),
  getUserRoleAndGracePeriod,
  isGracePeriodActive,
  getActiveSubscriptionPeriod: async (userID) => getActiveSubscriptionPeriodFromFirestore(userID),
  getLatestProSubscriptionPeriod: async (userID) => getLatestProSubscriptionPeriodFromFirestore(userID),
};

let aiInsightsQuotaDependencies: AiInsightsQuotaDependencies = defaultAiInsightsQuotaDependencies;

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

async function getActiveSubscriptionPeriodFromFirestore(userID: string): Promise<SubscriptionPeriod | null> {
  const snapshot = await admin.firestore()
    .collection('customers')
    .doc(userID)
    .collection('subscriptions')
    .where('status', 'in', ['active', 'trialing'])
    .orderBy('created', 'desc')
    .limit(5)
    .get();

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const startDate = toDate(data.current_period_start);
    const endDate = toDate(data.current_period_end);
    if (startDate && endDate) {
      return {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      };
    }
  }

  return null;
}

async function getLatestProSubscriptionPeriodFromFirestore(userID: string): Promise<SubscriptionPeriod | null> {
  const snapshot = await admin.firestore()
    .collection('customers')
    .doc(userID)
    .collection('subscriptions')
    .orderBy('current_period_end', 'desc')
    .limit(10)
    .get();

  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (data.role !== 'pro') {
      continue;
    }

    const startDate = toDate(data.current_period_start);
    const endDate = toDate(data.current_period_end);
    if (startDate && endDate) {
      return {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      };
    }
  }

  return null;
}

function buildUsageDocId(periodStart: string, periodEnd: string): string {
  return `period_${Date.parse(periodStart)}_${Date.parse(periodEnd)}`;
}

function getUsageDocRef(
  userID: string,
  periodDocId: string,
): FirebaseFirestore.DocumentReference {
  return aiInsightsQuotaDependencies.db()
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

function normalizeUsageDoc(
  snapshot: FirebaseFirestore.DocumentSnapshot,
  nowMs: number,
): AiInsightsQuotaUsageDoc {
  const data = snapshot.data() as Record<string, unknown> | undefined;
  const successfulGenkitCount = typeof data?.successfulGenkitCount === 'number'
    && Number.isFinite(data.successfulGenkitCount)
    ? Math.max(0, Math.floor(data.successfulGenkitCount))
    : 0;

  return {
    version: AI_INSIGHTS_USAGE_DOC_VERSION,
    role: data?.role === 'basic' || data?.role === 'free' || data?.role === 'pro'
      ? data.role
      : 'pro',
    limit: typeof data?.limit === 'number' && Number.isFinite(data.limit)
      ? Math.max(0, Math.floor(data.limit))
      : 0,
    periodStart: typeof data?.periodStart === 'string' ? data.periodStart : '',
    periodEnd: typeof data?.periodEnd === 'string' ? data.periodEnd : '',
    periodKind: data?.periodKind === 'subscription' || data?.periodKind === 'grace_hold' || data?.periodKind === 'no_billing_period'
      ? data.periodKind
      : 'subscription',
    successfulGenkitCount,
    reservationMap: normalizeReservationMap(data?.reservationMap, nowMs),
    lastSuccessfulGenkitAt: typeof data?.lastSuccessfulGenkitAt === 'string'
      ? data.lastSuccessfulGenkitAt
      : undefined,
  };
}

function buildQuotaStatus(
  baseStatus: ResolvedAiInsightsQuotaWindow['status'],
  successfulGenkitCount: number,
  activeReservationCount: number,
): AiInsightsQuotaStatus {
  const remainingCount = baseStatus.isEligible
    ? Math.max(0, baseStatus.limit - successfulGenkitCount - activeReservationCount)
    : 0;

  return {
    ...baseStatus,
    successfulGenkitCount,
    activeReservationCount,
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
  successfulGenkitCount: number,
  reservationMap: Record<string, number>,
  lastSuccessfulGenkitAt?: string,
): FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData> {
  const updatedAt = aiInsightsQuotaDependencies.now().toISOString();

  return {
    version: AI_INSIGHTS_USAGE_DOC_VERSION,
    role: baseStatus.role,
    limit: baseStatus.limit,
    periodStart: baseStatus.periodStart,
    periodEnd: baseStatus.periodEnd,
    periodKind: baseStatus.periodKind,
    successfulGenkitCount,
    reservationMap,
    ...(lastSuccessfulGenkitAt ? { lastSuccessfulGenkitAt } : {}),
    updatedAt,
  };
}

async function resolveAiInsightsQuotaWindow(
  userID: string,
): Promise<ResolvedAiInsightsQuotaWindow> {
  const { role, gracePeriodUntil } = await aiInsightsQuotaDependencies.getUserRoleAndGracePeriod(userID);
  const hasGrace = aiInsightsQuotaDependencies.isGracePeriodActive(gracePeriodUntil);
  const effectiveRole = role === 'pro' || hasGrace ? 'pro' : role === 'basic' ? 'basic' : 'free';

  if (effectiveRole !== 'pro') {
    return {
      status: {
        role: effectiveRole,
        limit: getAiInsightsRequestLimitForRole(effectiveRole),
        periodStart: null,
        periodEnd: null,
        periodKind: 'no_billing_period',
        resetMode: 'next_successful_payment',
        isEligible: false,
      },
      periodDocId: null,
    };
  }

  const activePeriod = await aiInsightsQuotaDependencies.getActiveSubscriptionPeriod(userID);
  if (activePeriod) {
    return {
      status: {
        role: 'pro',
        limit: getAiInsightsRequestLimitForRole('pro'),
        periodStart: activePeriod.startDate,
        periodEnd: activePeriod.endDate,
        periodKind: 'subscription',
        resetMode: 'date',
        isEligible: true,
      },
      periodDocId: buildUsageDocId(activePeriod.startDate, activePeriod.endDate),
    };
  }

  const latestProPeriod = await aiInsightsQuotaDependencies.getLatestProSubscriptionPeriod(userID);
  if (latestProPeriod) {
    return {
      status: {
        role: 'pro',
        limit: getAiInsightsRequestLimitForRole('pro'),
        periodStart: latestProPeriod.startDate,
        periodEnd: latestProPeriod.endDate,
        periodKind: hasGrace ? 'grace_hold' : 'subscription',
        resetMode: hasGrace ? 'next_successful_payment' : 'date',
        isEligible: true,
      },
      periodDocId: buildUsageDocId(latestProPeriod.startDate, latestProPeriod.endDate),
    };
  }

  logger.warn('[aiInsightsQuota] Missing subscription period for eligible AI user', {
    userID,
    role,
    hasGrace,
  });

  return {
    status: {
      role: 'pro',
      limit: getAiInsightsRequestLimitForRole('pro'),
      periodStart: null,
      periodEnd: null,
      periodKind: hasGrace ? 'grace_hold' : 'no_billing_period',
      resetMode: 'next_successful_payment',
      isEligible: true,
    },
    periodDocId: null,
  };
}

async function withQuotaDocumentTransaction<T>(
  userID: string,
  periodDocId: string,
  handler: (
    transaction: FirebaseFirestore.Transaction,
    baseStatus: ResolvedAiInsightsQuotaWindow['status'],
    usageDoc: AiInsightsQuotaUsageDoc,
    nowMs: number,
    nowIso: string,
  ) => Promise<T> | T,
): Promise<T> {
  const resolvedWindow = await resolveAiInsightsQuotaWindow(userID);
  if (!resolvedWindow.status.isEligible) {
    return handler(
      {} as FirebaseFirestore.Transaction,
      resolvedWindow.status,
      {
        version: AI_INSIGHTS_USAGE_DOC_VERSION,
        role: resolvedWindow.status.role,
        limit: resolvedWindow.status.limit,
        periodStart: resolvedWindow.status.periodStart || '',
        periodEnd: resolvedWindow.status.periodEnd || '',
        periodKind: resolvedWindow.status.periodKind,
        successfulGenkitCount: 0,
        reservationMap: {},
      },
      aiInsightsQuotaDependencies.now().getTime(),
      aiInsightsQuotaDependencies.now().toISOString(),
    );
  }

  const docRef = getUsageDocRef(userID, periodDocId);
  return aiInsightsQuotaDependencies.db().runTransaction(async (transaction) => {
    const now = aiInsightsQuotaDependencies.now();
    const snapshot = await transaction.get(docRef);
    const usageDoc = normalizeUsageDoc(snapshot, now.getTime());
    return handler(transaction, resolvedWindow.status, usageDoc, now.getTime(), now.toISOString());
  });
}

export async function getAiInsightsQuotaStatus(
  userID: string,
): Promise<AiInsightsQuotaStatus> {
  const resolvedWindow = await resolveAiInsightsQuotaWindow(userID);
  if (!resolvedWindow.status.isEligible || !resolvedWindow.periodDocId) {
    return buildQuotaStatus(resolvedWindow.status, 0, 0);
  }

  return withQuotaDocumentTransaction(userID, resolvedWindow.periodDocId, async (transaction, baseStatus, usageDoc) => {
    const activeReservationCount = Object.keys(usageDoc.reservationMap).length;
    transaction.set(
      getUsageDocRef(userID, resolvedWindow.periodDocId as string),
      buildUsageDocPayload(
        baseStatus,
        usageDoc.successfulGenkitCount,
        usageDoc.reservationMap,
        usageDoc.lastSuccessfulGenkitAt,
      ),
      { merge: true },
    );

    return buildQuotaStatus(baseStatus, usageDoc.successfulGenkitCount, activeReservationCount);
  });
}

export async function reserveAiInsightsQuotaForGenkit(
  userID: string,
): Promise<AiInsightsQuotaReservation> {
  const resolvedWindow = await resolveAiInsightsQuotaWindow(userID);
  if (!resolvedWindow.status.isEligible) {
    throw new HttpsError('permission-denied', 'AI Insights is a Pro feature. Please upgrade to Pro.');
  }

  if (!resolvedWindow.periodDocId || !resolvedWindow.status.periodStart || !resolvedWindow.status.periodEnd) {
    throw new HttpsError('internal', 'Could not resolve an AI Insights billing period for this account.');
  }

  const reservationID = aiInsightsQuotaDependencies.createReservationId();

  await withQuotaDocumentTransaction(userID, resolvedWindow.periodDocId, async (transaction, baseStatus, usageDoc, nowMs) => {
    const reservationMap = { ...usageDoc.reservationMap };
    const activeReservationCount = Object.keys(reservationMap).length;
    if (usageDoc.successfulGenkitCount + activeReservationCount >= baseStatus.limit) {
      logger.warn('[aiInsightsQuota] Reservation denied because limit was reached', {
        userID,
        periodDocId: resolvedWindow.periodDocId,
        successfulGenkitCount: usageDoc.successfulGenkitCount,
        activeReservationCount,
        limit: baseStatus.limit,
      });
      throw new HttpsError('resource-exhausted', AI_INSIGHTS_LIMIT_REACHED_MESSAGE);
    }

    reservationMap[reservationID] = nowMs + AI_INSIGHTS_RESERVATION_TTL_MS;
    transaction.set(
      getUsageDocRef(userID, resolvedWindow.periodDocId as string),
      buildUsageDocPayload(
        baseStatus,
        usageDoc.successfulGenkitCount,
        reservationMap,
        usageDoc.lastSuccessfulGenkitAt,
      ),
      { merge: true },
    );
  });

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
): Promise<AiInsightsQuotaStatus> {
  const result = await withQuotaDocumentTransaction(
    reservation.userID,
    reservation.periodDocId,
    async (transaction, baseStatus, usageDoc, _nowMs, nowIso) => {
      const reservationMap = { ...usageDoc.reservationMap };
      delete reservationMap[reservation.reservationID];
      const successfulGenkitCount = usageDoc.successfulGenkitCount + 1;

      transaction.set(
        getUsageDocRef(reservation.userID, reservation.periodDocId),
        buildUsageDocPayload(baseStatus, successfulGenkitCount, reservationMap, nowIso),
        { merge: true },
      );

      return buildQuotaStatus(baseStatus, successfulGenkitCount, Object.keys(reservationMap).length);
    },
  );

  logger.info('[aiInsightsQuota] Finalized successful Genkit quota usage', {
    userID: reservation.userID,
    reservationID: reservation.reservationID,
    periodDocId: reservation.periodDocId,
  });

  return result;
}

export async function releaseAiInsightsQuotaReservation(
  reservation: AiInsightsQuotaReservation,
): Promise<AiInsightsQuotaStatus> {
  const result = await withQuotaDocumentTransaction(
    reservation.userID,
    reservation.periodDocId,
    async (transaction, baseStatus, usageDoc) => {
      const reservationMap = { ...usageDoc.reservationMap };
      delete reservationMap[reservation.reservationID];

      transaction.set(
        getUsageDocRef(reservation.userID, reservation.periodDocId),
        buildUsageDocPayload(
          baseStatus,
          usageDoc.successfulGenkitCount,
          reservationMap,
          usageDoc.lastSuccessfulGenkitAt,
        ),
        { merge: true },
      );

      return buildQuotaStatus(baseStatus, usageDoc.successfulGenkitCount, Object.keys(reservationMap).length);
    },
  );

  logger.info('[aiInsightsQuota] Released quota reservation', {
    userID: reservation.userID,
    reservationID: reservation.reservationID,
    periodDocId: reservation.periodDocId,
  });

  return result;
}

export function setAiInsightsQuotaDependenciesForTesting(
  dependencies?: Partial<AiInsightsQuotaDependencies>,
): void {
  aiInsightsQuotaDependencies = dependencies
    ? { ...defaultAiInsightsQuotaDependencies, ...dependencies }
    : defaultAiInsightsQuotaDependencies;
}
