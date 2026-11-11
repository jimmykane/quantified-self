import { randomUUID } from 'node:crypto';
import { Firestore, Query, Timestamp, Transaction } from 'firebase-admin/firestore';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TRAINING_SPORT_DEFINITIONS } from '../../../shared/training-disciplines';
import { runMcpTrainingThresholds } from './training-thresholds.service';
import { TRAINING_THRESHOLD_OUTPUTS, type TrainingThresholdTool } from './training-thresholds.schemas';
import type { McpContentWriteInput } from './content-write.service';
import { PaceUnits, SwimPaceUnits } from '@sports-alliance/sports-lib';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('dated threshold MCP transactions', { timeout: 30_000 }, () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (host && !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('Loopback emulator required.');
  const db = new Firestore({ projectId: 'demo-mcp-training-thresholds' });
  const owners: string[] = [];
  let uid: string, clock: number;
  const deps = { db, now: () => clock };
  const input = (args: unknown): McpContentWriteInput => ({ uid, connectionId: 'connection', grantId: 'grant',
    scopes: ['training-thresholds:read', 'training-thresholds:write'], arguments: args });
  const call = (tool: TrainingThresholdTool, args: unknown, override?: Partial<McpContentWriteInput>) =>
    runMcpTrainingThresholds(tool, { ...input(args), ...override }, deps);
  const read = async (family = 'cycling', override?: Partial<McpContentWriteInput>) =>
    TRAINING_THRESHOLD_OUTPUTS.get_training_thresholds.parse(await call('get_training_thresholds', { family }, override)).policies[0];
  const preview = async (changes = { functionalThresholdPower: 220 }, override?: Partial<McpContentWriteInput>) => {
    const current = await read('cycling', override);
    return TRAINING_THRESHOLD_OUTPUTS.preview_training_threshold_change.parse(await call('preview_training_threshold_change',
      { policyRef: current.policyRef, mutationId: randomUUID(), changes }, override));
  };
  beforeEach(async () => {
    uid = `thresholds-${randomUUID()}`; owners.push(uid); clock = Date.now();
    await db.doc(`users/${uid}`).set({ fixture: true });
    await db.doc(`users/${uid}/mcpConnections/connection`).set({ grantId: 'grant', status: 'active', createdAtMs: 1,
      scopes: ['training-thresholds:read', 'training-thresholds:write'] });
  });
  afterAll(async () => {
    for (const owner of owners) {
      await db.recursiveDelete(db.doc(`users/${owner}`));
      await db.doc(`userDeletionTombstones/${owner}`).delete();
    }
    await db.terminate();
  });
  it('reads sparse current heads with one bounded query and fills missing families with defaults', async () => {
    const policies = db.collection(`users/${uid}/trainingLoadPolicies`);
    await policies.doc('cycling').set({ revision: 1, method: 'AUTOMATIC', included: true,
      effectiveAt: Timestamp.fromMillis(0), functionalThresholdPower: 220 });
    await policies.doc('swimming').set({ revision: 2, method: 'HR', included: true,
      effectiveAt: Timestamp.fromMillis(0), swimThresholdSpeed: 1 });
    const reads = vi.spyOn(Transaction.prototype, 'get');
    try {
      const result = TRAINING_THRESHOLD_OUTPUTS.get_training_thresholds.parse(await call('get_training_thresholds', {}));
      expect(result.policies).toHaveLength(TRAINING_SPORT_DEFINITIONS.length);
      expect(result.policies.find(row => row.family === 'cycling')?.thresholds.functionalThresholdPower?.value).toBe(220);
      expect(result.policies.find(row => row.family === 'swimming')?.thresholds.swimThresholdSpeed?.value).toBe(1);
      expect(result.policies.find(row => row.family === 'running')).toMatchObject({ revision: 0,
        thresholds: { functionalThresholdPower: null, lactateThresholdHR: null, swimThresholdSpeed: null } });
      const queries = reads.mock.calls.map(([ref]) => ref).filter(ref => ref instanceof Query);
      expect(queries).toHaveLength(1);
      expect(queries[0].isEqual(policies.limit(TRAINING_SPORT_DEFINITIONS.length + 1))).toBe(true);
    } finally { reads.mockRestore(); }
  });
  it('returns defaults for an empty current collection and rejects an overflowing policy collection', async () => {
    const result = TRAINING_THRESHOLD_OUTPUTS.get_training_thresholds.parse(await call('get_training_thresholds', {}));
    expect(result.policies.every(row => row.revision === 0 && row.policyRef !== null)).toBe(true);
    const batch = db.batch();
    for (let i = 0; i <= TRAINING_SPORT_DEFINITIONS.length; i++)
      batch.set(db.doc(`users/${uid}/trainingLoadPolicies/unknown-${i}`), { fixture: true });
    await batch.commit();
    await expect(call('get_training_thresholds', {})).rejects.toThrow(/policies need review/);
    // A targeted read does not scan unrelated heads.
    expect((await read('cycling')).revision).toBe(0);
  });
  it('appends one dated revision, preserves unrelated preferences and retries idempotently', async () => {
    const head = db.doc(`users/${uid}/trainingLoadPolicies/cycling`);
    await head.set({ revision: 1, revisionId: 'initial', method: 'MET', included: false,
      effectiveAt: Timestamp.fromMillis(0), lactateThresholdHR: 165 });
    const event = db.doc(`users/${uid}/events/existing`);
    await event.set({ stats: { 'Training Stress Score': 87.3 } });
    const current = await read();
    const args = { policyRef: current.policyRef!, mutationId: randomUUID(), changes: { functionalThresholdPower: 220 } };
    const first = TRAINING_THRESHOLD_OUTPUTS.preview_training_threshold_change.parse(await call('preview_training_threshold_change', args));
    expect(await call('preview_training_threshold_change', args)).toEqual(first);
    expect((await head.get()).get('revision')).toBe(1);
    const result = TRAINING_THRESHOLD_OUTPUTS.apply_training_threshold_change.parse(await call('apply_training_threshold_change', { proposalRef: first.proposalRef }));
    expect(result.policy.revision).toBe(2);
    expect((await head.get()).data()).toMatchObject({ method: 'MET', included: false, functionalThresholdPower: 220, lactateThresholdHR: 165 });
    expect(await call('apply_training_threshold_change', { proposalRef: first.proposalRef })).toEqual(result);
    expect((await head.collection('revisions').get()).size).toBe(1);
    expect((await event.get()).data()).toEqual({ stats: { 'Training Stress Score': 87.3 } });
    expect(result.policy.effectiveAt).toBeTruthy();
  });
  it('rejects competing edits instead of overwriting the winner', async () => {
    const a = await preview(), b = await preview({ functionalThresholdPower: 230 });
    const outcomes = await Promise.allSettled([a, b].map(proposal => call('apply_training_threshold_change', { proposalRef: proposal.proposalRef })));
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect((await db.doc(`users/${uid}/trainingLoadPolicies/cycling`).get()).get('revision')).toBe(1);
  });
  it('rechecks proposal expiry inside the transaction after a delayed request', async () => {
    const proposal = await preview(); let first = true;
    await expect(runMcpTrainingThresholds('apply_training_threshold_change', input({ proposalRef: proposal.proposalRef }),
      { db, now: () => { if (first) { first = false; return clock; } return clock + 16 * 60000; } })).rejects.toThrow(/expired/);
    expect((await db.doc(`users/${uid}/trainingLoadPolicies/cycling`).get()).exists).toBe(false);
  });
  it('rejects expired proposals, revoked grants, other connections and account deletion', async () => {
    const proposal = await preview();
    await expect(call('apply_training_threshold_change', { proposalRef: proposal.proposalRef }, { connectionId: 'foreign' })).rejects.toThrow();
    clock += 16 * 60_000;
    await expect(call('apply_training_threshold_change', { proposalRef: proposal.proposalRef })).rejects.toThrow(/expired/);
    clock -= 16 * 60_000;
    await db.doc(`users/${uid}/mcpConnections/connection`).update({ revokedAtMs: clock });
    await expect(call('apply_training_threshold_change', { proposalRef: proposal.proposalRef })).rejects.toThrow(/permission/);
    await db.doc(`users/${uid}/mcpConnections/connection`).update({ revokedAtMs: null });
    await db.doc(`userDeletionTombstones/${uid}`).set({ deletedAt: Timestamp.now() });
    await expect(call('apply_training_threshold_change', { proposalRef: proposal.proposalRef })).rejects.toThrow(/deleted/);
    expect((await db.doc(`users/${uid}/trainingLoadPolicies/cycling`).get()).exists).toBe(false);
  });
  it('reads dated settings without returning an editable historical reference', async () => {
    const head = db.doc(`users/${uid}/trainingLoadPolicies/swimming`);
    await head.collection('revisions').doc('old').set({ revision: 1, method: 'HR', included: true,
      effectiveAt: Timestamp.fromMillis(0), swimThresholdSpeed: 100 / 113 });
    const result = TRAINING_THRESHOLD_OUTPUTS.get_training_thresholds.parse(await call('get_training_thresholds',
      { family: 'swimming', asOf: '2020-01-01T00:00:00Z' }));
    expect(result.policies[0].thresholds.swimThresholdSpeed?.value).toBe(100 / 113);
    expect(result.policies[0].policyRef).toBeNull();
    expect((await read('cycling')).thresholds.functionalThresholdPower).toBeNull();
  });
  it('keeps imperial CSS display separate from its canonical speed and never forwards private policy fields', async () => {
    await db.doc(`users/${uid}/config/settings`).set({ unitSettings: { swimPaceUnits: [SwimPaceUnits.MinutesPer100Yard] } });
    await db.doc(`users/${uid}/trainingLoadPolicies/swimming`).set({ revision: 1, method: 'HR', included: false,
      effectiveAt: Timestamp.fromMillis(0), swimThresholdSpeed: 91.44 / 113, privateWeight: 'PRIVATE-SOURCE' });
    const result = await read('swimming');
    expect(result.thresholds.swimThresholdSpeed).toEqual({ value: 91.44 / 113, unit: 'm/s', displayValue: '01:53', displayUnit: 'min/100yd' });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|privateWeight|included|method/);
  });
  it('reads, previews and applies Running pace with explicit imperial units without changing existing workouts', async () => {
    await db.doc(`users/${uid}/config/settings`).set({ unitSettings: { paceUnits: [PaceUnits.MinutesPerMile] } });
    const head = db.doc(`users/${uid}/trainingLoadPolicies/running`);
    const original = { revision: 1, revisionId: 'old', method: 'RUNNING_PACE', included: true,
      effectiveAt: Timestamp.fromMillis(0), runningThresholdSpeed: 3, functionalThresholdPower: 220 };
    await head.set(original); await head.collection('revisions').doc('old').set(original);
    const event = db.doc(`users/${uid}/events/existing`); const recorded = { stats: { 'Training Stress Score': 42 } }; await event.set(recorded);
    const current = await read('running');
    const proposal = TRAINING_THRESHOLD_OUTPUTS.preview_training_threshold_change.parse(await call('preview_training_threshold_change',
      { policyRef: current.policyRef, mutationId: randomUUID(), changes: { runningPace: { paceSeconds: 420, distanceUnit: 'mi' } } }));
    expect(proposal.review.after.runningThresholdSpeed).toEqual({ value: 1609.34 / 420, unit: 'm/s', displayValue: '07:00', displayUnit: 'min/m' });
    expect((await head.get()).get('runningThresholdSpeed')).toBe(3);
    const applied = TRAINING_THRESHOLD_OUTPUTS.apply_training_threshold_change.parse(await call('apply_training_threshold_change', { proposalRef: proposal.proposalRef }));
    expect(applied.policy.thresholds.runningThresholdSpeed).toEqual(proposal.review.after.runningThresholdSpeed);
    expect((await head.get()).data()).toMatchObject({ revision: 2, method: 'RUNNING_PACE', functionalThresholdPower: 220, runningThresholdSpeed: 1609.34 / 420 });
    expect((await event.get()).data()).toEqual(recorded);
    const historical = TRAINING_THRESHOLD_OUTPUTS.get_training_thresholds.parse(await call('get_training_thresholds',
      { family: 'running', asOf: '2020-01-01T00:00:00Z' })).policies[0];
    expect(historical.thresholds.runningThresholdSpeed?.value).toBe(3); expect(historical.policyRef).toBeNull();
    const clear = TRAINING_THRESHOLD_OUTPUTS.preview_training_threshold_change.parse(await call('preview_training_threshold_change',
      { policyRef: (await read('running')).policyRef, mutationId: randomUUID(), changes: { runningPace: null } }));
    await call('apply_training_threshold_change', { proposalRef: clear.proposalRef });
    expect((await head.get()).get('runningThresholdSpeed')).toBeUndefined();
    expect((await head.get()).get('functionalThresholdPower')).toBe(220);
  });
  it('binds Assistant reads/previews and app apply to the same active conversation', async () => {
    const conversationId = 'current-chat';
    const conversation = db.doc(`users/${uid}/assistantConversations/active`);
    await conversation.set({ conversationId, trainingThresholdsEnabled: true, expireAt: Timestamp.fromMillis(clock + 3600000) });
    const override = { connectionId: `first-party-assistant-v1:${conversationId}`, assistantConversationId: conversationId };
    const proposed = await preview({ functionalThresholdPower: 225 }, override);
    await expect(call('apply_training_threshold_change', { proposalRef: proposed.proposalRef }, override)).rejects.toThrow(/Review/);
    const localRef = randomUUID();
    await conversation.update({ pendingContentProposal: { kind: 'apply_training_threshold_change', proposalRef: localRef,
      expiresAtMs: clock + 600000, arguments: { proposalRef: proposed.proposalRef } } });
    expect(TRAINING_THRESHOLD_OUTPUTS.apply_training_threshold_change.parse(await call('apply_training_threshold_change',
      { proposalRef: proposed.proposalRef }, { ...override, assistantProposalRef: localRef })).status).toBe('applied');
    await conversation.update({ trainingThresholdsEnabled: false });
    await expect(read('cycling', override)).rejects.toThrow(/setting/);
  });
  it('requires the independent grant even when Health and plan permissions exist', async () => {
    await expect(call('get_training_thresholds', {}, { scopes: ['health:read', 'measurements:write', 'training-plans:write'] })).rejects.toThrow();
    await expect(call('get_training_thresholds', { uid: 'foreign' })).rejects.toThrow();
  });
});
