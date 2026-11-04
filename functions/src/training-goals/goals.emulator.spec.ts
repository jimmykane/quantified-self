import { randomUUID } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import { afterAll, describe, expect, it } from 'vitest';
import { ActivityTypes, DataDistance, DataDuration } from '@sports-alliance/sports-lib';
import { previewTrainingGoalChange, applyTrainingGoalChange, readTrainingGoals } from '../mcp/training-goals.service';
import { encodeOpaqueValue } from '../mcp/data.service';
import { GOAL_OUTPUTS } from '../mcp/training-goals.schemas';
import { readTrainingGoalsProgress } from './read';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('Calendar goals emulator', () => {
  if (process.env.FIRESTORE_EMULATOR_HOST && !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) throw Error('Loopback emulator required');
  const db = new Firestore({ projectId: 'demo-training-goals' });
  const users: string[] = [], now = Date.parse('2026-11-03T09:00Z');
  const scopes = ['training-plans:read', 'training-plans:write', 'metrics:read'];
  const goal = { name: 'Run three days', kind: 'ongoing', lifecycle: 'active', priority: 'normal', startLocalDate: '2026-11-01',
    targetLocalDate: null, sportScope: 'sport', sport: ActivityTypes.Running, objective: '', planRef: null, weeklyTarget: { kind: 'days', value: 3 } };
  async function setup() {
    const uid = `goal-${randomUUID()}`, user = db.collection('users').doc(uid); users.push(uid);
    await user.set({});
    await user.collection('mcpConnections').doc('connection').set({ status: 'active', scopes, grantId: 'one', createdAtMs: 1 });
    await user.collection('trainingPlanState').doc('current').set({ schemaVersion: 1, revision: 7, activePlanId: null, currentWorkoutCount: 0, updatedAtMs: now });
    const deps = { db, now: () => now, randomId: randomUUID };
    const input = (args: unknown, connectionId = 'connection') => ({ uid, connectionId, scopes, arguments: args });
    return { uid, user, deps, input };
  }
  afterAll(async () => { for (const uid of users) await db.recursiveDelete(db.collection('users').doc(uid)); await db.terminate(); });
  it('previews without saving, applies once, reads progress and preserves the schedule revision', async () => {
    const { uid, user, deps, input } = await setup();
    const preview = await previewTrainingGoalChange(input({ goalRef: null, expectedRevision: 0, goal }), deps);
    expect((await user.collection('trainingGoals').get()).empty).toBe(true);
    expect(preview.goalReview.after).toMatchObject({ name: goal.name, weeklyTarget: goal.weeklyTarget });
    const result = await applyTrainingGoalChange(input({ proposalRef: preview.proposalRef }), deps);
    expect(await applyTrainingGoalChange(input({ proposalRef: preview.proposalRef }), deps)).toEqual(result);
    expect((await user.collection('trainingGoals').get()).size).toBe(1);
    expect((await user.collection('trainingPlanState').doc('current').get()).get('revision')).toBe(7);
    const list = GOAL_OUTPUTS.list_training_goals.parse(await readTrainingGoals({ ...input({}), tool: 'list_training_goals' }, deps));
    expect(list.goals).toEqual([{ ...result.goal, goalRef: expect.any(String) }]);
    const detail = GOAL_OUTPUTS.get_training_goal.parse(await readTrainingGoals({ ...input({ goalRef: list.goals[0].goalRef }), tool: 'get_training_goal' }, deps));
    expect(detail.goal).toEqual({ ...result.goal, goalRef: expect.any(String) });
    const batch = db.batch();
    for (const id of ['one', 'two']) {
      batch.set(user.collection('events').doc(id), { private: 'PRIVATE-CANARY' });
      batch.set(user.collection('activities').doc(id), { eventID: id, eventStartDate: new Date('2026-11-02T08:00Z'),
        type: ActivityTypes.Running, stats: { [DataDistance.type]: 5000, [DataDuration.type]: 1800 }, location: 'PRIVATE-CANARY' });
    }
    await batch.commit();
    const progress = await readTrainingGoalsProgress(uid, { localDate: '2026-11-03', timeZone: 'Europe/Athens' }, db);
    expect(progress.progress[0]).toMatchObject({ value: 1, complete: true });
    const publicProgress = await readTrainingGoals({ ...input({ localDate: '2026-11-03', timeZone: 'Europe/Athens', goalRefs: [result.goal.goalRef] }), tool: 'get_training_goals_progress' }, deps);
    expect(JSON.stringify(publicProgress)).not.toMatch(/PRIVATE-CANARY|recordingId|activityId|goalId/);
  }, 30000);
  it('rejects stale proposals, expiry, grant replacement and cross-account replay', async () => {
    const { user, deps, input } = await setup();
    const first = await previewTrainingGoalChange(input({ goalRef: null, expectedRevision: 0, goal }), deps);
    const saved = await applyTrainingGoalChange(input({ proposalRef: first.proposalRef }), deps);
    const edit = { goalRef: saved.goal.goalRef, expectedRevision: 1, goal: { ...goal, lifecycle: 'paused' } };
    const a = await previewTrainingGoalChange(input(edit), deps), b = await previewTrainingGoalChange(input(edit), deps);
    await applyTrainingGoalChange(input({ proposalRef: a.proposalRef }), deps);
    await expect(applyTrainingGoalChange(input({ proposalRef: b.proposalRef }), deps)).rejects.toThrow('changed');
    const newGoal = await previewTrainingGoalChange(input({ goalRef: null, expectedRevision: 0, goal }), deps);
    await expect(applyTrainingGoalChange(input({ proposalRef: newGoal.proposalRef }), { ...deps, now: () => now + 16 * 60000 })).rejects.toThrow('expired');
    const other = await setup();
    await expect(applyTrainingGoalChange(other.input({ proposalRef: newGoal.proposalRef }), other.deps)).rejects.toThrow();
    await user.collection('mcpConnections').doc('connection').update({ grantId: 'replacement' });
    await expect(applyTrainingGoalChange(input({ proposalRef: newGoal.proposalRef }), deps)).rejects.toThrow('grant');
  }, 30000);
  it('exposes weekly progress through MCP only once the goal has started', async () => {
    const { deps, input } = await setup();
    const preview = await previewTrainingGoalChange(input({ goalRef: null, expectedRevision: 0,
      goal: { ...goal, startLocalDate: '2026-11-05' } }), deps);
    const saved = await applyTrainingGoalChange(input({ proposalRef: preview.proposalRef }), deps);
    const progress = async (localDate: string) => GOAL_OUTPUTS.get_training_goals_progress.parse(await readTrainingGoals({
      ...input({ localDate, timeZone: 'Europe/Athens', goalRefs: [saved.goal.goalRef] }), tool: 'get_training_goals_progress',
    }, deps));
    expect(await progress('2026-11-03')).toMatchObject({ complete: true, progress: [] });
    expect((await progress('2026-11-05')).progress).toEqual([
      expect.objectContaining({ startLocalDate: '2026-11-05', partialWeek: true, value: 0, target: 3, complete: true }),
    ]);
  }, 30000);
  it('requires the current Assistant proposal and conversation generation before Apply', async () => {
    const { user, deps, input } = await setup();
    const connection = 'first-party-assistant-v1:conversation';
    const conversation = user.collection('assistantConversations').doc('active');
    await conversation.set({ conversationId: 'conversation', trainingPlansEnabled: true, trainingPlanChangesEnabled: true });
    const preview = await previewTrainingGoalChange(input({ goalRef: null, expectedRevision: 0, goal }, connection), deps);
    await expect(applyTrainingGoalChange(input({ proposalRef: preview.proposalRef }, connection), deps)).rejects.toThrow('no longer current');
    await conversation.update({ pendingTrainingProposal: preview });
    expect((await applyTrainingGoalChange(input({ proposalRef: preview.proposalRef }, connection), deps)).status).toBe('applied');
    await conversation.update({ conversationId: 'new-chat' });
    await expect(applyTrainingGoalChange(input({ proposalRef: preview.proposalRef }, connection), deps)).rejects.toThrow('permissions');
  }, 30000);
  it('rejects replaced plan links after preview and preserves unavailable existing links', async () => {
    const { uid, user, deps, input } = await setup();
    const plan = user.collection('trainingPlans').doc('plan'); await plan.set({ name: 'Base', createdAtMs: 1 });
    const planRef = encodeOpaqueValue('training_read', { kind: 'plan', id: 'plan', createdAtMs: 1 }, uid, 'connection');
    const preview = await previewTrainingGoalChange(input({ goalRef: null, expectedRevision: 0, goal: { ...goal, planRef } }), deps);
    await plan.set({ name: 'Recreated', createdAtMs: 2 });
    await expect(applyTrainingGoalChange(input({ proposalRef: preview.proposalRef }), deps)).rejects.toThrow('plan changed');
    await plan.set({ name: 'Base', createdAtMs: 1 });
    const saved = await applyTrainingGoalChange(input({ proposalRef: preview.proposalRef }), deps);
    await plan.delete();
    const current = GOAL_OUTPUTS.get_training_goal.parse(await readTrainingGoals({ ...input({ goalRef: saved.goal.goalRef }), tool: 'get_training_goal' }, deps));
    expect(current.goal.linkedPlanAvailable).toBe(false);
    const edit = await previewTrainingGoalChange(input({ goalRef: current.goal.goalRef, expectedRevision: 1,
      goal: { ...goal, lifecycle: 'paused', planRef: current.goal.planRef } }), deps);
    expect((await applyTrainingGoalChange(input({ proposalRef: edit.proposalRef }), deps)).goal).toMatchObject({ lifecycle: 'paused', linkedPlanAvailable: false });
  }, 30000);
  it('paginates mixed-case identifiers without skipping or repeating goals and rejects stale cursors', async () => {
    const { user, deps, input } = await setup();
    const { planRef: _plan, ...fields } = goal;
    const ids = Array.from({ length: 30 }, (_, i) => `${i % 2 ? 'a' : 'Z'}${String(i).padStart(2, '0')}`);
    const batch = db.batch();
    for (const id of ids) batch.set(user.collection('trainingGoals').doc(id), { ...fields, planId: null, schemaVersion: 1, id, name: id, revision: 1, createdAtMs: 1, updatedAtMs: 1 });
    batch.set(user.collection('trainingGoalState').doc('current'), { revision: 30, goalCount: 30 }); await batch.commit();
    const first = GOAL_OUTPUTS.list_training_goals.parse(await readTrainingGoals({ ...input({}), tool: 'list_training_goals' }, deps));
    const second = GOAL_OUTPUTS.list_training_goals.parse(await readTrainingGoals({ ...input({ cursor: first.nextCursor }), tool: 'list_training_goals' }, deps));
    expect([...first.goals, ...second.goals].map(goal => goal.name)).toEqual(ids.sort()); expect(second.nextCursor).toBeNull();
    await user.collection('trainingGoalState').doc('current').update({ revision: 31 });
    await expect(readTrainingGoals({ ...input({ cursor: first.nextCursor }), tool: 'list_training_goals' }, deps)).rejects.toThrow('Restart');
  }, 30000);
  it('requires metrics permission for progress and denies writes during account deletion', async () => {
    const { uid, deps, input } = await setup();
    await expect(readTrainingGoals({ ...input({}), scopes: ['training-plans:read'], tool: 'get_training_goals_progress' }, deps)).rejects.toThrow('permission');
    await db.doc(`userDeletionTombstones/${uid}`).set({});
    await expect(previewTrainingGoalChange(input({ goalRef: null, expectedRevision: 0, goal }), deps)).rejects.toThrow('deleted');
    // This tombstone is emulator-only and belongs to this test's unique synthetic user.
    await db.doc(`userDeletionTombstones/${uid}`).delete();
  }, 30000);
});
