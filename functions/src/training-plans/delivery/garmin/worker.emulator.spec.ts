import { randomUUID } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { GARMIN_GENERIC_WORKOUT_SPORTS_V1 } from '../../../../../shared/planned-workout-providers';
import { projectStrengthWorkoutToV1, type StrengthWorkoutDraftV1 } from '../../../../../shared/strength-workout';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduledWorkoutV1 } from '../../../../../shared/training-plans';
import { GARMIN_WORKOUT_NOT_FOUND_ISSUE, GARMIN_WORKOUT_WITH_CALENDAR_NOT_FOUND_ISSUE, type TrainingDeliveryCommandV1, type TrainingDeliveryPreviewV1 } from '../../../../../shared/training-provider-delivery';
import { DELIVERY_LEDGER, DELIVERY_QUEUE, type DeliveryLedgerV1, type DeliveryOperation, type DeliveryRuntime } from '../contracts';
import { trainingDeliveryCommand } from '../commands';
import { stageTrainingDeliveryDisconnect, stageTrainingDeliveryReconciliation } from '../marker';
import { reconcileTrainingDeliveryPage } from '../store';
import { processTrainingDelivery } from '../worker';
import { DELIVERY_SERVICES, productionDeliveryRuntime } from '../runtime';
import { GarminHttpFixture } from '../test-support/garmin-http-fixture';
import { GarminTrainingTransport } from './transport';
import { GarminTrainingHttpError } from './http';
import { authorizeGarminTrainingRequest } from './authorization';
import { GARMIN_INSPECTION_POLICY } from './inspection';
import { processTrainingVerification } from '../verification-worker';
import { mutateTrainingScheduleForUser } from '../../persistence';
import * as logger from 'firebase-functions/logger';

// Real Firestore authority and worker transactions; shared OAuth refresh is replaced
// with its persisted result, and every provider request stays in the synthetic server.
vi.mock('../../../tokens', () => ({ getTokenData: vi.fn(async snapshot => snapshot.data()) }));

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('Garmin delivery / real Firestore / synthetic HTTP', { timeout: 30_000 }, () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (host && !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('Loopback emulator required.');
  const db = new Firestore({ projectId: 'demo-training-delivery' });
  const users: string[] = [];
  const service = DELIVERY_SERVICES.garmin;
  let uid: string;
  let runtime: DeliveryRuntime;
  let server: GarminHttpFixture;
  let now: number;
  let pro: boolean;
  let proveRepair: boolean;
  const user = () => db.collection('users').doc(uid);
  const credential = () => db.collection(service.tokens).doc(uid).collection('tokens').doc('current');
  const ledger = async () => (await user().collection(DELIVERY_LEDGER).get()).docs[0]?.data() as DeliveryLedgerV1;
  const mark = () => db.runTransaction(async tx => { stageTrainingDeliveryReconciliation(tx, db, uid); });
  const drain = async () => {
    for (let page = 0; page < 20; page++) if (!await reconcileTrainingDeliveryPage(runtime, uid)) return;
    throw new Error('Unbounded fixture scan');
  };
  const command = async (action: TrainingDeliveryCommandV1['action'] = 'send', approvalDigest?: string, previewOnly = false) => {
    const [state, workout, settings] = await Promise.all([
      user().collection('trainingPlanState').doc('current').get(), user().collection('scheduledWorkouts').doc('w').get(),
      user().collection('trainingDeliverySettings').doc('workout_w_garmin').get(),
    ]);
    return trainingDeliveryCommand(runtime, uid, { schemaVersion: 1, mutationId: randomUUID(), scope: 'workout', scopeId: 'w',
      provider: 'garmin', action, ...(action !== 'replace' && action !== 'check' ? { timeZone: 'Europe/Helsinki' } : {}), expectedScheduleRevision: state.data()!.revision,
      expectedScopeRevision: workout.data()!.revision, expectedSettingsRevision: settings.data()?.revision ?? 0,
      ...(approvalDigest ? { approvalDigest } : {}) }, previewOnly);
  };
  const send = async () => { await command(); await drain(); return (await ledger()).id; };
  const retry = async (id: string) => { now = Math.max(now, (await ledger()).retryAtMs + 1); await processTrainingDelivery(runtime, uid, id); };
  const edit = async () => {
    await user().collection('scheduledWorkouts').doc('w').update({ title: 'Revised run', revision: 2, localDate: '2026-09-21' });
    await user().collection('trainingPlanState').doc('current').update({ revision: 2 });
    await mark(); await drain();
  };
  const strengthDraft = (load = 80): StrengthWorkoutDraftV1 => ({ version: 1, exercises: [
    { id: 'squat', name: 'Barbell back squat', sets: [{ id: 'set-one', ending: { kind: 'repetitions', repetitions: 5 },
      externalLoadKg: load, restAfterSeconds: 120 }] },
    { id: 'plank', name: 'Plank', sets: [{ id: 'set-two', ending: { kind: 'time', seconds: 30 } }] },
  ] });
  const mutate = async (operation: Parameters<typeof mutateTrainingScheduleForUser>[1]['operation']) => {
    const [state, workout, plan] = await Promise.all([user().collection('trainingPlanState').doc('current').get(),
      user().collection('scheduledWorkouts').doc('w').get(), user().collection('trainingPlans').doc('p').get()]);
    await mutateTrainingScheduleForUser(uid, { mutationId: randomUUID(), expectedRevisions: [
      { scope: 'state', id: 'current', revision: state.get('revision') },
      { scope: 'workout', id: 'w', revision: workout.exists ? workout.get('revision') : 0 },
      ...(plan.exists ? [{ scope: 'plan' as const, id: 'p', revision: plan.get('revision') }] : []),
    ], operation }, { db, nowMs: now });
  };
  const seedStrength = async (load = 80, planId: string | null = null) => {
    const current = await user().collection('scheduledWorkouts').doc('w').get();
    const existingStrength = current.get('structure.sport') === ActivityTypes.StrengthTraining;
    if (!existingStrength) {
      // Replace only this suite's synthetic baseline. Sport changes deliberately require a new workout.
      await db.recursiveDelete(current.ref);
      await user().collection('trainingPlanState').doc('current').update({ currentWorkoutCount: 0 });
    }
    const strength = strengthDraft(load);
    await mutate({ kind: existingStrength ? 'update-workout' : 'create-workout', workoutId: 'w', planId,
      localDate: '2026-09-20', title: 'Synthetic strength QA',
      structure: projectStrengthWorkoutToV1({ ...strength, workoutId: 'w', revision: 1 }), strength, confirmPlanRangeExtension: false });
  };
  beforeEach(async () => {
    vi.mocked(logger.warn).mockClear();
    uid = `garmin-delivery-test-${randomUUID()}`; users.push(uid);
    now = Date.parse('2026-09-14T10:00:00Z'); pro = true; proveRepair = false; server = new GarminHttpFixture();
    const inspectionPolicy = () => proveRepair ? { ...GARMIN_INSPECTION_POLICY,
      authoritativeAbsenceKeys: ['workout', 'schedule'], repairReadyKeys: ['workout', 'schedule'] }
      : GARMIN_INSPECTION_POLICY;
    const bind = (operation: Pick<DeliveryOperation, 'destinationKey' | 'connectionGeneration'>) => new GarminTrainingTransport(async (request, beforeSend) => {
      await authorizeGarminTrainingRequest(db, uid, operation);
      return server.request(request, beforeSend);
    }, () => now, inspectionPolicy());
    const policy = new GarminTrainingTransport(server.request, () => now);
    runtime = { ...productionDeliveryRuntime(db), now: () => now, hasPro: async () => pro,
      transport: provider => provider !== 'garmin' ? null : {
        mappingVersion: policy.mappingVersion, horizonDays: policy.horizonDays,
        inspection: { policy: inspectionPolicy(), inspect: (request, guard) => bind(request).inspection.inspect(request, guard) },
        assess: (...args) => policy.assess(...args), canRemove: (...args) => policy.canRemove(...args),
        execute: (operation, checkpoint, guard) => bind(operation).execute(operation, checkpoint, guard),
        recover: (operation, checkpoint, guard) => bind(operation).recover(operation, checkpoint, guard),
      } };
    const workout: ScheduledWorkoutV1 = { schemaVersion: 1, id: 'w', planId: null, revision: 1, title: 'Easy run',
      localDate: '2026-09-20', lifecycle: 'planned', createdAtMs: 1, updatedAtMs: 1,
      structure: { version: 1, sport: ActivityTypes.Running,
        nodes: [{ id: 's', kind: 'step', purpose: 'work', ending: { kind: 'time', seconds: 600 }, targets: [] }] } };
    await user().set({ fixture: true });
    await user().collection('trainingPlanState').doc('current').set({ schemaVersion: 1, revision: 1,
      activePlanId: null, currentWorkoutCount: 1, updatedAtMs: 1 });
    await user().collection('scheduledWorkouts').doc('w').set(workout);
    await user().collection('meta').doc(service.name).set({ connectionState: 'connected', connectionStateGeneration: 'connection-1', providerUserId: 'account-a' });
    await db.collection(service.tokens).doc(uid).set({ activeOAuthCredentialGeneration: 'credential-1' });
    await credential().set({ serviceName: service.name, userID: 'account-a', tokenCredentialGeneration: 'credential-1',
      accessToken: 'synthetic-only', expiresAt: Date.now() + 86_400_000, permissions: ['WORKOUT_IMPORT'] });
  });
  afterAll(async () => {
    for (const id of users) {
      await db.recursiveDelete(db.collection('users').doc(id));
      await db.recursiveDelete(db.collection(service.tokens).doc(id));
      await db.recursiveDelete(db.collection('userDeletionTombstones').doc(id));
      const jobs = await db.collection(DELIVERY_QUEUE).where('uid', '==', id).get();
      for (const job of jobs.docs) await db.recursiveDelete(job.ref);
    }
    await db.terminate();
  }, 120_000);

  it.each(GARMIN_GENERIC_WORKOUT_SPORTS_V1.flatMap(sport => ['standalone', 'plan'].map(scope => ({ sport, scope }))))(
    'requires current approval for $sport Generic in $scope and retains one Workout/Schedule through edits and Stop', async ({ sport, scope }) => {
    const planId = scope === 'plan' ? 'p' : null;
    if (planId) await mutate({ kind: 'create-plan', planId, name: 'Synthetic Generic plan', startLocalDate: '2026-09-20',
      endLocalDate: '2026-09-27', activate: true });
    const structure = { version: 1 as const, sport, nodes: [{ kind: 'step' as const, id: 'work', purpose: 'work' as const,
      ending: { kind: 'time' as const, seconds: 300 }, targets: [] }] };
    await mutate({ kind: 'update-workout', workoutId: 'w', planId, localDate: '2026-09-20',
      title: `Synthetic ${sport}`, structure, confirmPlanRangeExtension: false });
    const planCommand = async (action: 'configure' | 'stop') => {
      const [state, plan, settings] = await Promise.all([user().collection('trainingPlanState').doc('current').get(),
        user().collection('trainingPlans').doc('p').get(), user().collection('trainingDeliverySettings').doc('plan_p_garmin').get()]);
      return trainingDeliveryCommand(runtime, uid, { schemaVersion: 1, mutationId: randomUUID(), scope: 'plan', scopeId: 'p',
        provider: 'garmin', action, timeZone: 'Europe/Helsinki', expectedScheduleRevision: state.get('revision'),
        expectedScopeRevision: plan.get('revision'), expectedSettingsRevision: settings.get('revision') ?? 0 }, false);
    };
    if (planId) await planCommand('configure');
    const preview = await command('send', undefined, true) as TrainingDeliveryPreviewV1;
    expect(preview).toMatchObject({ workoutCompatibility: 'degraded', approvalRequiredCount: 1 });
    expect(preview.issues.join(' ')).toContain('Generic workout');
    expect(server.calls).toHaveLength(0);
    if (!planId) await command();
    await drain();
    const id = (await ledger()).id;
    await processTrainingDelivery(runtime, uid, id); await drain();
    expect((await ledger()).status).toBe('approval_required');
    expect(server.calls).toHaveLength(0);
    await command('approve', preview.approvalDigest!); await drain();
    await Promise.all([processTrainingDelivery(runtime, uid, id), processTrainingDelivery(runtime, uid, id)]); await drain();
    const original = (await ledger()).actual!;
    expect((await ledger()).status).toBe('delivered');
    expect(server.workouts.get(original.ids.workout)).toMatchObject({ sport: 'GENERIC',
      description: expect.stringContaining(`Quantified Self sport: ${sport}.`),
      segments: [{ sport: 'GENERIC', steps: [{ durationValue: 300 }] }] });
    expect((await user().collection('scheduledWorkouts').doc('w').get()).get('structure.sport')).toBe(sport);

    await mutate({ kind: 'update-workout', workoutId: 'w', planId, localDate: '2026-09-21',
      title: `Synthetic ${sport} revised`, structure: { ...structure, nodes: [{ ...structure.nodes[0],
        ending: { kind: 'time', seconds: 360 } }] }, confirmPlanRangeExtension: false });
    await drain(); await processTrainingDelivery(runtime, uid, id); await drain();
    expect((await ledger()).status).toBe('approval_required');
    await expect(command('approve', preview.approvalDigest!)).rejects.toMatchObject({ code: 'aborted' });
    const revised = await command('send', undefined, true) as TrainingDeliveryPreviewV1;
    await command('approve', revised.approvalDigest!); await drain();
    await processTrainingDelivery(runtime, uid, id); await drain();
    expect((await ledger()).actual!.ids).toEqual(original.ids);
    expect(server.workouts.get(original.ids.workout)).toMatchObject({ sport: 'GENERIC', segments: [{ steps: [{ durationValue: 360 }] }] });
    expect(server.schedules.get(original.ids.schedule)).toMatchObject({ date: '2026-09-21' });
    expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(2);
    if (planId) await planCommand('stop'); else await command('stop');
    await drain(); await processTrainingDelivery(runtime, uid, id); await drain();
    expect(server.workouts.size + server.schedules.size).toBe(0);
  });

  it.each(['standalone', 'plan'] as const)('delivers %s strength through real mutations, duplicate dispatch, load edit, reschedule and Stop', async scope => {
    await seedStrength();
    const planCommand = async (action: 'configure' | 'stop') => {
      const [state, plan, settings] = await Promise.all([user().collection('trainingPlanState').doc('current').get(),
        user().collection('trainingPlans').doc('p').get(), user().collection('trainingDeliverySettings').doc('plan_p_garmin').get()]);
      await trainingDeliveryCommand(runtime, uid, { schemaVersion: 1, mutationId: randomUUID(), scope: 'plan', scopeId: 'p',
        provider: 'garmin', action, timeZone: 'Europe/Helsinki', expectedScheduleRevision: state.get('revision'),
        expectedScopeRevision: plan.get('revision'), expectedSettingsRevision: settings.get('revision') ?? 0 }, false);
    };
    if (scope === 'plan') {
      await mutate({ kind: 'create-plan', planId: 'p', name: 'Synthetic strength plan', startLocalDate: '2026-09-20',
        endLocalDate: '2026-09-27', activate: true });
      await mutate({ kind: 'move-workout', workoutId: 'w', planId: 'p', localDate: '2026-09-20', confirmPlanRangeExtension: false });
      await planCommand('configure');
    } else await command();
    await drain(); const id = (await ledger()).id;
    await Promise.all([processTrainingDelivery(runtime, uid, id), processTrainingDelivery(runtime, uid, id)]); await drain();
    const original = (await ledger()).actual!;
    expect((await ledger()).status).toBe('delivered');
    expect(server.workouts.get(original.ids.workout)).toMatchObject({ sport: 'STRENGTH_TRAINING',
      segments: [{ steps: [{ exerciseName: 'BARBELL_BACK_SQUAT', weightValue: 80, durationType: 'REPS' },
        { durationValue: 120, intensity: 'REST' }, { exerciseName: 'PLANK', durationType: 'TIME' }] }] });
    const before = (await ledger()).contentDigest;
    await seedStrength(82.5, scope === 'plan' ? 'p' : null);
    await drain(); await processTrainingDelivery(runtime, uid, id); await drain();
    expect((await ledger()).contentDigest).not.toBe(before);
    expect((await ledger()).actual!.ids).toEqual(original.ids);
    expect(server.workouts.get(original.ids.workout)).toMatchObject({ segments: [{ steps: [{ weightValue: 82.5 }, {}, {}] }] });
    await mutate({ kind: 'move-workout', workoutId: 'w', planId: scope === 'plan' ? 'p' : null,
      localDate: '2026-09-21', confirmPlanRangeExtension: false });
    await drain(); await processTrainingDelivery(runtime, uid, id); await drain();
    expect(server.schedules.get(original.ids.schedule)).toMatchObject({ date: '2026-09-21' });
    expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(2);
    if (scope === 'plan') await planCommand('stop'); else await command('stop');
    await drain(); await processTrainingDelivery(runtime, uid, id); await drain();
    expect(server.workouts.size + server.schedules.size).toBe(0);
  });

  it.each(['missing', 'foreign', 'mismatch', 'invalid', 'unknown'] as const)('blocks %s strength companions before provider I/O', async failure => {
    await seedStrength();
    const companion = user().collection('scheduledWorkouts').doc('w').collection('strengthDetails').doc('current');
    if (failure === 'missing') await companion.delete(); // Synthetic leaf, no descendants by design.
    if (failure === 'foreign') await companion.update({ workoutId: 'foreign-workout' });
    if (failure === 'mismatch' || failure === 'unknown') await companion.update({ exercises: [{ ...strengthDraft().exercises[0], name: 'Custom unsupported exercise' }] });
    if (failure === 'unknown') {
      const invalid = { ...strengthDraft(), exercises: [{ ...strengthDraft().exercises[0], name: 'Custom unsupported exercise' }] };
      await user().collection('scheduledWorkouts').doc('w').update({ structure: projectStrengthWorkoutToV1({ ...invalid, workoutId: 'w', revision: 1 }) });
    }
    if (failure === 'invalid') await companion.update({ exercises: [{ ...strengthDraft().exercises[0], sets: [{ id: 'set-one', ending: { kind: 'repetitions', repetitions: 5 }, externalLoadKg: -1 }] }] });
    await expect(command()).rejects.toThrow();
    expect(server.calls).toHaveLength(0);
  });

  it('keeps one pool-swim Workout and Schedule through plan opt-in, edit, reschedule and Stop', async () => {
    const plan = user().collection('trainingPlans').doc('p');
    const state = user().collection('trainingPlanState').doc('current');
    const scheduled = user().collection('scheduledWorkouts').doc('w');
    const poolStructure = (count: number) => ({ version: 1 as const, sport: ActivityTypes.Swimming,
      poolLength: { meters: 25, presentation: 'meters' as const }, nodes: [{ kind: 'repeat' as const,
        id: 'set', count, steps: [{ kind: 'step' as const, id: 'swim', purpose: 'work' as const,
          ending: { kind: 'distance' as const, meters: 25 }, targets: [] },
        { kind: 'step' as const, id: 'rest', purpose: 'rest' as const,
          ending: { kind: 'time' as const, seconds: 30 }, targets: [] }] }] });
    const mutate = async (operation: Parameters<typeof mutateTrainingScheduleForUser>[1]['operation']) => {
      const [currentState, currentPlan, currentWorkout] = await Promise.all([state.get(), plan.get(), scheduled.get()]);
      const expectedRevisions = [{ scope: 'state' as const, id: 'current', revision: currentState.get('revision') },
        ...(currentPlan.exists ? [{ scope: 'plan' as const, id: 'p', revision: currentPlan.get('revision') }] : []),
        { scope: 'workout' as const, id: 'w', revision: currentWorkout.get('revision') }];
      await mutateTrainingScheduleForUser(uid, { mutationId: randomUUID(), expectedRevisions, operation }, { db, nowMs: now });
    };
    await mutate({ kind: 'create-plan', planId: 'p', name: 'QA pool plan', startLocalDate: '2026-09-20',
      endLocalDate: '2026-09-27', activate: true });
    await mutate({ kind: 'update-workout', workoutId: 'w', planId: 'p', localDate: '2026-09-20',
      title: 'Four 25 m lengths', structure: poolStructure(4), confirmPlanRangeExtension: false });
    const planCommand = async (action: 'configure' | 'stop') => {
      const [currentState, currentPlan, settings] = await Promise.all([state.get(), plan.get(),
        user().collection('trainingDeliverySettings').doc('plan_p_garmin').get()]);
      return trainingDeliveryCommand(runtime, uid, { schemaVersion: 1, mutationId: randomUUID(), scope: 'plan',
        scopeId: 'p', provider: 'garmin', action, timeZone: 'Europe/Helsinki',
        expectedScheduleRevision: currentState.get('revision'), expectedScopeRevision: currentPlan.get('revision'),
        expectedSettingsRevision: settings.get('revision') ?? 0 }, false);
    };
    await planCommand('configure'); await drain();
    const id = (await ledger()).id;
    await processTrainingDelivery(runtime, uid, id); await drain();
    const delivered = (await ledger()).actual!;
    expect(delivered.ids).toMatchObject({ workout: expect.any(String), schedule: expect.any(String) });
    expect(server.workouts.get(delivered.ids.workout)).toMatchObject({ sport: 'LAP_SWIMMING',
      poolLength: 25, poolLengthUnit: 'METER' });
    expect(server.schedules.get(delivered.ids.schedule)).toMatchObject({ date: '2026-09-20' });

    await mutate({ kind: 'update-workout', workoutId: 'w', planId: 'p', localDate: '2026-09-20',
      title: 'Five 25 m lengths', structure: poolStructure(5), confirmPlanRangeExtension: false });
    await drain(); await processTrainingDelivery(runtime, uid, id); await drain();
    expect((await ledger()).actual!.ids).toEqual(delivered.ids);
    expect(server.workouts.size).toBe(1); expect(server.schedules.size).toBe(1);

    await mutate({ kind: 'move-workout', workoutId: 'w', planId: 'p', localDate: '2026-09-21',
      confirmPlanRangeExtension: false });
    await drain(); await processTrainingDelivery(runtime, uid, id); await drain();
    expect((await ledger()).actual!.ids).toEqual(delivered.ids);
    expect(server.schedules.get(delivered.ids.schedule)).toMatchObject({ date: '2026-09-21' });

    await planCommand('stop'); await drain(); await processTrainingDelivery(runtime, uid, id); await drain();
    expect(server.schedules.size).toBe(0); expect(server.workouts.size).toBe(0);
  });

  it('confirms and repairs only a deleted Garmin schedule with the production policy', async () => {
    const id = await send(); await processTrainingDelivery(runtime, uid, id); await drain();
    const original = (await ledger()).actual!;
    server.schedules.delete(original.ids.schedule);
    await processTrainingVerification(runtime, uid, id);
    expect((await ledger()).verification).toMatchObject({ state: 'suspected_missing', missing: false, missingKeys: ['schedule'] });
    now += 900_000;
    await processTrainingVerification(runtime, uid, id);
    expect((await ledger()).verification).toMatchObject({ state: 'restoring', missing: true, missingKeys: ['schedule'] });
    await processTrainingDelivery(runtime, uid, id); await drain();
    const repaired = (await ledger()).actual!;
    expect(repaired.ids.workout).toBe(original.ids.workout);
    expect(repaired.ids.schedule).not.toBe(original.ids.schedule);
    expect(server.workouts.size).toBe(1); expect(server.schedules.size).toBe(1);
    expect((await ledger()).status).toBe('delivered');
  });

  it.each(['workout-only', 'connect-cascade'] as const)(
    'keeps %s Workout absence non-authoritative but visibly needing review under the production policy', async deletion => {
      const id = await send(); await processTrainingDelivery(runtime, uid, id); await drain();
      const original = (await ledger()).actual!;
      server.workouts.delete(original.ids.workout);
      if (deletion === 'connect-cascade') server.schedules.delete(original.ids.schedule);
      await processTrainingVerification(runtime, uid, id); now += 900_000;
      await processTrainingVerification(runtime, uid, id);
      expect((await ledger()).verification).toMatchObject({ state: 'unknown', missing: false, missingKeys: [] });
      expect((await ledger()).repair).toBeFalsy();
      expect((await ledger()).status).toBe('needs_attention');
      expect((await ledger()).issues).toContain(deletion === 'connect-cascade' ? GARMIN_WORKOUT_NOT_FOUND_ISSUE : GARMIN_WORKOUT_WITH_CALENDAR_NOT_FOUND_ISSUE);
      expect(server.calls.filter(request => request.method === 'POST' && request.path.includes('workout'))).toHaveLength(1);
      expect(server.calls.filter(request => request.method === 'POST' && request.path === '/training-api/schedule/')).toHaveLength(1);
    });

  const missingGarminCopy = async (cascade = true, existingId?: string) => {
    const id = existingId ?? await send(); await processTrainingDelivery(runtime, uid, id); await drain();
    const original = (await ledger()).actual!;
    const savedWorkout = structuredClone(server.workouts.get(original.ids.workout)!);
    const savedSchedule = structuredClone(server.schedules.get(original.ids.schedule)!);
    server.workouts.delete(original.ids.workout);
    if (cascade) server.schedules.delete(original.ids.schedule);
    await processTrainingVerification(runtime, uid, id);
    return { id, original, savedWorkout, savedSchedule };
  };
  const requestReplacement = async () => {
    const preview = await command('replace', undefined, true) as TrainingDeliveryPreviewV1;
    expect(preview.effect).toBe('replace'); expect(preview.approvalDigest).toMatch(/^[a-f0-9]{64}$/);
    await command('replace', preview.approvalDigest!); await drain();
  };
  it('replaces only after explicit review, preserving old IDs', async () => {
    const { id, original } = await missingGarminCopy();
    await command('retry'); await drain(); await processTrainingDelivery(runtime, uid, id);
    expect(server.calls.filter(call => call.method === 'POST' && call.path.includes('workout'))).toHaveLength(1);
    await command('check'); await drain(); await processTrainingVerification(runtime, uid, id);
    await expect(command('replace')).rejects.toMatchObject({ code: 'aborted' });
    await requestReplacement();
    await Promise.all([processTrainingDelivery(runtime, uid, id), processTrainingDelivery(runtime, uid, id)]);
    await drain();
    const result = await ledger();
    expect(result.status).toBe('delivered'); expect(result.actual!.ids.workout).not.toBe(original.ids.workout);
    expect(server.workouts.size).toBe(1); expect(server.schedules.size).toBe(1);
    expect(server.calls.filter(call => call.method === 'POST' && call.path.includes('workout'))).toHaveLength(2);
    const attempts = await user().collection(DELIVERY_LEDGER).doc(id).collection('attempts').get();
    expect(attempts.docs.some(doc => doc.get('operation.repair.original.ids.workout') === original.ids.workout)).toBe(true);
    const statuses = await user().collection('trainingDeliveryStatuses').get();
    expect(statuses.docs[0].data()).toMatchObject({ status: 'delivered', differsFromQS: false });
  });
  it('keeps the unproved surviving-Schedule case unsupported rather than enabling replacement', async () => {
    await missingGarminCopy(false);
    await expect(command('replace', undefined, true)).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(server.calls.filter(call => call.method === 'POST' && call.path.includes('workout'))).toHaveLength(1);
  });
  it('replays one reviewed mutation receipt without creating another replacement intent or POST', async () => {
    const { id } = await missingGarminCopy();
    const preview = await command('replace', undefined, true) as TrainingDeliveryPreviewV1;
    const settings = await user().collection('trainingDeliverySettings').doc('workout_w_garmin').get();
    const raw = { schemaVersion: 1, mutationId: randomUUID(), scope: 'workout', scopeId: 'w', provider: 'garmin', action: 'replace',
      expectedScheduleRevision: 1, expectedScopeRevision: 1, expectedSettingsRevision: settings.get('revision'), approvalDigest: preview.approvalDigest };
    const [one, two] = await Promise.all([trainingDeliveryCommand(runtime, uid, raw, false), trainingDeliveryCommand(runtime, uid, raw, false)]);
    expect(two).toEqual(one);
    await drain(); await processTrainingDelivery(runtime, uid, id); await drain();
    expect(await trainingDeliveryCommand(runtime, uid, raw, false)).toEqual(one);
    await expect(trainingDeliveryCommand(runtime, uid, { ...raw, approvalDigest: 'b'.repeat(64) }, false)).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(server.calls.filter(call => call.method === 'POST' && call.path.includes('workout'))).toHaveLength(2);
  });
  it('replaces a plan-bound copy without disabling inherited sync or granting other workouts new consent', async () => {
    const id = await send(); await processTrainingDelivery(runtime, uid, id); await drain();
    await user().collection('trainingPlans').doc('p').set({ schemaVersion: 1, id: 'p', name: 'Synthetic recovery plan',
      lifecycle: 'active', startLocalDate: '2026-09-14', endLocalDate: '2026-09-30', revision: 1,
      lastCheckpointRevision: 1, workoutCount: 1, createdAtMs: 1, updatedAtMs: 1 });
    await user().collection('scheduledWorkouts').doc('w').update({ planId: 'p' });
    await trainingDeliveryCommand(runtime, uid, { schemaVersion: 1, mutationId: randomUUID(), scope: 'plan', scopeId: 'p',
      provider: 'garmin', action: 'configure', timeZone: 'Europe/Helsinki', expectedScheduleRevision: 1,
      expectedScopeRevision: 1, expectedSettingsRevision: 0 }, false);
    await drain(); await missingGarminCopy(true, id); await requestReplacement();
    await processTrainingDelivery(runtime, uid, id); await drain();
    expect((await ledger()).status).toBe('delivered');
    expect((await user().collection('trainingDeliverySettings').doc('plan_p_garmin').get()).get('enabled')).toBe(true);
    expect((await user().collection('trainingDeliverySettings').doc('workout_w_garmin').get()).get('suppressed')).toBe(false);
  });
  it('preserves Generic mapping approval separately from replacement approval', async () => {
    const baseline = (await user().collection('scheduledWorkouts').doc('w').get()).data() as ScheduledWorkoutV1;
    await user().collection('scheduledWorkouts').doc('w').update({ structure: { ...baseline.structure, sport: ActivityTypes.Walking } });
    const mappingPreview = await command('send', undefined, true) as TrainingDeliveryPreviewV1;
    expect(mappingPreview.workoutCompatibility).toBe('degraded');
    await command('send', mappingPreview.approvalDigest!); await drain();
    const id = (await ledger()).id; await processTrainingDelivery(runtime, uid, id); await drain();
    await missingGarminCopy(true, id); await requestReplacement();
    expect((await user().collection('trainingDeliverySettings').doc('workout_w_garmin').get()).get('approvedDigest'))
      .toBe(mappingPreview.approvalDigest);
    await processTrainingDelivery(runtime, uid, id); await drain();
    expect((await ledger()).status).toBe('delivered');
    expect(server.calls.filter(call => call.method === 'POST' && call.path.includes('workout'))).toHaveLength(2);
    expect((await user().collection('scheduledWorkouts').doc('w').get()).get('structure.sport')).toBe(ActivityTypes.Walking);
  });
  it('requires a fresh review after an edit but can then replace the current prescription', async () => {
    const { id } = await missingGarminCopy(); await requestReplacement(); await edit();
    await processTrainingDelivery(runtime, uid, id);
    expect((await ledger()).attempt).toBeNull();
    await processTrainingVerification(runtime, uid, id);
    await requestReplacement(); await processTrainingDelivery(runtime, uid, id); await drain();
    expect((await ledger()).status).toBe('delivered');
    const copy = (await ledger()).actual!;
    expect(copy.localDate).toBe('2026-09-21'); expect(server.workouts.get(copy.ids.workout)!.workoutName).toBe('Revised run');
    expect(server.calls.filter(call => call.method === 'POST' && call.path.includes('workout'))).toHaveLength(2);
  });
  it('resumes an authorized edit against the original pair when it reappears after replacement review was invalidated', async () => {
    const { id, original, savedWorkout, savedSchedule } = await missingGarminCopy();
    await requestReplacement(); await edit(); await processTrainingDelivery(runtime, uid, id);
    server.workouts.set(original.ids.workout, savedWorkout); server.schedules.set(original.ids.schedule, savedSchedule);
    await processTrainingVerification(runtime, uid, id);
    expect((await db.collection(DELIVERY_QUEUE).doc(id).get()).get('kind')).toBe('delivery');
    await processTrainingDelivery(runtime, uid, id); await drain();
    expect((await ledger()).status).toBe('delivered'); expect((await ledger()).actual!.ids).toEqual(original.ids);
    expect(server.workouts.get(original.ids.workout)!.workoutName).toBe('Revised run');
    expect(server.schedules.get(original.ids.schedule)!.date).toBe('2026-09-21');
    expect(server.calls.filter(call => call.method === 'POST' && call.path.includes('workout'))).toHaveLength(1);
  });
  it('adopts a fully reappearing original instead of POSTing another Workout', async () => {
    const { id, original, savedWorkout, savedSchedule } = await missingGarminCopy();
    await requestReplacement();
    server.workouts.set(original.ids.workout, savedWorkout); server.schedules.set(original.ids.schedule, savedSchedule);
    await processTrainingDelivery(runtime, uid, id); await drain();
    expect((await ledger()).actual).toEqual(original);
    expect((await ledger()).status).toBe('delivered');
    expect(server.calls.filter(call => call.method === 'POST' && call.path.includes('workout'))).toHaveLength(1);
  });
  it('never repeats an uncertain replacement root POST, including explicit Retry or another Replace', async () => {
    const { id } = await missingGarminCopy(); await requestReplacement();
    server.afterHandle = async request => {
      if (request.method !== 'POST' || !request.path.includes('workout')) return;
      server.afterHandle = null; throw new GarminTrainingHttpError('uncertain', false);
    };
    await processTrainingDelivery(runtime, uid, id);
    expect((await ledger()).status).toBe('needs_attention');
    await expect(command('replace', undefined, true)).rejects.toMatchObject({ code: 'failed-precondition' });
    await command('retry'); await drain(); await retry(id);
    expect((await ledger()).status).toBe('needs_attention');
    expect(server.calls.filter(call => call.method === 'POST' && call.path.includes('workout'))).toHaveLength(2);
    expect(server.workouts.size).toBe(1);
  });
  it.each(['stale-check', 'edit', 'permission', 'other-account', 'epoch', 'completion', 'past', 'pro', 'lock'] as const)(
    'rejects replacement after %s before provider writes', async changed => {
      const { id } = await missingGarminCopy();
      const preview = await command('replace', undefined, true) as TrainingDeliveryPreviewV1;
      const writes = server.calls.filter(call => call.method !== 'GET').length;
      if (changed === 'stale-check') now += 86_400_001;
      if (changed === 'edit') await edit();
      if (changed === 'permission') await credential().update({ permissions: [] });
      if (changed === 'other-account') await credential().update({ userID: 'account-b' });
      if (changed === 'epoch') await db.runTransaction(async tx => { stageTrainingDeliveryDisconnect(tx, db, uid, 'garmin'); });
      if (changed === 'completion') await user().collection(DELIVERY_LEDGER).doc(id).update({ 'actual.completed': true });
      if (changed === 'past') now += 10 * 86_400_000;
      if (changed === 'pro') pro = false;
      if (changed === 'lock') await user().collection('trainingPlanState').doc('current').collection('planDeletionLocks').doc('p').set({});
      await expect(command('replace', preview.approvalDigest!)).rejects.toBeDefined();
      expect(server.calls.filter(call => call.method !== 'GET')).toHaveLength(writes);
    });
  it.each(['stop', 'completion', 'reconnect', 'edit', 'permission', 'past', 'pro'] as const)(
    'does not POST a replacement when %s wins between review and worker admission', async changed => {
      const { id } = await missingGarminCopy(); await requestReplacement();
      if (changed === 'stop') await command('stop');
      if (changed === 'completion') await user().collection(DELIVERY_LEDGER).doc(id).update({ 'actual.completed': true });
      if (changed === 'reconnect') await user().collection('meta').doc(service.name).update({ connectionStateGeneration: 'connection-2' });
      if (changed === 'edit') await edit();
      if (changed === 'permission') await credential().update({ permissions: [] });
      if (changed === 'past') now += 10 * 86_400_000;
      if (changed === 'pro') pro = false;
      await processTrainingDelivery(runtime, uid, id); await drain();
      expect(server.calls.filter(call => call.method === 'POST' && call.path.includes('workout'))).toHaveLength(1);
    });

  it('restarts the schedule absence clock after the original association reappears', async () => {
    const id = await send(); await processTrainingDelivery(runtime, uid, id); await drain();
    const original = (await ledger()).actual!;
    const saved = structuredClone(server.schedules.get(original.ids.schedule)!);
    server.schedules.delete(original.ids.schedule);
    await processTrainingVerification(runtime, uid, id);
    expect((await ledger()).verification).toMatchObject({ state: 'suspected_missing', missing: false });

    server.schedules.set(original.ids.schedule, saved);
    now += 900_000;
    await processTrainingVerification(runtime, uid, id);
    expect((await ledger()).verification).toMatchObject({ state: 'present', missing: false, missingKeys: [] });

    server.schedules.delete(original.ids.schedule);
    now += 86_400_000;
    await processTrainingVerification(runtime, uid, id);
    expect((await ledger()).verification).toMatchObject({ state: 'suspected_missing', missing: false, missingKeys: ['schedule'] });
    expect((await ledger()).repair).toBeFalsy();
    expect(server.calls.filter(request => request.method === 'POST' && request.path === '/training-api/schedule/')).toHaveLength(1);

    now += 900_000;
    await processTrainingVerification(runtime, uid, id);
    expect((await ledger()).verification).toMatchObject({ state: 'restoring', missing: true, missingKeys: ['schedule'] });
  });

  it.each(['stop', 'edit'] as const)('resolves a %s after an accepted production schedule-only repair POST', async change => {
    const id = await send(); await processTrainingDelivery(runtime, uid, id); await drain();
    const original = (await ledger()).actual!;
    server.schedules.delete(original.ids.schedule);
    await processTrainingVerification(runtime, uid, id); now += 900_000;
    await processTrainingVerification(runtime, uid, id);
    expect((await ledger()).verification?.state).toBe('restoring');

    server.afterHandle = async request => {
      if (request.method !== 'POST' || request.path !== '/training-api/schedule/') return;
      server.afterHandle = null;
      if (change === 'stop') await command('stop');
      else await edit();
      await drain();
    };
    await processTrainingDelivery(runtime, uid, id);
    for (let pass = 0; pass < 4; pass++) { await retry(id); await drain(); }

    const current = await ledger();
    expect(current.attempt).toBeNull();
    expect(server.calls.filter(request => request.method === 'POST' && request.path.includes('workout'))).toHaveLength(1);
    expect(server.calls.filter(request => request.method === 'POST' && request.path === '/training-api/schedule/')).toHaveLength(2);
    if (change === 'stop') {
      expect(current.status).toBe('removed');
      expect(server.workouts.size).toBe(0); expect(server.schedules.size).toBe(0);
    } else {
      expect(current.status).toBe('delivered');
      expect(current.actual?.ids.workout).toBe(original.ids.workout);
      expect(server.workouts.size).toBe(1); expect(server.schedules.size).toBe(1);
      expect(server.workouts.get(original.ids.workout)?.workoutName).toBe('Revised run');
      expect(server.schedules.get(current.actual!.ids.schedule)?.date).toBe('2026-09-21');
    }
  });

  it('serializes duplicate workers, updates retained Long IDs, and deletes both artifacts after Stop without Pro', async () => {
    const id = await send();
    await Promise.all([processTrainingDelivery(runtime, uid, id), processTrainingDelivery(runtime, uid, id)]);
    const accepted = await ledger();
    expect(accepted.status).toBe('delivered');
    expect(server.calls.filter(request => request.method === 'POST')).toHaveLength(2);
    await edit(); await processTrainingDelivery(runtime, uid, id);
    expect((await ledger()).actual?.ids).toEqual(accepted.actual?.ids);
    expect(server.workouts.values().next().value?.workoutName).toBe('Revised run');
    expect(server.schedules.values().next().value?.date).toBe('2026-09-21');
    pro = false; await command('stop'); await drain(); await processTrainingDelivery(runtime, uid, id);
    expect((await ledger()).status).toBe('removed');
    expect(server.workouts.size + server.schedules.size).toBe(0);
    expect(server.calls.filter(request => request.method === 'POST')).toHaveLength(2);
  }, 30_000);

  it.each(['accepted', 'rejected'] as const)('withdraws the surviving original schedule when Stop interrupts a repair after a %s replacement POST', async outcome => {
    proveRepair = true;
    const id = await send(); await processTrainingDelivery(runtime, uid, id); await drain();
    const original = (await ledger()).actual!;
    server.workouts.delete(original.ids.workout);
    await processTrainingVerification(runtime, uid, id); now += 900_000;
    await processTrainingVerification(runtime, uid, id);
    expect((await ledger()).verification?.state).toBe('restoring');
    const stop = async (request: { method: string; path: string }) => {
      if (request.method !== 'POST' || !request.path.includes('workout')) return;
      server.afterHandle = null; server.beforeHandle = null;
      await command('stop'); await drain();
      if (outcome === 'rejected') throw new GarminTrainingHttpError('retryable', true);
    };
    if (outcome === 'accepted') server.afterHandle = stop; else server.beforeHandle = stop;
    await processTrainingDelivery(runtime, uid, id);
    for (let pass = 0; pass < 4; pass++) { await retry(id); await drain(); }
    expect(server.schedules.size).toBe(0);
    expect(server.workouts.size).toBe(0);
    expect((await ledger()).attempt).toBeNull();
  });

  it('blocks an uncertain replacement Workout POST after paired absence, including explicit Retry', async () => {
    // Synthetic authority exercises the disabled replacement branch without enabling
    // production Workout absence/repair from a 404.
    proveRepair = true;
    const id = await send(); await processTrainingDelivery(runtime, uid, id); await drain();
    const original = (await ledger()).actual!;
    server.workouts.delete(original.ids.workout); server.schedules.delete(original.ids.schedule);
    await processTrainingVerification(runtime, uid, id); now += 900_000;
    await processTrainingVerification(runtime, uid, id);
    expect((await ledger()).verification?.state).toBe('restoring');
    server.afterHandle = async request => {
      if (request.method === 'POST' && request.path.includes('workout')) {
        server.afterHandle = null; throw new GarminTrainingHttpError('uncertain', false);
      }
    };
    await processTrainingDelivery(runtime, uid, id);
    expect((await ledger()).attempt?.progress).toMatchObject({ step: 'workout-create', state: 'started' });
    expect(server.workouts.size).toBe(1); expect(server.schedules.size).toBe(0);
    await retry(id);
    expect((await ledger()).status).toBe('needs_attention');
    await command('retry'); await drain(); await retry(id);
    expect((await ledger()).status).toBe('needs_attention');
    expect(server.calls.filter(request => request.method === 'POST' && request.path.includes('workout'))).toHaveLength(2);
    expect(server.calls.filter(request => request.method === 'POST' && request.path === '/training-api/schedule/')).toHaveLength(1);
  });

  it('does not classify a missing Schedule after Garmin Training permission is revoked', async () => {
    const id = await send(); await processTrainingDelivery(runtime, uid, id); await drain();
    const original = (await ledger()).actual!;
    server.schedules.delete(original.ids.schedule);
    await credential().update({ permissions: [] });
    const before = server.calls.length;
    await processTrainingVerification(runtime, uid, id);
    expect(server.calls).toHaveLength(before);
    // Readiness rejects the check before HTTP; it cannot produce a negative observation.
    expect((await ledger()).verification).toMatchObject({ state: 'pending', missing: false, missingKeys: [] });
    expect((await ledger()).repair).toBeFalsy();
  });

  it.each(['ready', 'inspection-paused'] as const)('finishes the latest edit after partial repair, respecting %s readiness', async readiness => {
    proveRepair = true;
    const id = await send(); await processTrainingDelivery(runtime, uid, id); await drain();
    const original = (await ledger()).actual!;
    server.workouts.delete(original.ids.workout);
    await processTrainingVerification(runtime, uid, id); now += 900_000;
    await processTrainingVerification(runtime, uid, id);
    server.afterHandle = async request => {
      if (request.method !== 'POST' || !request.path.includes('workout')) return;
      server.afterHandle = null; await edit();
    };
    await processTrainingDelivery(runtime, uid, id);
    await retry(id); await drain(); // Recover and retire the old authored revision.
    if (readiness === 'inspection-paused') {
      proveRepair = false;
      const count = server.calls.length;
      await retry(id);
      expect(server.calls).toHaveLength(count);
      expect((await ledger()).repair?.continuation).toBe(true);
      proveRepair = true; await mark(); await drain();
    }
    for (let pass = 0; pass < 4; pass++) { await retry(id); await drain(); }
    expect((await ledger()).status).toBe('delivered');
    expect(server.workouts.size).toBe(1); expect(server.schedules.size).toBe(1);
    expect(server.workouts.values().next().value?.workoutName).toBe('Revised run');
    expect(server.schedules.get(original.ids.schedule)?.date).toBe('2026-09-21');
    expect(server.schedules.get(original.ids.schedule)?.workoutId).toBe((await ledger()).actual!.ids.workout);
    expect(server.calls.filter(request => request.method === 'POST' && request.path.includes('workout'))).toHaveLength(2);
  });

  it.each(['empty', 'numeric', 'long'] as const)('confirms a %s successful schedule create in one worker attempt, retaining one identity under duplicate dispatch', async response => {
    if (response === 'numeric') server.nextId = 1000n;
    const request = server.request;
    server.request = async (...args) => {
      const result = await request(...args);
      if (args[0].method !== 'POST' || args[0].path !== '/training-api/schedule/') return result;
      const id = (result.body as { scheduleId: string }).scheduleId;
      return response === 'empty' ? { status: 204, body: null } : { status: 200, body: response === 'numeric' ? Number(id) : id };
    };
    const id = await send();
    await Promise.all([processTrainingDelivery(runtime, uid, id), processTrainingDelivery(runtime, uid, id)]);
    const current = await ledger();
    expect(current.status).toBe('delivered'); expect(current.retries).toBe(0); expect(current.attempt).toBeNull();
    expect(Object.keys(current.actual!.ids).sort()).toEqual(['owner', 'schedule', 'workout']);
    expect(server.calls.filter(request => request.method === 'POST')).toHaveLength(2);
    expect(server.workouts.size).toBe(1); expect(server.schedules.size).toBe(1);
  });

  it.each(['edit', 'stop', 'expiry', 'lease'] as const)('retains an accepted workout when %s wins before schedule creation', async change => {
    const id = await send();
    server.afterHandle = async request => {
      if (request.method !== 'POST' || !request.path.includes('workout')) return;
      server.afterHandle = null;
      if (change === 'edit') await edit();
      if (change === 'stop') { await command('stop'); await drain(); }
      if (change === 'expiry') { pro = false; await mark(); await drain(); }
      if (change === 'lease') now += 180_001;
    };
    await processTrainingDelivery(runtime, uid, id);
    expect(server.workouts.size).toBe(1); expect(server.schedules.size).toBe(0);
    expect((await ledger()).actual?.ids.workout).toBe([...server.workouts.keys()][0]);
    await retry(id); await drain();
    if (change === 'expiry') {
      expect(server.schedules.size).toBe(0);
      pro = true; await mark(); await drain();
    }
    await retry(id); await drain(); await retry(id);
    expect((await ledger()).status).toBe(change === 'stop' ? 'stopped' : 'delivered');
    expect(server.workouts.size).toBe(change === 'stop' ? 0 : 1);
    expect(server.schedules.size).toBe(change === 'stop' ? 0 : 1);
    expect(server.calls.filter(request => request.method === 'POST' && request.path.includes('workout'))).toHaveLength(1);
  }, 30_000);

  it.each(['lookup', 'checkpoint', 'edit', 'stop'] as const)('retains scalar schedule acceptance across a %s interruption without duplicate creates', async fault => {
    const request = server.request;
    let persistence: ReturnType<typeof vi.spyOn> | undefined;
    server.request = async (...args) => {
      const result = await request(...args);
      if (args[0].method !== 'POST' || args[0].path !== '/training-api/schedule/') return result;
      if (fault === 'checkpoint') persistence = vi.spyOn(db, 'runTransaction').mockRejectedValueOnce(new Error('Synthetic persistence failure'));
      if (fault === 'edit') await edit();
      if (fault === 'stop') { await command('stop'); await drain(); }
      if (fault === 'lookup') server.beforeHandle = async candidate => {
        if (candidate.method === 'GET' && candidate.path.includes('/schedule/')) throw new GarminTrainingHttpError('retryable', false);
      };
      return { status: 200, body: (result.body as { scheduleId: string }).scheduleId };
    };
    const id = await send();
    await processTrainingDelivery(runtime, uid, id); persistence?.mockRestore();
    const interrupted = await ledger();
    expect(interrupted.status).not.toBe('delivered');
    if (fault === 'lookup' || fault === 'checkpoint') {
      expect(interrupted.attempt?.progress).toMatchObject({ step: 'schedule-create', state: 'started' });
    } else {
      // The already accepted old version can finish its read-only confirmation;
      // current intent stays pending and must be applied before claiming delivery.
      expect(interrupted.attempt).toBeNull(); expect(interrupted.status).toBe('pending');
    }
    expect(interrupted.actual?.ids.schedule).toBe(fault === 'checkpoint' ? undefined : [...server.schedules.keys()][0]);
    server.beforeHandle = null;
    for (let pass = 0; pass < 4; pass++) { await retry(id); await drain(); }
    expect((await ledger()).status).toBe(fault === 'stop' ? 'removed' : 'delivered');
    expect(server.workouts.size).toBe(fault === 'stop' ? 0 : 1);
    expect(server.schedules.size).toBe(fault === 'stop' ? 0 : 1);
    expect(server.calls.filter(candidate => candidate.method === 'POST')).toHaveLength(2);
    if (fault === 'lookup') expect(server.calls.some(candidate => candidate.path.includes('?'))).toBe(false);
    if (fault === 'edit') expect([...server.schedules.values()][0].date).toBe('2026-09-21');
  });

  it.each(['lost-response', 'lost-checkpoint'] as const)('never repeats an ambiguous first POST after %s, even on explicit Retry', async fault => {
    const id = await send(); let persistence: ReturnType<typeof vi.spyOn> | undefined;
    server.afterHandle = async request => {
      if (request.method !== 'POST') return;
      server.afterHandle = null;
      if (fault === 'lost-response') throw new GarminTrainingHttpError('uncertain', false);
      persistence = vi.spyOn(db, 'runTransaction').mockRejectedValueOnce(new Error('Synthetic persistence failure'));
    };
    await processTrainingDelivery(runtime, uid, id); persistence?.mockRestore();
    if (fault === 'lost-checkpoint') expect(logger.warn).toHaveBeenCalledWith('[TrainingDelivery]', {
      event: 'checkpoint_failed', provider: 'garmin', complete: false, checkpointState: 'accepted', persistenceCode: 'unknown',
    });
    else expect(logger.warn).not.toHaveBeenCalledWith('[TrainingDelivery]', expect.objectContaining({ event: 'checkpoint_failed' }));
    expect((await ledger()).attempt?.progress).toMatchObject({ step: 'workout-create', state: 'started' });
    await retry(id); expect((await ledger()).status).toBe('needs_attention');
    await command('retry'); await drain(); await retry(id);
    expect((await ledger()).status).toBe('needs_attention');
    expect(server.calls.filter(request => request.method === 'POST')).toHaveLength(1);
  });

  it('recovers a schedule accepted before a lost response through an exact workout/date lookup', async () => {
    const id = await send();
    server.afterHandle = async request => {
      if (request.method === 'POST' && request.path.includes('schedule')) {
        server.afterHandle = null; throw new GarminTrainingHttpError('uncertain', false);
      }
    };
    await processTrainingDelivery(runtime, uid, id); await retry(id);
    expect((await ledger()).status).toBe('delivered');
    expect(server.calls.filter(request => request.method === 'POST')).toHaveLength(2);
    expect(server.calls.some(request => request.path.includes('schedule?startDate=2026-09-20'))).toBe(true);
  });

  it('reconciles a revert after an intervening edit reached Garmin instead of trusting the old accepted digest', async () => {
    const original = (await user().collection('scheduledWorkouts').doc('w').get()).data()!;
    const id = await send(); await processTrainingDelivery(runtime, uid, id);
    const first = await ledger();
    await edit();
    server.afterHandle = async request => {
      if (request.method !== 'PUT' || !request.path.includes('workout')) return;
      server.afterHandle = null;
      await user().collection('scheduledWorkouts').doc('w').set({ ...original, revision: 3 });
      await user().collection('trainingPlanState').doc('current').update({ revision: 3 });
      await mark(); await drain();
    };
    await processTrainingDelivery(runtime, uid, id);
    expect(server.workouts.values().next().value?.workoutName).toBe('Revised run');
    const projection = await user().collection('trainingDeliveryStatuses').doc(id).get();
    expect(projection.data()?.differsFromQS).toBe(true);
    await retry(id); await drain(); await retry(id);
    expect((await ledger()).status).toBe('delivered');
    expect((await ledger()).actual?.ids).toEqual(first.actual?.ids);
    expect(server.workouts.values().next().value?.workoutName).toBe('Easy run');
    expect(server.schedules.values().next().value?.date).toBe(original.localDate);
    expect(server.calls.filter(request => request.method === 'POST')).toHaveLength(2);
  });

  it.each(['edit', 'retry', 'stop-resume'] as const)('does not bypass a provider Retry-After after %s', async action => {
    const id = await send();
    server.beforeHandle = async () => {
      server.beforeHandle = null; throw new GarminTrainingHttpError('retryable', true, 86_400_000);
    };
    await processTrainingDelivery(runtime, uid, id);
    const dueAt = (await ledger()).retryAtMs;
    const requests = server.calls.length;
    if (action === 'edit') await edit();
    else if (action === 'stop-resume') { await command('stop'); await drain(); await command('resume'); await drain(); }
    else { await command('retry'); await drain(); }
    await processTrainingDelivery(runtime, uid, id);
    expect(server.calls).toHaveLength(requests);
    expect(await ledger()).toMatchObject({ status: 'retrying', retryAtMs: dueAt });
    await retry(id); await drain(); await retry(id);
    expect((await ledger()).status).toBe('delivered');
    expect(server.workouts.size).toBe(1); expect(server.schedules.size).toBe(1);
  });

  it.each(['replacement', 'completed'] as const)('retains late acceptance after a %s lease without permitting another POST', async state => {
    const id = await send();
    server.afterHandle = async request => {
      if (request.method !== 'POST') return;
      server.afterHandle = null;
      await user().collection(DELIVERY_LEDGER).doc(id).update(state === 'completed' ? { lease: null, attempt: null }
        : { lease: { id: 'replacement-worker', expiresAtMs: now + 180_000 },
          'attempt.progress': { version: 1, step: 'schedule-create', state: 'started' } });
    };
    await processTrainingDelivery(runtime, uid, id);
    const current = await ledger();
    expect(current).toMatchObject({ status: 'needs_attention', lease: null,
      actual: { ids: { workout: [...server.workouts.keys()][0] } },
      attempt: { recoveryBlocked: true, progress: { step: state === 'completed' ? 'workout-create' : 'schedule-create', state: 'started' } } });
    const evidence = await user().collection(DELIVERY_LEDGER).doc(id).collection('attempts').doc(current.attempt!.id)
      .collection('lateAcceptances').get();
    expect(evidence.size).toBe(1);
    expect(evidence.docs[0].data().artifact.ids.workout).toBe([...server.workouts.keys()][0]);
    await command('retry'); await drain(); await retry(id);
    expect((await ledger()).status).toBe('needs_attention'); expect(server.calls).toHaveLength(1);
  });

  it.each(['running', 'strength'])('shows permission repair and resumes %s only after same-account reconnect', async sport => {
    if (sport === 'strength') await seedStrength();
    await credential().update({ permissions: ['ACTIVITY_EXPORT'] });
    const authority = await db.runTransaction(tx => runtime.connection(tx, uid, 'garmin'));
    expect(authority).toMatchObject({ state: 'connection_repair', issues: [expect.stringContaining('Garmin Training permission')] });
    await expect(command()).rejects.toMatchObject({ code: 'failed-precondition' });
    await credential().update({ permissions: ['WORKOUT_IMPORT'] });
    const id = await send();
    server.beforeHandle = async () => { server.beforeHandle = null; throw new GarminTrainingHttpError('permission', true); };
    await processTrainingDelivery(runtime, uid, id);
    expect(await ledger()).toMatchObject({ status: 'connection_repair', issues: [expect.stringContaining('Reconnect')] });
    await command('retry'); await drain(); await retry(id); expect(server.workouts.size).toBe(0);
    await user().collection('meta').doc(service.name).update({ connectionStateGeneration: 'connection-2' });
    await mark(); await drain(); await retry(id);
    expect((await ledger()).status).toBe('delivered');
  });

  it.each(['running', 'strength'])('invalidates %s consent after a different account reconnect or explicit disconnect', async sport => {
    if (sport === 'strength') await seedStrength();
    const id = await send(); await processTrainingDelivery(runtime, uid, id);
    const requests = server.calls.length;
    await credential().update({ userID: 'account-b' });
    await user().collection('meta').doc(service.name).update({ providerUserId: 'account-b', connectionStateGeneration: 'connection-2' });
    await mark(); await drain(); await processTrainingDelivery(runtime, uid, id);
    expect((await ledger()).status).toBe('fresh_consent_required');
    await db.runTransaction(async tx => stageTrainingDeliveryDisconnect(tx, db, uid, 'garmin'));
    await drain(); await processTrainingDelivery(runtime, uid, id);
    expect(server.calls).toHaveLength(requests); expect(server.workouts.size).toBe(1);
  });

  it.each(['running', 'strength'])('fences %s HTTP and recreation after deletion wins during acceptance', async sport => {
    if (sport === 'strength') await seedStrength();
    const id = await send();
    server.afterHandle = async () => {
      server.afterHandle = null;
      await db.collection('userDeletionTombstones').doc(uid).set({ deleting: true });
      await db.recursiveDelete(user());
    };
    await processTrainingDelivery(runtime, uid, id);
    expect(await ledger()).toBeUndefined();
    expect(server.calls).toHaveLength(1); expect(server.schedules.size).toBe(0);
    await processTrainingDelivery(runtime, uid, id);
    expect((await user().listCollections())).toEqual([]);
  });
});
