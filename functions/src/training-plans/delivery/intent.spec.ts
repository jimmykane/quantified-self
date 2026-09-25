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
  override: null, scopeGeneration: 0, planActive: true, hasPro: true, nowMs: Date.parse('2026-09-10T10:00:00Z'), pastCleanup: null,
  connection: { state: 'connected', destinationKey: 'account-a', epoch: 0, generation: 'g1' }, transport: new FakeTrainingTransport(),
};
describe('delivery intent', () => {
  it('withdraws a moved upcoming Suunto copy, retains consent and delivers when the date enters its window', () => {
    const transport = new FakeTrainingTransport(); transport.horizonDays = 6;
    const policy = Object.assign(transport, { withdrawOutsideHorizon: true });
    const context = { ...base, transport: policy, workout: { ...base.workout!, localDate: '2026-09-17' } };
    expect(resolveDeliveryIntent(context)).toMatchObject({ desired: 'absent', status: 'outside_horizon' });
    expect(resolveDeliveryIntent({ ...context, nowMs: Date.parse('2026-09-11T10:00:00Z') })).toMatchObject({ desired: 'present' });
    expect(resolveDeliveryIntent({ ...context, hasPro: false })).toMatchObject({ desired: 'preserve', status: 'paused_pro' });
  });
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
  it('protects the retained copy using its original zone after a settings edit', () => {
    const context = { ...base, setting: { ...base.setting!, timeZone: 'Pacific/Pago_Pago' },
      nowMs: Date.parse('2026-09-10T10:30:00Z') };
    const ledger = { actual: { ids: { workout: 'id' }, localDate: '2026-09-10', completed: false,
      timeZone: 'Pacific/Kiritimati' } } as DeliveryLedgerV1;
    // The old copy is already September 11's past, even though new settings say September 9.
    expect(resolveDeliveryIntent(context, ledger).status).toBe('past');
  });
  it('protects original artifacts retained during a repair even when no replacement was accepted', () => {
    const ledger = { actual: null, repair: { original: { ids: { workout: 'old', schedule: 'original' },
      localDate: '2026-09-09', completed: false } } } as DeliveryLedgerV1;
    const stopped = { ...base, setting: { ...base.setting!, enabled: false } };
    expect(resolveDeliveryIntent(stopped, ledger).status).toBe('past');
    ledger.repair!.original.completed = true;
    expect(resolveDeliveryIntent(stopped, ledger).status).toBe('completed');
  });
  it('only withdraws an old uncompleted copy after explicit deletion opt-in', () => {
    const ledger = { provider: 'garmin', connectionEpoch: 0, destinationKey: 'account-a',
      actual: { ids: { workout: 'id' }, localDate: '2026-09-09', completed: false } } as DeliveryLedgerV1;
    const stopped = { ...base, workout: { ...base.workout!, lifecycle: 'deleted' as const, deletedAtMs: 7 } };
    expect(resolveDeliveryIntent(stopped, ledger)).toMatchObject({ desired: 'preserve', status: 'past' });
    const authorized = { ...stopped, pastCleanup: { scope: 'workout' as const, scopeId: 'workout', mutationId: 'delete-1',
      requestedAtMs: 7, deletedAtMs: 7 } };
    expect(resolveDeliveryIntent(authorized, ledger)).toMatchObject({ desired: 'absent', status: 'stopped' });
    ledger.actual!.completed = true;
    expect(resolveDeliveryIntent(authorized, ledger)).toMatchObject({ desired: 'preserve', status: 'completed' });
  });
  it('reports COROS past deletion as unavailable even after opt-in', () => {
    const transport = new FakeTrainingTransport();
    transport.canRemove = (artifact, today) => !artifact.completed && artifact.localDate >= today;
    const ledger = { provider: 'coros', actual: { ids: { workout: 'id' }, localDate: '2026-09-09', completed: false } } as DeliveryLedgerV1;
    const intent = resolveDeliveryIntent({ ...base, workout: null, transport, pastCleanup: {
      scope: 'plan', scopeId: 'plan', mutationId: 'delete-plan', requestedAtMs: 7,
    } }, ledger);
    expect(intent).toMatchObject({ desired: 'preserve', status: 'past' });
    expect(intent.issues).toContain('COROS permits removal only for unexecuted workouts dated today or later.');
  });
});
