import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { createHash } from 'node:crypto';

const PROVIDER_ACCOUNT_DIGEST = createHash('sha256').update('provider-1').digest('hex');

const hoisted = vi.hoisted(() => {
  const state: Record<string, Record<string, unknown> | undefined> = {};
  const bindingRef = { path: 'suuntoHealthWebhookAccountBindings/digest' };
  const tokenRef = { path: 'suuntoAppAccessTokens/user-1/tokens/provider-1' };
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
    tokenRootRef,
    transactionSet,
  };
});

vi.mock('../shared/user-deletion-guard', () => ({
  getUserDeletionGuardStateInTransaction: hoisted.deletionGuard,
}));
vi.mock('../service-token-store', () => ({
  getServiceTokenRootDocumentRef: vi.fn(() => hoisted.tokenRootRef),
  doesServiceDisconnectOperationPermitTokenUse: vi.fn((data: Record<string, unknown>) =>
    !data.disconnectOperationGeneration),
}));
vi.mock('../service-disconnect-pending-state', () => ({
  isServiceDisconnectPendingData: vi.fn((data: Record<string, unknown>) =>
    data.disconnectState === 'disconnect_pending'),
}));
import { ensureSuuntoHealthWebhookAccountBindingForActiveToken } from './health-webhook-binding-lifecycle';

describe('Suunto Health webhook account binding lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.state.binding = undefined;
    hoisted.state.token = {
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
  });

  it('creates a binding for a retained token whose generation predates the root revision', async () => {
    await expect(ensureSuuntoHealthWebhookAccountBindingForActiveToken(
      hoisted.db as never,
      'user-1',
      'provider-1',
      1_777_777_777_000,
    )).resolves.toBe('created');

    expect(hoisted.transactionSet).toHaveBeenCalledWith(
      hoisted.bindingRef,
      {
        schemaVersion: 3,
        userID: 'user-1',
        providerAccountDigest: PROVIDER_ACCOUNT_DIGEST,
        tokenCredentialGeneration: 'token-generation-1',
      },
    );
  });

  it('upgrades a generation-matched schema-v2 binding to the indexed schema', async () => {
    hoisted.state.binding = {
      schemaVersion: 2,
      userID: 'user-1',
      tokenCredentialGeneration: 'token-generation-1',
    };

    await expect(ensureSuuntoHealthWebhookAccountBindingForActiveToken(
      hoisted.db as never,
      'user-1',
      'provider-1',
    )).resolves.toBe('created');
    expect(hoisted.transactionSet).toHaveBeenCalledWith(
      hoisted.bindingRef,
      {
        schemaVersion: 3,
        userID: 'user-1',
        providerAccountDigest: PROVIDER_ACCOUNT_DIGEST,
        tokenCredentialGeneration: 'token-generation-1',
      },
    );
  });

  it('does not overwrite a malformed per-user binding owned by another UID', async () => {
    hoisted.state.binding = {
      schemaVersion: 3,
      userID: 'other-user',
      providerAccountDigest: PROVIDER_ACCOUNT_DIGEST,
      tokenCredentialGeneration: 'other-generation',
    };

    await expect(ensureSuuntoHealthWebhookAccountBindingForActiveToken(
      hoisted.db as never,
      'user-1',
      'provider-1',
    )).resolves.toBe('conflict');
    expect(hoisted.transactionSet).not.toHaveBeenCalled();
  });

  it('does not bind deleting or reconnect-required accounts', async () => {
    hoisted.deletionGuard.mockResolvedValueOnce({ shouldSkip: true });
    await expect(ensureSuuntoHealthWebhookAccountBindingForActiveToken(
      hoisted.db as never,
      'user-1',
      'provider-1',
    )).resolves.toBe('inactive');

    hoisted.state.serviceMeta = {
      connectionState: 'reconnect_required',
      connectionStateGeneration: 'replacement-generation',
    };
    await expect(ensureSuuntoHealthWebhookAccountBindingForActiveToken(
      hoisted.db as never,
      'user-1',
      'provider-1',
    )).resolves.toBe('inactive');
    expect(hoisted.transactionSet).not.toHaveBeenCalled();
  });
});
