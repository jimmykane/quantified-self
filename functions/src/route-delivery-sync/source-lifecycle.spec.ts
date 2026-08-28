import { beforeEach, describe, expect, it } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import {
  captureCurrentSuuntoRouteDeliverySourceLifecycle,
  recheckSuuntoRouteDeliverySourceLifecycleInTransaction,
} from './source-lifecycle';

const documents = new Map<string, Record<string, unknown>>();

function documentRef(path: string): any {
  return {
    path,
    collection: (name: string) => collectionRef(`${path}/${name}`),
    get: async () => snapshot(path),
  };
}

function collectionRef(path: string): any {
  return {
    path,
    doc: (id: string) => documentRef(`${path}/${id}`),
  };
}

function snapshot(path: string) {
  const data = documents.get(path);
  return {
    exists: data !== undefined,
    data: () => data,
  };
}

const db = {
  collection: (name: string) => collectionRef(name),
} as any;

const transaction = {
  get: async (ref: { path: string }) => snapshot(ref.path),
} as any;

function seedActiveLifecycle(): void {
  documents.set(`users/user-1/meta/${ServiceNames.SuuntoApp}`, {
    connectionState: 'connected',
    connectionStateGeneration: 'connection-generation-1',
  });
  documents.set('suuntoAppAccessTokens/user-1', {
    activeOAuthCredentialGeneration: 'root-generation-1',
  });
  documents.set('suuntoAppAccessTokens/user-1/tokens/suunto-user', {
    serviceName: ServiceNames.SuuntoApp,
    userName: 'suunto-user',
    tokenCredentialGeneration: 'token-generation-1',
  });
}

describe('Suunto route-delivery source lifecycle', () => {
  beforeEach(() => {
    documents.clear();
    seedActiveLifecycle();
  });

  it('captures the UID, account-token, and root lifecycle fence for an active source', async () => {
    await expect(captureCurrentSuuntoRouteDeliverySourceLifecycle(
      db,
      'user-1',
      'suunto-user',
    )).resolves.toEqual({
      status: 'active',
      fence: {
        connectionStateGeneration: 'connection-generation-1',
        tokenCredentialGeneration: 'token-generation-1',
        rootOAuthCredentialGeneration: 'root-generation-1',
      },
    });
  });

  it('treats a root disconnect fence as pending before token cleanup completes', async () => {
    documents.set('suuntoAppAccessTokens/user-1', {
      activeOAuthCredentialGeneration: 'root-generation-1',
      disconnectOperationGeneration: 'disconnect-operation-1',
    });

    await expect(captureCurrentSuuntoRouteDeliverySourceLifecycle(
      db,
      'user-1',
      'suunto-user',
    )).resolves.toEqual({ status: 'disconnect_pending' });
  });

  it('rejects a queue fence when reconnect rotates the root lifecycle', async () => {
    documents.set('suuntoAppAccessTokens/user-1', {
      activeOAuthCredentialGeneration: 'root-generation-2',
    });

    await expect(recheckSuuntoRouteDeliverySourceLifecycleInTransaction(
      db,
      transaction,
      'user-1',
      'suunto-user',
      {
        connectionStateGeneration: 'connection-generation-1',
        tokenCredentialGeneration: 'token-generation-1',
        rootOAuthCredentialGeneration: 'root-generation-1',
      },
    )).resolves.toEqual({ status: 'inactive' });
  });

  it('rejects an already disconnected source even when stale token data remains', async () => {
    documents.set(`users/user-1/meta/${ServiceNames.SuuntoApp}`, {
      connectionStateGeneration: 'connection-generation-2',
    });

    await expect(captureCurrentSuuntoRouteDeliverySourceLifecycle(
      db,
      'user-1',
      'suunto-user',
    )).resolves.toEqual({ status: 'inactive' });
  });
});
