import { describe, expect, it } from 'vitest';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { resolveDeliveryIntent, deliveryIdentity } from './intent';
import type { DeliveryContext, DeliveryLedgerV1 } from './contracts';
import { FakeTrainingTransport } from './test-support/fake-transport';

const base: DeliveryContext = {
  workout: { schemaVersion: 1, id: 'workout', planId: null, revision: 1, localDate: '2026-09-10', lifecycle: 'planned',
    title: 'Easy', createdAtMs: 1, updatedAtMs: 1, structure: { version: 1, sport: ActivityTypes.Running,
      nodes: [{ kind: 'step', id: 'a', purpose: 'work', ending: { kind: 'time', seconds: 600 }, targets: [] }] } },
  setting: { schemaVersion: 1, scope: 'workout', scopeId: 'workout', provider: 'garmin', revision: 1, enabled: true,
    suppressed: false, timeZone: 'Europe/Helsinki', destinationKey: 'account-a', connectionEpoch: 0,
    scopeGeneration: 0, associationPlanId: null, approvedDigest: null, updatedAtMs: 1 },
  override: null, scopeGeneration: 0, planActive: true, hasPro: true, nowMs: Date.parse('2026-09-10T10:00:00Z'),
  connection: { state: 'connected', destinationKey: 'account-a', epoch: 0, generation: 'g1' }, transport: new FakeTrainingTransport(),
};
describe('delivery intent', () => {
  it('isolates identities by owner, account and provider, not revision', () => {
    expect(new Set([deliveryIdentity('u', 'garmin', 'a', 'w'), deliveryIdentity('v', 'garmin', 'a', 'w'),
      deliveryIdentity('u', 'garmin', 'b', 'w'), deliveryIdentity('u', 'coros', 'a', 'w')]).size).toBe(4);
  });
  it.each([
    ['send', {}, 'present', 'pending'],
    ['expiry', { hasPro: false }, 'preserve', 'paused_pro'],
    ['unavailable', { transport: null }, 'preserve', 'provider_unavailable'],
    ['auth', { connection: { ...base.connection, state: 'reconnect_required' } }, 'preserve', 'reconnect_required'],
    ['disconnect', { connection: { ...base.connection, epoch: 1 } }, 'preserve', 'fresh_consent_required'],
    ['other account', { connection: { ...base.connection, destinationKey: 'b' } }, 'preserve', 'fresh_consent_required'],
    ['stop after expiry', { hasPro: false, setting: { ...base.setting!, enabled: false } }, 'absent', 'stopped'],
    ['copy', { setting: null }, 'absent', 'stopped'],
    ['transferred standalone', { scopeGeneration: 1 }, 'absent', 'stopped'],
    ['deleted plan converted to standalone', { setting: { ...base.setting!, associationPlanId: 'deleted-plan' } }, 'absent', 'stopped'],
    ['past', { nowMs: Date.parse('2026-09-12') }, 'preserve', 'past'],
  ])('%s', (_name, patch, desired, status) => {
    expect(resolveDeliveryIntent({ ...base, ...patch } as DeliveryContext)).toMatchObject({ desired, status });
  });
  it('withdraws inactive plans and respects workout-level suppression', () => {
    const context = { ...base, workout: { ...base.workout!, planId: 'p' }, setting: { ...base.setting!, scope: 'plan' as const, scopeId: 'p' } };
    expect(resolveDeliveryIntent({ ...context, planActive: false })).toMatchObject({ desired: 'absent', status: 'paused_plan' });
    expect(resolveDeliveryIntent({ ...context, override: { ...base.setting!, associationPlanId: 'p', suppressed: true } })).toMatchObject({ desired: 'absent' });
    expect(resolveDeliveryIntent({ ...context, override: { ...base.setting!, associationPlanId: 'other', suppressed: true } })).toMatchObject({ desired: 'present' });
  });
  it('binds degradation consent to current content/destination/mapping', () => {
    const transport = new FakeTrainingTransport(); transport.level = 'degraded';
    const context = { ...base, transport };
    const initial = resolveDeliveryIntent(context);
    expect(initial.status).toBe('approval_required');
    context.setting = { ...base.setting!, approvedDigest: initial.approvalDigest };
    expect(resolveDeliveryIntent(context).desired).toBe('present');
    context.workout = { ...base.workout!, title: 'Changed' };
    expect(resolveDeliveryIntent(context).status).toBe('approval_required');
    transport.level = 'unsupported';
    expect(resolveDeliveryIntent(context).status).toBe('unsupported');
  });
  it('does not rewrite completed or old remote copies, even if QS is moved forward', () => {
    const ledger = { actual: { ids: { workout: 'id' }, localDate: '2026-09-09', completed: false } } as DeliveryLedgerV1;
    expect(resolveDeliveryIntent(base, ledger).status).toBe('past');
    ledger.actual!.completed = true;
    expect(resolveDeliveryIntent(base, ledger).status).toBe('completed');
  });
});
