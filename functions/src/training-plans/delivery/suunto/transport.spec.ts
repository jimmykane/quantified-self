import { beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { ActivityTypes, DataWeight, DistanceUnits, WeightUnits } from '@sports-alliance/sports-lib';
import { normalizeUserUnitSettings } from '../../../../../shared/unit-aware-display';
import { projectStrengthWorkoutToV1 } from '../../../../../shared/strength-workout';
import type { ScheduledWorkoutV1 } from '../../../../../shared/training-plans';
import type { WorkoutStepV1 } from '../../../../../shared/planned-workout';
import type { DeliveryCheckpoint, DeliveryOperation } from '../contracts';
import { SuuntoGuideTransport } from './transport';
import { SuuntoGuideHttpError } from './http';
import { SuuntoHttpFixture } from '../test-support/suunto-http-fixture';
import { packageGuide, readGuideArchive } from './archive';
import type { SuuntoGuideFieldsStepV1, SuuntoGuideJsonV1 } from '../../providers/suunto-guide.serializer';
import { assessSuuntoGuideV2ForRecovery, assessSuuntoGuideV3ForRecovery, assessSuuntoGuideV4ForRecovery, assessSuuntoGuideV6ForRecovery,
  assessSuuntoGuideV7ForRecovery, assessSuuntoGuideV9ForRecovery, assessSuuntoGuideV10ForRecovery,
  assessSuuntoGuideV11ForRecovery, assessSuuntoGuideV12ForRecovery, guideExternalId, guideMapping, guidePayloadForRecovery } from './mapping';

describe('Suunto Guide lifecycle — synthetic transport', () => {
  const now = Date.parse('2026-12-29T12:00:00Z'); const owner = 'Quantified Self';
  let server: SuuntoHttpFixture; let transport: SuuntoGuideTransport; let op: DeliveryOperation;
  const guard = vi.fn(async () => {}); let checkpoint: DeliveryCheckpoint;
  const execute = () => transport.execute(op, checkpoint, guard);
  const recover = () => transport.recover(op, checkpoint, guard);
  const next = (patch: Partial<ScheduledWorkoutV1> = {}) => {
    op = { ...op, id: `${op.id}-next`, generation: op.generation + 1, progress: null, workout: { ...op.workout!, ...patch } };
    op.digest = transport.assess(op.workout!, op.destinationKey, op.timeZone, op.strength, op.suuntoWeightUnits, op.suuntoUnitSettings).digest;
  };
  beforeEach(() => {
    guard.mockReset(); guard.mockResolvedValue(undefined);
    checkpoint = vi.fn(async () => {}); server = new SuuntoHttpFixture(); transport = new SuuntoGuideTransport(server.request, owner, () => now);
    const workout: ScheduledWorkoutV1 = { schemaVersion: 1, id: 'workout', planId: 'plan', title: 'Intervals', localDate: '2026-12-30',
      lifecycle: 'planned', revision: 1, createdAtMs: now, updatedAtMs: now, structure: { version: 1, sport: ActivityTypes.Running,
        nodes: [{ kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'time', seconds: 60 }, targets: [] }] } };
    op = { id: 'attempt', kind: 'upsert', deliveryId: 'stable', generation: 1, connectionGeneration: 'generation', destinationKey: 'destination',
      timeZone: 'Europe/Helsinki', workout, artifact: null, progress: null, contentDigest: 'content', digest: transport.assess(workout, 'destination', 'Europe/Helsinki').digest };
  });
  it('classifies only exact journal digests without changing the operation or making HTTP calls', () => {
    const before = structuredClone(op);
    expect(transport.diagnosticMappingVersion(op)).toBe('suunto-guides-v13');
    expect(op).toEqual(before);
    op.digest = assessSuuntoGuideV2ForRecovery(op.workout!, op.destinationKey, op.timeZone, owner).digest;
    expect(transport.diagnosticMappingVersion(op)).toBe('suunto-guides-v2');
    op.digest = assessSuuntoGuideV3ForRecovery(op.workout!, op.destinationKey, op.timeZone, owner).digest;
    expect(transport.diagnosticMappingVersion(op)).toBe('suunto-guides-v3');
    op.digest = assessSuuntoGuideV4ForRecovery(op.workout!, op.destinationKey, op.timeZone, owner).digest;
    expect(transport.diagnosticMappingVersion(op)).toBe('suunto-guides-v4');
    op.digest = assessSuuntoGuideV6ForRecovery(op.workout!, op.destinationKey, op.timeZone, owner).digest;
    expect(transport.diagnosticMappingVersion(op)).toBe('suunto-guides-v6');
    op.digest = 'unknown-version';
    expect(transport.diagnosticMappingVersion(op)).toBeNull();
    expect(transport.diagnosticMappingVersion({ ...op, kind: 'remove', workout: null })).toBeNull();
    expect(server.calls).toHaveLength(0);
  });
  it('creates, updates and reschedules the same Guide, preserves pinning and withdraws', async () => {
    const original = (await execute())!; server.guides.get(original.ids.guide)!.pinned = true;
    next({ title: 'Changed', localDate: '2027-01-02', planId: 'other-plan' });
    const changed = (await execute())!;
    expect(changed.ids).toEqual(original.ids); expect(server.guides.get(changed.ids.guide)!.pinned).toBe(true);
    expect(server.guides.get(changed.ids.guide)!.guide.localDate).toBe('2027-01-02');
    op = { ...op, kind: 'remove', workout: null, progress: null };
    expect(await execute()).toBeNull(); expect(server.guides.size).toBe(0);
  });
  const strengthOperation = () => {
    op.strength = { version: 1, workoutId: op.workout!.id, revision: 1, exercises: [{ id: 'squat', name: 'Back squat', sets: [
      { id: 'set', ending: { kind: 'repetitions', repetitions: 5 }, externalLoadKg: DataWeight.fromDisplayValue(100, WeightUnits.Pounds).getValue() },
    ] }] };
    op.suuntoWeightUnits = WeightUnits.Pounds;
    next({ structure: projectStrengthWorkoutToV1(op.strength) });
  };
  it('fails closed on app-preview metadata mismatches during lost-response recovery', async () => {
    op.suuntoUnitSettings = normalizeUserUnitSettings({ distanceUnits: DistanceUnits.Miles });
    next({ structure: { version: 1, sport: ActivityTypes.Running, nodes: [{ kind: 'step', id: 'work', purpose: 'work',
      ending: { kind: 'distance', meters: 1609.344 }, targets: [] }] } });
    server.afterHandle = async request => { if (request.method === 'POST') {
      server.afterHandle = null; throw new SuuntoGuideHttpError('uncertain', false);
    } };
    await expect(execute()).rejects.toMatchObject({ kind: 'uncertain' });
    const guide = [...server.guides.values()][0].guide;
    expect(guide.richText).toContain('mi');
    const original = guide.richText;
    guide.richText = 'Different app instructions';
    expect(await recover()).toEqual({ kind: 'uncertain' });
    delete guide.richText;
    expect(await recover()).toEqual({ kind: 'uncertain' });
    guide.richText = original;
    expect(await recover()).toMatchObject({ kind: 'accepted' });
    expect(server.calls.filter(request => request.method === 'POST')).toHaveLength(1);
    expect(server.calls.filter(request => request.method === 'PUT')).toHaveLength(0);
  });
  it('uses the snapshotted strength units and updates the same Guide after a unit-only change', async () => {
    strengthOperation();
    expect(transport.diagnosticMappingVersion(op)).toBe('suunto-guides-v13');
    const original = (await execute())!;
    expect(JSON.stringify(server.guides.get(original.ids.guide)!.guide)).toContain('100.0 lb');
    op.suuntoWeightUnits = WeightUnits.Kilograms;
    // An edited snapshot cannot be delivered under its old digest.
    await expect(execute()).rejects.toMatchObject({ kind: 'terminal' });
    next(); await execute();
    expect(JSON.stringify(server.guides.get(original.ids.guide)!.guide)).toContain('45.4 kg');
    next(); await execute();
    expect(server.guides.size).toBe(1);
    expect(server.calls.filter(request => request.method === 'POST')).toHaveLength(1);
    expect(server.calls.filter(request => request.method === 'PUT')).toHaveLength(1);
    expect(op.strength!.exercises[0].sets[0].externalLoadKg).toBe(45.359237);
  });
  it('recovers a v7 kg strength create before updating its retained Guide to pounds', async () => {
    strengthOperation();
    op.digest = assessSuuntoGuideV7ForRecovery(op.workout!, op.destinationKey, op.timeZone, owner, op.strength).digest;
    const oldGuide = guidePayloadForRecovery(op, owner)!;
    expect(JSON.stringify(oldGuide)).toContain('45.359237 kg');
    server.guides.set('legacy-strength', { guide: oldGuide, pinned: true });
    op.artifact = null; op.progress = { version: 1, step: 'create', state: 'started' };
    const recovered = await recover();
    expect(recovered).toMatchObject({ kind: 'accepted', artifact: { ids: { guide: 'legacy-strength' } } });
    if (recovered.kind !== 'accepted') throw new Error('Legacy strength was not recovered');
    op.artifact = recovered.artifact;
    expect(server.calls.every(request => request.method === 'GET')).toBe(true);
    next(); await execute();
    expect(JSON.stringify(server.guides.get('legacy-strength')!.guide)).toContain('100.0 lb');
    expect(server.guides.get('legacy-strength')!.pinned).toBe(true);
    expect(server.guides.size).toBe(1);
    expect(server.calls.filter(request => request.method === 'POST')).toHaveLength(0);
    expect(server.calls.filter(request => request.method === 'PUT')).toHaveLength(1);
  });
  it('keeps interval digests independent of irrelevant weight settings and watch steps byte-equivalent to v7', () => {
    const current = transport.assess(op.workout!, op.destinationKey, op.timeZone);
    const oldOperation = { ...op, digest: assessSuuntoGuideV7ForRecovery(op.workout!, op.destinationKey, op.timeZone, owner).digest };
    expect(guideMapping(op.workout!, op.destinationKey, owner).artifact.steps).toEqual(guidePayloadForRecovery(oldOperation, owner)!.steps);
    expect(current.mappingVersion).toBe('suunto-guides-v13');
    expect(transport.assess(op.workout!, op.destinationKey, op.timeZone, undefined, WeightUnits.Pounds)).toEqual(current);
  });
  it.each([ActivityTypes.Running, ActivityTypes.Cycling, ActivityTypes.Rowing])(
    'preserves frozen manual %s watch instructions when adding the app preview', sport => {
    next({ structure: { version: 1, sport, nodes: [{ kind: 'step', id: 'manual', purpose: 'warmup',
      ending: { kind: 'manual' }, targets: [] }] } });
    const current = transport.assess(op.workout!, op.destinationKey, op.timeZone);
    expect(current.mappingVersion).toBe('suunto-guides-v13');
    expect(transport.diagnosticMappingVersion(op)).toBe('suunto-guides-v13');
    const prior = { ...op, digest: assessSuuntoGuideV11ForRecovery(op.workout!, op.destinationKey, op.timeZone, owner).digest };
    expect(guideMapping(op.workout!, op.destinationKey, owner).artifact.steps).toEqual(guidePayloadForRecovery(prior, owner)!.steps);
    expect(transport.assess(op.workout!, op.destinationKey, op.timeZone, undefined, WeightUnits.Pounds)).toEqual(current);
    for (const step of [
      { kind: 'step', id: 'manual', purpose: 'warmup', ending: { kind: 'manual' }, targets: [], note: 'Stay relaxed' },
      { kind: 'step', id: 'timed', purpose: 'work', ending: { kind: 'time', seconds: 90 }, targets: [] },
      { kind: 'step', id: 'distance', purpose: 'work', ending: { kind: 'distance', meters: 100 }, targets: [] },
    ] satisfies WorkoutStepV1[]) {
      next({ structure: { version: 1, sport, nodes: [step] } });
      const oldOperation = { ...op, digest: assessSuuntoGuideV7ForRecovery(op.workout!, op.destinationKey, op.timeZone, owner).digest };
      expect(guideMapping(op.workout!, op.destinationKey, owner).artifact.steps).toEqual(guidePayloadForRecovery(oldOperation, owner)!.steps);
    }
    expect(server.calls).toHaveLength(0);
  });
  it.each([ActivityTypes.Running, ActivityTypes.Cycling, ActivityTypes.Rowing])(
    'recovers exact v7 %s manual instructions before one presentation update, with stable identity and ZIP readback', async sport => {
    next({ structure: { version: 1, sport, nodes: [{ kind: 'repeat', id: 'sets', count: 3, steps: [
      { kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'manual' }, targets: [] },
      { kind: 'step', id: 'rest', purpose: 'rest', ending: { kind: 'time', seconds: 15 }, targets: [] },
    ] }] } });
    op.digest = assessSuuntoGuideV7ForRecovery(op.workout!, op.destinationKey, op.timeZone, owner).digest;
    const old = guidePayloadForRecovery(op, owner)!;
    expect(JSON.stringify(old)).toContain('Press lap when ready');
    server.guides.set('legacy-manual', { guide: old, pinned: true });
    op.progress = { version: 1, step: 'create', state: 'started' };
    const recovered = await recover();
    if (recovered.kind !== 'accepted') throw new Error('Historical manual copy not recovered');
    expect(server.calls.every(request => request.method === 'GET')).toBe(true);
    op.artifact = recovered.artifact;
    next(); await execute();
    const current = server.guides.get('legacy-manual')!;
    expect(current.pinned).toBe(true);
    expect(current.guide.externalId).toBe(old.externalId);
    expect(JSON.stringify(current.guide)).toContain('Press Lap to finish this interval.');
    expect(JSON.stringify(current.guide)).not.toContain('Press lap when ready');
    expect(await readGuideArchive(await packageGuide(current.guide))).toEqual(current.guide);
    next(); await execute();
    expect(server.guides.size).toBe(1);
    expect(server.calls.filter(request => request.method === 'POST')).toHaveLength(0);
    expect(server.calls.filter(request => request.method === 'PUT')).toHaveLength(1);
  });
  it.each([
    { sport: ActivityTypes.Running, legacy: assessSuuntoGuideV11ForRecovery },
    { sport: ActivityTypes.Walking, legacy: assessSuuntoGuideV11ForRecovery },
    { sport: ActivityTypes.Cycling, legacy: assessSuuntoGuideV11ForRecovery },
    { sport: ActivityTypes.Swimming, legacy: assessSuuntoGuideV10ForRecovery },
    { sport: ActivityTypes.OpenWaterSwimming, legacy: assessSuuntoGuideV10ForRecovery },
    { sport: ActivityTypes.Swimming, legacy: assessSuuntoGuideV12ForRecovery },
  ])('recovers frozen $sport Rest before an idempotent v13 update and fails closed for changed content', async ({ sport, legacy }) => {
    next({ structure: { version: 1, sport, nodes: [{ kind: 'repeat', id: 'sets', count: 3, steps: [
      { kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'manual' }, targets: [] },
      { kind: 'step', id: 'rest', purpose: 'rest', ending: { kind: 'time', seconds: 15 }, targets: [] },
    ] }] } });
    const recipe = structuredClone(op.workout!.structure);
    op.digest = legacy(op.workout!, op.destinationKey, op.timeZone, owner).digest;
    const old = guidePayloadForRecovery(op, owner)!;
    server.guides.set('legacy-rest', { guide: old, pinned: true });
    op.progress = { version: 1, step: 'create', state: 'started' };
    const recovered = await recover();
    if (recovered.kind !== 'accepted') throw new Error('Historical Rest copy not recovered');
    expect(server.calls.every(request => request.method === 'GET')).toBe(true);
    op.artifact = recovered.artifact;
    next(); expect(transport.diagnosticMappingVersion(op)).toBe('suunto-guides-v13');
    await execute();
    const current = server.guides.get('legacy-rest')!;
    expect(current.pinned).toBe(true);
    expect(current.guide.externalId).toBe(old.externalId);
    expect(current.guide.richText).toContain('Repeat 3 times');
    if (legacy === assessSuuntoGuideV12ForRecovery) expect(current.guide.steps).toEqual(old.steps);
    expect(current.guide.steps[1]).toMatchObject({ title: 'Rest 1/3' });
    expect(await readGuideArchive(await packageGuide(current.guide))).toEqual(current.guide);
    next(); await execute();
    expect(op.workout!.structure).toEqual(recipe);
    expect(server.calls.filter(request => request.method === 'POST')).toHaveLength(0);
    expect(server.calls.filter(request => request.method === 'PUT')).toHaveLength(1);
    // A current digest can never authorize an altered prescription.
    op.workout!.title = 'Changed without a new digest';
    await expect(execute()).rejects.toMatchObject({ kind: 'terminal' });
    expect(server.calls.filter(request => ['POST', 'PUT', 'DELETE'].includes(request.method))).toHaveLength(1);
  });
  it('recovers the exact v7 pool copy before upgrading its screens once in place', async () => {
    next({ structure: { version: 1, sport: ActivityTypes.Swimming, nodes: [
      { kind: 'repeat', id: 'sets', count: 10, steps: [
        { kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'manual' }, targets: [] },
        { kind: 'step', id: 'rest', purpose: 'rest', ending: { kind: 'time', seconds: 15 }, targets: [] },
      ] },
    ] } });
    expect(transport.diagnosticMappingVersion(op)).toBe('suunto-guides-v13');
    const currentDigest = op.digest;
    op.digest = assessSuuntoGuideV7ForRecovery(op.workout!, op.destinationKey, op.timeZone, owner).digest;
    expect(op.digest).not.toBe(currentDigest);
    expect(transport.diagnosticMappingVersion(op)).toBe('suunto-guides-v7');
    const oldGuide = guidePayloadForRecovery(op, owner)!;
    expect(JSON.stringify(oldGuide)).not.toContain('"window":"step"');
    server.guides.set('legacy-pool-v7', { guide: oldGuide, pinned: true });
    op.progress = { version: 1, step: 'create', state: 'started' };
    const recovered = await recover();
    expect(recovered).toMatchObject({ kind: 'accepted', artifact: { ids: { guide: 'legacy-pool-v7' } } });
    if (recovered.kind !== 'accepted') throw new Error('Legacy identity was not recovered');
    op.artifact = recovered.artifact;
    expect(server.calls.every(request => request.method === 'GET')).toBe(true);
    next(); await execute();
    const current = server.guides.get('legacy-pool-v7')!;
    expect(current.pinned).toBe(true);
    expect(JSON.stringify(current.guide)).toContain('"window":"step"');
    expect(current.guide.externalId).toBe(oldGuide.externalId);
    next(); await execute();
    expect(server.guides.size).toBe(1);
    expect(server.calls.filter(request => request.method === 'POST')).toHaveLength(0);
    expect(server.calls.filter(request => request.method === 'PUT')).toHaveLength(1);
  });
  it.each([assessSuuntoGuideV7ForRecovery, assessSuuntoGuideV9ForRecovery])('carries identical pool mapping losses, never approval for an edited prescription: %s', assessLegacy => {
    next({ structure: { version: 1, sport: ActivityTypes.Swimming, nodes: [{ kind: 'step', id: 'work', purpose: 'work',
      ending: { kind: 'manual' }, targets: [], note: 'A'.repeat(55) }] } });
    const old = assessLegacy(op.workout!, op.destinationKey, op.timeZone, owner);
    const current = transport.assess(op.workout!, op.destinationKey, op.timeZone);
    expect(current.level).toBe('degraded');
    expect(current.compatibleApprovalDigests).toContain(old.digest);
    next({ structure: { ...op.workout!.structure, nodes: [{ kind: 'step', id: 'work', purpose: 'work',
      ending: { kind: 'manual' }, targets: [], note: 'B'.repeat(55) }] } });
    expect(transport.assess(op.workout!, op.destinationKey, op.timeZone).compatibleApprovalDigests).not.toContain(old.digest);
  });
  it.each([
    { sport: ActivityTypes.Swimming, version: 'suunto-guides-v9', assessLegacy: assessSuuntoGuideV9ForRecovery },
    { sport: ActivityTypes.OpenWaterSwimming, version: 'suunto-guides-v7', assessLegacy: assessSuuntoGuideV7ForRecovery },
  ])('recovers $version $sport before upgrading Rest once, retaining identity and notifications through ZIP readback', async ({ sport, version, assessLegacy }) => {
    next({ structure: { version: 1, sport, nodes: [{ kind: 'repeat', id: 'sets', count: 10, steps: [
      { kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'manual' }, targets: [] },
      { kind: 'step', id: 'rest', purpose: 'rest', ending: { kind: 'time', seconds: 15 }, targets: [] },
    ] }] } });
    op.digest = assessLegacy(op.workout!, op.destinationKey, op.timeZone, owner).digest;
    expect(transport.diagnosticMappingVersion(op)).toBe(version);
    const oldGuide = guidePayloadForRecovery(op, owner)!;
    expect(JSON.stringify(oldGuide)).not.toContain('"window":"workout"');
    server.guides.set('prior-swim', { guide: oldGuide, pinned: true });
    op.progress = { version: 1, step: 'create', state: 'started' };
    const recovered = await recover();
    if (recovered.kind !== 'accepted') throw new Error('Historical swim copy not recovered');
    op.artifact = recovered.artifact;
    expect(server.calls.every(request => request.method === 'GET')).toBe(true);
    next(); await execute();
    const current = server.guides.get('prior-swim')!;
    expect(current.pinned).toBe(true);
    expect(current.guide.externalId).toBe(oldGuide.externalId);
    const readback = await readGuideArchive(await packageGuide(current.guide));
    expect(readback).toEqual(current.guide);
    const steps = current.guide.steps.flatMap(step => step.type === 'repeat' ? step.steps : [step]);
    for (const step of steps.filter(step => step.title === 'Work')) expect(step.notification?.text).toBe('Swim now. Press Lap to finish this interval.');
    for (const step of steps.filter(step => step.title === 'Rest')) {
      expect(step.notification?.text).toBe('Rest for 15s');
      expect(step.fields).toContainEqual({ type: 'distance', title: 'Total', window: 'workout' });
    }
    next(); await execute();
    expect(server.guides.size).toBe(1);
    expect(server.calls.filter(request => request.method === 'POST')).toHaveLength(0);
    expect(server.calls.filter(request => request.method === 'PUT')).toHaveLength(1);
  });
  it('recovers a frozen v6 pool create and adds SWOLF to the same Guide once', async () => {
    next({ structure: { ...op.workout!.structure, sport: ActivityTypes.Swimming } });
    op.digest = assessSuuntoGuideV6ForRecovery(op.workout!, op.destinationKey, op.timeZone, owner).digest;
    const oldGuide = guidePayloadForRecovery(op, owner)!;
    expect(JSON.stringify(oldGuide)).not.toContain('swolf');
    server.guides.set('legacy-pool', { guide: oldGuide, pinned: true });
    op.progress = { version: 1, step: 'create', state: 'started' };
    const recovered = await recover();
    expect(recovered).toMatchObject({ kind: 'accepted', artifact: { ids: { guide: 'legacy-pool' } } });
    if (recovered.kind !== 'accepted') throw new Error('Legacy identity was not recovered');
    op.artifact = recovered.artifact;
    expect(server.calls.every(request => request.method === 'GET')).toBe(true);
    next();
    expect((await execute())!.ids.guide).toBe('legacy-pool');
    expect(server.guides.get('legacy-pool')).toMatchObject({ pinned: true });
    expect(JSON.stringify(server.guides.get('legacy-pool')!.guide)).toContain('swolf');
    next(); await execute();
    expect(server.calls.filter(request => request.method === 'POST')).toHaveLength(0);
    expect(server.calls.filter(request => request.method === 'PUT')).toHaveLength(1);
    expect(server.guides.size).toBe(1);
  });
  it('removes an exactly owned past Guide after explicit authorization', async () => {
    const artifact = (await execute())!;
    transport = new SuuntoGuideTransport(server.request, owner, () => Date.parse('2027-01-02T12:00:00Z'));
    op = { ...op, kind: 'remove', workout: null, progress: null, allowPastRemoval: true };
    expect(await execute()).toBeNull();
    expect(server.guides.has(artifact.ids.guide)).toBe(false);
  });
  it('updates a retained pre-normalization Guide in place without changing pinning or identity', async () => {
    next({ title: 'Sample — interval session' });
    const artifact = (await execute())!;
    const retained = server.guides.get(artifact.ids.guide)!;
    retained.guide.name = op.workout!.title;
    retained.guide.shortDescription = Array.from(op.workout!.title).slice(0, 23).join('');
    retained.pinned = true;
    next();
    expect((await execute())!.ids).toEqual(artifact.ids);
    expect(server.guides.get(artifact.ids.guide)!.guide.name).toBe('Sample - interval session');
    expect(server.guides.get(artifact.ids.guide)!.pinned).toBe(true);
    expect(server.calls.filter(request => request.method === 'POST')).toHaveLength(1);
    expect(server.calls.filter(request => request.method === 'PUT')).toHaveLength(1);
  });
  it('does not duplicate an uncertain pre-normalization create whose content no longer matches', async () => {
    next({ title: 'Sample — interval session' });
    const artifact = (await execute())!;
    const retained = server.guides.get(artifact.ids.guide)!;
    retained.guide.name = op.workout!.title;
    retained.guide.shortDescription = Array.from(op.workout!.title).slice(0, 23).join('');
    op = { ...op, artifact: null, progress: { version: 1, step: 'create', state: 'started' } };
    expect(await recover()).toEqual({ kind: 'uncertain' });
    await expect(execute()).rejects.toMatchObject({ kind: 'uncertain' });
    expect(server.calls.filter(request => request.method === 'POST')).toHaveLength(1);
    expect(server.guides.size).toBe(1);
  });
  it('packages deterministic ZIPs with a valid non-personal 300x300 icon', async () => {
    const guide = guideMapping(op.workout!, op.destinationKey, owner).artifact;
    const archive = await packageGuide(guide); expect(await packageGuide(guide)).toEqual(archive);
    const zip = await JSZip.loadAsync(archive); expect(Object.keys(zip.files).sort()).toEqual(['guide.json', 'icon.png']);
    const icon = await zip.file('icon.png')!.async('nodebuffer'); expect(icon.subarray(1, 4).toString()).toBe('PNG');
    expect([icon.readUInt32BE(16), icon.readUInt32BE(20)]).toEqual([300, 300]);
    expect(await readGuideArchive(archive)).toEqual(guide);
  });
  it('bounds decompression and rejects malformed archives', async () => {
    const zip = new JSZip(); zip.file('guide.json', 'x'.repeat(300_000));
    await expect(readGuideArchive(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))).rejects.toThrow();
    await expect(readGuideArchive(Buffer.from('not-zip'))).rejects.toThrow();
  });
  it('isolates external IDs between accounts/users and copied workouts', () => {
    expect(guideExternalId('a', 'w')).not.toBe(guideExternalId('b', 'w'));
    expect(guideExternalId('a', 'w')).not.toBe(guideExternalId('a', 'copy'));
    expect(guideExternalId('a', 'w').length).toBeLessThanOrEqual(64);
  });
  it('recovers accepted create after a lost response without another POST', async () => {
    server.afterHandle = async req => { if (req.method === 'POST') { server.afterHandle = null; throw new SuuntoGuideHttpError('uncertain', false); } };
    await expect(execute()).rejects.toMatchObject({ kind: 'uncertain' });
    expect(op.progress).toMatchObject({ step: 'create', state: 'started' });
    expect(await recover()).toMatchObject({ kind: 'accepted' });
    expect(server.calls.filter(req => req.method === 'POST')).toHaveLength(1);
  });
  it.each([false, true])('does not rewrite unchanged content when default notification enrichment is %s', async enriched => {
    server.addDefaultNotificationType = enriched;
    const original = (await execute())!;
    const retained = server.guides.get(original.ids.guide)!; retained.pinned = true;
    const sent = structuredClone(retained.guide);
    next(); const digest = op.digest;
    expect((await execute())!.ids).toEqual(original.ids);
    expect(op.digest).toBe(digest);
    expect(retained).toEqual({ guide: sent, pinned: true });
    expect(server.calls.filter(req => req.method === 'POST')).toHaveLength(1);
    expect(server.calls.filter(req => req.method === 'PUT')).toHaveLength(0);
    expect(checkpoint).toHaveBeenLastCalledWith(expect.objectContaining({ ids: original.ids }),
      { version: 1, step: 'finished', state: 'accepted' });
  });
  it('recovers enriched repeat children and the final screen without mutating the sent prescription', async () => {
    next({ structure: { ...op.workout!.structure, nodes: [{ kind: 'repeat', id: 'repeat', count: 2,
      steps: [op.workout!.structure.nodes[0] as WorkoutStepV1] }] } });
    const sent = guideMapping(op.workout!, op.destinationKey, owner).artifact;
    const digest = op.digest;
    server.afterHandle = async req => { if (req.method === 'POST') { server.afterHandle = null; throw new SuuntoGuideHttpError('uncertain', false); } };
    await expect(execute()).rejects.toMatchObject({ kind: 'uncertain' });
    const result = await recover(); expect(result).toMatchObject({ kind: 'accepted' });
    expect(op.digest).toBe(digest);
    expect([...server.guides.values()][0].guide).toEqual(sent);
    expect(server.calls.filter(req => req.method === 'POST')).toHaveLength(1);
    expect(server.calls.filter(req => req.method === 'PUT')).toHaveLength(0);
    expect(await recover()).toEqual(result);
  });
  it.each(['alarm', 'Default', 'default ', null, false, 0, {}, []])(
    'does not ignore a different or malformed notification type: %j', async type => {
      const artifact = (await execute())!;
      const step = server.guides.get(artifact.ids.guide)!.guide.steps[0] as SuuntoGuideFieldsStepV1;
      Object.assign(step.notification!, { type });
      op = { ...op, artifact: null, progress: { version: 1, step: 'create', state: 'started' } };
      expect(await recover()).toEqual({ kind: 'uncertain' });
      await expect(execute()).rejects.toMatchObject({ kind: 'uncertain' });
      expect(server.calls.filter(req => req.method === 'POST')).toHaveLength(1);
      expect(server.calls.filter(req => req.method === 'PUT')).toHaveLength(0);
    });
  it.each<{ name: string; change: (guide: SuuntoGuideJsonV1) => void }>([
    { name: 'notification text', change: guide => { (guide.steps[0] as SuuntoGuideFieldsStepV1).notification!.text = 'Changed'; } },
    { name: 'notification title', change: guide => { (guide.steps[0] as SuuntoGuideFieldsStepV1).notification!.title = 'Changed'; } },
    { name: 'unknown notification field', change: guide => { Object.assign((guide.steps[0] as SuuntoGuideFieldsStepV1).notification!, { sound: 'default' }); } },
    { name: 'missing notification', change: guide => { delete (guide.steps[0] as SuuntoGuideFieldsStepV1).notification; } },
    { name: 'countdown', change: guide => { Object.assign((guide.steps[0] as SuuntoGuideFieldsStepV1).fields[1], { value: 99 }); } },
    { name: 'average window', change: guide => { Object.assign((guide.steps[0] as SuuntoGuideFieldsStepV1).fields[0], { window: 'workout' }); } },
    { name: 'lap boundary', change: guide => { (guide.steps[0] as SuuntoGuideFieldsStepV1).createManualLap = true; } },
    { name: 'default marker outside notification', change: guide => { Object.assign((guide.steps[0] as SuuntoGuideFieldsStepV1).fields[0], { notification: { type: 'default' } }); } },
    { name: 'unknown root field', change: guide => { Object.assign(guide, { notification: { type: 'default' } }); } },
  ])('keeps enriched content with changed $name uncertain without another create', async ({ change }) => {
    const artifact = (await execute())!;
    change(server.guides.get(artifact.ids.guide)!.guide);
    op = { ...op, artifact: null, progress: { version: 1, step: 'create', state: 'started' } };
    expect(await recover()).toEqual({ kind: 'uncertain' });
    await expect(execute()).rejects.toMatchObject({ kind: 'uncertain' });
    expect(server.calls.filter(req => req.method === 'POST')).toHaveLength(1);
  });
  it('does not recognize enriched content when the journal digest is unknown', async () => {
    await execute(); op = { ...op, digest: 'unknown-digest', artifact: null,
      progress: { version: 1, step: 'create', state: 'started' } };
    const count = server.calls.length;
    expect(await recover()).toEqual({ kind: 'uncertain' });
    expect(server.calls).toHaveLength(count);
  });
  it('recovers accepted create after checkpoint persistence fails', async () => {
    checkpoint = async (_artifact, progress) => { if (progress?.state === 'accepted') throw new Error('persistence'); };
    await expect(execute()).rejects.toThrow('persistence'); checkpoint = vi.fn();
    expect(await recover()).toMatchObject({ kind: 'accepted' }); expect(server.guides.size).toBe(1);
  });
  it('accepts a conflict only after exact owned content is found', async () => {
    const original = (await execute())!; op = { ...op, artifact: null, progress: null };
    expect((await execute())!.ids).toEqual(original.ids);
    op = { ...op, artifact: null, progress: null }; next({ title: 'Different content' });
    await expect(execute()).rejects.toMatchObject({ kind: 'uncertain' });
    expect(await recover()).toEqual({ kind: 'uncertain' });
  });
  it('never repeats an uncertain create from empty inventory, including explicit recovery', async () => {
    op.progress = { version: 1, step: 'create', state: 'started' };
    expect(await recover()).toEqual({ kind: 'uncertain' }); expect(await recover()).toEqual({ kind: 'uncertain' });
    await expect(execute()).rejects.toMatchObject({ kind: 'uncertain' });
    expect(server.calls.every(req => req.method === 'GET')).toBe(true);
  });
  it('resumes discovery across bounded pages without authorizing another create', async () => {
    const guide = guideMapping(op.workout!, op.destinationKey, owner).artifact;
    for (let i = 0; i < 155; i++) server.guides.set(`unrelated-${i}`, { guide: { ...guide, externalId: `unrelated-${i}` }, pinned: false });
    server.guides.set('recovered', { guide, pinned: false });
    op.progress = { version: 1, step: 'create', state: 'started' };
    await expect(recover()).rejects.toMatchObject({ kind: 'retryable' });
    expect(op.progress?.step).toBe('discover-150'); expect(await recover()).toMatchObject({ kind: 'accepted', artifact: { ids: { guide: 'recovered' } } });
  });
  it('rejects duplicate external identities', async () => {
    const guide = guideMapping(op.workout!, op.destinationKey, owner).artifact;
    server.guides.set('a', { guide, pinned: false }); server.guides.set('b', { guide, pinned: false });
    op.progress = { version: 1, step: 'create', state: 'started' };
    expect(await recover()).toEqual({ kind: 'uncertain' });
  });
  it('traverses unrelated undated Guides during exact create recovery', async () => {
    await execute(); op.progress = { version: 1, step: 'create', state: 'started' }; op.artifact = null;
    const client = server.request;
    transport = new SuuntoGuideTransport(async (request, beforeSend) => {
      const response = await client(request, beforeSend);
      if (request.path.startsWith('/v2/guides/items?')) (response.body as unknown[]).unshift({ id: 'unrelated', owner,
        username: 'fixture-account', pinned: false, localDate: null, externalId: null });
      return response;
    }, owner, () => now);
    expect(await recover()).toMatchObject({ kind: 'accepted' });
  });
  it('recovers a lost PUT acknowledgement without replacing the Guide', async () => {
    await execute(); next({ title: 'Edited' });
    server.afterHandle = async req => { if (req.method === 'PUT') { server.afterHandle = null; throw new SuuntoGuideHttpError('uncertain', false); } };
    await expect(execute()).rejects.toThrow(); expect(await recover()).toMatchObject({ kind: 'accepted' });
    expect(server.calls.filter(req => req.method === 'POST')).toHaveLength(1);
    expect(server.calls.filter(req => req.method === 'PUT')).toHaveLength(1);
  });
  it('recovers an enriched reschedule readback against the new date without another write', async () => {
    const original = (await execute())!; server.guides.get(original.ids.guide)!.pinned = true;
    next({ localDate: '2027-01-02', title: 'Rescheduled' });
    server.afterHandle = async req => { if (req.method === 'PUT') { server.afterHandle = null; throw new SuuntoGuideHttpError('uncertain', false); } };
    await expect(execute()).rejects.toMatchObject({ kind: 'uncertain' });
    expect(await recover()).toEqual({ kind: 'accepted', artifact: { ...original, localDate: '2027-01-02' } });
    expect(server.guides.get(original.ids.guide)!.pinned).toBe(true);
    expect(server.calls.filter(req => req.method === 'POST')).toHaveLength(1);
    expect(server.calls.filter(req => req.method === 'PUT')).toHaveLength(1);
  });
  it('does not claim a lost DELETE completed from an ambiguous 404', async () => {
    await execute(); op = { ...op, kind: 'remove', workout: null, progress: null };
    server.afterHandle = async req => { if (req.method === 'DELETE') { server.afterHandle = null; throw new SuuntoGuideHttpError('uncertain', false); } };
    await expect(execute()).rejects.toThrow(); expect(await recover()).toEqual({ kind: 'uncertain' });
  });
  it.each(['2026-12-28', '2027-01-05'])('does not send outside the saved-zone window: %s', async localDate => {
    next({ localDate }); await expect(execute()).rejects.toThrow(); expect(server.calls).toHaveLength(0);
  });
  it('uses saved-zone calendar days across DST rather than elapsed 24-hour periods', async () => {
    // Helsinki is already October 25; DST ends during this local day.
    transport = new SuuntoGuideTransport(server.request, owner, () => Date.parse('2026-10-24T22:30:00Z'));
    next({ localDate: '2026-10-31' }); expect(await execute()).toMatchObject({ localDate: '2026-10-31' });
    next({ localDate: '2026-11-01' }); const count = server.calls.length;
    await expect(execute()).rejects.toThrow(); expect(server.calls).toHaveLength(count);
  });
  it('honors final guards and known completed protection', async () => {
    guard.mockRejectedValueOnce(new Error('stop')); await expect(execute()).rejects.toThrow('stop'); expect(server.calls).toHaveLength(0);
    op.progress = null; await execute(); op.artifact!.completed = true; next();
    const count = server.calls.length; await expect(execute()).rejects.toThrow(); expect(server.calls).toHaveLength(count);
  });
  it('keeps hidden-Guide lookup internal while declaring visibility checks and repair unavailable', async () => {
    const artifact = (await execute())!;
    const request = { destinationKey: op.destinationKey, connectionGeneration: op.connectionGeneration, artifact, timeZone: op.timeZone, cursor: null };
    expect(await transport.inspection.inspect(request, guard)).toMatchObject({ artifacts: [{ key: 'guide', state: 'present' }] });
    server.guides.get(artifact.ids.guide)!.pinned = false;
    expect(await transport.inspection.inspect(request, guard)).toMatchObject({ artifacts: [{ state: 'present' }] });
    server.guides.delete(artifact.ids.guide);
    expect(await transport.inspection.inspect(request, guard)).toMatchObject({ artifacts: [{ state: 'unknown', authoritative: false }] });
    expect(transport.inspection.policy.version).toBe('suunto-owned-guide-v2');
    expect(transport.inspection.policy.mode).toBe('unavailable');
    expect(transport.inspection.policy.authoritativeAbsenceKeys).toEqual([]);
    expect(transport.inspection.policy.repairReadyKeys).toEqual([]);
  });
  it('does not overwrite or withdraw an externally moved Guide', async () => {
    const artifact = (await execute())!; server.guides.get(artifact.ids.guide)!.guide.localDate = '2026-12-31'; next({ title: 'Edit' });
    await expect(execute()).rejects.toThrow(); op = { ...op, kind: 'remove', workout: null, progress: null }; await expect(execute()).rejects.toThrow();
    expect(server.calls.filter(req => ['PUT', 'DELETE'].includes(req.method))).toHaveLength(0);
  });
});
