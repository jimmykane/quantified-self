import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';

const {
  mockCollection,
  mockRunTransaction,
  mockTransactionGet,
  mockTransactionSet,
  mockMetadataGet,
  mockReservationGet,
  mockReservationRef,
  mockGenerateEventID,
  mockGenerateIDFromParts,
  mockWarn,
  mockGetUserDeletionGuardStateInTransaction,
} = vi.hoisted(() => {
  const metadataRef = { path: 'users/uid-1/events/primary-event-id/metaData/COROS API' };
  const reservationRef = { path: 'users/uid-1/providerImportEventIDReservations/reservation-id' };
  const metadataGet = vi.fn();
  const reservationGet = vi.fn();
  const transactionGet = vi.fn(async (ref: unknown) => {
    if (ref === metadataRef) {
      return metadataGet();
    }
    if (ref === reservationRef) {
      return reservationGet();
    }
    throw new Error(`Unexpected transaction.get ref ${(ref as { path?: string })?.path || String(ref)}`);
  });
  const transactionSet = vi.fn();
  const runTransaction = vi.fn(async (runner: (transaction: unknown) => unknown) => runner({
    get: transactionGet,
    set: transactionSet,
  }));
  const metadataDoc = vi.fn(() => metadataRef);
  const eventMetadataCollection = vi.fn(() => ({ doc: metadataDoc }));
  const eventDoc = vi.fn(() => ({ collection: eventMetadataCollection }));
  const eventsCollection = vi.fn(() => ({ doc: eventDoc }));
  const reservationDoc = vi.fn(() => reservationRef);
  const reservationsCollection = vi.fn(() => ({ doc: reservationDoc }));
  const userDoc = vi.fn(() => ({
    collection: vi.fn((collectionName: string) => {
      if (collectionName === 'events') {
        return eventsCollection();
      }
      if (collectionName === 'providerImportEventIDReservations') {
        return reservationsCollection();
      }
      throw new Error(`Unexpected user subcollection ${collectionName}`);
    }),
  }));
  const collection = vi.fn((collectionName: string) => {
    if (collectionName === 'users') {
      return { doc: userDoc };
    }
    throw new Error(`Unexpected collection ${collectionName}`);
  });

  return {
    mockCollection: collection,
    mockRunTransaction: runTransaction,
    mockTransactionGet: transactionGet,
    mockTransactionSet: transactionSet,
    mockMetadataGet: metadataGet,
    mockReservationGet: reservationGet,
    mockReservationRef: reservationRef,
    mockGenerateEventID: vi.fn(),
    mockGenerateIDFromParts: vi.fn(),
    mockWarn: vi.fn(),
    mockGetUserDeletionGuardStateInTransaction: vi.fn(),
  };
});

vi.mock('firebase-admin', () => ({
  default: {
    firestore: () => ({
      collection: mockCollection,
      runTransaction: mockRunTransaction,
    }),
  },
  firestore: () => ({
    collection: mockCollection,
    runTransaction: mockRunTransaction,
  }),
}));

vi.mock('firebase-functions/logger', () => ({
  warn: mockWarn,
}));

vi.mock('../shared/user-deletion-guard', () => {
  class MockUserDeletionGuardReadError extends Error {
    readonly name = 'UserDeletionGuardReadError';

    constructor(
      public readonly uid: string,
      public readonly phase: string,
      public readonly originalError: unknown,
    ) {
      super(`Could not read deletion guard for user ${uid} during ${phase}.`);
    }
  }

  return {
    getUserDeletionGuardStateInTransaction: mockGetUserDeletionGuardStateInTransaction,
    UserDeletionGuardReadError: MockUserDeletionGuardReadError,
  };
});

vi.mock('../utils', () => {
  class MockEventWriteSkippedForDeletedUserError extends Error {
    readonly name = 'EventWriteSkippedForDeletedUserError';

    constructor(
      public readonly userID: string,
      public readonly phase: string,
    ) {
      super(`Skipping event write for user ${userID} during ${phase}.`);
    }
  }

  return {
    EventWriteSkippedForDeletedUserError: MockEventWriteSkippedForDeletedUserError,
    generateEventID: mockGenerateEventID,
    generateIDFromParts: mockGenerateIDFromParts,
  };
});

import { resolveProviderImportEventID } from './provider-event-id';

const corosRequest = {
  userID: 'uid-1',
  startDate: new Date('2026-07-08T10:00:00.000Z'),
  serviceName: ServiceNames.COROSAPI,
  providerEventID: 'workout-1',
  providerEventIDField: 'serviceWorkoutID',
  providerEventSecondaryID: 'https://coros.example/workout-1.fit',
  providerEventSecondaryIDField: 'serviceFITFileURI',
};

describe('resolveProviderImportEventID', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateEventID.mockResolvedValue('primary-event-id');
    mockGenerateIDFromParts.mockImplementation(async (parts: string[]) => parts.join('|'));
    mockMetadataGet.mockResolvedValue({ exists: false, data: () => undefined });
    mockReservationGet.mockResolvedValue({ exists: false, data: () => undefined });
    mockGetUserDeletionGuardStateInTransaction.mockResolvedValue({
      userExists: true,
      deletionInProgress: false,
      shouldSkip: false,
    });
  });

  it('uses and reserves the start-date event ID for the first provider identity in a bucket', async () => {
    const eventID = await resolveProviderImportEventID(corosRequest);

    expect(eventID).toBe('primary-event-id');
    expect(mockTransactionSet).toHaveBeenCalledWith(
      mockReservationRef,
      expect.objectContaining({
        serviceName: ServiceNames.COROSAPI,
        primaryEventID: 'primary-event-id',
        providerIdentities: {
          'uid-1|corosAPI|serviceWorkoutID|workout-1|serviceFITFileURI|https://coros.example/workout-1.fit': expect.objectContaining({
            eventID: 'primary-event-id',
          }),
        },
      }),
      { merge: true },
    );
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('keeps the reserved event ID for idempotent retry before service metadata exists', async () => {
    mockReservationGet.mockResolvedValue({
      exists: true,
      data: () => ({
        providerIdentities: {
          'uid-1|corosAPI|serviceWorkoutID|workout-1|serviceFITFileURI|https://coros.example/workout-1.fit': {
            eventID: 'primary-event-id',
          },
        },
      }),
    });

    const eventID = await resolveProviderImportEventID(corosRequest);

    expect(eventID).toBe('primary-event-id');
    expect(mockTransactionSet).not.toHaveBeenCalled();
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('uses a provider identity event ID when another identity already reserved the same service/start bucket', async () => {
    mockReservationGet.mockResolvedValue({
      exists: true,
      data: () => ({
        providerIdentities: {
          'uid-1|corosAPI|serviceWorkoutID|workout-2|serviceFITFileURI|https://coros.example/workout-2.fit': {
            eventID: 'primary-event-id',
          },
        },
      }),
    });

    const eventID = await resolveProviderImportEventID(corosRequest);

    expect(eventID).toBe('uid-1|corosAPI|serviceWorkoutID|workout-1|serviceFITFileURI|https://coros.example/workout-1.fit');
    expect(mockTransactionSet).toHaveBeenCalledWith(
      mockReservationRef,
      expect.objectContaining({
        providerIdentities: {
          'uid-1|corosAPI|serviceWorkoutID|workout-1|serviceFITFileURI|https://coros.example/workout-1.fit': expect.objectContaining({
            eventID: 'uid-1|corosAPI|serviceWorkoutID|workout-1|serviceFITFileURI|https://coros.example/workout-1.fit',
          }),
        },
      }),
      { merge: true },
    );
    expect(mockWarn).toHaveBeenCalledWith(
      '[Queue] Provider import event ID collision detected; using provider identity event ID.',
      expect.objectContaining({
        userID: 'uid-1',
        serviceName: ServiceNames.COROSAPI,
        primaryEventID: 'primary-event-id',
        collisionSafeEventID: 'uid-1|corosAPI|serviceWorkoutID|workout-1|serviceFITFileURI|https://coros.example/workout-1.fit',
        providerEventSecondaryIDPresent: true,
      }),
    );
    expect(mockWarn.mock.calls[0][1]).not.toHaveProperty('providerEventSecondaryID');
  });

  it('keeps the existing start-date event ID for idempotent retry of the same provider file after metadata exists', async () => {
    mockMetadataGet.mockResolvedValue({
      exists: true,
      data: () => ({
        serviceWorkoutID: 'workout-1',
        serviceFITFileURI: 'https://coros.example/workout-1.fit',
      }),
    });

    const eventID = await resolveProviderImportEventID(corosRequest);

    expect(eventID).toBe('primary-event-id');
    expect(mockTransactionSet).toHaveBeenCalled();
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('uses a provider identity event ID when the start-date event belongs to another provider file', async () => {
    mockMetadataGet.mockResolvedValue({
      exists: true,
      data: () => ({
        serviceWorkoutID: 'workout-2',
        serviceFITFileURI: 'https://coros.example/workout-2.fit',
      }),
    });

    const eventID = await resolveProviderImportEventID(corosRequest);

    expect(eventID).toBe('uid-1|corosAPI|serviceWorkoutID|workout-1|serviceFITFileURI|https://coros.example/workout-1.fit');
    expect(mockWarn).toHaveBeenCalled();
  });

  it('compares numeric metadata and provider identities by normalized string value', async () => {
    mockMetadataGet.mockResolvedValue({
      exists: true,
      data: () => ({
        serviceActivityFileID: 123,
        serviceActivityFileType: 'FIT',
      }),
    });

    const eventID = await resolveProviderImportEventID({
      userID: 'uid-1',
      startDate: new Date('2026-07-13T10:00:00.000Z'),
      serviceName: ServiceNames.GarminAPI,
      providerEventID: '123',
      providerEventIDField: 'serviceActivityFileID',
      providerEventSecondaryID: 'FIT',
      providerEventSecondaryIDField: 'serviceActivityFileType',
    });

    expect(eventID).toBe('primary-event-id');
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('uses a provider identity event ID when a provider needs stability across edited start times', async () => {
    const eventID = await resolveProviderImportEventID({
      userID: 'uid-1',
      startDate: new Date('2026-07-18T10:00:00.000Z'),
      serviceName: ServiceNames.WahooAPI,
      providerEventID: 'workout-1',
      providerEventIDField: 'serviceWorkoutID',
      providerEventSecondaryID: 'wahoo-user-1',
      providerEventSecondaryIDField: 'serviceUserID',
      preferProviderIdentityEventID: true,
    });

    expect(eventID).toBe('uid-1|wahooAPI|serviceWorkoutID|workout-1|serviceUserID|wahoo-user-1');
    expect(mockTransactionSet).toHaveBeenCalledWith(
      mockReservationRef,
      expect.objectContaining({
        providerIdentities: {
          'uid-1|wahooAPI|serviceWorkoutID|workout-1|serviceUserID|wahoo-user-1': expect.objectContaining({
            eventID: 'uid-1|wahooAPI|serviceWorkoutID|workout-1|serviceUserID|wahoo-user-1',
          }),
        },
      }),
      { merge: true },
    );
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('skips before writing a reservation when the user is deleted or deleting', async () => {
    mockGetUserDeletionGuardStateInTransaction.mockResolvedValue({
      userExists: false,
      deletionInProgress: false,
      shouldSkip: true,
    });

    await expect(resolveProviderImportEventID(corosRequest)).rejects.toMatchObject({
      name: 'EventWriteSkippedForDeletedUserError',
      userID: 'uid-1',
      phase: 'provider_import_event_id:corosAPI',
    });
    expect(mockTransactionSet).not.toHaveBeenCalled();
  });
});
