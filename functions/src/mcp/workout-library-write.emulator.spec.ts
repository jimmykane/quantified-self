import { randomUUID } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { afterAll, describe, expect, it } from 'vitest';
import { decodeOpaqueValue, encodeOpaqueValue } from './data.service';
import { mutateTrainingScheduleForUser } from '../training-plans/persistence';
import { TRAINING_PLANS_SCOPE, TRAINING_PLANS_WRITE_SCOPE } from './training-plans.schemas';
import { applySavedWorkoutChange, previewSavedWorkoutChange } from './workout-library-write.service';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('MCP workout library proposals', { timeout: 120_000 }, () => {
  if (process.env.FIRESTORE_EMULATOR_HOST
    && !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) {
    throw new Error('A loopback Firestore emulator is required.');
  }
  const db = new Firestore({ projectId: 'demo-mcp-workout-library' });
  const users: string[] = [];
  const nowMs = Date.parse('2026-10-01T08:00:00Z');
  const scopes = [TRAINING_PLANS_SCOPE, TRAINING_PLANS_WRITE_SCOPE];
  const structure = { version: 1 as const, sport: ActivityTypes.Running, nodes: [{ kind: 'step' as const,
    id: 'easy', purpose: 'work' as const, ending: { kind: 'time' as const, seconds: 1800 }, targets: [] }] };

  async function setup() {
    const uid = `mcp-library-${randomUUID()}`;
    users.push(uid);
    const user = db.collection('users').doc(uid);
    await user.set({ test: true });
    await user.collection('trainingPlanState').doc('current').set({ schemaVersion: 1, revision: 0,
      activePlanId: null, currentWorkoutCount: 0, updatedAtMs: nowMs });
    await user.collection('mcpConnections').doc('connection').set({ status: 'active', scopes,
      grantId: 'grant-1', createdAtMs: 1, revokedAtMs: null });
    let sequence = 0;
    const deps = { db, now: () => nowMs, randomId: () => `id-${++sequence}` };
    const input = (argumentsValue: unknown, connectionId = 'connection') => ({ uid, connectionId,
      scopes, arguments: argumentsValue });
    return { uid, user, deps, input };
  }

  afterAll(async () => {
    for (const uid of users) await db.recursiveDelete(db.collection('users').doc(uid));
    await db.terminate();
  });

  it('previews, applies and replays a create without schedule or provider consent', async () => {
    const { uid, user, deps, input } = await setup();
    await expect(previewSavedWorkoutChange(input(undefined), deps)).rejects.toThrow('valid saved-workout change');
    const preview = await previewSavedWorkoutChange(input({ expectedScheduleRevision: 0,
      expectedLibraryRevision: 0, change: { kind: 'create', title: 'Easy run', structure } }), deps);
    expect(preview.providerPreviews).toEqual([]);
    expect((await user.collection('workoutLibrary').get()).empty).toBe(true);
    const applied = await applySavedWorkoutChange(input({ proposalRef: preview.proposalRef,
      permissionMode: 'schedule' }), deps);
    expect(applied).toMatchObject({ kind: 'create', libraryRevision: 1, scheduleRevision: 0,
      workoutRefs: [] });
    expect(applied.savedWorkoutRef).toBeTruthy();
    expect(await applySavedWorkoutChange(input({ proposalRef: preview.proposalRef,
      permissionMode: 'schedule' }), deps)).toEqual(applied);
    const decoded = decodeOpaqueValue('training_read', applied.savedWorkoutRef!, uid, 'connection', 'Saved workout');
    expect((await user.collection('workoutLibrary').doc(decoded.id as string).get()).get('title')).toBe('Easy run');
    expect((await user.collection('workoutLibrary').get()).size).toBe(1);
    expect((await user.collection('scheduledWorkouts').get()).empty).toBe(true);
    expect((await user.collection('trainingDeliverySettings').get()).empty).toBe(true);
  });

  it('fails closed if private proposal authority or request data is incomplete', async () => {
    const { uid, user, deps, input } = await setup();
    const preview = await previewSavedWorkoutChange(input({ expectedScheduleRevision: 0,
      expectedLibraryRevision: 0, change: { kind: 'create', title: 'Easy run', structure } }), deps);
    const proposalId = decodeOpaqueValue('training_proposal', preview.proposalRef,
      uid, 'connection', 'Proposal').id as string;
    const proposalDoc = user.collection('trainingMcpLibraryProposals').doc(proposalId);
    const original = (await proposalDoc.get()).data()!;
    await proposalDoc.update({ accessGeneration: null });
    await expect(applySavedWorkoutChange(input({ proposalRef: preview.proposalRef,
      permissionMode: 'schedule' }), deps)).rejects.toThrow('unavailable');
    await proposalDoc.update({ accessGeneration: original.accessGeneration, request: { malformed: true } });
    await expect(applySavedWorkoutChange(input({ proposalRef: preview.proposalRef,
      permissionMode: 'schedule' }), deps)).rejects.toThrow('invalid');
    await proposalDoc.update({ request: { ...original.request, mutationId: 'mcp-other-proposal' } });
    await expect(applySavedWorkoutChange(input({ proposalRef: preview.proposalRef,
      permissionMode: 'schedule' }), deps)).rejects.toThrow('invalid');
    expect((await user.collection('workoutLibrary').get()).empty).toBe(true);
  });

  it('atomically places independent copies and rejects stale, revoked or foreign authority', async () => {
    const { uid, user, deps, input } = await setup();
    const create = await previewSavedWorkoutChange(input({ expectedScheduleRevision: 0,
      expectedLibraryRevision: 0, change: { kind: 'create', title: 'Easy run', structure } }), deps);
    const saved = await applySavedWorkoutChange(input({ proposalRef: create.proposalRef,
      permissionMode: 'schedule' }), deps);
    const placement = await previewSavedWorkoutChange(input({ expectedScheduleRevision: 0,
      expectedLibraryRevision: 1, change: { kind: 'place', savedWorkoutRef: saved.savedWorkoutRef,
        expectedRevision: 1, planRef: null, expectedPlanRevision: null,
        dates: ['2026-10-02', '2026-10-09'], confirmPlanRangeExtension: false } }), deps);
    await expect(applySavedWorkoutChange(input({ proposalRef: placement.proposalRef,
      permissionMode: 'schedule' }, 'other-connection'), deps)).rejects.toThrow();
    await user.collection('mcpConnections').doc('connection').update({ scopes: [TRAINING_PLANS_SCOPE] });
    await expect(applySavedWorkoutChange(input({ proposalRef: placement.proposalRef,
      permissionMode: 'schedule' }), deps)).rejects.toThrow();
    await user.collection('mcpConnections').doc('connection').update({ scopes,
      grantId: 'grant-2' });
    await expect(applySavedWorkoutChange(input({ proposalRef: placement.proposalRef,
      permissionMode: 'schedule' }), deps)).rejects.toThrow();
    expect((await user.collection('scheduledWorkouts').get()).empty).toBe(true);
    const fresh = await previewSavedWorkoutChange(input({ expectedScheduleRevision: 0,
      expectedLibraryRevision: 1, change: { kind: 'place', savedWorkoutRef: saved.savedWorkoutRef,
        expectedRevision: 1, planRef: null, expectedPlanRevision: null,
        dates: ['2026-10-02', '2026-10-09'], confirmPlanRangeExtension: false } }), deps);
    expect(fresh.changes[0].summary).toContain('2026-10-02, 2026-10-09');
    const result = await applySavedWorkoutChange(input({ proposalRef: fresh.proposalRef,
      permissionMode: 'schedule' }), deps);
    expect(result.workoutRefs).toHaveLength(2);
    expect(result.scheduleRevision).toBe(1);
    const replay = await applySavedWorkoutChange(input({ proposalRef: fresh.proposalRef,
      permissionMode: 'schedule' }), deps);
    expect(replay).toEqual(result);
    const workouts = await user.collection('scheduledWorkouts').get();
    expect(workouts.size).toBe(2);
    expect(workouts.docs.map(doc => doc.get('templateOrigin'))).toEqual([
      expect.objectContaining({ revision: 1 }), expect.objectContaining({ revision: 1 }),
    ]);
    expect(workouts.docs.every(doc => doc.get('completion') === undefined)).toBe(true);
    expect((await user.collection('trainingDeliverySettings').get()).empty).toBe(true);
    const hundredDates = Array.from({ length: 100 }, (_, index) =>
      new Date(nowMs + (index + 1) * 86_400_000).toISOString().slice(0, 10));
    const largePreview = await previewSavedWorkoutChange(input({ expectedScheduleRevision: 1,
      expectedLibraryRevision: 1, change: { kind: 'place', savedWorkoutRef: saved.savedWorkoutRef,
        expectedRevision: 1, planRef: null, expectedPlanRevision: null,
        dates: hundredDates, confirmPlanRangeExtension: false } }), deps);
    expect(largePreview.changes).toHaveLength(5);
    const disclosedDates = largePreview.changes.map(change => change.summary).join(', ');
    for (const date of hundredDates) expect(disclosedDates).toContain(date);
    await expect(previewSavedWorkoutChange(input({ expectedScheduleRevision: 0,
      expectedLibraryRevision: 1, change: { kind: 'copy', savedWorkoutRef: saved.savedWorkoutRef,
        expectedRevision: 1 } }), deps)).rejects.toThrow('changed');
    const anotherUid = `mcp-library-${randomUUID()}`;
    users.push(anotherUid);
    await db.collection('users').doc(anotherUid).set({ test: true });
    expect(() => decodeOpaqueValue('training_read', saved.savedWorkoutRef!, anotherUid,
      'connection', 'Saved workout')).toThrow();
    expect(encodeOpaqueValue('training_read', { kind: 'saved-workout', id: 'other', createdAtMs: 1 },
      uid, 'other-connection')).not.toEqual(saved.savedWorkoutRef);
  });

  it('keeps copy, edit, archive, restore and confirmed deletion revision-bound', async () => {
    const { user, deps, input } = await setup();
    const run = async (libraryRevision: number, change: Record<string, unknown>) => {
      const preview = await previewSavedWorkoutChange(input({ expectedScheduleRevision: 0,
        expectedLibraryRevision: libraryRevision, change }), deps);
      return applySavedWorkoutChange(input({ proposalRef: preview.proposalRef, permissionMode: 'schedule' }), deps);
    };
    const created = await run(0, { kind: 'create', title: 'First', structure });
    const copied = await run(1, { kind: 'copy', savedWorkoutRef: created.savedWorkoutRef, expectedRevision: 1 });
    expect(copied.savedWorkoutRef).not.toBe(created.savedWorkoutRef);
    const edited = await run(2, { kind: 'update', savedWorkoutRef: copied.savedWorkoutRef,
      expectedRevision: 1, title: 'Edited copy', structure });
    expect(edited.libraryRevision).toBe(3);
    const archived = await run(3, { kind: 'set-status', savedWorkoutRef: copied.savedWorkoutRef,
      expectedRevision: 2, status: 'archived' });
    expect(archived.kind).toBe('set-status');
    await expect(previewSavedWorkoutChange(input({ expectedScheduleRevision: 0,
      expectedLibraryRevision: 4, change: { kind: 'place', savedWorkoutRef: copied.savedWorkoutRef,
        expectedRevision: 3, planRef: null, expectedPlanRevision: null,
        dates: ['2026-10-02'], confirmPlanRangeExtension: false } }), deps)).rejects.toThrow('Archived');
    await run(4, { kind: 'set-status', savedWorkoutRef: copied.savedWorkoutRef,
      expectedRevision: 3, status: 'active' });
    const deletePreview = await previewSavedWorkoutChange(input({ expectedScheduleRevision: 0,
      expectedLibraryRevision: 5, change: { kind: 'delete', savedWorkoutRef: copied.savedWorkoutRef,
        expectedRevision: 4, confirmDeletion: true } }), deps);
    expect(deletePreview.summary).toContain('Permanently remove');
    const deleted = await applySavedWorkoutChange(input({ proposalRef: deletePreview.proposalRef,
      permissionMode: 'schedule' }), deps);
    expect(deleted.savedWorkoutRef).toBeNull();
    expect((await user.collection('workoutLibrary').get()).size).toBe(1);
    expect((await user.collection('trainingPlanState').doc('current').collection('workoutLibraryTombstones').get()).size)
      .toBe(1);
    expect((await user.collection('scheduledWorkouts').get()).empty).toBe(true);
  });

  it('requires explicit plan-range extension and protects a saved source workout revision', async () => {
    const { uid, user, deps, input } = await setup();
    await mutateTrainingScheduleForUser(uid, { mutationId: 'create-plan', expectedRevisions: [
      { scope: 'state', id: 'current', revision: 0 },
    ], operation: { kind: 'create-plan', planId: 'plan-one', name: 'Autumn',
      startLocalDate: '2026-10-01', endLocalDate: '2026-10-07', activate: true } }, { db, nowMs });
    const created = await previewSavedWorkoutChange(input({ expectedScheduleRevision: 1,
      expectedLibraryRevision: 0, change: { kind: 'create', title: 'Easy run', structure } }), deps);
    const saved = await applySavedWorkoutChange(input({ proposalRef: created.proposalRef,
      permissionMode: 'schedule' }), deps);
    const planRef = encodeOpaqueValue('training_read', { kind: 'plan', id: 'plan-one', createdAtMs: nowMs },
      uid, 'connection');
    const change = { kind: 'place', savedWorkoutRef: saved.savedWorkoutRef, expectedRevision: 1,
      planRef, expectedPlanRevision: 1, dates: ['2026-10-02', '2026-10-09'] };
    await expect(previewSavedWorkoutChange(input({ expectedScheduleRevision: 1,
      expectedLibraryRevision: 1, change: { ...change, confirmPlanRangeExtension: false } }), deps))
      .rejects.toThrow('extend');
    const preview = await previewSavedWorkoutChange(input({ expectedScheduleRevision: 1,
      expectedLibraryRevision: 1, change: { ...change, confirmPlanRangeExtension: true } }), deps);
    expect(preview.summary).toContain('2 explicit dates');
    const applied = await applySavedWorkoutChange(input({ proposalRef: preview.proposalRef,
      permissionMode: 'schedule' }), deps);
    expect(applied.workoutRefs).toHaveLength(2);
    expect((await user.collection('trainingPlans').doc('plan-one').get()).get('endLocalDate')).toBe('2026-10-09');
    expect((await user.collection('trainingDeliverySettings').get()).empty).toBe(true);
    expect((await user.collection('events').get()).empty).toBe(true);
  });

  it('saves an exact scheduled workout snapshot and rejects expired or changed proposals', async () => {
    const { uid, user, deps, input } = await setup();
    await mutateTrainingScheduleForUser(uid, { mutationId: 'source-workout', expectedRevisions: [
      { scope: 'state', id: 'current', revision: 0 },
    ], operation: { kind: 'create-workout', workoutId: 'source-one', planId: null,
      localDate: '2026-10-02', title: 'Source run', structure,
      confirmPlanRangeExtension: false } }, { db, nowMs });
    const sourceRef = encodeOpaqueValue('training_read', { kind: 'workout', id: 'source-one', createdAtMs: nowMs },
      uid, 'connection');
    const proposal = await previewSavedWorkoutChange(input({ expectedScheduleRevision: 1,
      expectedLibraryRevision: 0, change: { kind: 'save-workout', workoutRef: sourceRef,
        expectedWorkoutRevision: 1 } }), deps);
    await expect(applySavedWorkoutChange(input({ proposalRef: proposal.proposalRef,
      permissionMode: 'schedule' }), { ...deps, now: () => nowMs + 16 * 60_000 }))
      .rejects.toThrow('expired');
    const fresh = await previewSavedWorkoutChange(input({ expectedScheduleRevision: 1,
      expectedLibraryRevision: 0, change: { kind: 'save-workout', workoutRef: sourceRef,
        expectedWorkoutRevision: 1 } }), deps);
    const result = await applySavedWorkoutChange(input({ proposalRef: fresh.proposalRef,
      permissionMode: 'schedule' }), deps);
    const savedId = decodeOpaqueValue('training_read', result.savedWorkoutRef!, uid, 'connection', 'Saved').id;
    const saved = (await user.collection('workoutLibrary').doc(savedId as string).get()).data();
    expect(saved).toMatchObject({ title: 'Source run', structure, revision: 1 });
    expect(saved).not.toHaveProperty('completion');
    expect((await user.collection('scheduledWorkouts').get()).size).toBe(1);
    await expect(previewSavedWorkoutChange(input({ expectedScheduleRevision: 1,
      expectedLibraryRevision: 0, change: { kind: 'copy', savedWorkoutRef: result.savedWorkoutRef,
        expectedRevision: 1 } }), deps)).rejects.toThrow('changed');
  });

  it('rejects library and schedule capacity before asking for approval', async () => {
    const { user, deps, input } = await setup();
    const library = user.collection('workoutLibrary');
    const batch = db.batch();
    for (let index = 0; index < 200; index += 1) batch.set(library.doc(`entry-${index}`), { test: true });
    await batch.commit();
    await expect(previewSavedWorkoutChange(input({ expectedScheduleRevision: 0,
      expectedLibraryRevision: 0, change: { kind: 'create', title: 'Too many', structure } }), deps))
      .rejects.toThrow('library is full');
    await library.doc('entry-199').delete();
    const capacityRace = await previewSavedWorkoutChange(input({ expectedScheduleRevision: 0,
      expectedLibraryRevision: 0, change: { kind: 'create', title: 'Last spot', structure } }), deps);
    await library.doc('entry-199').set({ test: true });
    await expect(applySavedWorkoutChange(input({ proposalRef: capacityRace.proposalRef,
      permissionMode: 'schedule' }), deps)).rejects.toThrow('current library or schedule limit');
    await user.collection('trainingPlanState').doc('current').update({ currentWorkoutCount: 400 });
    const savedRef = encodeOpaqueValue('training_read', { kind: 'saved-workout', id: 'entry-0',
      createdAtMs: nowMs }, (await user.get()).id, 'connection');
    await expect(previewSavedWorkoutChange(input({ expectedScheduleRevision: 0,
      expectedLibraryRevision: 0, change: { kind: 'place', savedWorkoutRef: savedRef,
        expectedRevision: 1, planRef: null, expectedPlanRevision: null,
        dates: ['2026-10-02'], confirmPlanRangeExtension: false } }), deps))
      .rejects.toThrow('400-workout');
  });
  it('preserves true and false settings through saved creation, independent placement and explicit removal', async () => {
    const { uid, user, deps, input } = await setup();
    const early = { ...structure, nodes: [{ kind: 'repeat', id: 'repeat', count: 2, steps: [
      { ...structure.nodes[0], ending: { kind: 'time', seconds: 90.123, allowEarlyLap: true } },
      { ...structure.nodes[0], id: 'distance', ending: { kind: 'distance', meters: 400.125, allowEarlyLap: false } },
    ] }] };
    const preview = await previewSavedWorkoutChange(input({ expectedScheduleRevision: 0, expectedLibraryRevision: 0,
      change: { kind: 'create', title: 'Early Lap', structure: early } }), deps, 'v2');
    expect(preview.changes[0].summary).toContain('Early Lap: enabled on 1');
    const saved = await applySavedWorkoutChange(input({ proposalRef: preview.proposalRef, permissionMode: 'schedule' }), deps);
    const id = decodeOpaqueValue('training_read', saved.savedWorkoutRef!, uid, 'connection', 'Saved workout').id as string;
    expect((await user.collection('workoutLibrary').doc(id).get()).get('structure')).toEqual(early);
    const placement = await previewSavedWorkoutChange(input({ expectedScheduleRevision: 0, expectedLibraryRevision: 1,
      change: { kind: 'place', savedWorkoutRef: saved.savedWorkoutRef, expectedRevision: 1, planRef: null,
        expectedPlanRevision: null, dates: ['2026-10-02', '2026-10-09'], confirmPlanRangeExtension: false } }), deps, 'v2');
    const placed = await applySavedWorkoutChange(input({ proposalRef: placement.proposalRef, permissionMode: 'schedule' }), deps);
    for (const doc of (await user.collection('scheduledWorkouts').get()).docs) expect(doc.get('structure')).toEqual(early);
    const args = { expectedScheduleRevision: placed.scheduleRevision, expectedLibraryRevision: 1,
      change: { kind: 'update', savedWorkoutRef: saved.savedWorkoutRef, expectedRevision: 1, title: 'Numeric only', structure } };
    await expect(previewSavedWorkoutChange(input(args), deps)).rejects.toThrow('v2');
    const removal = await previewSavedWorkoutChange(input(args), deps, 'v2');
    expect(removal.changes[0].summary).toContain('Removed from 1 previously enabled step');
    await applySavedWorkoutChange(input({ proposalRef: removal.proposalRef, permissionMode: 'schedule' }), deps);
    expect((await user.collection('workoutLibrary').doc(id).get()).get('structure')).toEqual(structure);
    for (const doc of (await user.collection('scheduledWorkouts').get()).docs) expect(doc.get('structure')).toEqual(early);
    expect((await user.collection('trainingDeliverySettings').get()).empty).toBe(true);
  });

});
