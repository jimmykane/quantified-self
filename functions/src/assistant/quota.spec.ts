import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';
import {
  createAssistantQuota,
  normalizeUsageDocRole,
  type AssistantQuotaApi,
  type AssistantQuotaDependencies,
} from './quota';
import { ASSISTANT_REQUEST_LIMITS } from '../../../shared/limits';

let quotaSubject = createAssistantQuota();

function setAssistantQuotaDependenciesForTesting(
  dependencies: Partial<AssistantQuotaDependencies> = {},
): void {
  quotaSubject = createAssistantQuota(dependencies);
}

async function withAssistantQuotaDependenciesForTesting<T>(
  dependencies: Partial<AssistantQuotaDependencies>,
  run: () => Promise<T> | T,
): Promise<T> {
  const previousSubject = quotaSubject;
  quotaSubject = createAssistantQuota(dependencies);
  try {
    return await run();
  } finally {
    quotaSubject = previousSubject;
  }
}

function getAssistantQuotaStatus(
  ...args: Parameters<AssistantQuotaApi['getAssistantQuotaStatus']>
): ReturnType<AssistantQuotaApi['getAssistantQuotaStatus']> {
  return quotaSubject.getAssistantQuotaStatus(...args);
}

function reserveAssistantQuotaForRequest(
  ...args: Parameters<AssistantQuotaApi['reserveAssistantQuotaForRequest']>
): ReturnType<AssistantQuotaApi['reserveAssistantQuotaForRequest']> {
  return quotaSubject.reserveAssistantQuotaForRequest(...args);
}

function finalizeAssistantQuotaReservation(
  ...args: Parameters<AssistantQuotaApi['finalizeAssistantQuotaReservation']>
): ReturnType<AssistantQuotaApi['finalizeAssistantQuotaReservation']> {
  return quotaSubject.finalizeAssistantQuotaReservation(...args);
}

function releaseAssistantQuotaReservation(
  ...args: Parameters<AssistantQuotaApi['releaseAssistantQuotaReservation']>
): ReturnType<AssistantQuotaApi['releaseAssistantQuotaReservation']> {
  return quotaSubject.releaseAssistantQuotaReservation(...args);
}

const FIXED_NOW_ISO = '2026-03-19T12:00:00.000Z';
const PERIOD_START = '2026-03-01T00:00:00.000Z';
const PERIOD_END = '2026-04-01T00:00:00.000Z';
const PERIOD_DOC_ID = 'period_1772323200000_1775001600000';

type StoredDoc = Record<string, unknown> | undefined;

class FakeDocumentSnapshot {
  constructor(private readonly storedDoc: StoredDoc) { }

  get exists(): boolean {
    return this.storedDoc !== undefined;
  }

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
    limit: ASSISTANT_REQUEST_LIMITS.pro,
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    periodKind: 'subscription',
    successfulRequestCount: 0,
    reservationMap: {},
    ...overrides,
  };
}

describe('Assistant quota', () => {
  let fakeDb: FakeFirestore;
  let reservationCounter: number;

  beforeEach(() => {
    fakeDb = new FakeFirestore();
    fakeDb.seedDocument('users/user-1', {});
    fakeDb.seedDocument('users/user-2', {});
    reservationCounter = 0;

    setAssistantQuotaDependenciesForTesting({
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
    setAssistantQuotaDependenciesForTesting();
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
    const reservation = await reserveAssistantQuotaForRequest('user-1');
    const finalizedStatus = await finalizeAssistantQuotaReservation(reservation);
    const quotaStatus = await getAssistantQuotaStatus('user-1');

    expect(reservation.periodDocId).toBe(PERIOD_DOC_ID);
    expect(finalizedStatus.successfulRequestCount).toBe(1);
    expect(finalizedStatus.activeRequestCount).toBe(0);
    expect(finalizedStatus.remainingCount).toBe(99);
    expect(quotaStatus.successfulRequestCount).toBe(1);
    expect(quotaStatus.remainingCount).toBe(99);
  });

  it('does not consume quota twice when a reservation is finalized again', async () => {
    const reservation = await reserveAssistantQuotaForRequest('user-1');

    await finalizeAssistantQuotaReservation(reservation);
    await expect(finalizeAssistantQuotaReservation(reservation))
      .rejects.toMatchObject<HttpsError>({ code: 'unavailable' });

    const storedDoc = fakeDb.getDocument(
      `users/user-1/assistantUsage/${reservation.periodDocId}`,
    );
    expect(storedDoc?.successfulRequestCount).toBe(1);
    expect(storedDoc?.reservationMap).toEqual({});
  });

  it('does not consume quota after a reservation expires', async () => {
    const reservation = await reserveAssistantQuotaForRequest('user-1');
    const usagePath = `users/user-1/assistantUsage/${reservation.periodDocId}`;
    fakeDb.seedDocument(usagePath, {
      ...fakeDb.getDocument(usagePath),
      reservationMap: {
        [reservation.reservationID]: Date.parse('2026-03-19T11:59:59.999Z'),
      },
    });

    await expect(finalizeAssistantQuotaReservation(reservation))
      .rejects.toMatchObject<HttpsError>({ code: 'unavailable' });

    expect(fakeDb.getDocument(usagePath)?.successfulRequestCount).toBe(0);
  });

  it('scopes quota dependency overrides and restores previous test dependencies', async () => {
    const scopedReservation = await withAssistantQuotaDependenciesForTesting({
      now: () => new Date(FIXED_NOW_ISO),
      createReservationId: () => 'scoped-reservation',
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
    }, async () => reserveAssistantQuotaForRequest('user-1'));

    const restoredReservation = await reserveAssistantQuotaForRequest('user-2');

    expect(scopedReservation.reservationID).toBe('scoped-reservation');
    expect(restoredReservation.reservationID).toBe('reservation-1');
  });

  it('stores usage timestamps without depending on admin.firestore.FieldValue', async () => {
    const originalFieldValue = (admin.firestore as typeof admin.firestore & { FieldValue?: unknown }).FieldValue;
    (admin.firestore as typeof admin.firestore & { FieldValue?: unknown }).FieldValue = undefined;

    try {
      const reservation = await reserveAssistantQuotaForRequest('user-1');
      const storedDoc = fakeDb.getDocument(`users/user-1/assistantUsage/${reservation.periodDocId}`);

      expect(storedDoc?.updatedAt).toBe(FIXED_NOW_ISO);
    } finally {
      (admin.firestore as typeof admin.firestore & { FieldValue?: unknown }).FieldValue = originalFieldValue;
    }
  });

  it('releases fallback reservations without consuming quota', async () => {
    const reservation = await reserveAssistantQuotaForRequest('user-1');
    const releasedStatus = await releaseAssistantQuotaReservation(reservation);
    const quotaStatus = await getAssistantQuotaStatus('user-1');

    expect(releasedStatus.successfulRequestCount).toBe(0);
    expect(releasedStatus.activeRequestCount).toBe(0);
    expect(releasedStatus.remainingCount).toBe(ASSISTANT_REQUEST_LIMITS.pro);
    expect(quotaStatus.successfulRequestCount).toBe(0);
    expect(quotaStatus.remainingCount).toBe(ASSISTANT_REQUEST_LIMITS.pro);
  });

  it('treats release as an idempotent no-op once a reservation is gone', async () => {
    const reservation = await reserveAssistantQuotaForRequest('user-1');
    await releaseAssistantQuotaReservation(reservation);
    const writesAfterFirstRelease = fakeDb.getWriteCount();

    const releasedAgain = await releaseAssistantQuotaReservation(reservation);

    expect(releasedAgain.successfulRequestCount).toBe(0);
    expect(releasedAgain.activeRequestCount).toBe(0);
    expect(fakeDb.getWriteCount()).toBe(writesAfterFirstRelease);
  });

  it('does not create or update quota state after account deletion starts', async () => {
    fakeDb.seedDocument('userDeletionTombstones/user-1', {
      expireAt: new Date('2026-03-20T12:00:00.000Z'),
    });

    await expect(reserveAssistantQuotaForRequest('user-1'))
      .rejects.toMatchObject<HttpsError>({ code: 'permission-denied' });
    expect(fakeDb.getDocument(`users/user-1/assistantUsage/${PERIOD_DOC_ID}`))
      .toBeUndefined();
    expect(fakeDb.getWriteCount()).toBe(0);
  });

  it('does not finalize or release an existing reservation after deletion starts', async () => {
    const reservation = await reserveAssistantQuotaForRequest('user-1');
    const usagePath = `users/user-1/assistantUsage/${PERIOD_DOC_ID}`;
    const storedBeforeDeletion = fakeDb.getDocument(usagePath);
    const writesBeforeDeletion = fakeDb.getWriteCount();
    fakeDb.seedDocument('userDeletionTombstones/user-1', {
      expireAt: new Date('2026-03-20T12:00:00.000Z'),
    });

    await expect(finalizeAssistantQuotaReservation(reservation))
      .rejects.toMatchObject<HttpsError>({ code: 'permission-denied' });
    await expect(releaseAssistantQuotaReservation(reservation))
      .rejects.toMatchObject<HttpsError>({ code: 'permission-denied' });
    expect(fakeDb.getDocument(usagePath)).toEqual(storedBeforeDeletion);
    expect(fakeDb.getWriteCount()).toBe(writesBeforeDeletion);
  });

  it('finalizes an existing reservation even if the user becomes ineligible afterward', async () => {
    const reservation = await reserveAssistantQuotaForRequest('user-1');

    setAssistantQuotaDependenciesForTesting({
      now: () => new Date(FIXED_NOW_ISO),
      createReservationId: () => 'reservation-2',
      db: () => fakeDb as unknown as FirebaseFirestore.Firestore,
      getUserRoleAndGracePeriod: async () => ({ role: 'free' }),
      isGracePeriodActive: () => false,
      getActiveSubscriptionPeriod: async () => null,
      getLatestPaidSubscriptionPeriod: async () => null,
    });

    const finalizedStatus = await finalizeAssistantQuotaReservation(reservation);
    const storedDoc = fakeDb.getDocument(`users/user-1/assistantUsage/${PERIOD_DOC_ID}`);

    expect(finalizedStatus.successfulRequestCount).toBe(1);
    expect(finalizedStatus.activeRequestCount).toBe(0);
    expect(finalizedStatus.limit).toBe(ASSISTANT_REQUEST_LIMITS.pro);
    expect(storedDoc?.successfulRequestCount).toBe(1);
    expect(storedDoc?.reservationMap).toEqual({});
  });

  it('pins grace users to the last paid pro period when there is no active subscription', async () => {
    setAssistantQuotaDependenciesForTesting({
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

    const quotaStatus = await getAssistantQuotaStatus('user-1');

    expect(quotaStatus.isEligible).toBe(true);
    expect(quotaStatus.periodKind).toBe('grace_hold');
    expect(quotaStatus.resetMode).toBe('next_successful_payment');
    expect(quotaStatus.periodStart).toBe(PERIOD_START);
    expect(quotaStatus.periodEnd).toBe(PERIOD_END);
  });

  it('pins grace users to the last paid basic period and limit when there is no active subscription', async () => {
    setAssistantQuotaDependenciesForTesting({
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

    const quotaStatus = await getAssistantQuotaStatus('user-1');

    expect(quotaStatus.role).toBe('basic');
    expect(quotaStatus.limit).toBe(ASSISTANT_REQUEST_LIMITS.basic);
    expect(quotaStatus.remainingCount).toBe(ASSISTANT_REQUEST_LIMITS.basic);
    expect(quotaStatus.periodKind).toBe('grace_hold');
    expect(quotaStatus.resetMode).toBe('next_successful_payment');
  });

  it('prunes expired reservations before computing availability', async () => {
    fakeDb.seedDocument(`users/user-1/assistantUsage/${PERIOD_DOC_ID}`, buildUsageDoc({
      successfulRequestCount: 5,
      reservationMap: {
        expired: Date.parse('2026-03-19T11:00:00.000Z'),
      },
    }));

    const quotaStatus = await getAssistantQuotaStatus('user-1');
    const storedDoc = fakeDb.getDocument(`users/user-1/assistantUsage/${PERIOD_DOC_ID}`);

    expect(quotaStatus.successfulRequestCount).toBe(5);
    expect(quotaStatus.activeRequestCount).toBe(0);
    expect(quotaStatus.remainingCount).toBe(95);
    expect(storedDoc?.reservationMap).toEqual({
      expired: Date.parse('2026-03-19T11:00:00.000Z'),
    });
    expect(fakeDb.getWriteCount()).toBe(0);
  });

  it('does not write usage documents when quota status is fetched', async () => {
    fakeDb.seedDocument(`users/user-1/assistantUsage/${PERIOD_DOC_ID}`, buildUsageDoc({
      successfulRequestCount: 12,
      reservationMap: {
        active: Date.parse('2026-03-19T12:05:00.000Z'),
      },
    }));

    const quotaStatus = await getAssistantQuotaStatus('user-1');

    expect(quotaStatus.successfulRequestCount).toBe(12);
    expect(quotaStatus.activeRequestCount).toBe(1);
    expect(quotaStatus.remainingCount).toBe(87);
    expect(fakeDb.getWriteCount()).toBe(0);
  });

  it('caps concurrent reservations at the configured limit', async () => {
    fakeDb.seedDocument(`users/user-1/assistantUsage/${PERIOD_DOC_ID}`, buildUsageDoc({
      successfulRequestCount: 99,
    }));

    const firstReservation = await reserveAssistantQuotaForRequest('user-1');

    await expect(reserveAssistantQuotaForRequest('user-1')).rejects.toMatchObject<HttpsError>({
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

    setAssistantQuotaDependenciesForTesting({
      now: () => new Date(FIXED_NOW_ISO),
      createReservationId: () => 'reservation-1',
      db: () => fakeDb as unknown as FirebaseFirestore.Firestore,
      getUserRoleAndGracePeriod,
      isGracePeriodActive: () => false,
      getActiveSubscriptionPeriod,
      getLatestPaidSubscriptionPeriod,
    });

    const reservation = await reserveAssistantQuotaForRequest('user-1');

    expect(reservation.periodDocId).toBe(PERIOD_DOC_ID);
    expect(getUserRoleAndGracePeriod).toHaveBeenCalledTimes(1);
    expect(getActiveSubscriptionPeriod).toHaveBeenCalledTimes(1);
    expect(getLatestPaidSubscriptionPeriod).not.toHaveBeenCalled();
  });

  it('returns an eligible active basic period with the configured basic request limit', async () => {
    setAssistantQuotaDependenciesForTesting({
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

    const quotaStatus = await getAssistantQuotaStatus('user-1');

    expect(quotaStatus.role).toBe('basic');
    expect(quotaStatus.limit).toBe(ASSISTANT_REQUEST_LIMITS.basic);
    expect(quotaStatus.remainingCount).toBe(ASSISTANT_REQUEST_LIMITS.basic);
    expect(quotaStatus.isEligible).toBe(true);
    expect(quotaStatus.periodKind).toBe('subscription');
  });

  it('returns an eligible calendar-month quota for free users without a billing period', async () => {
    setAssistantQuotaDependenciesForTesting({
      now: () => new Date(FIXED_NOW_ISO),
      createReservationId: () => 'reservation-1',
      db: () => fakeDb as unknown as FirebaseFirestore.Firestore,
      getUserRoleAndGracePeriod: async () => ({ role: 'free' }),
      isGracePeriodActive: () => false,
      getActiveSubscriptionPeriod: async () => null,
      getLatestPaidSubscriptionPeriod: async () => null,
    });

    const quotaStatus = await getAssistantQuotaStatus('user-1');

    expect(quotaStatus).toEqual({
      role: 'free',
      limit: ASSISTANT_REQUEST_LIMITS.free,
      successfulRequestCount: 0,
      activeRequestCount: 0,
      remainingCount: ASSISTANT_REQUEST_LIMITS.free,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      periodKind: 'calendar_month',
      resetMode: 'date',
      isEligible: true,
      blockedReason: null,
    });
  });

  it('reserves and finalizes free user quota in the calendar-month window', async () => {
    setAssistantQuotaDependenciesForTesting({
      now: () => new Date(FIXED_NOW_ISO),
      createReservationId: () => 'reservation-1',
      db: () => fakeDb as unknown as FirebaseFirestore.Firestore,
      getUserRoleAndGracePeriod: async () => ({ role: 'free' }),
      isGracePeriodActive: () => false,
      getActiveSubscriptionPeriod: async () => null,
      getLatestPaidSubscriptionPeriod: async () => null,
    });

    const reservation = await reserveAssistantQuotaForRequest('user-1');
    const finalizedStatus = await finalizeAssistantQuotaReservation(reservation);

    expect(reservation).toMatchObject({
      role: 'free',
      limit: ASSISTANT_REQUEST_LIMITS.free,
      periodDocId: PERIOD_DOC_ID,
      periodKind: 'calendar_month',
      resetMode: 'date',
      isEligible: true,
    });
    expect(finalizedStatus.successfulRequestCount).toBe(1);
    expect(finalizedStatus.remainingCount).toBe(ASSISTANT_REQUEST_LIMITS.free - 1);
  });

  it('returns an ineligible status for paid users when no billing window can be resolved', async () => {
    setAssistantQuotaDependenciesForTesting({
      now: () => new Date(FIXED_NOW_ISO),
      createReservationId: () => 'reservation-1',
      db: () => fakeDb as unknown as FirebaseFirestore.Firestore,
      getUserRoleAndGracePeriod: async () => ({ role: 'basic' }),
      isGracePeriodActive: () => false,
      getActiveSubscriptionPeriod: async () => null,
      getLatestPaidSubscriptionPeriod: async () => null,
    });

    const quotaStatus = await getAssistantQuotaStatus('user-1');

    expect(quotaStatus).toEqual({
      role: 'basic',
      limit: ASSISTANT_REQUEST_LIMITS.basic,
      successfulRequestCount: 0,
      activeRequestCount: 0,
      remainingCount: 0,
      periodStart: null,
      periodEnd: null,
      periodKind: 'no_billing_period',
      resetMode: 'next_successful_payment',
      isEligible: false,
      blockedReason: 'requires_pro',
    });
  });

  it('rejects reservation for paid users without a resolvable billing window before internal failures', async () => {
    setAssistantQuotaDependenciesForTesting({
      now: () => new Date(FIXED_NOW_ISO),
      createReservationId: () => 'reservation-1',
      db: () => fakeDb as unknown as FirebaseFirestore.Firestore,
      getUserRoleAndGracePeriod: async () => ({ role: 'pro' }),
      isGracePeriodActive: () => false,
      getActiveSubscriptionPeriod: async () => null,
      getLatestPaidSubscriptionPeriod: async () => null,
    });

    await expect(reserveAssistantQuotaForRequest('user-1')).rejects.toMatchObject<HttpsError>({
      code: 'permission-denied',
      message: 'Assistant is unavailable for this account.',
    });
  });
});
