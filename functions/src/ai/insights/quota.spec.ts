import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';
import {
  finalizeAiInsightsQuotaReservation,
  getAiInsightsQuotaStatus,
  normalizeUsageDocRole,
  releaseAiInsightsQuotaReservation,
  reserveAiInsightsQuotaForGenkit,
  setAiInsightsQuotaDependenciesForTesting,
} from './quota';
import { AI_INSIGHTS_REQUEST_LIMITS } from '../../../../shared/limits';

const FIXED_NOW_ISO = '2026-03-19T12:00:00.000Z';
const PERIOD_START = '2026-03-01T00:00:00.000Z';
const PERIOD_END = '2026-04-01T00:00:00.000Z';
const PERIOD_DOC_ID = 'period_1772323200000_1775001600000';

type StoredDoc = Record<string, unknown> | undefined;

class FakeDocumentSnapshot {
  constructor(private readonly storedDoc: StoredDoc) { }

  data(): StoredDoc {
    return this.storedDoc;
  }
}

class FakeDocumentReference {
  constructor(
    private readonly db: FakeFirestore,
    public readonly path: string,
  ) { }

  async get(): Promise<FakeDocumentSnapshot> {
    return new FakeDocumentSnapshot(this.db.getDocument(this.path));
  }

  collection(name: string): FakeCollectionReference {
    return new FakeCollectionReference(this.db, `${this.path}/${name}`);
  }
}

class FakeCollectionReference {
  constructor(
    private readonly db: FakeFirestore,
    private readonly path: string,
  ) { }

  doc(id: string): FakeDocumentReference {
    return new FakeDocumentReference(this.db, `${this.path}/${id}`);
  }
}

class FakeTransaction {
  constructor(private readonly db: FakeFirestore) { }

  async get(docRef: FakeDocumentReference): Promise<FakeDocumentSnapshot> {
    return new FakeDocumentSnapshot(this.db.getDocument(docRef.path));
  }

  set(
    docRef: FakeDocumentReference,
    data: Record<string, unknown>,
    options?: { merge?: boolean },
  ): void {
    this.db.setDocument(docRef.path, data, options?.merge === true);
  }
}

class FakeFirestore {
  private readonly documents = new Map<string, Record<string, unknown>>();
  private writeCount = 0;

  collection(name: string): FakeCollectionReference {
    return new FakeCollectionReference(this, name);
  }

  async runTransaction<T>(
    updateFunction: (transaction: FakeTransaction) => Promise<T>,
  ): Promise<T> {
    return updateFunction(new FakeTransaction(this));
  }

  seedDocument(path: string, data: Record<string, unknown>): void {
    this.documents.set(path, { ...data });
  }

  getDocument(path: string): StoredDoc {
    return this.documents.get(path);
  }

  getWriteCount(): number {
    return this.writeCount;
  }

  setDocument(path: string, data: Record<string, unknown>, merge: boolean): void {
    const previous = this.documents.get(path);
    this.writeCount += 1;
    this.documents.set(path, merge ? { ...(previous ?? {}), ...data } : { ...data });
  }
}

function buildUsageDoc(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    version: 1,
    role: 'pro',
    limit: AI_INSIGHTS_REQUEST_LIMITS.pro,
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    periodKind: 'subscription',
    successfulGenkitCount: 0,
    reservationMap: {},
    ...overrides,
  };
}

describe('ai insights quota', () => {
  let fakeDb: FakeFirestore;
  let reservationCounter: number;

  beforeEach(() => {
    fakeDb = new FakeFirestore();
    reservationCounter = 0;

    setAiInsightsQuotaDependenciesForTesting({
      now: () => new Date(FIXED_NOW_ISO),
      createReservationId: () => {
        reservationCounter += 1;
        return `reservation-${reservationCounter}`;
      },
      db: () => fakeDb as unknown as FirebaseFirestore.Firestore,
      getUserRoleAndGracePeriod: async () => ({ role: 'pro' }),
      isGracePeriodActive: (gracePeriodUntil?: number) => Boolean(gracePeriodUntil && gracePeriodUntil > Date.parse(FIXED_NOW_ISO)),
      getActiveSubscriptionPeriod: async () => ({
        role: 'pro',
        startDate: PERIOD_START,
        endDate: PERIOD_END,
      }),
      getLatestPaidSubscriptionPeriod: async () => ({
        role: 'pro',
        startDate: PERIOD_START,
        endDate: PERIOD_END,
      }),
    });
  });

  afterEach(() => {
    setAiInsightsQuotaDependenciesForTesting();
    vi.restoreAllMocks();
  });

  it('defaults malformed usage doc roles to free', () => {
    expect(normalizeUsageDocRole('free')).toBe('free');
    expect(normalizeUsageDocRole('basic')).toBe('basic');
    expect(normalizeUsageDocRole('pro')).toBe('pro');
    expect(normalizeUsageDocRole(undefined)).toBe('free');
    expect(normalizeUsageDocRole('enterprise')).toBe('free');
    expect(normalizeUsageDocRole({ role: 'pro' })).toBe('free');
  });

  it('increments quota only after a successful Genkit finalization', async () => {
    const reservation = await reserveAiInsightsQuotaForGenkit('user-1');
    const finalizedStatus = await finalizeAiInsightsQuotaReservation(reservation);
    const quotaStatus = await getAiInsightsQuotaStatus('user-1');

    expect(reservation.periodDocId).toBe(PERIOD_DOC_ID);
    expect(finalizedStatus.successfulGenkitCount).toBe(1);
    expect(finalizedStatus.activeReservationCount).toBe(0);
    expect(finalizedStatus.remainingCount).toBe(99);
    expect(quotaStatus.successfulGenkitCount).toBe(1);
    expect(quotaStatus.remainingCount).toBe(99);
  });

  it('stores usage timestamps without depending on admin.firestore.FieldValue', async () => {
    const originalFieldValue = (admin.firestore as typeof admin.firestore & { FieldValue?: unknown }).FieldValue;
    (admin.firestore as typeof admin.firestore & { FieldValue?: unknown }).FieldValue = undefined;

    try {
      const reservation = await reserveAiInsightsQuotaForGenkit('user-1');
      const storedDoc = fakeDb.getDocument(`users/user-1/aiInsightsUsage/${reservation.periodDocId}`);

      expect(storedDoc?.updatedAt).toBe(FIXED_NOW_ISO);
    } finally {
      (admin.firestore as typeof admin.firestore & { FieldValue?: unknown }).FieldValue = originalFieldValue;
    }
  });

  it('releases fallback reservations without consuming quota', async () => {
    const reservation = await reserveAiInsightsQuotaForGenkit('user-1');
    const releasedStatus = await releaseAiInsightsQuotaReservation(reservation);
    const quotaStatus = await getAiInsightsQuotaStatus('user-1');

    expect(releasedStatus.successfulGenkitCount).toBe(0);
    expect(releasedStatus.activeReservationCount).toBe(0);
    expect(releasedStatus.remainingCount).toBe(AI_INSIGHTS_REQUEST_LIMITS.pro);
    expect(quotaStatus.successfulGenkitCount).toBe(0);
    expect(quotaStatus.remainingCount).toBe(AI_INSIGHTS_REQUEST_LIMITS.pro);
  });

  it('finalizes an existing reservation even if the user becomes ineligible afterward', async () => {
    const reservation = await reserveAiInsightsQuotaForGenkit('user-1');

    setAiInsightsQuotaDependenciesForTesting({
      now: () => new Date(FIXED_NOW_ISO),
      createReservationId: () => 'reservation-2',
      db: () => fakeDb as unknown as FirebaseFirestore.Firestore,
      getUserRoleAndGracePeriod: async () => ({ role: 'free' }),
      isGracePeriodActive: () => false,
      getActiveSubscriptionPeriod: async () => null,
      getLatestPaidSubscriptionPeriod: async () => null,
    });

    const finalizedStatus = await finalizeAiInsightsQuotaReservation(reservation);
    const storedDoc = fakeDb.getDocument(`users/user-1/aiInsightsUsage/${PERIOD_DOC_ID}`);

    expect(finalizedStatus.successfulGenkitCount).toBe(1);
    expect(finalizedStatus.activeReservationCount).toBe(0);
    expect(finalizedStatus.limit).toBe(AI_INSIGHTS_REQUEST_LIMITS.pro);
    expect(storedDoc?.successfulGenkitCount).toBe(1);
    expect(storedDoc?.reservationMap).toEqual({});
  });

  it('pins grace users to the last paid pro period when there is no active subscription', async () => {
    setAiInsightsQuotaDependenciesForTesting({
      now: () => new Date(FIXED_NOW_ISO),
      createReservationId: () => 'reservation-1',
      db: () => fakeDb as unknown as FirebaseFirestore.Firestore,
      getUserRoleAndGracePeriod: async () => ({ role: 'free', gracePeriodUntil: Date.parse('2026-03-25T00:00:00.000Z') }),
      isGracePeriodActive: (gracePeriodUntil?: number) => Boolean(gracePeriodUntil && gracePeriodUntil > Date.parse(FIXED_NOW_ISO)),
      getActiveSubscriptionPeriod: async () => null,
      getLatestPaidSubscriptionPeriod: async () => ({
        role: 'pro',
        startDate: PERIOD_START,
        endDate: PERIOD_END,
      }),
    });

    const quotaStatus = await getAiInsightsQuotaStatus('user-1');

    expect(quotaStatus.isEligible).toBe(true);
    expect(quotaStatus.periodKind).toBe('grace_hold');
    expect(quotaStatus.resetMode).toBe('next_successful_payment');
    expect(quotaStatus.periodStart).toBe(PERIOD_START);
    expect(quotaStatus.periodEnd).toBe(PERIOD_END);
  });

  it('pins grace users to the last paid basic period and limit when there is no active subscription', async () => {
    setAiInsightsQuotaDependenciesForTesting({
      now: () => new Date(FIXED_NOW_ISO),
      createReservationId: () => 'reservation-1',
      db: () => fakeDb as unknown as FirebaseFirestore.Firestore,
      getUserRoleAndGracePeriod: async () => ({ role: 'free', gracePeriodUntil: Date.parse('2026-03-25T00:00:00.000Z') }),
      isGracePeriodActive: (gracePeriodUntil?: number) => Boolean(gracePeriodUntil && gracePeriodUntil > Date.parse(FIXED_NOW_ISO)),
      getActiveSubscriptionPeriod: async () => null,
      getLatestPaidSubscriptionPeriod: async () => ({
        role: 'basic',
        startDate: PERIOD_START,
        endDate: PERIOD_END,
      }),
    });

    const quotaStatus = await getAiInsightsQuotaStatus('user-1');

    expect(quotaStatus.role).toBe('basic');
    expect(quotaStatus.limit).toBe(AI_INSIGHTS_REQUEST_LIMITS.basic);
    expect(quotaStatus.remainingCount).toBe(AI_INSIGHTS_REQUEST_LIMITS.basic);
    expect(quotaStatus.periodKind).toBe('grace_hold');
    expect(quotaStatus.resetMode).toBe('next_successful_payment');
  });

  it('prunes expired reservations before computing availability', async () => {
    fakeDb.seedDocument(`users/user-1/aiInsightsUsage/${PERIOD_DOC_ID}`, buildUsageDoc({
      successfulGenkitCount: 5,
      reservationMap: {
        expired: Date.parse('2026-03-19T11:00:00.000Z'),
      },
    }));

    const quotaStatus = await getAiInsightsQuotaStatus('user-1');
    const storedDoc = fakeDb.getDocument(`users/user-1/aiInsightsUsage/${PERIOD_DOC_ID}`);

    expect(quotaStatus.successfulGenkitCount).toBe(5);
    expect(quotaStatus.activeReservationCount).toBe(0);
    expect(quotaStatus.remainingCount).toBe(95);
    expect(storedDoc?.reservationMap).toEqual({
      expired: Date.parse('2026-03-19T11:00:00.000Z'),
    });
    expect(fakeDb.getWriteCount()).toBe(0);
  });

  it('does not write usage documents when quota status is fetched', async () => {
    fakeDb.seedDocument(`users/user-1/aiInsightsUsage/${PERIOD_DOC_ID}`, buildUsageDoc({
      successfulGenkitCount: 12,
      reservationMap: {
        active: Date.parse('2026-03-19T12:05:00.000Z'),
      },
    }));

    const quotaStatus = await getAiInsightsQuotaStatus('user-1');

    expect(quotaStatus.successfulGenkitCount).toBe(12);
    expect(quotaStatus.activeReservationCount).toBe(1);
    expect(quotaStatus.remainingCount).toBe(87);
    expect(fakeDb.getWriteCount()).toBe(0);
  });

  it('caps concurrent reservations at the configured limit', async () => {
    fakeDb.seedDocument(`users/user-1/aiInsightsUsage/${PERIOD_DOC_ID}`, buildUsageDoc({
      successfulGenkitCount: 99,
    }));

    const firstReservation = await reserveAiInsightsQuotaForGenkit('user-1');

    await expect(reserveAiInsightsQuotaForGenkit('user-1')).rejects.toMatchObject<HttpsError>({
      code: 'resource-exhausted',
    });

    expect(firstReservation.reservationID).toBe('reservation-1');
  });

  it('resolves the quota window only once when reserving quota', async () => {
    const getUserRoleAndGracePeriod = vi.fn(async () => ({ role: 'pro' as const }));
    const getActiveSubscriptionPeriod = vi.fn(async () => ({
      role: 'pro' as const,
      startDate: PERIOD_START,
      endDate: PERIOD_END,
    }));
    const getLatestPaidSubscriptionPeriod = vi.fn(async () => ({
      role: 'pro' as const,
      startDate: PERIOD_START,
      endDate: PERIOD_END,
    }));

    setAiInsightsQuotaDependenciesForTesting({
      now: () => new Date(FIXED_NOW_ISO),
      createReservationId: () => 'reservation-1',
      db: () => fakeDb as unknown as FirebaseFirestore.Firestore,
      getUserRoleAndGracePeriod,
      isGracePeriodActive: () => false,
      getActiveSubscriptionPeriod,
      getLatestPaidSubscriptionPeriod,
    });

    const reservation = await reserveAiInsightsQuotaForGenkit('user-1');

    expect(reservation.periodDocId).toBe(PERIOD_DOC_ID);
    expect(getUserRoleAndGracePeriod).toHaveBeenCalledTimes(1);
    expect(getActiveSubscriptionPeriod).toHaveBeenCalledTimes(1);
    expect(getLatestPaidSubscriptionPeriod).not.toHaveBeenCalled();
  });

  it('returns an eligible active basic period with the configured basic request limit', async () => {
    setAiInsightsQuotaDependenciesForTesting({
      now: () => new Date(FIXED_NOW_ISO),
      createReservationId: () => 'reservation-1',
      db: () => fakeDb as unknown as FirebaseFirestore.Firestore,
      getUserRoleAndGracePeriod: async () => ({ role: 'basic' }),
      isGracePeriodActive: () => false,
      getActiveSubscriptionPeriod: async () => ({
        role: 'basic',
        startDate: PERIOD_START,
        endDate: PERIOD_END,
      }),
      getLatestPaidSubscriptionPeriod: async () => null,
    });

    const quotaStatus = await getAiInsightsQuotaStatus('user-1');

    expect(quotaStatus.role).toBe('basic');
    expect(quotaStatus.limit).toBe(AI_INSIGHTS_REQUEST_LIMITS.basic);
    expect(quotaStatus.remainingCount).toBe(AI_INSIGHTS_REQUEST_LIMITS.basic);
    expect(quotaStatus.isEligible).toBe(true);
    expect(quotaStatus.periodKind).toBe('subscription');
  });

  it('returns an ineligible zero limit status for unpaid users without a billing period', async () => {
    setAiInsightsQuotaDependenciesForTesting({
      now: () => new Date(FIXED_NOW_ISO),
      createReservationId: () => 'reservation-1',
      db: () => fakeDb as unknown as FirebaseFirestore.Firestore,
      getUserRoleAndGracePeriod: async () => ({ role: 'free' }),
      isGracePeriodActive: () => false,
      getActiveSubscriptionPeriod: async () => null,
      getLatestPaidSubscriptionPeriod: async () => null,
    });

    const quotaStatus = await getAiInsightsQuotaStatus('user-1');

    expect(quotaStatus).toEqual({
      role: 'free',
      limit: 0,
      successfulGenkitCount: 0,
      activeReservationCount: 0,
      remainingCount: 0,
      periodStart: null,
      periodEnd: null,
      periodKind: 'no_billing_period',
      resetMode: 'next_successful_payment',
      isEligible: false,
      blockedReason: 'requires_pro',
    });
  });
});
