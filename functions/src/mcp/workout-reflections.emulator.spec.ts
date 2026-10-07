import { randomUUID } from 'node:crypto';
import { Firestore, Timestamp } from 'firebase-admin/firestore';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { runMcpWorkoutReflection } from './workout-reflections.service';
import type { McpContentWriteInput } from './content-write.service';
const host = process.env.FIRESTORE_EMULATOR_HOST;
if (host && !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('Loopback emulator required.');
describe.skipIf(!host)('Private reflection transactions in Firestore', () => {
  const db = new Firestore({ projectId: 'demo-workout-reflections' });
  const users: string[] = [];
  const scopes = ['activity-details:read', 'workout-reflections:read', 'workout-reflections:write'];
  const now = () => Date.parse('2026-10-06T12:00:00Z');
  let uid: string;
  const codec = { decodeActivityRef: (value: string, owner: string, connection: string) => {
    if (value !== `opaque:${owner}:${connection}`) throw new Error();
    return { eventId: 'event', activityId: 'activity' };
  } };
  const input = (arguments_: unknown, overrides: Partial<McpContentWriteInput> = {}): McpContentWriteInput => ({
    uid, connectionId: 'connection', grantId: 'grant', scopes, arguments: arguments_, ...overrides,
  });
  const args = () => ({ activityRef: `opaque:${uid}:connection`, target: 'activity', expectedRevision: 0,
    mutationId: randomUUID(), note: 'reported context' });
  beforeEach(async () => {
    uid = `reflection-${randomUUID()}`; users.push(uid);
    const root = db.doc(`users/${uid}`);
    await root.set({ test: true });
    await root.collection('events').doc('event').set({ privacy: 'public', provider: 'private-canary', description: 'different text', stats: { RPE: 5 } });
    await root.collection('activities').doc('activity').set({ eventID: 'event', sourceKey: 'private-canary' });
    await root.collection('mcpConnections').doc('connection').set({ scopes, grantId: 'grant', status: 'active', createdAtMs: 1 });
  });
  afterAll(async () => { for (const owner of users) { await db.recursiveDelete(db.doc(`users/${owner}`)); await db.doc(`userDeletionTombstones/${owner}`).delete(); } await db.terminate(); });
  it('round-trips only authored fields, separates target scope, retries and fences stale edits', async () => {
    const change = args(); const deps = { db, now };
    const result = await runMcpWorkoutReflection('save_workout_reflection', input(change), codec, deps);
    expect(result).toMatchObject({ note: 'reported context', revision: 1 });
    expect(result).not.toHaveProperty('effort'); expect(result).not.toHaveProperty('effortScale');
    const saved = (await db.doc(`users/${uid}/events/event/workoutReflections/activity_activity`).get()).data();
    expect(saved).not.toHaveProperty('effort');
    expect((await db.doc(`users/${uid}/events/event`).get()).data()?.stats).toEqual({ RPE: 5 });
    expect(JSON.stringify(result)).not.toMatch(/private-canary|eventId|activityId|mutationId/);
    expect(await runMcpWorkoutReflection('save_workout_reflection', input(change), codec, deps)).toMatchObject({ changed: false });
    await expect(runMcpWorkoutReflection('save_workout_reflection', input({ ...change, mutationId: randomUUID() }), codec, deps)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(await runMcpWorkoutReflection('get_workout_reflection', input({ activityRef: change.activityRef, target: 'recording' }), codec, deps))
      .toMatchObject({ present: false, revision: 0, note: null });
    const removal = { activityRef: change.activityRef, target: 'activity', expectedRevision: 1, mutationId: randomUUID() };
    await runMcpWorkoutReflection('delete_workout_reflection', input(removal), codec, deps);
    expect(await runMcpWorkoutReflection('delete_workout_reflection', input(removal), codec, deps)).toMatchObject({ revision: 2, deleted: true });
    await expect(runMcpWorkoutReflection('delete_workout_reflection', input({ ...removal, expectedRevision: 2, mutationId: randomUUID() }), codec, deps)).rejects.toMatchObject({ code: 'invalid_request' });
    const stored = (await db.doc(`users/${uid}/events/event/workoutReflections/activity_activity`).get()).data();
    expect(stored).toMatchObject({ deleted: true, note: null, revision: 2 });
    await expect(runMcpWorkoutReflection('save_workout_reflection', input(change), codec, deps)).rejects.toMatchObject({ code: 'invalid_request' });
  });
  it('rejects a second RPE field and excludes undeclared stored fields from reads', async () => {
    const change = args(); const deps = { db, now };
    await expect(runMcpWorkoutReflection('save_workout_reflection', input({ ...change, effort: 5 }), codec, deps))
      .rejects.toMatchObject({ code: 'invalid_request' });
    const ref = db.doc(`users/${uid}/events/event/workoutReflections/activity_activity`);
    expect((await ref.get()).exists).toBe(false);
    await ref.set({ schemaVersion: 1, revision: 1, deleted: false, mutationId: randomUUID(),
      note: 'private note', effort: 5, effortScale: 'private-canary', provider: 'private-canary' });
    const result = await runMcpWorkoutReflection('get_workout_reflection',
      input({ activityRef: change.activityRef, target: 'activity' }), codec, deps);
    expect(result).toEqual({ activityRef: change.activityRef, target: 'activity', revision: 1, present: true, note: 'private note' });
  });
  it('allows only one concurrent writer at an expected revision', async () => {
    const change = args(); const deps = { db, now };
    const writes = await Promise.allSettled([
      runMcpWorkoutReflection('save_workout_reflection', input(change), codec, deps),
      runMcpWorkoutReflection('save_workout_reflection', input({ ...change, mutationId: randomUUID(), note: 'other writer' }), codec, deps),
    ]);
    expect(writes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(writes.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect((await db.doc(`users/${uid}/events/event/workoutReflections/activity_activity`).get()).data()?.revision).toBe(1);
  });

  it('denies missing, revoked or changed grants, cross-connection references and account deletion', async () => {
    const change = args(); const deps = { db, now };
    for (const overrides of [{ scopes: ['activity-details:read'] }, { connectionId: 'other' }, { uid: 'other' }]) {
      await expect(runMcpWorkoutReflection('save_workout_reflection', input(change, overrides), codec, deps)).rejects.toMatchObject({ code: 'invalid_request' });
    }
    await db.doc(`users/${uid}/mcpConnections/connection`).update({ revokedAtMs: now() });
    await expect(runMcpWorkoutReflection('save_workout_reflection', input(change), codec, deps)).rejects.toMatchObject({ code: 'invalid_request' });
    await db.doc(`users/${uid}/mcpConnections/connection`).update({ revokedAtMs: null, grantId: 'new-grant' });
    await expect(runMcpWorkoutReflection('save_workout_reflection', input(change), codec, deps)).rejects.toMatchObject({ code: 'invalid_request' });
    await db.doc(`userDeletionTombstones/${uid}`).set({ deleting: true });
    await expect(runMcpWorkoutReflection('get_workout_reflection', input({ activityRef: change.activityRef, target: 'activity' }), codec, deps)).rejects.toMatchObject({ code: 'detail_not_available' });
  });
  it('checks current recording membership, benchmark status and existing Assistant review inside the transaction', async () => {
    const change = args(); const deps = { db, now };
    await db.doc(`users/${uid}/activities/activity`).update({ eventID: 'other' });
    await expect(runMcpWorkoutReflection('save_workout_reflection', input(change), codec, deps)).rejects.toMatchObject({ code: 'detail_not_available' });
    await db.doc(`users/${uid}/activities/activity`).update({ eventID: 'event' });
    await db.doc(`users/${uid}/events/event`).update({ mergeType: 'benchmark' });
    await expect(runMcpWorkoutReflection('save_workout_reflection', input(change), codec, deps)).rejects.toMatchObject({ code: 'detail_not_available' });
    await db.doc(`users/${uid}/events/event`).update({ mergeType: 'multi' });
    const conversation = 'chat';
    const proposal = { kind: 'save_workout_reflection', proposalRef: 'proposal', expiresAtMs: now() + 10000,
      arguments: { ...change, activityRef: `opaque:${uid}:first-party-assistant-v1:${conversation}` } };
    await db.doc(`users/${uid}/assistantConversations/active`).set({ conversationId: conversation,
      expireAt: Timestamp.fromMillis(now() + 100000), reflectionChangesEnabled: true, pendingContentProposal: proposal });
    const approved = input(proposal.arguments, { connectionId: `first-party-assistant-v1:${conversation}`,
      assistantConversationId: conversation, assistantProposalRef: 'proposal' });
    await expect(runMcpWorkoutReflection('save_workout_reflection', { ...approved, assistantProposalRef: undefined }, codec, deps)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(await runMcpWorkoutReflection('save_workout_reflection', approved, codec, deps)).toMatchObject({ revision: 1 });
    await db.doc(`users/${uid}/assistantConversations/active`).update({ reflectionChangesEnabled: false });
    await expect(runMcpWorkoutReflection('save_workout_reflection', approved, codec, deps)).rejects.toMatchObject({ code: 'invalid_request' });
  });
});
