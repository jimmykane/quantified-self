import { describe, expect, it } from 'vitest';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { readTrainingDeliveryAuthority, DELIVERY_SERVICES, GARMIN_TRAINING_PERMISSION_ISSUE } from './connection';
import { deliveryIdentity } from './intent';
import { buildSuuntoHealthWebhookAccountBinding } from '../../suunto/health-webhook-binding';

describe('Training authority extraction compatibility', () => {
  it('uses the Garmin-facing Training permission name in the repair message', () => {
    expect(GARMIN_TRAINING_PERMISSION_ISSUE).toBe('Garmin Training permission is required. Reconnect Garmin and allow training workouts.');
  });
  it('uses canonical string account identity and explicit Training grants for Wahoo', async () => {
    const provider = 'wahoo' as const;
    const service = DELIVERY_SERVICES[provider];
    const ref = { collection: () => ref, doc: () => ref, limit: () => ref };
    const data = { [service.account]: '123', tokenCredentialGeneration: 'credential', scope: 'user_read plans_read plans_write workouts_read workouts_write' };
    const values = [
      { data: () => ({ connectionState: 'connected', connectionStateGeneration: 'connection', providerUserId: '123' }) },
      { exists: true, data: () => ({ activeOAuthCredentialGeneration: 'credential' }) },
      { empty: false, size: 1, docs: [{ id: '123', data: () => data }] },
      { data: () => ({ connectionEpochs: { [provider]: 2 } }) },
    ];
    const db = { collection: () => ref } as unknown as Firestore;
    const tx = { get: async () => values.shift() } as unknown as Transaction;
    const authority = await readTrainingDeliveryAuthority(db, tx, 'fixture', provider);
    expect(authority.connection).toEqual({ state: 'connected', destinationKey: deliveryIdentity('fixture', provider, '123', 'account'),
      generation: 'connection:credential:credential', epoch: 2 });
  });
  it.each([
    ['absent-generation', undefined, undefined, true],
    ['matching', 'credential', 'credential', true],
    ['root-only', 'credential', undefined, false],
    ['token-only', undefined, 'credential', false],
    ['mismatched', 'root', 'token', false],
  ] as const)('resolves COROS credential generations: %s', async (_scenario, rootGeneration, tokenGeneration, valid) => {
    const service = DELIVERY_SERVICES.coros;
    const ref = { collection: () => ref, doc: () => ref, limit: () => ref };
    const tokenData = { openId: 'coros-account', serviceName: service.name,
      ...(tokenGeneration ? { tokenCredentialGeneration: tokenGeneration } : {}) };
    const token = { id: 'coros-account', data: () => tokenData };
    const values = [
      { data: () => ({ connectionState: 'connected', connectionStateGeneration: 'connection', providerUserId: 'coros-account' }) },
      { exists: true, data: () => rootGeneration ? { activeOAuthCredentialGeneration: rootGeneration } : {} },
      { empty: false, size: 1, docs: [token] },
      { data: () => ({ connectionEpochs: { coros: 2 } }) },
    ];
    const authority = await readTrainingDeliveryAuthority({ collection: () => ref } as unknown as Firestore,
      { get: async () => values.shift() } as unknown as Transaction, 'fixture', 'coros');
    expect(authority.connection.state).toBe(valid ? 'connected' : 'connection_repair');
    if (valid) {
      expect(authority.token).toBe(token);
      expect(authority.connection).toMatchObject({
        destinationKey: deliveryIdentity('fixture', 'coros', 'coros-account', 'account'),
        generation: `connection:${rootGeneration ?? ''}:${tokenGeneration ?? ''}`,
        epoch: 2,
      });
    }
  });
  it('accepts an existing COROS token without redundant serviceName metadata', async () => {
    const ref = { collection: () => ref, doc: () => ref, limit: () => ref };
    const token = { id: 'coros-account', data: () => ({ openId: 'coros-account' }) };
    const values = [
      { data: () => ({ connectionState: 'connected', providerUserId: 'coros-account' }) },
      { exists: true, data: () => ({}) },
      { empty: false, size: 1, docs: [token] },
      { data: () => ({}) },
    ];
    const authority = await readTrainingDeliveryAuthority({ collection: () => ref } as unknown as Firestore,
      { get: async () => values.shift() } as unknown as Transaction, 'fixture', 'coros');
    expect(authority.connection.state).toBe('connected');
    expect(authority.token).toBe(token);
  });
  it('rejects a COROS token whose document identity conflicts with openId', async () => {
    const service = DELIVERY_SERVICES.coros;
    const ref = { collection: () => ref, doc: () => ref, limit: () => ref };
    const values = [
      { data: () => ({ connectionState: 'connected', connectionStateGeneration: 'connection' }) },
      { exists: true, data: () => ({}) },
      { empty: false, size: 1, docs: [{ id: 'document-account', data: () => ({
        openId: 'different-account', serviceName: service.name,
      }) }] },
      { data: () => ({}) },
    ];
    const authority = await readTrainingDeliveryAuthority({ collection: () => ref } as unknown as Firestore,
      { get: async () => values.shift() } as unknown as Transaction, 'fixture', 'coros');
    expect(authority.connection.state).toBe('connection_repair');
  });
  it('does not silently replace an invalid saved COROS account pin', async () => {
    const service = DELIVERY_SERVICES.coros;
    const ref = { collection: () => ref, doc: () => ref, limit: () => ref };
    const values = [
      { data: () => ({ connectionState: 'connected', providerUserId: 123 }) },
      { exists: true, data: () => ({}) },
      { empty: false, size: 1, docs: [{ id: 'valid-account', data: () => ({
        openId: 'valid-account', serviceName: service.name,
      }) }] },
      { data: () => ({}) },
    ];
    const authority = await readTrainingDeliveryAuthority({ collection: () => ref } as unknown as Firestore,
      { get: async () => values.shift() } as unknown as Transaction, 'fixture', 'coros');
    expect(authority.connection.state).toBe('connection_repair');
    expect(authority.token).toBeNull();
  });
  it('honors a pinned COROS account when another retained account also lacks generation metadata', async () => {
    const service = DELIVERY_SERVICES.coros;
    const ref = { collection: () => ref, doc: () => ref, limit: () => ref };
    const pinned = { id: 'pinned-account', data: () => ({ openId: 'pinned-account', serviceName: service.name }) };
    const retained = { id: 'retained-account', data: () => ({ openId: 'retained-account', serviceName: service.name }) };
    const values = [
      { data: () => ({ connectionState: 'connected', providerUserId: 'pinned-account' }) },
      { exists: true, data: () => ({}) },
      { empty: false, size: 2, docs: [retained, pinned] },
      { data: () => ({ connectionEpochs: { coros: 3 } }) },
    ];
    const authority = await readTrainingDeliveryAuthority({ collection: () => ref } as unknown as Firestore,
      { get: async () => values.shift() } as unknown as Transaction, 'fixture', 'coros');
    expect(authority.token).toBe(pinned);
    expect(authority.connection).toMatchObject({ state: 'connected', epoch: 3,
      destinationKey: deliveryIdentity('fixture', 'coros', 'pinned-account', 'account') });
  });
  it('uses canonical deterministic selection for multiple unpinned COROS accounts without generation metadata', async () => {
    const service = DELIVERY_SERVICES.coros;
    const ref = { collection: () => ref, doc: () => ref, limit: () => ref };
    const docs = [
      { id: 'older', data: () => ({ openId: 'older', serviceName: service.name, dateRefreshed: 1 }) },
      { id: 'newer', data: () => ({ openId: 'newer', serviceName: service.name, dateRefreshed: 2 }) },
    ];
    const values = [
      { data: () => ({ connectionState: 'connected' }) },
      { exists: true, data: () => ({}) },
      { empty: false, size: 2, docs },
      { data: () => ({}) },
    ];
    const authority = await readTrainingDeliveryAuthority({ collection: () => ref } as unknown as Firestore,
      { get: async () => values.shift() } as unknown as Transaction, 'fixture', 'coros');
    expect(authority.connection.state).toBe('connected');
    expect(authority.token).toBe(docs[1]);
    expect(authority.account).toBe('newer');
  });
  it('fails closed when the canonical latest COROS token is not authorized by the root generation', async () => {
    const service = DELIVERY_SERVICES.coros;
    const ref = { collection: () => ref, doc: () => ref, limit: () => ref };
    const docs = [
      { id: 'older', data: () => ({ openId: 'older', serviceName: service.name,
        tokenCredentialGeneration: 'current', dateRefreshed: 1 }) },
      { id: 'newer', data: () => ({ openId: 'newer', serviceName: service.name,
        tokenCredentialGeneration: 'stale', dateRefreshed: 2 }) },
    ];
    const values = [
      { data: () => ({ connectionState: 'connected' }) },
      { exists: true, data: () => ({ activeOAuthCredentialGeneration: 'current' }) },
      { empty: false, size: 2, docs },
      { data: () => ({}) },
    ];
    const authority = await readTrainingDeliveryAuthority({ collection: () => ref } as unknown as Firestore,
      { get: async () => values.shift() } as unknown as Transaction, 'fixture', 'coros');
    expect(authority.connection.state).toBe('connection_repair');
    expect(authority.token).toBeNull();
  });
  it.each(['retained', 'pinned', 'ambiguous', 'untrusted', 'numeric', 'wrong-id', 'malformed-pin',
    'malformed-other', 'pinned-malformed-other'])('resolves Suunto authority: %s', async scenario => {
    const ref = { collection: () => ref, doc: () => ref, limit: () => ref };
    const token = { id: scenario === 'wrong-id' ? 'wrong' : 'account', data: () => ({ userName: scenario === 'numeric' ? 123 : 'account',
      serviceName: DELIVERY_SERVICES.suunto.name, tokenCredentialGeneration: 'older-token' }) };
    const docs = [token, ...(['pinned', 'ambiguous'].includes(scenario) ? [{ id: 'second', data: () => ({ userName: 'second', serviceName: DELIVERY_SERVICES.suunto.name, tokenCredentialGeneration: 'newest' }) }] : [])];
    if (scenario.endsWith('malformed-other')) docs.push({ id: 'second', data: () => ({ userName: 'second',
      serviceName: DELIVERY_SERVICES.suunto.name, tokenCredentialGeneration: '' }) });
    const values = [
      { data: () => ({ connectionState: 'connected', connectionStateGeneration: 'connection', ...(scenario.startsWith('pinned') ? { providerUserId: 'account' } : {}), ...(scenario === 'malformed-pin' ? { providerUserId: 123 } : {}) }) },
      { exists: true, data: () => ({ activeOAuthCredentialGeneration: 'newest-root' }) },
      { empty: false, size: docs.length, docs }, { data: () => ({}) },
      { data: () => scenario === 'untrusted' ? {} : buildSuuntoHealthWebhookAccountBinding('uid', 'account', 'older-token', 'oauth_callback') },
    ];
    const result = await readTrainingDeliveryAuthority({ collection: () => ref } as unknown as Firestore,
      { get: async () => values.shift() } as unknown as Transaction, 'uid', 'suunto');
    if (['retained', 'pinned', 'pinned-malformed-other'].includes(scenario)) {
      expect(result.connection.state).toBe('connected'); expect(result.token).toBe(token);
      expect(result.connection.generation).toBe('connection:newest-root:older-token');
      expect(result.credentialGeneration).toBe('newest-root');
    } else expect(result.connection.state).toBe('connection_repair');
  });
});
