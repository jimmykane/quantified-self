import { isBenchmarkEvent } from '../../../shared/event-classification';
import { WORKOUT_REFLECTION_COLLECTION, decodeWorkoutReflection, nextWorkoutReflection, reflectionDocumentId } from '../../../shared/workout-reflection';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import { assertInputScopes, assertConnectionAuthorityInTransaction, defaultMcpContentWriteDependencies,
  McpContentWriteError, type McpContentWriteCodec, type McpContentWriteDependencies, type McpContentWriteInput } from './content-write.service';
import { MCP_WORKOUT_REFLECTION_INPUTS, MCP_WORKOUT_REFLECTION_OUTPUTS, WORKOUT_REFLECTIONS_READ_SCOPE,
  WORKOUT_REFLECTIONS_WRITE_SCOPE, type McpWorkoutReflectionTool } from './workout-reflections.schemas';

/** Existing MCP transport owns reviewed external writes; no new deployed CRUD endpoint. */
export async function runMcpWorkoutReflection(tool: McpWorkoutReflectionTool, input: McpContentWriteInput,
  codec: Pick<McpContentWriteCodec, 'decodeActivityRef'>,
  deps: Pick<McpContentWriteDependencies, 'db' | 'now'> = defaultMcpContentWriteDependencies()) {
  const writing = tool !== 'get_workout_reflection';
  const requiredScopes = ['activity-details:read', WORKOUT_REFLECTIONS_READ_SCOPE,
    ...(writing ? [WORKOUT_REFLECTIONS_WRITE_SCOPE] : [])];
  assertInputScopes(input, requiredScopes);
  if (writing && input.assistantConversationId && !input.assistantProposalRef) {
    throw new McpContentWriteError('invalid_request', 'Review the current Assistant proposal before changing a reflection.');
  }
  const parsed = MCP_WORKOUT_REFLECTION_INPUTS[tool].safeParse(input.arguments);
  if (!parsed.success) throw new McpContentWriteError('invalid_request', 'The reflection request is invalid. Review the strict tool schema.');
  const args = parsed.data;
  let binding: { eventId: string; activityId: string };
  try {
    binding = codec.decodeActivityRef(args.activityRef, input.uid, input.connectionId);
    reflectionDocumentId(args.target, binding.activityId);
    if (!binding.eventId || binding.eventId.includes('/') || /^\.+$/.test(binding.eventId) || binding.eventId.length > 1500) throw new Error();
  } catch { throw new McpContentWriteError('invalid_request', 'The activity reference is invalid. Discover the recording again.'); }
  const root = deps.db.doc(`users/${input.uid}`);
  const activityRef = root.collection('activities').doc(binding.activityId);
  const eventRef = root.collection('events').doc(binding.eventId);
  const reflectionRef = eventRef.collection(WORKOUT_REFLECTION_COLLECTION).doc(reflectionDocumentId(args.target, binding.activityId));
  return deps.db.runTransaction(async transaction => {
    const guard = await getUserDeletionGuardStateInTransaction(deps.db, transaction, input.uid, deps.now());
    if (guard.shouldSkip) throw new McpContentWriteError('detail_not_available', 'The recording is no longer available.');
    await assertConnectionAuthorityInTransaction(deps, transaction, input, requiredScopes,
      writing ? tool as 'save_workout_reflection' | 'delete_workout_reflection' : undefined);
    const [activity, event] = await transaction.getAll(activityRef, eventRef, { fieldMask: ['eventID', 'mergeType', 'isMerge'] });
    if (!activity.exists || activity.data()?.eventID !== binding.eventId || !event.exists || isBenchmarkEvent(event.data())) {
      throw new McpContentWriteError('detail_not_available', 'The selected recording is no longer available.');
    }
    const [snapshot] = await transaction.getAll(reflectionRef,
      { fieldMask: ['schemaVersion', 'revision', 'deleted', 'mutationId', 'effort', 'note'] });
    const current = snapshot.exists ? decodeWorkoutReflection(snapshot.data()) : null;
    if (snapshot.exists && !current) throw new McpContentWriteError('detail_not_available', 'The saved reflection cannot be read safely.');
    const projection = { activityRef: args.activityRef, target: args.target, revision: current?.revision ?? 0,
      present: !!current && !current.deleted, effortScale: 'borg_cr10' as const,
      effort: current?.effort ?? null, note: current?.note ?? null };
    if (!writing) return MCP_WORKOUT_REFLECTION_OUTPUTS.get_workout_reflection.parse(projection);
    const changeArgs = tool === 'save_workout_reflection'
      ? MCP_WORKOUT_REFLECTION_INPUTS.save_workout_reflection.parse(input.arguments)
      : MCP_WORKOUT_REFLECTION_INPUTS.delete_workout_reflection.parse(input.arguments);
    const deleted = tool === 'delete_workout_reflection';
    if (deleted && (changeArgs.expectedRevision === 0 || !current
      || (current.deleted && !(current.mutationId === changeArgs.mutationId && current.revision === changeArgs.expectedRevision + 1)))) throw new McpContentWriteError('invalid_request', 'Read an existing reflection before deleting it.');
    const savedFields = tool === 'save_workout_reflection'
      ? MCP_WORKOUT_REFLECTION_INPUTS.save_workout_reflection.parse(input.arguments)
      : { effort: null, note: null };
    let next;
    try {
      next = nextWorkoutReflection(current, changeArgs.expectedRevision, changeArgs.mutationId,
        { effort: savedFields.effort, note: savedFields.note }, deleted);
    } catch { throw new McpContentWriteError('invalid_request', 'Reflection changed or the supplied content is invalid. Read it again before editing.'); }
    if (next !== current) transaction.set(reflectionRef, next);
    return deleted ? MCP_WORKOUT_REFLECTION_OUTPUTS.delete_workout_reflection.parse({ activityRef: args.activityRef,
      target: args.target, revision: next.revision, deleted: true })
      : MCP_WORKOUT_REFLECTION_OUTPUTS.save_workout_reflection.parse({ ...projection, revision: next.revision,
          present: true, effort: next.effort, note: next.note, changed: next !== current });
  });
}
