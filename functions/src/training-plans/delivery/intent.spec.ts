import { describe, expect, it, vi } from 'vitest';
import { ActivityTypes, WeightUnits } from '@sports-alliance/sports-lib';
import { projectStrengthWorkoutToV1, type StrengthWorkoutDetailsV1 } from '../../../../shared/strength-workout';
import { resolveDeliveryIntent, deliveryIdentity, deliveryContentDigest } from './intent';
import type { DeliveryContext, DeliveryLedgerV1 } from './contracts';
import { FakeTrainingTransport } from './test-support/fake-transport';
import { GarminTrainingTransport } from './garmin/transport';
import { SuuntoGuideTransport } from './suunto/transport';
import { assessSuuntoGuideV2ForRecovery, assessSuuntoGuideV3ForRecovery, assessSuuntoGuideV4ForRecovery, assessSuuntoGuideV5ForRecovery,
  assessSuuntoGuideV6ForRecovery, assessSuuntoGuideV7ForRecovery, assessSuuntoGuideV9ForRecovery } from './suunto/mapping';

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
  it.each([
    ['year boundary', '2026-12-31T22:30:00Z', 'Europe/Helsinki', '2027-01-01', '2028-01-01', '2028-01-02', '2026-12-31'],
    ['leap year', '2027-12-31T22:30:00Z', 'Europe/Helsinki', '2028-01-01', '2028-12-31', '2029-01-01', '2027-12-31'],
    ['DST start', '2026-03-28T22:30:00Z', 'Europe/Helsinki', '2026-03-29', '2027-03-29', '2027-03-30', '2026-03-28'],
    ['DST end', '2026-10-24T21:30:00Z', 'Europe/Helsinki', '2026-10-25', '2027-10-25', '2027-10-26', '2026-10-24'],
    ['western saved zone', '2026-12-31T22:30:00Z', 'America/Los_Angeles', '2026-12-31', '2027-12-31', '2028-01-01', '2026-12-30'],
  ])('enforces QS\'s inclusive 365-calendar-day Garmin horizon at %s', (_label, instant, timeZone, today, last, outside, past) => {
    const nowMs = Date.parse(instant);
    const request = vi.fn(async () => { throw new Error('No HTTP during intent assessment'); });
    const transport = new GarminTrainingTransport(request, () => nowMs);
    expect(transport.horizonDays).toBe(365);
    const context: DeliveryContext = { ...base, nowMs, transport, setting: { ...base.setting!, timeZone } };
    for (const localDate of [today, last]) {
      expect(resolveDeliveryIntent({ ...context, workout: { ...base.workout!, localDate } }))
        .toMatchObject({ desired: 'present', status: 'pending' });
    }
    expect(resolveDeliveryIntent({ ...context, workout: { ...base.workout!, localDate: outside } }))
      .toMatchObject({ desired: 'preserve', status: 'outside_horizon' });
    expect(resolveDeliveryIntent({ ...context, workout: { ...base.workout!, localDate: past } }))
      .toMatchObject({ desired: 'preserve', status: 'past' });
    expect(request).not.toHaveBeenCalled();
  });
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
  it('allows disclosed non-blocking limitations only with existing sync consent', () => {
    const transport = new FakeTrainingTransport();
    transport.level = 'degraded';
    const assess = transport.assess.bind(transport);
    vi.spyOn(transport, 'assess').mockImplementation((...args) => ({ ...assess(...args), requiresApproval: false }));
    const context = { ...base, transport };
    expect(resolveDeliveryIntent(context)).toMatchObject({ desired: 'present', status: 'pending', approvalDigest: null });
    expect(resolveDeliveryIntent({ ...context, workout: { ...base.workout!, title: 'Edited' } })).toMatchObject({ desired: 'present' });
    expect(resolveDeliveryIntent({ ...context, setting: null })).toMatchObject({ desired: 'absent', status: 'stopped' });
    expect(resolveDeliveryIntent({ ...context, hasPro: false })).toMatchObject({ desired: 'preserve', status: 'paused_pro' });
    expect(resolveDeliveryIntent({ ...context, connection: { ...base.connection, epoch: 1 } }))
      .toMatchObject({ desired: 'preserve', status: 'fresh_consent_required' });
    transport.level = 'unsupported';
    expect(resolveDeliveryIntent(context)).toMatchObject({ desired: 'preserve', status: 'unsupported' });
  });
  it.each(['current', 'legacy-v7'].flatMap(version => [WeightUnits.Kilograms, WeightUnits.Pounds]
    .map(units => ({ version, units }))))('retains the same approved strength losses after $version / $units unit changes', ({ version, units }) => {
    const transport = new SuuntoGuideTransport(async () => { throw Error('No HTTP during assessment'); }, 'Quantified Self');
    const strength: StrengthWorkoutDetailsV1 = { version: 1, workoutId: base.workout!.id, revision: 1,
      exercises: [{ id: 'exercise', name: 'A'.repeat(60), sets: [{ id: 'set',
        ending: { kind: 'repetitions', repetitions: 5 }, externalLoadKg: 80 }] }] };
    const workout = { ...base.workout!, structure: projectStrengthWorkoutToV1(strength) };
    const assess = (weightUnits: WeightUnits) => transport.assess(workout, 'account-a', 'Europe/Helsinki', strength, weightUnits);
    const prior = version === 'current' ? assess(units)
      : assessSuuntoGuideV7ForRecovery(workout, 'account-a', 'Europe/Helsinki', 'Quantified Self', strength);
    expect(prior.requiresApproval).toBe(true);
    const context: DeliveryContext = { ...base, workout, strength, transport, suuntoWeightUnits: units,
      setting: { ...base.setting!, provider: 'suunto', approvedDigest: prior.digest } };
    const ledger = { connectionEpoch: 0, destinationKey: 'account-a', acceptedDigest: prior.digest,
      acceptedContentDigest: deliveryContentDigest(workout, 'Europe/Helsinki', strength) } as DeliveryLedgerV1;
    const first = resolveDeliveryIntent(context, ledger);
    expect(first.desired).toBe('present');
    // Model the accepted presentation upgrade before the owner changes units again.
    ledger.acceptedDigest = first.digest;
    ledger.mappingApprovalProof = first.mappingApprovalProof;
    const changedUnits = units === WeightUnits.Kilograms ? WeightUnits.Pounds : WeightUnits.Kilograms;
    const changed = resolveDeliveryIntent({ ...context, suuntoWeightUnits: changedUnits }, ledger);
    expect(changed).toMatchObject({ desired: 'present', status: 'pending', approvalDigest: null });
    expect(changed.issues).toEqual(first.issues);
    ledger.acceptedDigest = changed.digest;
    ledger.mappingApprovalProof = changed.mappingApprovalProof;
    expect(resolveDeliveryIntent(context, ledger).desired).toBe('present');
    expect(resolveDeliveryIntent({ ...context, suuntoWeightUnits: changedUnits }, {
      ...ledger, acceptedContentDigest: 'mismatch', mappingApprovalProof: undefined,
    }).status).toBe('approval_required');
    expect(resolveDeliveryIntent({ ...context, suuntoWeightUnits: changedUnits, hasPro: false }, ledger).status).toBe('paused_pro');
    expect(resolveDeliveryIntent({ ...context, suuntoWeightUnits: changedUnits, setting: null }, ledger).desired).toBe('absent');
    expect(resolveDeliveryIntent({ ...context, suuntoWeightUnits: changedUnits,
      connection: { ...context.connection, epoch: 1 } }, ledger).status).toBe('fresh_consent_required');
    const edited = structuredClone(strength);
    edited.exercises[0].name = 'A'.repeat(59) + 'B'; // An edit hidden beyond the watch's truncated text.
    expect(resolveDeliveryIntent({ ...context, suuntoWeightUnits: changedUnits, strength: edited,
      workout: { ...workout, structure: projectStrengthWorkoutToV1(edited) } }, ledger).status).toBe('approval_required');
  });
  it('does not inherit strength approval when pounds adds a loss beyond the bounded public warning list', () => {
    const transport = new SuuntoGuideTransport(async () => { throw Error('No HTTP during assessment'); }, 'Quantified Self');
    const strength: StrengthWorkoutDetailsV1 = { version: 1, workoutId: base.workout!.id, revision: 1, exercises: [
      { id: 'long', name: 'A'.repeat(60), sets: Array.from({ length: 20 }, (_, index) => ({ id: `long-set-${index}`,
        ending: { kind: 'repetitions' as const, repetitions: 5 }, externalLoadKg: 80 })) },
      // The complete label fits 54 characters in kg, but needs 55 in lb.
      { id: 'boundary', name: 'B'.repeat(27), sets: [{ id: 'last',
        ending: { kind: 'repetitions', repetitions: 5 }, externalLoadKg: 80 }] },
    ] };
    const workout = { ...base.workout!, structure: projectStrengthWorkoutToV1(strength) };
    const kg = transport.assess(workout, 'account-a', 'Europe/Helsinki', strength, WeightUnits.Kilograms);
    const lb = transport.assess(workout, 'account-a', 'Europe/Helsinki', strength, WeightUnits.Pounds);
    const legacy = assessSuuntoGuideV7ForRecovery(workout, 'account-a', 'Europe/Helsinki', 'Quantified Self', strength);
    expect(lb.issues).toHaveLength(20);
    expect(lb.issues).toEqual(kg.issues);
    expect(lb).not.toHaveProperty('lossSignature');
    expect(lb.compatibleApprovalDigests ?? []).not.toContain(legacy.digest);
    expect(lb.compatibleApprovalDigests ?? []).not.toContain(kg.digest);
    for (const prior of [kg, legacy]) {
      const context: DeliveryContext = { ...base, workout, strength, transport, suuntoWeightUnits: WeightUnits.Pounds,
        setting: { ...base.setting!, provider: 'suunto', approvedDigest: prior.digest } };
      const ledger = { connectionEpoch: 0, destinationKey: 'account-a', acceptedDigest: prior.digest,
        acceptedContentDigest: deliveryContentDigest(workout, 'Europe/Helsinki', strength) } as DeliveryLedgerV1;
      expect(resolveDeliveryIntent(context, ledger).status).toBe('approval_required');
    }
  });
  it.each([
    ...[assessSuuntoGuideV2ForRecovery, assessSuuntoGuideV3ForRecovery, assessSuuntoGuideV4ForRecovery, assessSuuntoGuideV5ForRecovery, assessSuuntoGuideV6ForRecovery]
      .flatMap(assessLegacy => [ActivityTypes.Running, ActivityTypes.Swimming].map(sport => ({ assessLegacy, sport }))),
    { assessLegacy: assessSuuntoGuideV7ForRecovery, sport: ActivityTypes.Swimming },
    { assessLegacy: assessSuuntoGuideV7ForRecovery, sport: ActivityTypes.OpenWaterSwimming },
    { assessLegacy: assessSuuntoGuideV9ForRecovery, sport: ActivityTypes.Swimming },
  ])(
    'keeps exact legacy loss approval for $sport across Suunto display upgrades, never across edits or authority changes', ({ assessLegacy, sport }) => {
    const transport = new SuuntoGuideTransport(async () => { throw Error('No HTTP during assessment'); }, 'Quantified Self');
    const workout = { ...base.workout!, structure: { ...base.workout!.structure, sport, nodes: [{ ...base.workout!.structure.nodes[0],
      note: 'A'.repeat(45) }] } };
    const destination = base.connection.destinationKey;
    const prior = assessLegacy(workout, destination, 'Europe/Helsinki', 'Quantified Self');
    const context: DeliveryContext = { ...base, workout, transport,
      setting: { ...base.setting!, provider: 'suunto', approvedDigest: prior.digest } };
    const ledger = { connectionEpoch: 0, destinationKey: 'account-a', acceptedDigest: prior.digest,
      acceptedContentDigest: deliveryContentDigest(workout, 'Europe/Helsinki') } as DeliveryLedgerV1;
    expect(transport.assess(workout, 'account-a', 'Europe/Helsinki')).toMatchObject({
      mappingVersion: [ActivityTypes.Swimming, ActivityTypes.OpenWaterSwimming].includes(sport) ? 'suunto-guides-v10' : 'suunto-guides-v7',
      compatibleApprovalDigests: expect.arrayContaining([prior.digest]),
    });
    expect(resolveDeliveryIntent(context, ledger)).toMatchObject({ desired: 'present', status: 'pending', approvalDigest: null });
    const currentDigest = transport.assess(workout, 'account-a', 'Europe/Helsinki').digest;
    expect(resolveDeliveryIntent(context, { ...ledger, acceptedDigest: currentDigest }))
      .toMatchObject({ desired: 'present', status: 'delivered', approvalDigest: null });
    const proof = resolveDeliveryIntent(context, ledger).mappingApprovalProof!;
    const retired = { ...ledger, acceptedDigest: null, acceptedContentDigest: null, attempt: null, mappingApprovalProof: proof };
    expect(resolveDeliveryIntent(context, retired)).toMatchObject({ desired: 'present', status: 'pending', mappingApprovalProof: proof });
    // Approval evidence never asserts provider acceptance, even with a retained copy.
    expect(resolveDeliveryIntent(context, retired).status).not.toBe('delivered');
    for (const key of ['approvedDigest', 'mappingDigest', 'contentDigest'] as const) {
      expect(resolveDeliveryIntent(context, { ...retired, mappingApprovalProof: { ...proof, [key]: 'mismatch' } }).status)
        .toBe('approval_required');
    }
    for (const edited of [{ ...workout, title: 'Changed' }, { ...workout, localDate: '2026-09-11' },
      { ...workout, structure: { ...workout.structure, nodes: [{ ...workout.structure.nodes[0], note: 'B'.repeat(45) }] } },
      { ...workout, structure: { ...workout.structure, nodes: [{ ...workout.structure.nodes[0], note: 'A'.repeat(40) + 'BBBBB' }] } }]) {
      expect(resolveDeliveryIntent({ ...context, workout: edited }, ledger).status).toBe('approval_required');
      expect(resolveDeliveryIntent({ ...context, workout: edited }, retired).status).toBe('approval_required');
    }
    expect(resolveDeliveryIntent(context).status).toBe('approval_required');
    const attempt = { digest: prior.digest, contentDigest: ledger.acceptedContentDigest } as NonNullable<DeliveryLedgerV1['attempt']>;
    expect(resolveDeliveryIntent(context, { ...ledger, acceptedDigest: null, attempt }).desired).toBe('present');
    expect(resolveDeliveryIntent(context, { ...ledger, acceptedDigest: null, acceptedContentDigest: null,
      attempt: { ...attempt, digest: currentDigest, progress: { version: 1, step: 'update', state: 'started' } } }).desired).toBe('present');
    expect(resolveDeliveryIntent({ ...context, setting: { ...context.setting!, approvedDigest: 'unknown' } }).status).toBe('approval_required');
    expect(resolveDeliveryIntent({ ...context, setting: null }).desired).toBe('absent');
    expect(resolveDeliveryIntent({ ...context, hasPro: false }).status).toBe('paused_pro');
    expect(resolveDeliveryIntent({ ...context, connection: { ...context.connection, epoch: 1 } }).status).toBe('fresh_consent_required');
    expect(resolveDeliveryIntent({ ...context, hasPro: false }, retired).status).toBe('paused_pro');
    expect(resolveDeliveryIntent({ ...context, setting: null }, retired).desired).toBe('absent');
    expect(resolveDeliveryIntent({ ...context, connection: { ...context.connection, epoch: 1 } }, retired).status)
      .toBe('fresh_consent_required');
    expect(transport.assess(workout, 'other-account', 'Europe/Helsinki').compatibleApprovalDigests).not.toContain(prior.digest);
    expect(transport.assess(workout, 'account-a', 'UTC').compatibleApprovalDigests).not.toContain(prior.digest);
    const v3Digest = assessSuuntoGuideV3ForRecovery(workout, destination, 'Europe/Helsinki', 'Quantified Self').digest;
    expect(resolveDeliveryIntent(context, { ...retired, mappingApprovalProof: { ...proof, mappingDigest: v3Digest } }).desired)
      .toBe('present');
  });
  it('keeps an earlier provider copy when the current workout becomes unsupported', () => {
    const transport = new FakeTrainingTransport();
    transport.level = 'unsupported';
    const ledger = { connectionEpoch: 0, destinationKey: 'account-a',
      actual: { ids: { workout: 'earlier-copy' }, localDate: '2026-09-10', completed: false } } as DeliveryLedgerV1;
    expect(resolveDeliveryIntent({ ...base, transport, workout: { ...base.workout!, title: 'Unsupported edit' } }, ledger))
      .toMatchObject({ desired: 'preserve', status: 'unsupported' });
    expect(ledger.actual?.ids.workout).toBe('earlier-copy');
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
