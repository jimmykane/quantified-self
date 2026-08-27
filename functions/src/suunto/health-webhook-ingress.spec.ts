/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { createHash } from 'node:crypto';

const hoisted = vi.hoisted(() => {
  const state: Record<string, Record<string, unknown> | undefined> = {};
  const bindingRef = { path: 'suuntoHealthWebhookAccountBindings/digest' };
  const bindingRef2 = { path: 'suuntoHealthWebhookAccountBindings/digest-2' };
  const ingressRef = { path: `suuntoHealthWebhookIngress/${'a'.repeat(64)}` };
  const ingressRef2 = { path: `suuntoHealthWebhookIngress/${'b'.repeat(64)}` };
  const tokenRef = { path: 'suuntoAppAccessTokens/firebase-user-1/tokens/suunto-account-1' };
  const tokenRef2 = { path: 'suuntoAppAccessTokens/firebase-user-2/tokens/suunto-account-1' };
  const tokenRootRef: any = {
    path: 'suuntoAppAccessTokens/firebase-user-1',
    collection: vi.fn(() => ({ doc: vi.fn(() => tokenRef) })),
  };
  const tokenRootRef2: any = {
    path: 'suuntoAppAccessTokens/firebase-user-2',
    collection: vi.fn(() => ({ doc: vi.fn(() => tokenRef2) })),
  };
  const serviceMetaRef = { path: 'users/firebase-user-1/meta/SuuntoApp' };
  const serviceMetaRef2 = { path: 'users/firebase-user-2/meta/SuuntoApp' };
  const userRef = {
    collection: vi.fn(() => ({ doc: vi.fn(() => serviceMetaRef) })),
  };
  const userRef2 = {
    collection: vi.fn(() => ({ doc: vi.fn(() => serviceMetaRef2) })),
  };
  const collectionGroup = vi.fn(() => {
    throw new Error('Webhook binding must not use collection-group token lookup.');
  });
  const collection = vi.fn((name: string) => ({
    doc: vi.fn((id: string) => {
      if (name === 'suuntoHealthWebhookAccountBindings') {
        return id === 'ccf4ef38d2a13e51ac427ffce2d71e2ec690fef05753ed5f6f112a8e832287ed'
          ? bindingRef2
          : bindingRef;
      }
      if (name === 'suuntoHealthWebhookIngress') {
        return id === 'b696f85ef3779e44bb99b1c99c1f84267dbf80e7ec5ab1596d3c7f30ef5421ba'
          ? ingressRef2
          : ingressRef;
      }
      if (name === 'suuntoAppAccessTokens') {
        return id === 'firebase-user-2' ? tokenRootRef2 : tokenRootRef;
      }
      if (name === 'users') return id === 'firebase-user-2' ? userRef2 : userRef;
      throw new Error(`Unexpected collection ${name}`);
    }),
  }));
  const stateKeyByRef = new Map<unknown, string>([
    [bindingRef, 'binding'],
    [bindingRef2, 'binding2'],
    [tokenRef, 'token'],
    [tokenRef2, 'token2'],
    [tokenRootRef, 'tokenRoot'],
    [tokenRootRef2, 'tokenRoot2'],
    [serviceMetaRef, 'serviceMeta'],
    [serviceMetaRef2, 'serviceMeta2'],
    [ingressRef, 'ingress'],
    [ingressRef2, 'ingress2'],
  ]);
  const transactionGet = vi.fn(async (ref: unknown) => {
    const key = stateKeyByRef.get(ref);
    if (!key) throw new Error('Unexpected transaction read.');
    const data = state[key];
    return { exists: data !== undefined, data: () => data };
  });
  const transactionCreate = vi.fn();
  const transaction = { get: transactionGet, create: transactionCreate };
  const runTransaction = vi.fn(async (callback: (tx: unknown) => unknown) => callback(transaction));
  const recursiveDelete = vi.fn();
  const db = { collection, collectionGroup, recursiveDelete, runTransaction };
  let registeredTriggerOptions: unknown;
  return {
    addQueueItem: vi.fn(),
    bindingRef,
    bindingRef2,
    collectionGroup,
    db,
    getDeletionGuardInTransaction: vi.fn(),
    getRegisteredTriggerOptions: () => registeredTriggerOptions,
    ingressRef,
    ingressRef2,
    isQueueSkip: vi.fn(() => false),
    onDocumentCreated: vi.fn((options: unknown, handler: unknown) => {
      registeredTriggerOptions = options;
      return handler;
    }),
    recursiveDelete,
    runTransaction,
    serviceMetaRef,
    serviceMetaRef2,
    state,
    tokenRef,
    tokenRef2,
    tokenRootRef,
    tokenRootRef2,
    transactionCreate,
  };
});

vi.mock('firebase-admin', () => ({ firestore: vi.fn(() => hoisted.db) }));
vi.mock('firebase-functions/logger', () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(),
}));
vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentCreated: hoisted.onDocumentCreated,
}));
vi.mock('../queue/provider-queue-errors', () => ({
  isProviderQueueSkippedWithoutRetryError: hoisted.isQueueSkip,
}));
vi.mock('../sleep/queue', () => ({ addSleepSyncQueueItem: hoisted.addQueueItem }));
vi.mock('../shared/user-deletion-guard', () => ({
  getUserDeletionGuardStateInTransaction: hoisted.getDeletionGuardInTransaction,
}));
vi.mock('../shared/ttl-config', () => ({
  getExpireAtTimestamp: vi.fn(() => 'EXPIRE_AT'),
  TTL_CONFIG: { QUEUE_ITEM_IN_DAYS: 7 },
}));

import {
  fanOutSuuntoHealthWebhookIngress,
  persistSuuntoHealthWebhookIngress,
  processSuuntoHealthWebhookIngressDocument,
} from './health-webhook-ingress';

const INGRESS_ID = 'a'.repeat(64);
const RECEIVED_AT_MS = 1_777_777_777_000;
const PROCESSED_AT_MS = RECEIVED_AT_MS + 1_000;
const TOKEN_GENERATION = 'credential-generation-1';
const PROVIDER_ACCOUNT_DIGEST = createHash('sha256').update('suunto-account-1').digest('hex');
const ROOT_GENERATION = 'root-credential-generation-2';
const CONNECTION_GENERATION = 'connection-generation-1';

function snapshot(data?: Record<string, unknown>, exists = true) {
  return { exists, data: () => data };
}

function ingressData(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 5,
    userID: 'firebase-user-1',
    notificationType: 'SUUNTO_247_ACTIVITY_CREATED',
    providerUserId: 'suunto-account-1',
    tokenCredentialGeneration: TOKEN_GENERATION,
    rootOAuthCredentialGeneration: ROOT_GENERATION,
    connectionState: 'connected',
    connectionStateGeneration: CONNECTION_GENERATION,
    windows: [
      { startMs: 1_700_000_000_000, endMs: 1_700_086_400_000 },
      { startMs: 1_700_086_400_000, endMs: 1_700_172_800_000 },
    ],
    receivedAtMs: RECEIVED_AT_MS,
    processed: false,
    ...overrides,
  };
}

function ingressSnapshot(data = ingressData(), id = INGRESS_ID) {
  const ref = {
    get: vi.fn().mockResolvedValue(snapshot(data)),
    update: vi.fn().mockResolvedValue(undefined),
  };
  return { snapshot: { id, data: () => data, ref } as any, ref };
}

function activeDependencies(overrides: Record<string, unknown> = {}) {
  return {
    addQueueItem: hoisted.addQueueItem,
    db: hoisted.db as any,
    isHealthEnabled: vi.fn(() => true),
    isUserAllowed: vi.fn(() => true),
    nowMs: vi.fn(() => PROCESSED_AT_MS),
    ...overrides,
  };
}

function persistInput() {
  return {
    notificationDigest: INGRESS_ID,
    notificationType: 'SUUNTO_247_ACTIVITY_CREATED' as const,
    providerUserId: 'suunto-account-1',
    windows: [{ startMs: 1_700_000_000_000, endMs: 1_700_086_400_000 }],
    receivedAtMs: RECEIVED_AT_MS,
  };
}

function persistDependencies(isAllowed = true) {
  return {
    candidateUserIDs: ['firebase-user-1'],
    isUserAllowed: vi.fn(() => isAllowed),
  };
}

describe('Suunto Health webhook ingress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.state.binding = {
      schemaVersion: 3,
      userID: 'firebase-user-1',
      providerAccountDigest: PROVIDER_ACCOUNT_DIGEST,
      tokenCredentialGeneration: TOKEN_GENERATION,
    };
    hoisted.state.token = {
      serviceName: ServiceNames.SuuntoApp,
      userName: 'suunto-account-1',
      tokenCredentialGeneration: TOKEN_GENERATION,
    };
    hoisted.state.tokenRoot = { activeOAuthCredentialGeneration: ROOT_GENERATION };
    hoisted.state.serviceMeta = {
      connectionState: 'connected',
      connectionStateGeneration: CONNECTION_GENERATION,
    };
    hoisted.state.ingress = undefined;
    hoisted.state.binding2 = undefined;
    hoisted.state.token2 = undefined;
    hoisted.state.tokenRoot2 = undefined;
    hoisted.state.serviceMeta2 = undefined;
    hoisted.state.ingress2 = undefined;
    hoisted.addQueueItem.mockResolvedValue({ id: 'queue-item' });
    hoisted.getDeletionGuardInTransaction.mockResolvedValue({
      userExists: true, deletionInProgress: false, shouldSkip: false,
    });
    hoisted.recursiveDelete.mockResolvedValue(undefined);
  });

  it('registers a retry-enabled asynchronous Firestore fan-out trigger', () => {
    expect(fanOutSuuntoHealthWebhookIngress).toBeTypeOf('function');
    expect(hoisted.getRegisteredTriggerOptions()).toEqual(expect.objectContaining({
      document: 'suuntoHealthWebhookIngress/{ingressID}',
      region: 'europe-west2',
      retry: true,
    }));
  });

  it('binds a retained staged account and captures schema-v5 root lifecycle state', async () => {
    await expect(persistSuuntoHealthWebhookIngress(
      persistInput(),
      persistDependencies(),
    )).resolves.toBe('created');

    expect(hoisted.collectionGroup).not.toHaveBeenCalled();
    expect(hoisted.runTransaction).toHaveBeenCalledTimes(1);
    expect(hoisted.transactionCreate).toHaveBeenCalledWith(hoisted.ingressRef, {
      schemaVersion: 5,
      userID: 'firebase-user-1',
      notificationType: 'SUUNTO_247_ACTIVITY_CREATED',
      providerUserId: 'suunto-account-1',
      tokenCredentialGeneration: TOKEN_GENERATION,
      rootOAuthCredentialGeneration: ROOT_GENERATION,
      connectionState: 'connected',
      connectionStateGeneration: CONNECTION_GENERATION,
      windows: [{ startMs: 1_700_000_000_000, endMs: 1_700_086_400_000 }],
      receivedAtMs: RECEIVED_AT_MS,
      processed: false,
      expireAt: 'EXPIRE_AT',
    });
  });

  it('treats an existing bound ingress as a durable duplicate', async () => {
    hoisted.state.ingress = { processed: false };
    await expect(persistSuuntoHealthWebhookIngress(
      persistInput(),
      persistDependencies(),
    )).resolves.toBe('duplicate');
    expect(hoisted.transactionCreate).not.toHaveBeenCalled();
  });

  it('creates independent durable ingress for every active staged connection', async () => {
    hoisted.state.binding2 = {
      schemaVersion: 3,
      userID: 'firebase-user-2',
      providerAccountDigest: PROVIDER_ACCOUNT_DIGEST,
      tokenCredentialGeneration: 'credential-generation-2',
    };
    hoisted.state.token2 = {
      serviceName: ServiceNames.SuuntoApp,
      userName: 'suunto-account-1',
      tokenCredentialGeneration: 'credential-generation-2',
    };
    hoisted.state.tokenRoot2 = {
      activeOAuthCredentialGeneration: 'root-credential-generation-3',
    };
    hoisted.state.serviceMeta2 = {
      connectionState: 'connected',
      connectionStateGeneration: 'connection-generation-2',
    };

    await expect(persistSuuntoHealthWebhookIngress(persistInput(), {
      candidateUserIDs: ['firebase-user-1', 'firebase-user-2'],
      isUserAllowed: () => true,
    })).resolves.toBe('created');

    expect(hoisted.transactionCreate).toHaveBeenCalledTimes(2);
    expect(hoisted.transactionCreate).toHaveBeenCalledWith(
      hoisted.ingressRef,
      expect.objectContaining({ userID: 'firebase-user-1' }),
    );
    expect(hoisted.transactionCreate).toHaveBeenCalledWith(
      hoisted.ingressRef2,
      expect.objectContaining({
        userID: 'firebase-user-2',
        tokenCredentialGeneration: 'credential-generation-2',
        rootOAuthCredentialGeneration: 'root-credential-generation-3',
        connectionStateGeneration: 'connection-generation-2',
      }),
    );
  });

  it('does not persist ingress for unknown or non-rollout bindings', async () => {
    hoisted.state.binding = undefined;
    await expect(persistSuuntoHealthWebhookIngress(
      persistInput(),
      persistDependencies(),
    )).resolves.toBe('permanent_skip');

    hoisted.state.binding = {
      schemaVersion: 3,
      userID: 'firebase-user-1',
      providerAccountDigest: PROVIDER_ACCOUNT_DIGEST,
      tokenCredentialGeneration: TOKEN_GENERATION,
    };
    await expect(persistSuuntoHealthWebhookIngress(
      persistInput(),
      persistDependencies(false),
    )).resolves.toBe('permanent_skip');
    expect(hoisted.transactionCreate).not.toHaveBeenCalled();
  });

  it('does not persist ingress when deletion, disconnect, or reconnect-required wins', async () => {
    hoisted.getDeletionGuardInTransaction.mockResolvedValueOnce({ shouldSkip: true });
    await expect(persistSuuntoHealthWebhookIngress(
      persistInput(),
      persistDependencies(),
    )).resolves.toBe('permanent_skip');

    hoisted.state.tokenRoot = {
      activeOAuthCredentialGeneration: ROOT_GENERATION,
      disconnectState: 'disconnect_pending',
    };
    await expect(persistSuuntoHealthWebhookIngress(
      persistInput(),
      persistDependencies(),
    )).resolves.toBe('permanent_skip');

    hoisted.state.tokenRoot = { activeOAuthCredentialGeneration: ROOT_GENERATION };
    hoisted.state.serviceMeta = {
      connectionState: 'reconnect_required',
      connectionStateGeneration: 'replacement-generation',
    };
    await expect(persistSuuntoHealthWebhookIngress(
      persistInput(),
      persistDependencies(),
    )).resolves.toBe('permanent_skip');
    expect(hoisted.transactionCreate).not.toHaveBeenCalled();
  });

  it('cannot be poisoned by similarly named client-writable token documents', async () => {
    await expect(persistSuuntoHealthWebhookIngress(
      persistInput(),
      persistDependencies(),
    )).resolves.toBe('created');
    expect(hoisted.collectionGroup).not.toHaveBeenCalled();
  });

  it('fans out every bounded window with binding and connection write fences', async () => {
    const { snapshot: eventSnapshot, ref } = ingressSnapshot();
    await processSuuntoHealthWebhookIngressDocument(eventSnapshot, activeDependencies() as any);

    expect(hoisted.addQueueItem).toHaveBeenCalledTimes(2);
    expect(hoisted.addQueueItem).toHaveBeenNthCalledWith(1, expect.objectContaining({
      type: 'suunto_health_poll',
      provider: 'SuuntoApp',
      userID: 'firebase-user-1',
      providerUserId: 'suunto-account-1',
      rangeStartMs: 1_700_000_000_000,
      rangeEndMs: 1_700_086_400_000,
      healthTrigger: 'webhook',
      dispatchImmediately: true,
      suuntoHealthTokenCredentialGeneration: TOKEN_GENERATION,
      suuntoHealthRootOAuthCredentialGeneration: ROOT_GENERATION,
      suuntoHealthConnectionStateGeneration: CONNECTION_GENERATION,
      requiredDocumentFieldValues: expect.arrayContaining([
        expect.objectContaining({ documentRef: hoisted.bindingRef }),
        expect.objectContaining({ documentRef: hoisted.tokenRef }),
        expect.objectContaining({ documentRef: hoisted.tokenRootRef }),
        expect.objectContaining({ documentRef: hoisted.serviceMetaRef }),
      ]),
    }));
    expect(ref.update).toHaveBeenCalledWith({
      processed: true,
      processedAtMs: PROCESSED_AT_MS,
      resultStatus: 'queued',
      windowsQueued: 2,
    });
    expect(hoisted.recursiveDelete).not.toHaveBeenCalled();
  });

  it('recursively deletes malformed, disabled, stale, and deleting ingress', async () => {
    const malformed = ingressSnapshot(ingressData({ schemaVersion: 4 }));
    await processSuuntoHealthWebhookIngressDocument(malformed.snapshot, activeDependencies() as any);
    expect(hoisted.recursiveDelete).toHaveBeenCalledWith(malformed.ref);

    const disabled = ingressSnapshot();
    await processSuuntoHealthWebhookIngressDocument(disabled.snapshot, activeDependencies({
      isHealthEnabled: vi.fn(() => false),
    }) as any);
    expect(hoisted.recursiveDelete).toHaveBeenCalledWith(disabled.ref);

    const stale = ingressSnapshot();
    hoisted.state.binding = undefined;
    await processSuuntoHealthWebhookIngressDocument(stale.snapshot, activeDependencies() as any);
    expect(hoisted.recursiveDelete).toHaveBeenCalledWith(stale.ref);

    hoisted.state.binding = {
      schemaVersion: 3,
      userID: 'firebase-user-1',
      providerAccountDigest: PROVIDER_ACCOUNT_DIGEST,
      tokenCredentialGeneration: TOKEN_GENERATION,
    };
    hoisted.getDeletionGuardInTransaction.mockResolvedValueOnce({ shouldSkip: true });
    const deleting = ingressSnapshot();
    await processSuuntoHealthWebhookIngressDocument(deleting.snapshot, activeDependencies() as any);
    expect(hoisted.recursiveDelete).toHaveBeenCalledWith(deleting.ref);
    expect(hoisted.addQueueItem).not.toHaveBeenCalled();
  });

  it('recursively deletes ingress when the captured token-root generation rotated', async () => {
    const rotated = ingressSnapshot();
    hoisted.state.tokenRoot = {
      activeOAuthCredentialGeneration: 'root-credential-generation-3',
    };

    await processSuuntoHealthWebhookIngressDocument(
      rotated.snapshot,
      activeDependencies() as any,
    );

    expect(hoisted.recursiveDelete).toHaveBeenCalledWith(rotated.ref);
    expect(hoisted.addQueueItem).not.toHaveBeenCalled();
  });

  it('recursively deletes lifecycle queue skips instead of retaining metadata', async () => {
    const { snapshot: eventSnapshot, ref } = ingressSnapshot();
    hoisted.addQueueItem.mockRejectedValueOnce(new Error('deleting'));
    hoisted.isQueueSkip.mockReturnValueOnce(true);

    await processSuuntoHealthWebhookIngressDocument(eventSnapshot, activeDependencies() as any);
    expect(hoisted.recursiveDelete).toHaveBeenCalledWith(ref);
    expect(ref.update).not.toHaveBeenCalled();
  });

  it('propagates transient fan-out and recursive-delete failures for Eventarc retry', async () => {
    const transient = ingressSnapshot();
    hoisted.addQueueItem.mockRejectedValueOnce(new Error('Cloud Tasks unavailable'));
    await expect(processSuuntoHealthWebhookIngressDocument(
      transient.snapshot,
      activeDependencies() as any,
    )).rejects.toThrow('Cloud Tasks unavailable');
    expect(transient.ref.update).not.toHaveBeenCalled();

    const malformed = ingressSnapshot(ingressData({ windows: [] }));
    hoisted.recursiveDelete.mockRejectedValueOnce(new Error('Firestore unavailable'));
    await expect(processSuuntoHealthWebhookIngressDocument(
      malformed.snapshot,
      activeDependencies() as any,
    )).rejects.toThrow('Firestore unavailable');
  });
});
