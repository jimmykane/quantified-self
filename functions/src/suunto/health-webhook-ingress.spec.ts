/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const create = vi.fn();
  const doc = vi.fn(() => ({ create }));
  const collection = vi.fn(() => ({ doc }));
  const db = { collection };
  let registeredTriggerOptions: unknown;
  return {
    create,
    doc,
    collection,
    db,
    addQueueItem: vi.fn(),
    getRegisteredTriggerOptions: () => registeredTriggerOptions,
    onDocumentCreated: vi.fn((options: unknown, handler: unknown) => {
      registeredTriggerOptions = options;
      return handler;
    }),
  };
});

vi.mock('firebase-admin', () => ({
  firestore: vi.fn(() => hoisted.db),
}));
vi.mock('firebase-functions/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentCreated: hoisted.onDocumentCreated,
}));
vi.mock('../sleep/queue', () => ({
  addSleepSyncQueueItem: hoisted.addQueueItem,
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

function ingressData(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    notificationType: 'SUUNTO_247_ACTIVITY_CREATED',
    providerUserId: 'suunto-account-1',
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
  const update = vi.fn().mockResolvedValue(undefined);
  const get = vi.fn().mockResolvedValue({
    exists: true,
    data: () => data,
  });
  return {
    snapshot: {
      id,
      data: () => data,
      ref: { get, update },
    } as any,
    get,
    update,
  };
}

function activeDependencies(overrides: Record<string, unknown> = {}) {
  return {
    addQueueItem: hoisted.addQueueItem,
    db: hoisted.db as any,
    getDeletionGuard: vi.fn().mockResolvedValue({
      userExists: true,
      deletionInProgress: false,
      shouldSkip: false,
    }),
    isHealthEnabled: vi.fn(() => true),
    isUserAllowed: vi.fn(() => true),
    nowMs: vi.fn(() => PROCESSED_AT_MS),
    resolveUserID: vi.fn().mockResolvedValue('firebase-user-1'),
    ...overrides,
  };
}

describe('Suunto Health webhook ingress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.create.mockResolvedValue(undefined);
    hoisted.addQueueItem.mockResolvedValue({ id: 'queue-item' });
  });

  it('registers a retry-enabled asynchronous Firestore fan-out trigger', () => {
    expect(fanOutSuuntoHealthWebhookIngress).toBeTypeOf('function');
    expect(hoisted.getRegisteredTriggerOptions()).toEqual(expect.objectContaining({
      document: 'suuntoHealthWebhookIngress/{ingressID}',
      region: 'europe-west2',
      retry: true,
    }));
  });

  it('persists one compact create-only ingress record and treats exact retries as durable duplicates', async () => {
    await expect(persistSuuntoHealthWebhookIngress({
      notificationDigest: INGRESS_ID,
      notificationType: 'SUUNTO_247_ACTIVITY_CREATED',
      providerUserId: 'suunto-account-1',
      windows: [{ startMs: 1_700_000_000_000, endMs: 1_700_086_400_000 }],
      receivedAtMs: RECEIVED_AT_MS,
    })).resolves.toBe('created');

    expect(hoisted.collection).toHaveBeenCalledWith('suuntoHealthWebhookIngress');
    expect(hoisted.doc).toHaveBeenCalledWith(INGRESS_ID);
    expect(hoisted.create).toHaveBeenCalledWith({
      schemaVersion: 1,
      notificationType: 'SUUNTO_247_ACTIVITY_CREATED',
      providerUserId: 'suunto-account-1',
      windows: [{ startMs: 1_700_000_000_000, endMs: 1_700_086_400_000 }],
      receivedAtMs: RECEIVED_AT_MS,
      processed: false,
      expireAt: 'EXPIRE_AT',
    });
    expect(hoisted.create.mock.calls[0]?.[0]).not.toHaveProperty('samples');

    hoisted.create.mockRejectedValueOnce({ code: 6 });
    await expect(persistSuuntoHealthWebhookIngress({
      notificationDigest: INGRESS_ID,
      notificationType: 'SUUNTO_247_ACTIVITY_CREATED',
      providerUserId: 'suunto-account-1',
      windows: [{ startMs: 1_700_000_000_000, endMs: 1_700_086_400_000 }],
      receivedAtMs: RECEIVED_AT_MS,
    })).resolves.toBe('duplicate');
  });

  it('fans out every bounded window only after the durable ingress trigger runs', async () => {
    const { snapshot, update } = ingressSnapshot();

    await processSuuntoHealthWebhookIngressDocument(snapshot, activeDependencies() as any);

    expect(hoisted.addQueueItem).toHaveBeenCalledTimes(2);
    expect(hoisted.addQueueItem).toHaveBeenNthCalledWith(1, {
      type: 'suunto_health_poll',
      provider: 'SuuntoApp',
      userID: 'firebase-user-1',
      providerUserId: 'suunto-account-1',
      rangeStartMs: 1_700_000_000_000,
      rangeEndMs: 1_700_086_400_000,
      healthTrigger: 'webhook',
      dedupeKey: `suunto-health-webhook:firebase-user-1:suunto-account-1:1700000000000:1700086400000:${INGRESS_ID}`,
      dispatchImmediately: true,
    });
    expect(update).toHaveBeenCalledWith({
      processed: true,
      processedAtMs: PROCESSED_AT_MS,
      resultStatus: 'queued',
      windowsQueued: 2,
      userID: 'firebase-user-1',
    });
  });

  it('uses the live document state to suppress duplicate trigger deliveries after completion', async () => {
    const { snapshot, update } = ingressSnapshot(ingressData({ processed: true }));

    await processSuuntoHealthWebhookIngressDocument(snapshot, activeDependencies() as any);

    expect(hoisted.addQueueItem).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('marks rollback and account-deletion skips without queueing work', async () => {
    const disabled = ingressSnapshot();
    await processSuuntoHealthWebhookIngressDocument(disabled.snapshot, activeDependencies({
      isHealthEnabled: vi.fn(() => false),
    }) as any);
    expect(disabled.update).toHaveBeenCalledWith(expect.objectContaining({
      resultStatus: 'provider_disabled',
      processed: true,
    }));

    const deleted = ingressSnapshot();
    await processSuuntoHealthWebhookIngressDocument(deleted.snapshot, activeDependencies({
      getDeletionGuard: vi.fn().mockResolvedValue({
        userExists: true,
        deletionInProgress: true,
        shouldSkip: true,
      }),
    }) as any);
    expect(deleted.update).toHaveBeenCalledWith(expect.objectContaining({
      resultStatus: 'user_deleted_or_deleting',
      userID: 'firebase-user-1',
    }));
    expect(hoisted.addQueueItem).not.toHaveBeenCalled();
  });

  it('propagates transient fan-out failures so Eventarc retries the idempotent ingress', async () => {
    const { snapshot, update } = ingressSnapshot();
    hoisted.addQueueItem.mockRejectedValueOnce(new Error('Cloud Tasks unavailable'));

    await expect(processSuuntoHealthWebhookIngressDocument(
      snapshot,
      activeDependencies() as any,
    )).rejects.toThrow('Cloud Tasks unavailable');

    expect(update).not.toHaveBeenCalled();
  });

  it('fails closed on malformed ingress without entering a retry loop', async () => {
    const { snapshot, update } = ingressSnapshot(ingressData({ windows: [] }));

    await processSuuntoHealthWebhookIngressDocument(snapshot, activeDependencies() as any);

    expect(hoisted.addQueueItem).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      processed: true,
      resultStatus: 'invalid_ingress',
    }));
  });
});
