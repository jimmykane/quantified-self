import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const tokenRootRef = { path: 'COROSAPIAccessTokens/user-1' };
  const tokenRef = { path: 'COROSAPIAccessTokens/user-1/tokens/open-id', parent: { parent: tokenRootRef } };
  const metaRef = { path: 'users/user-1/meta/corosAPI' };
  const settingsRef = { path: 'users/user-1/config/settings' };
  const rateLimitRef = { path: 'providerOperationLimits/coros-binding-state' };
  const refs = new Map([
    [metaRef.path, metaRef],
    [settingsRef.path, settingsRef],
  ]);
  const doc = vi.fn((id: string) => ({
    collection: vi.fn((collectionName: string) => ({
      doc: vi.fn((documentID: string) => refs.get(`users/${id}/${collectionName}/${documentID}`)
        || { path: `users/${id}/${collectionName}/${documentID}` }),
    })),
  }));
  const collection = vi.fn((collectionName: string) => {
    if (collectionName === 'users') return { doc };
    if (collectionName === 'providerOperationLimits') {
      return {
        doc: vi.fn((documentID: string) => {
          if (documentID !== 'coros-binding-state') {
            throw new Error(`Unexpected rate-limit document ${documentID}`);
          }
          return rateLimitRef;
        }),
      };
    }
    throw new Error(`Unexpected collection ${collectionName}`);
  });
  return {
    tokenRef,
    tokenRootRef,
    metaRef,
    settingsRef,
    rateLimitRef,
    collection,
    requestGet: vi.fn(),
    transactionGet: vi.fn(),
    transactionSet: vi.fn(),
    runTransaction: vi.fn(),
    getActiveCOROSTokenSnapshot: vi.fn(),
    getUserDeletionGuardStateInTransaction: vi.fn(),
    loggerWarn: vi.fn(),
    updateHealthSyncState: vi.fn(),
  };
});

vi.mock('firebase-admin', () => {
  const firestore = Object.assign(() => ({
    collection: mocks.collection,
    runTransaction: mocks.runTransaction,
  }), {});
  return { default: { firestore }, firestore };
});

vi.mock('firebase-functions/logger', () => ({
  info: vi.fn(),
  warn: mocks.loggerWarn,
  error: vi.fn(),
}));

vi.mock('../request-helper', () => ({
  get: mocks.requestGet,
}));

vi.mock('../health/writer', () => ({ updateHealthSyncState: mocks.updateHealthSyncState }));

vi.mock('../service-token-store', async importOriginal => ({
  ...await importOriginal<typeof import('../service-token-store')>(),
  getServiceTokenCollectionRef: () => ({ doc: () => mocks.tokenRef }),
}));

vi.mock('./account', () => ({
  getActiveCOROSTokenSnapshot: mocks.getActiveCOROSTokenSnapshot,
  normalizeCOROSOpenId: (value: unknown) => {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized && !normalized.includes('/') ? normalized : null;
  },
}));

vi.mock('../shared/user-deletion-guard', () => ({
  getUserDeletionGuardStateInTransaction: mocks.getUserDeletionGuardStateInTransaction,
  UserDeletionGuardReadError: class UserDeletionGuardReadError extends Error {
    readonly name = 'UserDeletionGuardReadError';
    constructor(
      public readonly uid: string,
      public readonly phase: string,
      public readonly originalError: unknown,
    ) {
      super('Could not read deletion guard.');
    }
  },
}));

import {
  checkCOROSBindingStateForUser,
  handleCOROSBindingStateRequest,
} from './binding-state';
import { getTokenCredentialSnapshot } from '../token-refresh-coordinator';

describe('COROS binding state', () => {
  let currentTokenData: Record<string, unknown>;
  let currentMetaData: Record<string, unknown>;
  let currentRateLimitData: Record<string, unknown>;
  let currentRootData: Record<string, unknown> | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    currentTokenData = { accessToken: 'stored-access-token', openId: 'open-id', dateCreated: 100 };
    currentMetaData = { connectionState: 'connected', providerUserId: 'open-id' };
    currentRateLimitData = {};
    currentRootData = {};
    mocks.updateHealthSyncState.mockReset().mockResolvedValue(true);
    mocks.getActiveCOROSTokenSnapshot.mockResolvedValue({
      id: 'open-id',
      ref: mocks.tokenRef,
      exists: true,
      data: () => ({ accessToken: 'stored-access-token', openId: 'open-id', dateCreated: 100 }),
    });
    mocks.getUserDeletionGuardStateInTransaction.mockResolvedValue({
      userExists: true,
      deletionInProgress: false,
      shouldSkip: false,
    });
    mocks.transactionGet.mockImplementation(async (ref: { path?: string }) => {
      if (ref === mocks.tokenRef) {
        return { exists: true, data: () => currentTokenData };
      }
      if (ref === mocks.tokenRootRef) {
        return { exists: !!currentRootData, data: () => currentRootData };
      }
      if (ref === mocks.metaRef) {
        return { exists: true, data: () => currentMetaData };
      }
      if (ref === mocks.rateLimitRef) {
        return { exists: true, data: () => currentRateLimitData };
      }
      throw new Error(`Unexpected transaction ref ${ref?.path}`);
    });
    mocks.transactionSet.mockImplementation((ref: unknown, data: Record<string, unknown>) => {
      if (ref === mocks.metaRef) currentMetaData = { ...currentMetaData, ...data };
      if (ref === mocks.rateLimitRef) currentRateLimitData = { ...currentRateLimitData, ...data };
    });
    mocks.runTransaction.mockImplementation(async (runner: (transaction: unknown) => unknown) => runner({
      get: mocks.transactionGet,
      set: mocks.transactionSet,
    }));
  });

  function recoveryTarget() {
    return { providerUserId: 'open-id', connectionGeneration: undefined, credential: getTokenCredentialSnapshot(currentTokenData) };
  }

  it('rechecks a fresh cached bound result after a worker authorization error and settles Health state on confirmed unbind', async () => {
    currentMetaData = { ...currentMetaData, providerBindingState: 'bound', providerBindingCheckedAt: 4_000 };
    mocks.requestGet.mockResolvedValueOnce('{"result":"0000","data":{"bindState":0}}');

    await expect(checkCOROSBindingStateForUser('user-1', 5_000, recoveryTarget())).resolves.toMatchObject({ status: 'unbound' });
    expect(mocks.getActiveCOROSTokenSnapshot).not.toHaveBeenCalled();
    expect(mocks.requestGet).toHaveBeenCalledOnce();
    expect(mocks.updateHealthSyncState).toHaveBeenCalledWith('user-1', 'COROSAPI', {
      status: 'reconnect_required', lastErrorCode: 'provider_auth_reconnect_required', retryPending: false,
    }, 5_000, expect.objectContaining({ transaction: expect.any(Object), authoritativeLifecycleTransition: true }));
    expect(currentMetaData).toMatchObject({ connectionState: 'reconnect_required', providerBindingState: 'unbound' });
  });

  it('keeps the existing lease and rejects a recovery check instead of returning a cached result while another check runs', async () => {
    currentMetaData = { ...currentMetaData, providerBindingState: 'bound', providerBindingCheckedAt: 4_000,
      providerBindingCheckLeaseExpiresAt: 6_000 };
    await expect(checkCOROSBindingStateForUser('user-1', 5_000, recoveryTarget()))
      .rejects.toMatchObject({ code: 'resource-exhausted' });
    expect(mocks.requestGet).not.toHaveBeenCalled();
    expect(mocks.transactionSet).not.toHaveBeenCalled();
  });

  it.each([
    ['worker', 'connection'], ['worker', 'token'], ['worker', 'root'],
    ['callable', 'connection'], ['callable', 'token'], ['callable', 'root'], ['callable', 'disconnect fence'],
  ] as const)('discards a late %s unbound response after the %s changes', async (caller, change) => {
    const target = caller === 'worker' ? recoveryTarget() : undefined;
    mocks.requestGet.mockImplementationOnce(async () => {
      if (change === 'connection') currentMetaData.connectionStateGeneration = 'replacement-connection';
      if (change === 'token') currentTokenData.dateRefreshed = 7_000;
      if (change === 'root') currentRootData = { activeOAuthCredentialGeneration: 'replacement-root' };
      if (change === 'disconnect fence') currentRootData = { disconnectOperationGeneration: 'pending-disconnect' };
      return '{"result":"0000","data":{"bindState":0}}';
    });

    await expect(checkCOROSBindingStateForUser('user-1', 5_000, target)).resolves.toMatchObject({ status: 'stale' });
    expect(currentMetaData.connectionState).toBe('connected');
    expect(mocks.updateHealthSyncState).not.toHaveBeenCalled();
    expect(mocks.transactionSet.mock.calls.some(([ref]) => ref === mocks.settingsRef)).toBe(false);
  });

  it('records a current bound state without changing lifecycle or routes', async () => {
    mocks.requestGet.mockResolvedValue(JSON.stringify({
      result: '0000',
      message: 'OK',
      data: { bindState: 1 },
    }));

    await expect(checkCOROSBindingStateForUser('user-1', 1234)).resolves.toEqual({
      status: 'bound',
      bound: true,
      checkedAt: 1234,
    });

    expect(mocks.requestGet).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://open.coros.com/coros/bindState?token=stored-access-token&openId=open-id',
      headers: { token: 'stored-access-token' },
      timeout: 30_000,
      maxResponseBytes: 16 * 1024,
    }));
    expect(mocks.transactionSet).toHaveBeenCalledWith(mocks.metaRef, {
      providerBindingState: 'bound',
      providerBindingCheckedAt: 1234,
      providerBindingCheckLeaseId: null,
      providerBindingCheckLeaseExpiresAt: 0,
      providerBindingCheckNextRetryAt: 0,
    }, { merge: true });
    expect(mocks.transactionSet).toHaveBeenCalledWith(mocks.rateLimitRef, expect.objectContaining({
      provider: 'COROS',
      operation: 'binding_state',
      count: 1,
    }), { merge: true });
    expect(mocks.updateHealthSyncState).not.toHaveBeenCalled();
  });

  it('atomically marks Connections and Health for reconnect and disables every COROS sync route', async () => {
    mocks.requestGet.mockResolvedValue(JSON.stringify({
      result: '0000',
      data: { bindState: 0 },
    }));

    await expect(checkCOROSBindingStateForUser('user-1', 5678)).resolves.toEqual({
      status: 'unbound',
      bound: false,
      checkedAt: 5678,
    });

    expect(mocks.updateHealthSyncState).toHaveBeenCalledExactlyOnceWith('user-1', 'COROSAPI', {
      status: 'reconnect_required', lastErrorCode: 'provider_auth_reconnect_required', retryPending: false,
    }, 5678, expect.objectContaining({
      transaction: expect.objectContaining({ set: mocks.transactionSet }),
      authoritativeLifecycleTransition: true,
      requiredDocumentFieldValues: {
        documentRef: mocks.metaRef,
        expectedFields: { providerUserId: 'open-id', connectionState: 'connected', connectionStateGeneration: undefined },
      },
    }));
    expect(mocks.transactionSet).toHaveBeenCalledWith(mocks.metaRef, expect.objectContaining({
      connectionState: 'reconnect_required',
      providerBindingState: 'unbound',
      providerBindingCheckedAt: 5678,
      providerBindingCheckLeaseId: null,
      providerBindingCheckLeaseExpiresAt: 0,
      providerBindingCheckNextRetryAt: 0,
      lastAuthFailureCode: 'coros_unbound',
      lastDisconnectedAt: 5678,
    }), { merge: true });
    expect(mocks.transactionSet).toHaveBeenCalledWith(mocks.settingsRef, {
      serviceSyncSettings: {
        activitySyncRoutes: {
          COROSAPI_to_SuuntoApp: { enabled: false },
          COROSAPI_to_WahooAPI: { enabled: false },
          GarminAPI_to_COROSAPI: { enabled: false },
          SuuntoApp_to_COROSAPI: { enabled: false },
          WahooAPI_to_COROSAPI: { enabled: false },
        },
        routeDeliverySyncRoutes: {
          SuuntoApp_to_COROSAPI: { enabled: false },
        },
      },
    }, { merge: true });
  });

  it('keeps the connection and routes unchanged if the Health lifecycle write is rejected', async () => {
    mocks.requestGet.mockResolvedValueOnce('{"result":"0000","data":{"bindState":0}}');
    mocks.updateHealthSyncState.mockResolvedValueOnce(false);

    await expect(checkCOROSBindingStateForUser('user-1', 5678)).resolves.toMatchObject({ status: 'stale' });
    expect(currentMetaData.connectionState).toBe('connected');
    expect(mocks.transactionSet.mock.calls.some(([ref]) => ref === mocks.settingsRef)).toBe(false);
  });

  it('records a stale-result cooldown before allowing another global budget debit', async () => {
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(5_678);
    try {
      mocks.requestGet.mockImplementationOnce(async () => {
        currentTokenData = { accessToken: 'new-access-token', openId: 'open-id', dateCreated: 200 };
        mocks.getActiveCOROSTokenSnapshot.mockResolvedValue({
          id: 'open-id',
          ref: mocks.tokenRef,
          exists: true,
          data: () => ({ accessToken: 'new-access-token', openId: 'open-id', dateCreated: 200 }),
        });
        return '{"result":"0000","data":{"bindState":0}}';
      });
      mocks.requestGet.mockResolvedValueOnce('{"result":"0000","data":{"bindState":1}}');

      await expect(checkCOROSBindingStateForUser('user-1', 5_678)).resolves.toEqual({
        status: 'stale',
        bound: null,
        retryAt: 20_678,
      });
      expect(mocks.transactionSet).not.toHaveBeenCalledWith(
        mocks.metaRef,
        expect.objectContaining({ providerBindingState: 'unbound' }),
        { merge: true },
      );
      expect(currentMetaData).toMatchObject({
        providerBindingCheckLeaseId: null,
        providerBindingCheckLeaseExpiresAt: 0,
        providerBindingCheckNextRetryAt: 20_678,
      });

      await expect(checkCOROSBindingStateForUser('user-1', 5_679)).rejects.toMatchObject({
        code: 'resource-exhausted',
        details: { retryAt: 20_678 },
      });
      expect(mocks.requestGet).toHaveBeenCalledTimes(1);
      expect(currentRateLimitData).toMatchObject({ count: 1 });

      dateNow.mockReturnValue(20_678);
      await expect(checkCOROSBindingStateForUser('user-1', 20_678)).resolves.toEqual({
        status: 'bound',
        bound: true,
        checkedAt: 20_678,
      });
      expect(mocks.requestGet).toHaveBeenCalledTimes(2);
      expect(currentRateLimitData).toMatchObject({ count: 2 });
    } finally {
      dateNow.mockRestore();
    }
  });

  it('ignores an unbound result from before a same-account OAuth reconnect', async () => {
    mocks.requestGet.mockImplementationOnce(async () => {
      currentTokenData = {
        accessToken: 'stored-access-token',
        openId: 'open-id',
        dateCreated: 200,
      };
      return '{"result":"0000","data":{"bindState":0}}';
    });

    await expect(checkCOROSBindingStateForUser('user-1', 5678)).resolves.toEqual({
      status: 'stale',
      bound: null,
      retryAt: expect.any(Number),
    });
    expect(mocks.transactionSet).not.toHaveBeenCalledWith(
      mocks.metaRef,
      expect.objectContaining({ providerBindingState: 'unbound' }),
      { merge: true },
    );
  });

  it('ignores an older provider response after a newer check takes over the lease', async () => {
    mocks.requestGet.mockImplementationOnce(async () => {
      currentMetaData = {
        ...currentMetaData,
        providerBindingCheckLeaseId: 'newer-request',
        providerBindingCheckLeaseExpiresAt: 10_000,
      };
      return '{"result":"0000","data":{"bindState":0}}';
    });

    await expect(checkCOROSBindingStateForUser('user-1', 5678)).resolves.toEqual({
      status: 'stale',
      bound: null,
    });
    expect(mocks.transactionSet).not.toHaveBeenCalledWith(
      mocks.metaRef,
      expect.objectContaining({ providerBindingState: 'unbound' }),
      { merge: true },
    );
    expect(currentMetaData).toMatchObject({
      providerBindingCheckLeaseId: 'newer-request',
      providerBindingCheckLeaseExpiresAt: 10_000,
    });
  });

  it('does not write after the deletion guard reports an inactive user', async () => {
    mocks.requestGet.mockResolvedValue('{"result":"0000","data":{"bindState":0}}');
    mocks.getUserDeletionGuardStateInTransaction.mockResolvedValue({
      userExists: false,
      deletionInProgress: false,
      shouldSkip: true,
    });

    await expect(checkCOROSBindingStateForUser('user-1', 5678)).rejects.toMatchObject({
      code: 'failed-precondition',
    });
    expect(mocks.requestGet).not.toHaveBeenCalled();
    expect(mocks.transactionSet).not.toHaveBeenCalled();
    expect(mocks.transactionGet).not.toHaveBeenCalledWith(mocks.rateLimitRef);
  });

  it('returns a recent cached binding result without contacting COROS', async () => {
    currentMetaData = {
      connectionState: 'connected',
      providerUserId: 'open-id',
      providerBindingState: 'bound',
      providerBindingCheckedAt: 1_000,
    };

    await expect(checkCOROSBindingStateForUser('user-1', 1_100)).resolves.toEqual({
      status: 'bound',
      bound: true,
      checkedAt: 1_000,
    });

    expect(mocks.requestGet).not.toHaveBeenCalled();
    expect(mocks.transactionSet).not.toHaveBeenCalled();
    expect(mocks.transactionGet).not.toHaveBeenCalledWith(mocks.rateLimitRef);
  });

  it('rejects a concurrent uncached check before contacting COROS', async () => {
    currentMetaData = {
      connectionState: 'connected',
      providerUserId: 'open-id',
      providerBindingCheckLeaseId: 'other-request',
      providerBindingCheckLeaseExpiresAt: 2_000,
    };

    await expect(checkCOROSBindingStateForUser('user-1', 1_000)).rejects.toMatchObject({
      code: 'resource-exhausted',
    });

    expect(mocks.requestGet).not.toHaveBeenCalled();
    expect(mocks.transactionSet).not.toHaveBeenCalled();
    expect(mocks.transactionGet).not.toHaveBeenCalledWith(mocks.rateLimitRef);
  });

  it('serves a recent stale result while another provider check holds the lease', async () => {
    currentMetaData = {
      connectionState: 'connected',
      providerUserId: 'open-id',
      providerBindingState: 'bound',
      providerBindingCheckedAt: 100_000,
      providerBindingCheckLeaseId: 'other-request',
      providerBindingCheckLeaseExpiresAt: 500_000,
    };

    await expect(checkCOROSBindingStateForUser('user-1', 450_000)).resolves.toEqual({
      status: 'bound',
      bound: true,
      checkedAt: 100_000,
    });

    expect(mocks.requestGet).not.toHaveBeenCalled();
    expect(mocks.transactionSet).not.toHaveBeenCalled();
    expect(mocks.transactionGet).not.toHaveBeenCalledWith(mocks.rateLimitRef);
  });

  it('enforces the shared provider request budget before contacting COROS', async () => {
    currentRateLimitData = {
      windowStartMs: 120_000,
      count: 60,
    };

    await expect(checkCOROSBindingStateForUser('user-1', 120_001)).rejects.toMatchObject({
      code: 'resource-exhausted',
    });

    expect(mocks.requestGet).not.toHaveBeenCalled();
    expect(mocks.transactionSet).not.toHaveBeenCalled();
  });

  it('records a per-account failure cooldown before allowing another global budget debit', async () => {
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(2_000);
    try {
      mocks.requestGet
        .mockRejectedValueOnce(Object.assign(new Error('network failed'), { statusCode: 503 }))
        .mockResolvedValueOnce('{"result":"0000","data":{"bindState":1}}');

      await expect(handleCOROSBindingStateRequest({ app: {}, auth: { uid: 'user-1' } }))
        .rejects.toMatchObject({
          code: 'unavailable',
          details: { retryAt: 17_000 },
        });
      expect(currentMetaData).toMatchObject({
        providerBindingCheckLeaseId: null,
        providerBindingCheckLeaseExpiresAt: 0,
        providerBindingCheckNextRetryAt: 17_000,
      });

      await expect(handleCOROSBindingStateRequest({ app: {}, auth: { uid: 'user-1' } }))
        .rejects.toMatchObject({
          code: 'resource-exhausted',
          details: { retryAt: 17_000 },
        });
      expect(mocks.requestGet).toHaveBeenCalledTimes(1);
      expect(currentRateLimitData).toMatchObject({ count: 1 });
      expect(mocks.transactionGet).toHaveBeenCalledWith(mocks.rateLimitRef);
      expect(mocks.transactionGet.mock.calls.filter(([ref]) => ref === mocks.rateLimitRef)).toHaveLength(1);

      await expect(checkCOROSBindingStateForUser('user-1', 17_000)).resolves.toEqual({
        status: 'bound',
        bound: true,
        checkedAt: 17_000,
      });
      expect(mocks.requestGet).toHaveBeenCalledTimes(2);
      expect(currentRateLimitData).toMatchObject({ count: 2 });
      expect(currentMetaData).toMatchObject({ providerBindingCheckNextRetryAt: 0 });
    } finally {
      dateNow.mockRestore();
    }
  });

  it('does not clear a newer provider-check lease when an older request fails', async () => {
    mocks.requestGet.mockImplementationOnce(async () => {
      currentMetaData = {
        ...currentMetaData,
        providerBindingCheckLeaseId: 'newer-request',
        providerBindingCheckLeaseExpiresAt: 50_000,
      };
      throw Object.assign(new Error('network failed'), { statusCode: 503 });
    });

    await expect(checkCOROSBindingStateForUser('user-1', 1_000)).rejects.toMatchObject({
      name: 'COROSBindingStateUnavailableError',
    });
    expect(currentMetaData).toMatchObject({
      providerBindingCheckLeaseId: 'newer-request',
      providerBindingCheckLeaseExpiresAt: 50_000,
    });
    expect(currentMetaData).toMatchObject({ providerBindingCheckNextRetryAt: 0 });
  });

  it('maps provider and malformed responses to retryable callable failures without binding-state changes', async () => {
    mocks.requestGet.mockRejectedValueOnce(Object.assign(new Error('network failed'), { statusCode: 503 }));
    await expect(handleCOROSBindingStateRequest({ app: {}, auth: { uid: 'user-1' } }))
      .rejects.toMatchObject({ code: 'unavailable' });
    currentMetaData = { connectionState: 'connected', providerUserId: 'open-id' };

    mocks.requestGet.mockResolvedValueOnce('{"result":"0000","data":{"bindState":2}}');
    await expect(handleCOROSBindingStateRequest({ app: {}, auth: { uid: 'user-1' } }))
      .rejects.toMatchObject({ code: 'unavailable' });
  });

  it('does not trust a contradictory provider success message', async () => {
    mocks.requestGet.mockResolvedValueOnce(JSON.stringify({
      result: '0000',
      message: 'ERROR',
      data: { bindState: 0 },
    }));

    await expect(handleCOROSBindingStateRequest({ app: {}, auth: { uid: 'user-1' } }))
      .rejects.toMatchObject({ code: 'unavailable' });
    expect(mocks.runTransaction).toHaveBeenCalledTimes(2);
    expect(mocks.transactionSet).not.toHaveBeenCalledWith(
      mocks.metaRef,
      expect.objectContaining({ providerBindingState: expect.anything() }),
      { merge: true },
    );
  });

  it('requires authentication before contacting COROS', async () => {
    await expect(handleCOROSBindingStateRequest({ app: {}, auth: null }))
      .rejects.toMatchObject({ code: 'unauthenticated' });
    expect(mocks.requestGet).not.toHaveBeenCalled();
  });
});
