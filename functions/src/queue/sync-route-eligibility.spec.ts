import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import type { QueueItemInterface } from './queue-item.interface';

const mocks = vi.hoisted(() => {
  const queueRef = { id: 'queue-1', parent: { id: 'activitySyncQueue' } };
  const settingsRef = { id: 'settings' };
  const sourceMetaRef = { id: 'suuntoApp' };
  const destinationMetaRef = { id: 'wahooAPI' };
  const runTransaction = vi.fn();
  const transactionUpdate = vi.fn();
  const deletionGuard = vi.fn();
  const deleteSentinel = Symbol('delete');
  return {
    queueRef,
    settingsRef,
    sourceMetaRef,
    destinationMetaRef,
    runTransaction,
    transactionUpdate,
    deletionGuard,
    deleteSentinel,
  };
});

vi.mock('firebase-admin', () => ({
  firestore: () => ({
    runTransaction: mocks.runTransaction,
    collection: (collectionName: string) => {
      if (collectionName !== 'users') throw new Error(`Unexpected collection ${collectionName}`);
      return {
        doc: () => ({
          collection: (nestedCollection: string) => ({
            doc: (documentID: string) => {
              if (nestedCollection === 'config' && documentID === 'settings') return mocks.settingsRef;
              if (nestedCollection === 'meta' && documentID === ServiceNames.SuuntoApp) return mocks.sourceMetaRef;
              if (nestedCollection === 'meta' && documentID === ServiceNames.WahooAPI) return mocks.destinationMetaRef;
              throw new Error(`Unexpected document ${nestedCollection}/${documentID}`);
            },
          }),
        }),
      };
    },
  }),
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { delete: () => mocks.deleteSentinel },
}));

vi.mock('../shared/user-deletion-guard', () => ({
  getUserDeletionGuardStateInTransaction: mocks.deletionGuard,
}));

import {
  DisabledSyncRouteTransitionResult,
  finalizeDisabledSyncRouteIfCurrent,
} from './sync-route-eligibility';

function queueItem(): QueueItemInterface {
  return {
    id: 'queue-1',
    ref: mocks.queueRef,
    dateCreated: 1,
    processed: false as const,
    retryCount: 0,
    dispatchedToCloudTask: 123,
  } as unknown as QueueItemInterface;
}

function installTransaction(
  settingsEnabled: boolean,
  routeRestorePending: boolean,
  connectionState?: string,
  routeRestoreParkingClosed = false,
): void {
  mocks.runTransaction.mockImplementation(async (callback: (transaction: unknown) => unknown) => callback({
    get: vi.fn(async (target: unknown) => {
      if (target === mocks.queueRef) return { exists: true, data: () => ({ processed: false }) };
      if (target === mocks.settingsRef) {
        return {
          exists: true,
          data: () => ({
            serviceSyncSettings: {
              activitySyncRoutes: { routeA: { enabled: settingsEnabled } },
            },
          }),
        };
      }
      if (target === mocks.sourceMetaRef || target === mocks.destinationMetaRef) {
        return {
          exists: true,
          data: () => ({ routeRestorePending, routeRestoreParkingClosed, connectionState }),
        };
      }
      throw new Error('Unexpected transaction target');
    }),
    update: mocks.transactionUpdate,
  }));
}

describe('finalizeDisabledSyncRouteIfCurrent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deletionGuard.mockResolvedValue({ shouldSkip: false });
  });

  it('defers the current row when route restoration has not completed', async () => {
    installTransaction(false, true);

    await expect(finalizeDisabledSyncRouteIfCurrent({
      queueItem: queueItem(),
      userID: 'user-1',
      routeId: 'routeA',
      settingsKind: 'activitySyncRoutes',
      serviceNames: [ServiceNames.SuuntoApp, ServiceNames.WahooAPI],
      isCurrent: current => current.processed !== true,
    })).resolves.toEqual({ result: DisabledSyncRouteTransitionResult.DeferredForRestore });

    expect(mocks.transactionUpdate).toHaveBeenCalledWith(mocks.queueRef, expect.objectContaining({
      processed: true,
      resultStatus: 'deferred',
      deferredReason: 'route_restore_pending',
      deferredContext: JSON.stringify({
        serviceName: ServiceNames.SuuntoApp,
        settingsKind: 'activitySyncRoutes',
        routeId: 'routeA',
      }),
      dispatchedToCloudTask: null,
    }));
  });

  it('continues instead of skipping when restoration enabled the route', async () => {
    installTransaction(true, false);

    await expect(finalizeDisabledSyncRouteIfCurrent({
      queueItem: queueItem(),
      userID: 'user-1',
      routeId: 'routeA',
      settingsKind: 'activitySyncRoutes',
      serviceNames: [ServiceNames.SuuntoApp, ServiceNames.WahooAPI],
      isCurrent: current => current.processed !== true,
    })).resolves.toEqual({ result: DisabledSyncRouteTransitionResult.Enabled });

    expect(mocks.transactionUpdate).not.toHaveBeenCalled();
  });

  it('does not create a new parked row after restoration closes its parking barrier', async () => {
    installTransaction(false, true, undefined, true);

    await expect(finalizeDisabledSyncRouteIfCurrent({
      queueItem: queueItem(),
      userID: 'user-1',
      routeId: 'routeA',
      settingsKind: 'activitySyncRoutes',
      serviceNames: [ServiceNames.SuuntoApp, ServiceNames.WahooAPI],
      isCurrent: current => current.processed !== true,
    })).resolves.toEqual({ result: DisabledSyncRouteTransitionResult.ProcessedAsDisabled });

    expect(mocks.transactionUpdate).toHaveBeenCalledWith(mocks.queueRef, expect.objectContaining({
      processed: true,
      resultStatus: 'skipped',
      skippedReason: 'route_disabled',
    }));
  });

  it('returns the authoritative reconnect state instead of finalizing a concurrently disabled route', async () => {
    installTransaction(false, false, 'reconnect_required');

    await expect(finalizeDisabledSyncRouteIfCurrent({
      queueItem: queueItem(),
      userID: 'user-1',
      routeId: 'routeA',
      settingsKind: 'activitySyncRoutes',
      serviceNames: [ServiceNames.SuuntoApp, ServiceNames.WahooAPI],
      isCurrent: current => current.processed !== true,
    })).resolves.toEqual({
      result: DisabledSyncRouteTransitionResult.ReconnectRequired,
      serviceName: ServiceNames.SuuntoApp,
    });

    expect(mocks.transactionUpdate).not.toHaveBeenCalled();
  });

  it('parks for a concurrent reconnect requirement even if the route was re-enabled', async () => {
    installTransaction(true, false, 'reconnect_required');

    await expect(finalizeDisabledSyncRouteIfCurrent({
      queueItem: queueItem(),
      userID: 'user-1',
      routeId: 'routeA',
      settingsKind: 'activitySyncRoutes',
      serviceNames: [ServiceNames.SuuntoApp, ServiceNames.WahooAPI],
      isCurrent: current => current.processed !== true,
    })).resolves.toEqual({
      result: DisabledSyncRouteTransitionResult.ReconnectRequired,
      serviceName: ServiceNames.SuuntoApp,
    });

    expect(mocks.transactionUpdate).not.toHaveBeenCalled();
  });

  it('finalizes a current row only when the route remains disabled without pending restoration', async () => {
    installTransaction(false, false);

    await expect(finalizeDisabledSyncRouteIfCurrent({
      queueItem: queueItem(),
      userID: 'user-1',
      routeId: 'routeA',
      settingsKind: 'activitySyncRoutes',
      serviceNames: [ServiceNames.SuuntoApp, ServiceNames.WahooAPI],
      isCurrent: current => current.processed !== true,
    })).resolves.toEqual({ result: DisabledSyncRouteTransitionResult.ProcessedAsDisabled });

    expect(mocks.transactionUpdate).toHaveBeenCalledWith(mocks.queueRef, expect.objectContaining({
      processed: true,
      resultStatus: 'skipped',
      skippedReason: 'route_disabled',
    }));
  });
});
