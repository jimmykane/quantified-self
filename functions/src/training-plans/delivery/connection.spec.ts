import { describe, expect, it } from 'vitest';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { readTrainingDeliveryAuthority, DELIVERY_SERVICES, GARMIN_TRAINING_PERMISSION_ISSUE } from './connection';
import { deliveryIdentity } from './intent';
import { buildSuuntoHealthWebhookAccountBinding } from '../../suunto/health-webhook-binding';

describe('Training authority extraction compatibility', () => {
  it('uses the Garmin-facing Training permission name in the repair message', () => {
    expect(GARMIN_TRAINING_PERMISSION_ISSUE).toBe('Garmin Training permission is required. Reconnect Garmin and allow training workouts.');
  });
  it.each(['wahoo', 'coros'] as const)('keeps existing scalar account normalization for %s', async provider => {
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
