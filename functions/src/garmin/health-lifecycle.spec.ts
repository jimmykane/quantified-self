import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as admin from 'firebase-admin';
import { ServiceNames } from '@sports-alliance/sports-lib';

const hoisted = vi.hoisted(() => ({
  deletionGuard: {
    userExists: true,
    deletionInProgress: false,
    shouldSkip: false,
  },
  serviceMeta: null as Record<string, unknown> | null,
  rootData: {} as Record<string, unknown>,
  metaRef: { path: 'users/test-user/meta/Garmin API' },
  rootRef: {
    path: 'garminAPITokens/test-user',
    get: vi.fn(),
  },
}));

vi.mock('../shared/user-deletion-guard', () => ({
  getUserDeletionGuardState: vi.fn(async () => hoisted.deletionGuard),
}));

vi.mock('../service-connection-meta', () => ({
  getServiceConnectionMeta: vi.fn(async () => hoisted.serviceMeta),
}));

vi.mock('../service-token-store', () => ({
  getServiceTokenRootDocumentRef: vi.fn(() => hoisted.rootRef),
}));

import {
  areGarminHealthWriteLifecycleGuardsContinuous,
  captureActiveGarminHealthWriteLifecycleGuards,
} from './health-lifecycle';

function createDb(): admin.firestore.Firestore {
  return {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        collection: vi.fn(() => ({
          doc: vi.fn(() => hoisted.metaRef),
        })),
      })),
    })),
  } as unknown as admin.firestore.Firestore;
}

function createTokenSnapshot(data: Record<string, unknown> = {}): admin.firestore.DocumentSnapshot {
  return {
    exists: true,
    data: () => ({
      serviceName: ServiceNames.GarminAPI,
      userID: 'garmin-user-1',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      tokenCredentialGeneration: 'token-generation-1',
      ...data,
    }),
    ref: {
      path: 'garminAPITokens/test-user/tokens/garmin-user-1',
      parent: { parent: { id: 'test-user' } },
    },
  } as unknown as admin.firestore.DocumentSnapshot;
}

describe('Garmin Health lifecycle guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.deletionGuard = {
      userExists: true,
      deletionInProgress: false,
      shouldSkip: false,
    };
    hoisted.serviceMeta = {
      providerUserId: 'garmin-user-1',
      connectionState: 'connected',
      connectionStateGeneration: 'connection-generation-1',
    };
    hoisted.rootData = {
      activeOAuthCredentialGeneration: 'token-generation-1',
    };
    hoisted.rootRef.get.mockImplementation(async () => ({
      exists: true,
      data: () => hoisted.rootData,
    }));
  });

  it('captures the pinned provider identity and all current lifecycle fences', async () => {
    const guards = await captureActiveGarminHealthWriteLifecycleGuards(
      createDb(),
      'test-user',
      'garmin-user-1',
      createTokenSnapshot(),
    );

    expect(guards).toMatchObject({
      providerUserId: 'garmin-user-1',
      providerIdentityPinned: true,
      tokenCredentialGeneration: 'token-generation-1',
      rootOAuthCredentialGeneration: 'token-generation-1',
      connectionStateGeneration: 'connection-generation-1',
      requiredExistingTokenCredential: {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        credentialGeneration: 'token-generation-1',
      },
    });
    expect(guards?.requiredDocumentFieldValues).toEqual({
      documentRef: hoisted.metaRef,
      expectedFields: {
        connectionState: 'connected',
        connectionStateGeneration: 'connection-generation-1',
        providerUserId: 'garmin-user-1',
      },
    });
  });

  it('supports active legacy connections while requiring provider verification later', async () => {
    hoisted.serviceMeta = null;
    hoisted.rootData = {};

    const guards = await captureActiveGarminHealthWriteLifecycleGuards(
      createDb(),
      'test-user',
      'garmin-user-1',
      createTokenSnapshot({ tokenCredentialGeneration: undefined }),
    );

    expect(guards).toMatchObject({
      providerIdentityPinned: false,
      tokenCredentialGeneration: null,
      rootOAuthCredentialGeneration: null,
      connectionStateGeneration: null,
    });
  });

  it.each([
    ['provider mismatch', { providerUserId: 'replacement-account', connectionState: 'connected' }],
    ['disconnect pending', { providerUserId: 'garmin-user-1', connectionState: 'disconnect_pending' }],
    ['reconnect required', { providerUserId: 'garmin-user-1', connectionState: 'reconnect_required' }],
  ])('rejects %s metadata', async (_label, serviceMeta) => {
    hoisted.serviceMeta = serviceMeta;

    await expect(captureActiveGarminHealthWriteLifecycleGuards(
      createDb(),
      'test-user',
      'garmin-user-1',
      createTokenSnapshot(),
    )).resolves.toBeNull();
  });

  it('rejects a user deletion or an OAuth generation mismatch', async () => {
    hoisted.deletionGuard = {
      userExists: true,
      deletionInProgress: true,
      shouldSkip: true,
    };
    await expect(captureActiveGarminHealthWriteLifecycleGuards(
      createDb(),
      'test-user',
      'garmin-user-1',
      createTokenSnapshot(),
    )).resolves.toBeNull();

    hoisted.deletionGuard.deletionInProgress = false;
    hoisted.deletionGuard.shouldSkip = false;
    hoisted.rootData.activeOAuthCredentialGeneration = 'replacement-generation';
    await expect(captureActiveGarminHealthWriteLifecycleGuards(
      createDb(),
      'test-user',
      'garmin-user-1',
      createTokenSnapshot(),
    )).resolves.toBeNull();
  });

  it('treats any account-generation change as discontinuous', async () => {
    const initial = await captureActiveGarminHealthWriteLifecycleGuards(
      createDb(),
      'test-user',
      'garmin-user-1',
      createTokenSnapshot(),
    );
    expect(initial).not.toBeNull();

    expect(areGarminHealthWriteLifecycleGuardsContinuous(
      initial!,
      { ...initial!, connectionStateGeneration: 'replacement-generation' },
    )).toBe(false);
  });
});
