import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase-admin', () => ({}));

import {
  buildSuuntoHealthWebhookAccountBinding,
  findSuuntoWebhookAccountBindingUserIDs,
  getSuuntoHealthWebhookAccountBindingRef,
  getSuuntoWebhookProviderAccountDigest,
  parseSuuntoHealthWebhookAccountBinding,
  SUUNTO_HEALTH_WEBHOOK_ACCOUNT_BINDINGS_COLLECTION_NAME,
  SUUNTO_WEBHOOK_MAX_MATCHING_ACCOUNT_BINDINGS,
  SUUNTO_WEBHOOK_BINDING_AUTHORIZATION_SOURCES,
} from './health-webhook-binding';

interface TestSnapshot {
  exists: boolean;
  id: string;
  data: () => Record<string, unknown> | undefined;
}

function createBindingStore() {
  const snapshotsByID = new Map<string, TestSnapshot>();
  let querySnapshots: TestSnapshot[] = [];
  const queryGet = vi.fn(async () => ({ docs: querySnapshots }));
  const queryLimit = vi.fn(() => ({ get: queryGet }));
  const queryWhere = vi.fn(() => ({ limit: queryLimit }));
  const collection = {
    doc: vi.fn((id: string) => ({
      id,
      get: vi.fn(async () => snapshotsByID.get(id) || {
        exists: false,
        id,
        data: () => undefined,
      }),
    })),
    where: queryWhere,
  };
  const db = {
    collection: vi.fn((name: string) => {
      if (name !== SUUNTO_HEALTH_WEBHOOK_ACCOUNT_BINDINGS_COLLECTION_NAME) {
        throw new Error(`Unexpected collection ${name}`);
      }
      return collection;
    }),
  };

  const setBinding = (
    providerUserId: string,
    userID: string,
    data = buildSuuntoHealthWebhookAccountBinding(
      userID,
      providerUserId,
      `generation-${userID}`,
      SUUNTO_WEBHOOK_BINDING_AUTHORIZATION_SOURCES.OAuthCallback,
    ),
  ): TestSnapshot => {
    const ref = getSuuntoHealthWebhookAccountBindingRef(db as never, providerUserId, userID);
    const snapshot = {
      exists: true,
      id: ref.id,
      data: () => data,
    };
    snapshotsByID.set(ref.id, snapshot);
    return snapshot;
  };

  return {
    db,
    queryLimit,
    queryWhere,
    setBinding,
    setQuerySnapshots: (snapshots: TestSnapshot[]) => {
      querySnapshots = snapshots;
    },
  };
}

describe('Suunto webhook account bindings', () => {
  let store: ReturnType<typeof createBindingStore>;

  beforeEach(() => {
    store = createBindingStore();
  });

  it('builds a queryable binding without retaining the raw provider account ID', () => {
    const binding = buildSuuntoHealthWebhookAccountBinding(
      'firebase-user-1',
      'suunto-account-1',
      'credential-generation-1',
      SUUNTO_WEBHOOK_BINDING_AUTHORIZATION_SOURCES.OAuthCallback,
    );

    expect(binding).toEqual({
      schemaVersion: 3,
      authorizationSource: 'oauth_callback',
      userID: 'firebase-user-1',
      providerAccountDigest: getSuuntoWebhookProviderAccountDigest('suunto-account-1'),
      tokenCredentialGeneration: 'credential-generation-1',
    });
    expect(JSON.stringify(binding)).not.toContain('suunto-account-1');
  });

  it('rejects unsupported binding schemas', () => {
    expect(parseSuuntoHealthWebhookAccountBinding({
      schemaVersion: 99,
      userID: 'firebase-user-1',
      tokenCredentialGeneration: 'credential-generation-1',
    })).toBeNull();
  });

  it('rejects provenance-less bindings created from untrusted legacy token data', () => {
    expect(parseSuuntoHealthWebhookAccountBinding({
      schemaVersion: 3,
      userID: 'firebase-user-1',
      providerAccountDigest: getSuuntoWebhookProviderAccountDigest('suunto-account-1'),
      tokenCredentialGeneration: 'credential-generation-1',
    })).toBeNull();
  });

  it('resolves every matching binding from the bounded server-owned digest index', async () => {
    const first = store.setBinding('suunto-account-1', 'firebase-user-1');
    const second = store.setBinding('suunto-account-1', 'firebase-user-2');
    const copiedBinding = buildSuuntoHealthWebhookAccountBinding(
      'firebase-user-3',
      'suunto-account-1',
      'generation-3',
      SUUNTO_WEBHOOK_BINDING_AUTHORIZATION_SOURCES.ProviderRefresh,
    );
    store.setQuerySnapshots([
      second,
      {
        exists: true,
        id: 'copied-to-the-wrong-document-id',
        data: () => copiedBinding,
      },
      first,
    ]);

    await expect(findSuuntoWebhookAccountBindingUserIDs(
      store.db as never,
      'suunto-account-1',
    )).resolves.toEqual(['firebase-user-1', 'firebase-user-2']);

    expect(store.queryWhere).toHaveBeenCalledWith(
      'providerAccountDigest',
      '==',
      getSuuntoWebhookProviderAccountDigest('suunto-account-1'),
    );
    expect(store.queryLimit).toHaveBeenCalledWith(
      SUUNTO_WEBHOOK_MAX_MATCHING_ACCOUNT_BINDINGS + 1,
    );
  });

  it('uses direct binding reads for explicit candidates and ignores missing candidates', async () => {
    store.setBinding('suunto-account-1', 'firebase-user-2');

    await expect(findSuuntoWebhookAccountBindingUserIDs(
      store.db as never,
      'suunto-account-1',
      ['firebase-user-1', 'firebase-user-2'],
    )).resolves.toEqual(['firebase-user-2']);
    expect(store.queryWhere).not.toHaveBeenCalled();
  });

  it('fails closed when an explicit candidate list contains no valid Firebase UIDs', async () => {
    store.setQuerySnapshots([
      store.setBinding('suunto-account-1', 'firebase-user-1'),
    ]);

    await expect(findSuuntoWebhookAccountBindingUserIDs(
      store.db as never,
      'suunto-account-1',
      [' invalid-user '],
    )).resolves.toEqual([]);
    expect(store.queryWhere).not.toHaveBeenCalled();
  });

  it('fails retryably instead of truncating excessive shared-account fan-out', async () => {
    store.setQuerySnapshots(Array.from(
      { length: SUUNTO_WEBHOOK_MAX_MATCHING_ACCOUNT_BINDINGS + 1 },
      (_, index) => store.setBinding('suunto-account-1', `firebase-user-${index}`),
    ));

    await expect(findSuuntoWebhookAccountBindingUserIDs(
      store.db as never,
      'suunto-account-1',
    )).rejects.toThrow('fan-out exceeds');
  });
});
