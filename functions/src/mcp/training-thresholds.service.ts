import * as admin from 'firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { DataFTP, DataHeartRate, DataPace, DataSwimPace, convertSpeedToPace, convertSpeedToSwimPace } from '@sports-alliance/sports-lib';
import { runningThresholdSpeed } from '../../../shared/running-threshold-pace';
import { resolveUnitAwareDisplayFromValue } from '../../../shared/unit-aware-display';
import { TRAINING_SPORT_DEFINITIONS, isTrainingDiscipline } from '../../../shared/training-disciplines';
import { DEFAULT_TRAINING_LOAD_POLICY, trainingLoadThresholds, validTrainingLoadPolicy,
  type TrainingLoadPolicy } from '../../../shared/training-load-policy';
import { applyTrainingThresholdChanges, type TrainingThresholdChanges, type TrainingThresholdValues } from '../../../shared/training-thresholds';
import { trainingLoadTimeMs } from '../../../shared/training-load-source';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import { assertInputScopes, readConnectionAuthorityInTransaction, type McpContentWriteInput } from './content-write.service';
import { decodeOpaqueValue, encodeOpaqueValue, McpDataError } from './data.service';
import { TRAINING_THRESHOLD_INPUTS, TRAINING_THRESHOLD_OUTPUTS, TRAINING_THRESHOLD_READ_SCOPE as READ,
  TRAINING_THRESHOLD_WRITE_SCOPE as WRITE, type TrainingThresholdTool } from './training-thresholds.schemas';

export interface TrainingThresholdDependencies { db: FirebaseFirestore.Firestore; now(): number }
const TTL_MS = 15 * 60_000;
const PROPOSALS = 'trainingMcpProposals';
const refSchema = z.strictObject({ kind: z.literal('training-thresholds'), family: z.string().max(64),
  revision: z.number().int().nonnegative().safe(), generation: z.string().length(64), expiresAtMs: z.number().int().safe() });
const proposalRefSchema = z.strictObject({ kind: z.literal('training-thresholds-proposal'), id: z.string().regex(/^thresholds_[a-f0-9-]{36}$/i) });
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function invalid(message: string): never { throw new McpDataError('invalid_request', message); }
const defaults = (): TrainingThresholdDependencies => ({ db: admin.firestore(), now: Date.now });

export function trainingThresholdChanges(args: z.infer<typeof TRAINING_THRESHOLD_INPUTS.preview_training_threshold_change>['changes']): TrainingThresholdChanges {
  const { css, runningPace, ...rest } = args;
  return { ...rest, ...(runningPace === undefined ? {} : { runningThresholdSpeed: runningPace === null ? null
    : runningThresholdSpeed(runningPace.paceSeconds, runningPace.distanceUnit) }),
    ...(css === undefined ? {} : { swimThresholdSpeed: css === null ? null
    : (css.distanceUnit === 'yd' ? 91.44 : 100) / css.paceSeconds }) };
}

function publicValues(policy: TrainingLoadPolicy, settings: unknown): TrainingThresholdValues {
  const value = (number: number | undefined, type: string, unit: 'watt' | 'bpm' | 'm/s') => {
    if (number === undefined) return null;
    const display = resolveUnitAwareDisplayFromValue(type, type === DataSwimPace.type ? convertSpeedToSwimPace(number)
      : type === DataPace.type ? convertSpeedToPace(number) : number,
      settings as Parameters<typeof resolveUnitAwareDisplayFromValue>[2], { roundSwimPaceSeconds: true });
    if (!display) invalid('A threshold cannot be displayed safely.');
    return { value: number, unit, displayValue: String(display.value), displayUnit: display.unit };
  };
  return { functionalThresholdPower: value(policy.functionalThresholdPower, DataFTP.type, 'watt'),
    lactateThresholdHR: value(policy.lactateThresholdHR, DataHeartRate.type, 'bpm'),
    swimThresholdSpeed: value(policy.swimThresholdSpeed, DataSwimPace.type, 'm/s'),
    runningThresholdSpeed: value(policy.runningThresholdSpeed, DataPace.type, 'm/s') };
}
function policyFields(family: string, data: FirebaseFirestore.DocumentData | undefined): TrainingLoadPolicy {
  if (!data) return { ...DEFAULT_TRAINING_LOAD_POLICY };
  const policy = { method: data.method, included: data.included, ...trainingLoadThresholds(data) } as TrainingLoadPolicy;
  if (!validTrainingLoadPolicy(family, policy) || !Number.isSafeInteger(data.revision) || data.revision < 1)
    invalid('The saved sport policy needs review before editing.');
  return policy;
}
function projectPolicy(input: McpContentWriteInput, family: string, data: FirebaseFirestore.DocumentData | undefined,
  settings: unknown, generation: string, now: number, writable = true) {
  const policy = policyFields(family, data), revision = data?.revision ?? 0;
  const effectiveAtMs = data ? trainingLoadTimeMs(data.effectiveAt) : null;
  if (effectiveAtMs !== null && !Number.isFinite(effectiveAtMs)) invalid('The saved policy date is unavailable.');
  return { family, familyLabel: TRAINING_SPORT_DEFINITIONS.find(row => row.id === family)!.label, revision,
    effectiveAt: effectiveAtMs === null ? null : new Date(effectiveAtMs).toISOString(),
    policyRef: writable ? encodeOpaqueValue('training_read', { kind: 'training-thresholds', family, revision,
      generation: digest(generation), expiresAtMs: now + TTL_MS }, input.uid, input.connectionId) : null,
    thresholds: publicValues(policy, settings) };
}
async function authorize(deps: TrainingThresholdDependencies, tx: FirebaseFirestore.Transaction,
  input: McpContentWriteInput, required: readonly string[], expected?: string, applying = false) {
  assertInputScopes(input, required);
  if ((await getUserDeletionGuardStateInTransaction(deps.db, tx, input.uid, deps.now())).shouldSkip)
    invalid('This account is unavailable or being deleted.');
  const generation = await readConnectionAuthorityInTransaction(deps, tx, input, required,
    applying ? 'apply_training_threshold_change' : undefined);
  if (expected !== undefined && digest(generation) !== expected) invalid('Threshold permissions changed. Read the current settings again.');
  return generation;
}

export async function runMcpTrainingThresholds(tool: TrainingThresholdTool, input: McpContentWriteInput,
  deps = defaults()) {
  const user = deps.db.doc(`users/${input.uid}`), now = deps.now();
  if (tool === 'get_training_thresholds') {
    const args = TRAINING_THRESHOLD_INPUTS[tool].parse(input.arguments);
    if (args.family && !isTrainingDiscipline(args.family)) invalid('Choose a supported sport family.');
    const asOf = args.asOf ? Date.parse(args.asOf) : now;
    if (asOf > now) invalid('Choose the current time or a past instant.');
    return deps.db.runTransaction(async tx => {
      const generation = await authorize(deps, tx, input, [READ]);
      const settings = (await tx.get(user.collection('config').doc('settings'))).get('unitSettings');
      const families = TRAINING_SPORT_DEFINITIONS.filter(row => !args.family || row.id === args.family);
      // Current heads are sparse. One bounded query avoids reading a missing
      // document for every family, while historical reads still query revisions.
      const heads = !args.family && !args.asOf
        ? await tx.get(user.collection('trainingLoadPolicies').limit(families.length + 1)) : null;
      if (heads && heads.size > families.length) invalid('The saved sport policies need review before reading all thresholds.');
      const current = heads ? new Map(heads.docs.map(doc => [doc.id, doc.data()])) : null;
      const policies = await Promise.all(families.map(async family => {
        const ref = user.collection('trainingLoadPolicies').doc(family.id);
        const data = args.asOf ? (await tx.get(ref.collection('revisions').where('effectiveAt', '<=', Timestamp.fromMillis(asOf))
          .orderBy('effectiveAt', 'desc').limit(1))).docs[0]?.data() : current ? current.get(family.id) : (await tx.get(ref)).data();
        return projectPolicy(input, family.id, data, settings, generation, now, !args.asOf);
      }));
      return TRAINING_THRESHOLD_OUTPUTS[tool].parse({ asOf: new Date(asOf).toISOString(), policies });
    });
  }
  if (tool === 'preview_training_threshold_change') {
    const args = TRAINING_THRESHOLD_INPUTS[tool].parse(input.arguments);
    let ref: z.infer<typeof refSchema>;
    try { ref = refSchema.parse(decodeOpaqueValue('training_read', args.policyRef, input.uid, input.connectionId, 'Threshold policy')); }
    catch { return invalid('Read the current sport thresholds on this connection before editing.'); }
    if (!isTrainingDiscipline(ref.family) || ref.expiresAtMs <= now) invalid('Read the current sport thresholds again.');
    const proposal = user.collection(PROPOSALS).doc(`thresholds_${args.mutationId}`);
    return deps.db.runTransaction(async tx => {
      await authorize(deps, tx, input, [READ, WRITE], ref.generation);
      const [head, saved, settings] = await tx.getAll(user.collection('trainingLoadPolicies').doc(ref.family),
        proposal, user.collection('config').doc('settings'));
      if (ref.expiresAtMs <= deps.now()) invalid('Read the current sport thresholds again.');
      const intent = digest({ ref: args.policyRef, changes: args.changes });
      if (saved.exists) {
        const data = saved.data()!;
        if (data.kind !== 'training-thresholds' || data.connectionId !== input.connectionId || data.intent !== intent
          || data.generation !== ref.generation || data.expiresAtMs <= deps.now()) invalid('This threshold request is unavailable. Read the current values again.');
        return TRAINING_THRESHOLD_OUTPUTS[tool].parse(data.preview);
      }
      if ((head.get('revision') ?? 0) !== ref.revision) invalid('Sport preferences changed. Read the current values again.');
      const current = policyFields(ref.family, head.data());
      let next: TrainingLoadPolicy;
      try { next = applyTrainingThresholdChanges(ref.family, current, trainingThresholdChanges(args.changes)); }
      catch { return invalid('Use positive finite thresholds for the selected sport family.'); }
      const preview = { proposalRef: encodeOpaqueValue('training_proposal', { kind: 'training-thresholds-proposal', id: proposal.id },
        input.uid, input.connectionId), expiresAtMs: deps.now() + TTL_MS, requiresConfirmation: true as const,
        appliesTo: 'future-workouts' as const, review: { family: ref.family,
          familyLabel: TRAINING_SPORT_DEFINITIONS.find(row => row.id === ref.family)!.label,
          before: publicValues(current, settings.get('unitSettings')), after: publicValues(next, settings.get('unitSettings')) } };
      tx.create(proposal, { kind: 'training-thresholds', connectionId: input.connectionId, generation: ref.generation,
        family: ref.family, revisionId: args.mutationId, expectedRevision: ref.revision, policy: next, intent,
        status: 'pending', expiresAtMs: preview.expiresAtMs, expireAt: Timestamp.fromMillis(preview.expiresAtMs), preview });
      return TRAINING_THRESHOLD_OUTPUTS[tool].parse(preview);
    });
  }
  const args = TRAINING_THRESHOLD_INPUTS.apply_training_threshold_change.parse(input.arguments);
  let decoded: z.infer<typeof proposalRefSchema>;
  try { decoded = proposalRefSchema.parse(decodeOpaqueValue('training_proposal', args.proposalRef, input.uid, input.connectionId, 'Threshold proposal')); }
  catch { return invalid('The threshold proposal is unavailable on this connection.'); }
  if (input.assistantConversationId && !input.assistantProposalRef) invalid('Review the threshold change in Quantified Self first.');
  const result = await deps.db.runTransaction(async tx => {
    const proposal = user.collection(PROPOSALS).doc(decoded.id), saved = await tx.get(proposal), data = saved.data();
    if (!data || data.kind !== 'training-thresholds' || data.connectionId !== input.connectionId || !isTrainingDiscipline(data.family))
      invalid('The threshold proposal is unavailable.');
    const generation = await authorize(deps, tx, input, [READ, WRITE], data.generation, true);
    const policyRef = user.collection('trainingLoadPolicies').doc(data.family);
    const revisionRef = policyRef.collection('revisions').doc(data.revisionId);
    if (data.status !== 'applied') {
      if (data.status !== 'pending') invalid('The threshold proposal is unavailable.');
      const [head, revision] = await tx.getAll(policyRef, revisionRef);
      if (data.expiresAtMs <= deps.now()) invalid('The threshold proposal expired. Review a new change.');
      if ((head.get('revision') ?? 0) !== data.expectedRevision || revision.exists) invalid('Sport preferences changed. Review the current thresholds again.');
      if (!validTrainingLoadPolicy(data.family, data.policy)) invalid('The saved threshold proposal is invalid.');
      const next = { ...data.policy, revision: data.expectedRevision + 1, revisionId: data.revisionId, effectiveAt: FieldValue.serverTimestamp() };
      tx.set(policyRef, next); tx.create(revisionRef, next);
      tx.update(proposal, { status: 'applied', expireAt: Timestamp.fromMillis(deps.now() + 30 * 86400000) });
    }
    return { family: data.family, revisionRef, generation };
  });
  const [revision, settings] = await deps.db.getAll(result.revisionRef, user.collection('config').doc('settings'));
  // The immutable revision provides the exact server timestamp even after another settings edit.
  const output = { status: 'applied' as const,
    policy: projectPolicy(input, result.family, revision.data(), settings.get('unitSettings'), result.generation, now, false) };
  await deps.db.runTransaction(tx => authorize(deps, tx, input, [READ, WRITE], digest(result.generation), true).then(() => undefined));
  return TRAINING_THRESHOLD_OUTPUTS.apply_training_threshold_change.parse(output);
}
