import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { createHash } from 'node:crypto';

const PROVIDER_ACCOUNT_DIGEST = createHash('sha256').update('provider-1').digest('hex');

const hoisted = vi.hoisted(() => {
  const state: Record<string, Record<string, unknown> | undefined> = {};
  const bindingRef = { path: 'suuntoHealthWebhookAccountBindings/digest' };
  const tokenRef = {
    path: 'suuntoAppAccessTokens/user-1/tokens/provider-1',
    get: vi.fn(async () => ({
      id: 'provider-1',
      ref: tokenRef,
      exists: state.token !== undefined,
      data: () => state.token,
    })),
  };
  const tokenSnapshot = {
    id: 'provider-1',
    ref: tokenRef,
    data: () => state.token,
  };
  const tokenRootRef = {
    path: 'suuntoAppAccessTokens/user-1',
    collection: vi.fn(() => ({ doc: vi.fn(() => tokenRef) })),
  };
  const serviceMetaRef = { path: 'users/user-1/meta/SuuntoApp' };
  const userRef = {
    collection: vi.fn(() => ({ doc: vi.fn(() => serviceMetaRef) })),
  };
  const transactionSet = vi.fn();
  const transactionGet = vi.fn(async (ref: unknown) => {
    const key = ref === bindingRef
      ? 'binding'
      : ref === tokenRef
        ? 'token'
        : ref === tokenRootRef
          ? 'tokenRoot'
          : ref === serviceMetaRef
            ? 'serviceMeta'
            : null;
    if (!key) throw new Error('Unexpected transaction read.');
    const data = state[key];
    return { exists: data !== undefined, data: () => data };
  });
  const db = {
    collection: vi.fn((name: string) => ({
      doc: vi.fn(() => {
        if (name === 'suuntoHealthWebhookAccountBindings') return bindingRef;
        if (name === 'users') return userRef;
        throw new Error(`Unexpected collection ${name}`);
      }),
    })),
    runTransaction: vi.fn(async (callback: (transaction: unknown) => unknown) => callback({
      get: transactionGet,
      set: transactionSet,
    })),
  };
  return {
    bindingRef,
    db,
    deletionGuard: vi.fn(),
    serviceMetaRef,
    state,
    tokenRef,
    tokenSnapshot,
    tokenRootRef,
    transactionSet,
    getTokenData: vi.fn(),
  };
});

vi.mock('../shared/user-deletion-guard', () => ({
  getUserDeletionGuardStateInTransaction: hoisted.deletionGuard,
}));
vi.mock('../service-token-store', () => ({
  getServiceTokenRootDocumentRef: vi.fn(() => hoisted.tokenRootRef),
  SERVICE_DISCONNECT_OPERATION_GENERATION_FIELD: 'disconnectOperationGeneration',
  doesServiceDisconnectOperationPermitTokenUse: vi.fn((data?: Record<string, unknown>) =>
    !data?.disconnectOperationGeneration),
}));
vi.mock('../service-disconnect-pending-state', () => ({
  isServiceDisconnectPendingData: vi.fn((data?: Record<string, unknown>) =>
    data?.disconnectState === 'disconnect_pending'),
}));
vi.mock('../tokens', () => ({
  getTokenData: (...args: unknown[]) => hoisted.getTokenData(...args),
}));
import {
  areSuuntoWebhookWriteLifecycleGuardsContinuous,
  captureActiveSuuntoWebhookWriteLifecycleGuards,
  captureCurrentSuuntoWebhookWriteLifecycleGuards,
  ensureSuuntoWebhookAccountBindingForProviderVerifiedToken,
  getSuuntoWebhookWriteLifecycleAuthorityDigest,
  repairSuuntoLegacyWebhookBindingForProviderVerifiedToken,
} from './health-webhook-binding-lifecycle';

describe('Suunto Health webhook account binding lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.state.binding = undefined;
    hoisted.state.token = {
      accessToken: 'access-token-1',
      refreshToken: 'refresh-token-1',
      expiresAt: 1_800_000_000_000,
      serviceName: ServiceNames.SuuntoApp,
      userName: 'provider-1',
      tokenCredentialGeneration: 'token-generation-1',
    };
    hoisted.state.tokenRoot = { activeOAuthCredentialGeneration: 'root-generation-2' };
    hoisted.state.serviceMeta = {
      connectionState: 'connected',
      connectionStateGeneration: 'connection-generation-1',
    };
    hoisted.deletionGuard.mockResolvedValue({ shouldSkip: false });
    hoisted.getTokenData.mockResolvedValue({ userName: 'provider-1' });
  });

  it('creates a binding only after Suunto verifies a retained token whose generation predates the root revision', async () => {
    await expect(ensureSuuntoWebhookAccountBindingForProviderVerifiedToken(
      hoisted.db as never,
      'user-1',
      hoisted.tokenSnapshot as never,
      1_777_777_777_000,
    )).resolves.toBe('created');

    expect(hoisted.getTokenData).toHaveBeenCalledWith(
      hoisted.tokenSnapshot,
      ServiceNames.SuuntoApp,
      true,
      {
        opaqueTelemetry: true,
        allowSupersededSnapshotRetry: false,
      },
    );
    expect(hoisted.transactionSet).toHaveBeenCalledWith(
      hoisted.bindingRef,
      {
        schemaVersion: 3,
        authorizationSource: 'provider_refresh',
        userID: 'user-1',
        providerAccountDigest: PROVIDER_ACCOUNT_DIGEST,
        tokenCredentialGeneration: 'token-generation-1',
      },
    );
  });

  it('replaces a provenance-less binding only after provider verification', async () => {
    hoisted.state.binding = {
      schemaVersion: 3,
      userID: 'other-user',
      providerAccountDigest: PROVIDER_ACCOUNT_DIGEST,
      tokenCredentialGeneration: 'other-generation',
    };

    await expect(ensureSuuntoWebhookAccountBindingForProviderVerifiedToken(
      hoisted.db as never,
      'user-1',
      hoisted.tokenSnapshot as never,
    )).resolves.toBe('created');
    expect(hoisted.getTokenData).toHaveBeenCalledOnce();
    expect(hoisted.transactionSet).toHaveBeenCalledWith(
      hoisted.bindingRef,
      expect.objectContaining({
        authorizationSource: 'provider_refresh',
        userID: 'user-1',
      }),
    );
  });

  it('does not mint victim webhook authority when Suunto refresh returns another account', async () => {
    hoisted.getTokenData.mockResolvedValueOnce({ userName: 'attacker-provider-account' });

    await expect(ensureSuuntoWebhookAccountBindingForProviderVerifiedToken(
      hoisted.db as never,
      'user-1',
      hoisted.tokenSnapshot as never,
    )).resolves.toBe('unverified');

    expect(hoisted.transactionSet).not.toHaveBeenCalled();
  });

  it('accepts a current OAuth-authorized binding without another provider refresh', async () => {
    hoisted.state.binding = {
      schemaVersion: 3,
      authorizationSource: 'oauth_callback',
      userID: 'user-1',
      providerAccountDigest: PROVIDER_ACCOUNT_DIGEST,
      tokenCredentialGeneration: 'token-generation-1',
    };

    await expect(ensureSuuntoWebhookAccountBindingForProviderVerifiedToken(
      hoisted.db as never,
      'user-1',
      hoisted.tokenSnapshot as never,
    )).resolves.toBe('current');

    expect(hoisted.getTokenData).not.toHaveBeenCalled();
    expect(hoisted.transactionSet).not.toHaveBeenCalled();
  });

  it('atomically backfills a generationless legacy lifecycle from an existing provider-authorized binding', async () => {
    hoisted.state.binding = {
      schemaVersion: 3,
      authorizationSource: 'provider_refresh',
      userID: 'user-1',
      providerAccountDigest: PROVIDER_ACCOUNT_DIGEST,
      tokenCredentialGeneration: null,
    };
    hoisted.state.token = {
      accessToken: 'access-token-1',
      refreshToken: 'refresh-token-1',
      expiresAt: 1_800_000_000_000,
      serviceName: ServiceNames.SuuntoApp,
      userName: 'provider-1',
    };
    hoisted.state.tokenRoot = {};
    hoisted.state.serviceMeta = undefined;

    await expect(ensureSuuntoWebhookAccountBindingForProviderVerifiedToken(
      hoisted.db as never,
      'user-1',
      hoisted.tokenSnapshot as never,
    )).resolves.toBe('current');

    expect(hoisted.getTokenData).not.toHaveBeenCalled();
    const tokenGeneration = hoisted.transactionSet.mock.calls.find(
      ([ref]) => ref === hoisted.tokenRef,
    )?.[1]?.tokenCredentialGeneration;
    expect(tokenGeneration).toEqual(expect.any(String));
    expect(hoisted.transactionSet).toHaveBeenCalledWith(
      hoisted.tokenRootRef,
      { activeOAuthCredentialGeneration: expect.any(String) },
      { merge: true },
    );
    expect(hoisted.transactionSet).toHaveBeenCalledWith(
      hoisted.serviceMetaRef,
      {
        connectionState: 'connected',
        connectionStateGeneration: expect.any(String),
      },
      { merge: true },
    );
    expect(hoisted.transactionSet).toHaveBeenCalledWith(
      hoisted.bindingRef,
      expect.objectContaining({
        authorizationSource: 'provider_refresh',
        tokenCredentialGeneration: tokenGeneration,
      }),
    );
  });

  it('provider-verifies an unbound legacy lifecycle before backfilling it', async () => {
    hoisted.state.token = {
      ...hoisted.state.token,
      tokenCredentialGeneration: undefined,
    };
    hoisted.state.tokenRoot = {};
    hoisted.state.serviceMeta = {
      connectionState: 'connected',
    };

    await expect(ensureSuuntoWebhookAccountBindingForProviderVerifiedToken(
      hoisted.db as never,
      'user-1',
      hoisted.tokenSnapshot as never,
    )).resolves.toBe('created');

    expect(hoisted.getTokenData).toHaveBeenCalledOnce();
    expect(hoisted.transactionSet).toHaveBeenCalledWith(
      hoisted.tokenRef,
      { tokenCredentialGeneration: expect.any(String) },
      { merge: true },
    );
    expect(hoisted.transactionSet).toHaveBeenCalledWith(
      hoisted.tokenRootRef,
      { activeOAuthCredentialGeneration: expect.any(String) },
      { merge: true },
    );
  });

  it('provider-verifies and repairs a child-only legacy token whose parent root is missing', async () => {
    hoisted.state.token = {
      ...hoisted.state.token,
      tokenCredentialGeneration: undefined,
    };
    hoisted.state.tokenRoot = undefined;

    await expect(ensureSuuntoWebhookAccountBindingForProviderVerifiedToken(
      hoisted.db as never,
      'user-1',
      hoisted.tokenSnapshot as never,
    )).resolves.toBe('created');

    expect(hoisted.getTokenData).toHaveBeenCalledOnce();
    expect(hoisted.transactionSet).toHaveBeenCalledWith(
      hoisted.tokenRootRef,
      { activeOAuthCredentialGeneration: expect.any(String) },
      { merge: true },
    );
    expect(hoisted.transactionSet).toHaveBeenCalledWith(
      hoisted.bindingRef,
      expect.objectContaining({
        authorizationSource: 'provider_refresh',
        userID: 'user-1',
      }),
    );
  });

  it('atomically records the resumable repair marker with a provider-verified child-only repair', async () => {
    hoisted.state.token = {
      ...hoisted.state.token,
      tokenCredentialGeneration: undefined,
    };
    hoisted.state.tokenRoot = undefined;
    const repairedAtMs = 1_777_777_777_000;
    const incidentStartMs = 1_777_500_000_000;

    await expect(repairSuuntoLegacyWebhookBindingForProviderVerifiedToken(
      hoisted.db as never,
      'user-1',
      hoisted.tokenSnapshot as never,
      incidentStartMs,
      repairedAtMs,
    )).resolves.toBe('created');

    expect(hoisted.transactionSet).toHaveBeenCalledWith(
      hoisted.tokenRef,
      {
        suuntoLegacyWebhookBindingRepairVersion: 1,
        suuntoLegacyWebhookBindingRepairedAtMs: repairedAtMs,
        suuntoLegacyWebhookBindingRepairIncidentStartMs: incidentStartMs,
      },
      { merge: true },
    );
    expect(hoisted.transactionSet).toHaveBeenCalledWith(
      hoisted.bindingRef,
      expect.objectContaining({ authorizationSource: 'provider_refresh' }),
    );
  });

  it('force-verifies an already current binding before recording the repair marker', async () => {
    hoisted.state.binding = {
      schemaVersion: 3,
      authorizationSource: 'oauth_callback',
      userID: 'user-1',
      providerAccountDigest: PROVIDER_ACCOUNT_DIGEST,
      tokenCredentialGeneration: 'token-generation-1',
    };
    const repairedAtMs = 1_777_777_777_000;

    await expect(repairSuuntoLegacyWebhookBindingForProviderVerifiedToken(
      hoisted.db as never,
      'user-1',
      hoisted.tokenSnapshot as never,
      1_777_500_000_000,
      repairedAtMs,
    )).resolves.toBe('current');

    expect(hoisted.getTokenData).toHaveBeenCalledOnce();
    expect(hoisted.transactionSet).toHaveBeenCalledWith(
      hoisted.tokenRef,
      expect.objectContaining({
        suuntoLegacyWebhookBindingRepairVersion: 1,
        suuntoLegacyWebhookBindingRepairedAtMs: repairedAtMs,
      }),
      { merge: true },
    );
  });

  it('does not migrate legacy lifecycle state before forced provider verification', async () => {
    hoisted.state.binding = {
      schemaVersion: 3,
      authorizationSource: 'oauth_callback',
      userID: 'user-1',
      providerAccountDigest: PROVIDER_ACCOUNT_DIGEST,
      tokenCredentialGeneration: 'token-generation-1',
    };
    hoisted.state.serviceMeta = { connectionState: 'connected' };
    hoisted.getTokenData.mockImplementationOnce(async () => {
      expect(hoisted.transactionSet).not.toHaveBeenCalled();
      return { userName: 'provider-1' };
    });

    await expect(repairSuuntoLegacyWebhookBindingForProviderVerifiedToken(
      hoisted.db as never,
      'user-1',
      hoisted.tokenSnapshot as never,
      1_777_500_000_000,
    )).resolves.toBe('current');

    expect(hoisted.transactionSet).toHaveBeenCalledWith(
      hoisted.serviceMetaRef,
      {
        connectionState: 'connected',
        connectionStateGeneration: expect.any(String),
      },
      { merge: true },
    );
  });

  it('fails closed when connected service metadata disappears during provider verification', async () => {
    hoisted.state.token = {
      ...hoisted.state.token,
      tokenCredentialGeneration: undefined,
    };
    hoisted.state.tokenRoot = undefined;
    hoisted.tokenRef.get.mockImplementationOnce(async () => {
      hoisted.state.serviceMeta = undefined;
      return {
        id: 'provider-1',
        ref: hoisted.tokenRef,
        exists: true,
        data: () => hoisted.state.token,
      };
    });

    await expect(repairSuuntoLegacyWebhookBindingForProviderVerifiedToken(
      hoisted.db as never,
      'user-1',
      hoisted.tokenSnapshot as never,
      1_777_500_000_000,
    )).resolves.toBe('inactive');

    expect(hoisted.getTokenData).toHaveBeenCalledOnce();
    expect(hoisted.transactionSet).not.toHaveBeenCalled();
  });

  it('does not apply provider proof after the refreshed credential is replaced', async () => {
    hoisted.state.token = {
      ...hoisted.state.token,
      tokenCredentialGeneration: undefined,
    };
    hoisted.state.tokenRoot = undefined;
    const providerVerifiedCredential = { ...hoisted.state.token };
    hoisted.tokenRef.get.mockImplementationOnce(async () => {
      hoisted.state.token = {
        ...providerVerifiedCredential,
        accessToken: 'replacement-access-token',
      };
      return {
        id: 'provider-1',
        ref: hoisted.tokenRef,
        exists: true,
        data: () => providerVerifiedCredential,
      };
    });

    await expect(ensureSuuntoWebhookAccountBindingForProviderVerifiedToken(
      hoisted.db as never,
      'user-1',
      hoisted.tokenSnapshot as never,
    )).resolves.toBe('inactive');

    expect(hoisted.getTokenData).toHaveBeenCalledOnce();
    expect(hoisted.transactionSet).not.toHaveBeenCalled();
  });

  it('backfills a retained legacy account without rotating the newer root revision', async () => {
    hoisted.state.binding = {
      schemaVersion: 3,
      authorizationSource: 'provider_refresh',
      userID: 'user-1',
      providerAccountDigest: PROVIDER_ACCOUNT_DIGEST,
      tokenCredentialGeneration: null,
    };
    hoisted.state.token = {
      ...hoisted.state.token,
      tokenCredentialGeneration: undefined,
    };

    await expect(ensureSuuntoWebhookAccountBindingForProviderVerifiedToken(
      hoisted.db as never,
      'user-1',
      hoisted.tokenSnapshot as never,
    )).resolves.toBe('current');

    expect(hoisted.getTokenData).not.toHaveBeenCalled();
    expect(hoisted.transactionSet).toHaveBeenCalledWith(
      hoisted.tokenRef,
      { tokenCredentialGeneration: expect.any(String) },
      { merge: true },
    );
    expect(hoisted.transactionSet).not.toHaveBeenCalledWith(
      hoisted.tokenRootRef,
      expect.anything(),
      expect.anything(),
    );
    expect(hoisted.transactionSet).toHaveBeenCalledWith(
      hoisted.bindingRef,
      expect.objectContaining({
        tokenCredentialGeneration: expect.any(String),
      }),
    );
  });

  it('requires a fresh provider verification before repairing an impossible token/root generation split', async () => {
    hoisted.state.binding = {
      schemaVersion: 3,
      authorizationSource: 'oauth_callback',
      userID: 'user-1',
      providerAccountDigest: PROVIDER_ACCOUNT_DIGEST,
      tokenCredentialGeneration: 'token-generation-1',
    };
    hoisted.state.tokenRoot = {};

    await expect(ensureSuuntoWebhookAccountBindingForProviderVerifiedToken(
      hoisted.db as never,
      'user-1',
      hoisted.tokenSnapshot as never,
    )).resolves.toBe('current');

    expect(hoisted.getTokenData).toHaveBeenCalledOnce();
    expect(hoisted.transactionSet).toHaveBeenCalledWith(
      hoisted.tokenRootRef,
      { activeOAuthCredentialGeneration: expect.any(String) },
      { merge: true },
    );
  });

  it('does not overwrite malformed legacy generations during verification', async () => {
    hoisted.state.token = {
      ...hoisted.state.token,
      tokenCredentialGeneration: ' malformed ',
    };

    await expect(ensureSuuntoWebhookAccountBindingForProviderVerifiedToken(
      hoisted.db as never,
      'user-1',
      hoisted.tokenSnapshot as never,
    )).resolves.toBe('inactive');

    expect(hoisted.getTokenData).not.toHaveBeenCalled();
    expect(hoisted.transactionSet).not.toHaveBeenCalled();
  });

  it('captures every current authority field for transaction-level Sleep writes', async () => {
    hoisted.state.binding = {
      schemaVersion: 3,
      authorizationSource: 'oauth_callback',
      userID: 'user-1',
      providerAccountDigest: PROVIDER_ACCOUNT_DIGEST,
      tokenCredentialGeneration: 'token-generation-1',
    };

    await expect(captureActiveSuuntoWebhookWriteLifecycleGuards(
      hoisted.db as never,
      'user-1',
      'provider-1',
      hoisted.tokenSnapshot as never,
      1_777_777_777_000,
    )).resolves.toEqual({
      requiredExistingDocumentRef: hoisted.tokenRef,
      requiredExistingTokenCredential: expect.objectContaining({
        accessToken: 'access-token-1',
        credentialGeneration: 'token-generation-1',
      }),
      requiredDocumentFieldValues: {
        documentRef: hoisted.bindingRef,
        expectedFields: hoisted.state.binding,
      },
      additionalRequiredDocumentFieldValues: [{
        documentRef: hoisted.tokenRef,
        expectedFields: {
          userName: 'provider-1',
          serviceName: ServiceNames.SuuntoApp,
          tokenCredentialGeneration: 'token-generation-1',
        },
      }, {
        documentRef: hoisted.tokenRootRef,
        expectedFields: {
          activeOAuthCredentialGeneration: 'root-generation-2',
          disconnectState: undefined,
          disconnectOperationGeneration: undefined,
        },
      }, {
        documentRef: hoisted.serviceMetaRef,
        expectedFields: {
          connectionState: 'connected',
          connectionStateGeneration: 'connection-generation-1',
        },
      }],
    });
  });

  it('atomically rebases rotating credentials without changing webhook authority', async () => {
    hoisted.state.binding = {
      schemaVersion: 3,
      authorizationSource: 'oauth_callback',
      userID: 'user-1',
      providerAccountDigest: PROVIDER_ACCOUNT_DIGEST,
      tokenCredentialGeneration: 'token-generation-1',
    };
    hoisted.state.token = {
      ...hoisted.state.token,
      accessToken: 'rotated-access-token',
      refreshToken: 'rotated-refresh-token',
    };

    const guards = await captureCurrentSuuntoWebhookWriteLifecycleGuards(
      hoisted.db as never,
      'user-1',
      'provider-1',
    );

    expect(guards?.requiredExistingTokenCredential).toEqual(expect.objectContaining({
      accessToken: 'rotated-access-token',
      refreshToken: 'rotated-refresh-token',
      credentialGeneration: 'token-generation-1',
    }));
    expect(guards?.requiredDocumentFieldValues.expectedFields).toEqual(hoisted.state.binding);
  });

  it('allows credential rotation only while every authority field remains continuous', () => {
    const initial = {
      requiredExistingDocumentRef: hoisted.tokenRef,
      requiredExistingTokenCredential: { accessToken: 'old-access', credentialGeneration: 'generation-1' },
      requiredDocumentFieldValues: {
        documentRef: hoisted.bindingRef,
        expectedFields: { authorizationSource: 'oauth_callback', tokenCredentialGeneration: 'generation-1' },
      },
      additionalRequiredDocumentFieldValues: [{
        documentRef: hoisted.tokenRootRef,
        expectedFields: { activeOAuthCredentialGeneration: 'root-generation-1' },
      }],
    };
    const rotatedCredential = {
      ...initial,
      requiredExistingTokenCredential: { accessToken: 'new-access', credentialGeneration: 'generation-1' },
    };

    expect(areSuuntoWebhookWriteLifecycleGuardsContinuous(initial as never, rotatedCredential as never))
      .toBe(true);
    expect(areSuuntoWebhookWriteLifecycleGuardsContinuous(initial as never, {
      ...rotatedCredential,
      additionalRequiredDocumentFieldValues: [{
        documentRef: hoisted.tokenRootRef,
        expectedFields: { activeOAuthCredentialGeneration: 'root-generation-2' },
      }],
    } as never)).toBe(false);
  });

  it('digests authority changes without treating credential rotation as new authority', () => {
    const initial = {
      requiredExistingDocumentRef: hoisted.tokenRef,
      requiredExistingTokenCredential: { accessToken: 'old-access', credentialGeneration: 'generation-1' },
      requiredDocumentFieldValues: {
        documentRef: hoisted.bindingRef,
        expectedFields: { authorizationSource: 'oauth_callback', tokenCredentialGeneration: 'generation-1' },
      },
      additionalRequiredDocumentFieldValues: [{
        documentRef: hoisted.tokenRootRef,
        expectedFields: {
          activeOAuthCredentialGeneration: 'root-generation-1',
          disconnectOperationGeneration: undefined,
        },
      }],
    };
    const rotatedCredential = {
      ...initial,
      requiredExistingTokenCredential: { accessToken: 'new-access', credentialGeneration: 'generation-1' },
    };
    const replacedConnection = {
      ...rotatedCredential,
      additionalRequiredDocumentFieldValues: [{
        documentRef: hoisted.tokenRootRef,
        expectedFields: {
          activeOAuthCredentialGeneration: 'root-generation-2',
          disconnectOperationGeneration: undefined,
        },
      }],
    };

    expect(getSuuntoWebhookWriteLifecycleAuthorityDigest(initial as never))
      .toBe(getSuuntoWebhookWriteLifecycleAuthorityDigest(rotatedCredential as never));
    expect(getSuuntoWebhookWriteLifecycleAuthorityDigest(replacedConnection as never))
      .not.toBe(getSuuntoWebhookWriteLifecycleAuthorityDigest(initial as never));
  });

  it('refuses to capture Sleep write authority from a provenance-less binding', async () => {
    hoisted.state.binding = {
      schemaVersion: 3,
      userID: 'user-1',
      providerAccountDigest: PROVIDER_ACCOUNT_DIGEST,
      tokenCredentialGeneration: 'token-generation-1',
    };

    await expect(captureActiveSuuntoWebhookWriteLifecycleGuards(
      hoisted.db as never,
      'user-1',
      'provider-1',
      hoisted.tokenSnapshot as never,
    )).resolves.toBeNull();
  });

  it('does not bind deleting or reconnect-required accounts', async () => {
    hoisted.deletionGuard.mockResolvedValueOnce({ shouldSkip: true });
    await expect(ensureSuuntoWebhookAccountBindingForProviderVerifiedToken(
      hoisted.db as never,
      'user-1',
      hoisted.tokenSnapshot as never,
    )).resolves.toBe('inactive');

    hoisted.state.serviceMeta = {
      connectionState: 'reconnect_required',
      connectionStateGeneration: 'replacement-generation',
    };
    await expect(ensureSuuntoWebhookAccountBindingForProviderVerifiedToken(
      hoisted.db as never,
      'user-1',
      hoisted.tokenSnapshot as never,
    )).resolves.toBe('inactive');
    expect(hoisted.transactionSet).not.toHaveBeenCalled();
    expect(hoisted.getTokenData).not.toHaveBeenCalled();
  });
});
