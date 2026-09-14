import { describe, expect, it } from 'vitest';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { readTrainingDeliveryAuthority, DELIVERY_SERVICES } from './connection';
import { deliveryIdentity } from './intent';

describe('Training authority extraction compatibility', () => {
  it.each(['wahoo', 'coros', 'suunto'] as const)('keeps existing scalar account normalization for %s', async provider => {
    const service = DELIVERY_SERVICES[provider];
    const ref = { collection: () => ref, doc: () => ref, limit: () => ref };
    const data = { [service.account]: 123, tokenCredentialGeneration: 'credential' };
    const values = [
      { data: () => ({ connectionState: 'connected', connectionStateGeneration: 'connection', providerUserId: 123 }) },
      { exists: true, data: () => ({ activeOAuthCredentialGeneration: 'credential' }) },
      { empty: false, size: 1, docs: [{ data: () => data }] },
      { data: () => ({ connectionEpochs: { [provider]: 2 } }) },
    ];
    const db = { collection: () => ref } as unknown as Firestore;
    const tx = { get: async () => values.shift() } as unknown as Transaction;
    const authority = await readTrainingDeliveryAuthority(db, tx, 'fixture', provider);
    expect(authority.connection).toEqual({ state: 'connected', destinationKey: deliveryIdentity('fixture', provider, '123', 'account'),
      generation: 'connection:credential', epoch: 2 });
  });
});
