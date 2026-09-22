import * as admin from 'firebase-admin';
import { FieldPath, FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import {
  getEventTags,
  normalizeEventTags,
} from '../../../shared/event-tags';
import { sanitizeEventFirestoreWritePayload } from '../../../shared/firestore-write-sanitizer';
import {
  decodeTimelineNote,
  isTimelineDate,
  isTimelineNoteVisible,
  timelineNoteEnd,
  TimelineNoteValidationError,
  TIMELINE_NOTES_COLLECTION,
  type TimelineNote,
} from '../../../shared/timeline-notes';
import {
  deleteTimelineNote,
  saveTimelineNote,
  TimelineNoteConflictError,
  TimelineNoteNotFoundError,
  TimelineNoteUnavailableError,
} from '../timeline-notes/mutations';
import {
  getUserDeletionGuardState,
  getUserDeletionGuardStateInTransaction,
} from '../shared/user-deletion-guard';
import {
  ACTIVITY_TAGS_WRITE_SCOPE,
  MCP_CONTENT_WRITE_INPUTS,
  MCP_CONTENT_WRITE_OUTPUTS,
  TIMELINE_NOTES_WRITE_SCOPE,
  type McpContentWriteTool,
} from './content-write.schemas';
import {
  MCP_TIMELINE_NOTES_LIMITS,
  MCP_TIMELINE_NOTES_SCOPE,
  type McpTimelineNotesReads,
} from './timeline-notes.service';

const ACTIVITY_DETAILS_READ_SCOPE = 'activity-details:read';
const NOTE_REFERENCE_SCHEMA = z.strictObject({
  id: z.string().regex(/^[a-f0-9]{64}$/),
});
const EDIT_CURSOR_POSITION_SCHEMA = z.strictObject({
  endDate: z.string().max(1_500).nullable(),
  startDate: z.string().max(1_500),
  id: z.string().min(1).max(1_500),
});
const EDIT_CURSOR_SCHEMA = z.strictObject({
  startDate: z.string().refine(isTimelineDate),
  endDate: z.string().refine(isTimelineDate),
  phase: z.enum(['closed', 'ongoing']),
  evaluatedAtMs: z.number().int().nonnegative().safe(),
  accessGeneration: z.string().min(1).max(2_000),
  position: EDIT_CURSOR_POSITION_SCHEMA.nullable(),
});

type EditableTimelineNotesResult = z.infer<
  typeof MCP_CONTENT_WRITE_OUTPUTS.query_editable_timeline_notes
>;
type TimelineNoteMutationResult = z.infer<
  typeof MCP_CONTENT_WRITE_OUTPUTS.create_timeline_note
> | z.infer<typeof MCP_CONTENT_WRITE_OUTPUTS.update_timeline_note>;

export interface McpContentWriteInput {
  uid: string;
  connectionId: string;
  grantId?: string;
  /** Set only by the in-process Assistant after binding a server-owned conversation. */
  assistantConversationId?: string;
  assistantProposalRef?: string;
  scopes: readonly string[];
  arguments: unknown;
}

export interface McpContentWriteCodec {
  decodeActivityRef(value: string, uid: string, connectionId: string): {
    activityId: string;
    eventId: string;
  };
  encodeNoteRef(value: Record<string, unknown>, uid: string, connectionId: string): string;
  decodeNoteRef(value: string, uid: string, connectionId: string): Record<string, unknown>;
  encodeEditCursor(value: Record<string, unknown>, uid: string, connectionId: string): string;
  decodeEditCursor(value: string, uid: string, connectionId: string): Record<string, unknown>;
}

export interface McpContentWriteDependencies {
  db: admin.firestore.Firestore;
  now(): number;
  timelineNotesReads: McpTimelineNotesReads;
}

export class McpContentWriteError extends Error {
  constructor(
    readonly code: 'invalid_request' | 'detail_not_available' | 'temporarily_unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'McpContentWriteError';
  }
}

export function defaultMcpContentWriteDependencies(): McpContentWriteDependencies {
  const db = admin.firestore();
  return {
    db,
    now: Date.now,
    timelineNotesReads: {
      async activeOwner(uid) {
        return !(await getUserDeletionGuardState(db, uid)).shouldSkip;
      },
      async fetchPage(uid, range, phase, limit, position) {
        let query = db.collection('users').doc(uid).collection(TIMELINE_NOTES_COLLECTION)
          .where('startDate', '<=', range.endDate)
          .where('endDate', phase === 'closed' ? '>=' : '==', phase === 'closed' ? range.startDate : null)
          .orderBy('endDate').orderBy('startDate').orderBy(FieldPath.documentId())
          .select('category', 'title', 'details', 'startDate', 'endDate', 'timeZone',
            'showOnCharts', 'color', 'revision', 'createdAtMs', 'updatedAtMs')
          .limit(limit);
        if (position) query = query.startAfter(position.endDate, position.startDate, position.id);
        return (await query.get()).docs.map(document => ({ id: document.id, data: document.data() }));
      },
    },
  };
}

function invalid(message: string): never {
  throw new McpContentWriteError('invalid_request', message);
}

function parseArguments<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    invalid('The content request is invalid. Review the tool schema and try again.');
  }
  return result.data;
}

function assertInputScopes(input: McpContentWriteInput, requiredScopes: readonly string[]): void {
  const missing = requiredScopes.filter(scope => !input.scopes.includes(scope));
  if (missing.length > 0) {
    invalid(`Missing required permission: ${missing.join(', ')}. Reauthorize this connection.`);
  }
}

function validateExternalConnectionId(connectionId: string): void {
  if (!connectionId || connectionId.length > 1_500 || connectionId.includes('/')
    || connectionId.startsWith('first-party-assistant-v1')) {
    invalid('This write is unavailable for the current connection.');
  }
}

function assistantAccessGeneration(data: admin.firestore.DocumentData, conversationId: string): string {
  return JSON.stringify([
    conversationId,
    data.activityTagChangesEnabled === true,
    data.timelineNotesEnabled === true,
    data.timelineNoteChangesEnabled === true,
  ]);
}

function assertAssistantConversationData(
  input: McpContentWriteInput,
  data: admin.firestore.DocumentData | undefined,
  requiredScopes: readonly string[],
  nowMs: number,
): string {
  const conversationId = input.assistantConversationId;
  const expectedConnectionId = conversationId
    ? `first-party-assistant-v1:${conversationId}`
    : '';
  const expiresAtMs = data?.expireAt && typeof data.expireAt.toMillis === 'function'
    ? data.expireAt.toMillis()
    : 0;
  const requiresTags = requiredScopes.includes(ACTIVITY_TAGS_WRITE_SCOPE);
  const requiresNotes = requiredScopes.includes(TIMELINE_NOTES_WRITE_SCOPE);
  if (!conversationId || conversationId.length > 120
    || input.connectionId !== expectedConnectionId
    || !data || data.conversationId !== conversationId || expiresAtMs <= nowMs
    || (requiresTags && data.activityTagChangesEnabled !== true)
    || (requiresNotes && (data.timelineNotesEnabled !== true || data.timelineNoteChangesEnabled !== true))
    || (input.assistantProposalRef !== undefined
      && (data.pendingContentProposal?.proposalRef !== input.assistantProposalRef
        || !Number.isSafeInteger(data.pendingContentProposal?.expiresAtMs)
        || data.pendingContentProposal.expiresAtMs <= nowMs))) {
    invalid('The Assistant data-access setting or pending change is no longer current. Review it again.');
  }
  return assistantAccessGeneration(data, conversationId);
}

function accessGeneration(data: admin.firestore.DocumentData): string {
  return JSON.stringify([
    data.grantId ?? null,
    data.createdAtMs ?? null,
    [...(Array.isArray(data.scopes) ? data.scopes : [])].sort(),
  ]);
}

function assertConnectionData(
  data: admin.firestore.DocumentData | undefined,
  requiredScopes: readonly string[],
  expectedGrantId: string | undefined,
): string {
  if (!data || data.revokedAtMs != null || ![undefined, 'active'].includes(data.status)
    || !Array.isArray(data.scopes)
    || data.grantId !== expectedGrantId
    || requiredScopes.some(scope => !data.scopes.includes(scope))) {
    invalid('This MCP connection no longer has the required permission. Reauthorize it and try again.');
  }
  return accessGeneration(data);
}

async function assertConnectionAuthorityInTransaction(
  deps: McpContentWriteDependencies,
  transaction: admin.firestore.Transaction,
  input: McpContentWriteInput,
  requiredScopes: readonly string[],
): Promise<void> {
  if (input.assistantConversationId) {
    const [conversation] = await transaction.getAll(
      deps.db.collection('users').doc(input.uid).collection('assistantConversations').doc('active'),
      { fieldMask: ['conversationId', 'expireAt', 'activityTagChangesEnabled', 'timelineNotesEnabled',
        'timelineNoteChangesEnabled', 'pendingContentProposal'] },
    );
    assertAssistantConversationData(input, conversation.exists ? conversation.data() : undefined,
      requiredScopes, deps.now());
    return;
  }
  validateExternalConnectionId(input.connectionId);
  const [connection] = await transaction.getAll(
    deps.db.collection('users').doc(input.uid).collection('mcpConnections').doc(input.connectionId),
    { fieldMask: ['scopes', 'status', 'revokedAtMs', 'grantId', 'createdAtMs'] },
  );
  assertConnectionData(connection.exists ? connection.data() : undefined, requiredScopes, input.grantId);
}

async function readAccessGeneration(
  deps: McpContentWriteDependencies,
  input: McpContentWriteInput,
  requiredScopes: readonly string[],
): Promise<string> {
  if ((await getUserDeletionGuardState(deps.db, input.uid)).shouldSkip) {
    invalid('This account is unavailable or being deleted.');
  }
  if (input.assistantConversationId) {
    const [conversation] = await deps.db.getAll(
      deps.db.collection('users').doc(input.uid).collection('assistantConversations').doc('active'),
      { fieldMask: ['conversationId', 'expireAt', 'activityTagChangesEnabled', 'timelineNotesEnabled',
        'timelineNoteChangesEnabled', 'pendingContentProposal'] },
    );
    return assertAssistantConversationData(input, conversation.exists ? conversation.data() : undefined,
      requiredScopes, deps.now());
  }
  validateExternalConnectionId(input.connectionId);
  const [connection] = await deps.db.getAll(
    deps.db.collection('users').doc(input.uid).collection('mcpConnections').doc(input.connectionId),
    { fieldMask: ['scopes', 'status', 'revokedAtMs', 'grantId', 'createdAtMs'] },
  );
  return assertConnectionData(
    connection.exists ? connection.data() : undefined,
    requiredScopes,
    input.grantId,
  );
}

function sameTags(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((tag, index) => tag === right[index]);
}

function publicTimelineNote(note: TimelineNote) {
  return {
    category: note.category,
    title: note.title,
    details: note.details ?? null,
    startDate: note.startDate,
    endDate: note.endDate,
    timeZone: note.timeZone,
    showOnCharts: isTimelineNoteVisible(note),
    color: note.color ?? 'default' as const,
  };
}

function decodeNoteId(
  noteRef: string,
  input: Pick<McpContentWriteInput, 'uid' | 'connectionId'>,
  codec: McpContentWriteCodec,
): string {
  try {
    return NOTE_REFERENCE_SCHEMA.parse(
      codec.decodeNoteRef(noteRef, input.uid, input.connectionId),
    ).id;
  } catch {
    return invalid('The Timeline note reference is invalid.');
  }
}

export async function updateMcpActivityTags(
  input: McpContentWriteInput,
  codec: McpContentWriteCodec,
  deps = defaultMcpContentWriteDependencies(),
) {
  if (input.assistantConversationId && !input.assistantProposalRef) {
    invalid('Review and confirm the current Assistant proposal before changing activity tags.');
  }
  const requiredScopes = [ACTIVITY_DETAILS_READ_SCOPE, ACTIVITY_TAGS_WRITE_SCOPE];
  assertInputScopes(input, requiredScopes);
  const args = parseArguments(MCP_CONTENT_WRITE_INPUTS.update_activity_tags, input.arguments);
  let reference: { activityId: string; eventId: string };
  try {
    reference = codec.decodeActivityRef(args.activityRef, input.uid, input.connectionId);
  } catch {
    return invalid('The activity reference is invalid.');
  }
  const expectedTags = normalizeEventTags(args.expectedTags);
  const tags = normalizeEventTags(args.tags);
  const user = deps.db.collection('users').doc(input.uid);
  const activityRef = user.collection('activities').doc(reference.activityId);
  const eventRef = user.collection('events').doc(reference.eventId);

  const result = await deps.db.runTransaction(async transaction => {
    if ((await getUserDeletionGuardStateInTransaction(
      deps.db,
      transaction,
      input.uid,
      deps.now(),
    )).shouldSkip) {
      invalid('This account is unavailable or being deleted.');
    }
    await assertConnectionAuthorityInTransaction(
      deps,
      transaction,
      input,
      requiredScopes,
    );
    const [activity] = await transaction.getAll(activityRef, { fieldMask: ['eventID'] });
    if (!activity.exists || activity.get('eventID') !== reference.eventId) {
      throw new McpContentWriteError('detail_not_available', 'The activity is no longer available.');
    }
    const [event] = await transaction.getAll(eventRef, {
      fieldMask: ['tags', 'benchmarkReviewTags'],
    });
    if (!event.exists) {
      throw new McpContentWriteError('detail_not_available', 'The activity event is no longer available.');
    }
    const currentTags = getEventTags(event.data());
    if (sameTags(currentTags, tags)) {
      return { activityRef: args.activityRef, tags, changed: false };
    }
    if (!sameTags(currentTags, expectedTags)) {
      invalid('Activity tags changed since they were read. Read them again before updating.');
    }
    transaction.update(eventRef, {
      ...sanitizeEventFirestoreWritePayload({ tags }),
      benchmarkReviewTags: FieldValue.delete(),
    });
    return { activityRef: args.activityRef, tags, changed: true };
  });
  return MCP_CONTENT_WRITE_OUTPUTS.update_activity_tags.parse(result);
}

export async function queryEditableMcpTimelineNotes(
  input: McpContentWriteInput,
  codec: McpContentWriteCodec,
  deps = defaultMcpContentWriteDependencies(),
): Promise<EditableTimelineNotesResult> {
  const requiredScopes = [MCP_TIMELINE_NOTES_SCOPE, TIMELINE_NOTES_WRITE_SCOPE];
  assertInputScopes(input, requiredScopes);
  const args = parseArguments(MCP_CONTENT_WRITE_INPUTS.query_editable_timeline_notes, input.arguments);
  if (args.endDate < args.startDate
    || Date.parse(args.endDate) - Date.parse(args.startDate) > 365 * 86_400_000) {
    invalid('Choose an inclusive window of at most 366 days.');
  }
  const generation = await readAccessGeneration(
    deps,
    input,
    requiredScopes,
  );
  let state: z.infer<typeof EDIT_CURSOR_SCHEMA> = {
    startDate: args.startDate,
    endDate: args.endDate,
    phase: 'closed',
    evaluatedAtMs: deps.now(),
    accessGeneration: generation,
    position: null,
  };
  if (args.cursor !== undefined) {
    try {
      state = EDIT_CURSOR_SCHEMA.parse(
        codec.decodeEditCursor(args.cursor, input.uid, input.connectionId),
      );
      if (state.startDate !== args.startDate || state.endDate !== args.endDate
        || state.accessGeneration !== generation
        || state.evaluatedAtMs > deps.now()
        || (state.phase === 'ongoing' && state.position && state.position.endDate !== null)) {
        throw new Error();
      }
    } catch {
      invalid('The pagination cursor is invalid.');
    }
  }
  const result: EditableTimelineNotesResult = {
    startDate: args.startDate,
    endDate: args.endDate,
    notes: [],
    scanComplete: false,
    recordsScanned: 0,
    skippedRecords: 0,
    limitsReached: [],
    nextCursor: null,
  };
  let inputBytes = 0;
  const assertGenerationUnchanged = async () => {
    const current = await readAccessGeneration(
      deps,
      input,
      requiredScopes,
    );
    if (current !== generation) invalid('The MCP permission grant changed. Restart the note query.');
  };
  const stop = async (reason: EditableTimelineNotesResult['limitsReached'][number]) => {
    await assertGenerationUnchanged();
    result.limitsReached.push(reason);
    result.nextCursor = codec.encodeEditCursor(state, input.uid, input.connectionId);
    if (result.nextCursor.length > MCP_TIMELINE_NOTES_LIMITS.cursorLength
      || Buffer.byteLength(JSON.stringify(result), 'utf8') > MCP_TIMELINE_NOTES_LIMITS.outputBytes) {
      throw new McpContentWriteError('temporarily_unavailable', 'Timeline notes could not be paged safely.');
    }
    return MCP_CONTENT_WRITE_OUTPUTS.query_editable_timeline_notes.parse(result);
  };

  while (true) {
    const size = Math.min(
      MCP_TIMELINE_NOTES_LIMITS.page,
      MCP_TIMELINE_NOTES_LIMITS.records - result.recordsScanned,
    );
    if (size === 0) {
      return stop('records');
    }
    const documents = await deps.timelineNotesReads.fetchPage(
      input.uid,
      args,
      state.phase,
      size,
      state.position,
    );
    result.recordsScanned += documents.length;
    for (const document of documents) {
      const documentBytes = Buffer.byteLength(JSON.stringify(document.data), 'utf8');
      if (inputBytes + documentBytes > MCP_TIMELINE_NOTES_LIMITS.inputBytes) return stop('input_bytes');
      inputBytes += documentBytes;
      const note = decodeTimelineNote(document.id, document.data);
      const effectiveEndDate = note ? timelineNoteEnd(note, state.evaluatedAtMs) : null;
      const overlaps = note && note.startDate <= args.endDate && effectiveEndDate! >= args.startDate
        && note.startDate <= effectiveEndDate!
        && (state.phase === 'ongoing' ? note.endDate === null : note.endDate !== null);
      if (overlaps) {
        if (result.notes.length === args.limit) return stop('limit');
        const projected = {
          noteRef: codec.encodeNoteRef({ id: note.id }, input.uid, input.connectionId),
          revision: note.revision,
          ...publicTimelineNote(note),
          effectiveEndDate: effectiveEndDate!,
        };
        if (Buffer.byteLength(JSON.stringify({ ...result, notes: [...result.notes, projected] }), 'utf8')
          > MCP_TIMELINE_NOTES_LIMITS.outputBytes - MCP_TIMELINE_NOTES_LIMITS.cursorLength - 512) {
          return stop('output_bytes');
        }
        result.notes.push(projected);
      } else {
        result.skippedRecords += 1;
      }
      const position = EDIT_CURSOR_POSITION_SCHEMA.safeParse({
        id: document.id,
        endDate: document.data.endDate,
        startDate: document.data.startDate,
      });
      if (!position.success) {
        throw new McpContentWriteError('temporarily_unavailable', 'Timeline notes could not be paged safely.');
      }
      state.position = position.data;
    }
    if (documents.length < size) {
      if (state.phase === 'ongoing') break;
      state = { ...state, phase: 'ongoing', position: null };
    }
  }
  await assertGenerationUnchanged();
  result.scanComplete = true;
  return MCP_CONTENT_WRITE_OUTPUTS.query_editable_timeline_notes.parse(result);
}

async function mutateTimelineNote(
  tool: Extract<McpContentWriteTool, 'create_timeline_note' | 'update_timeline_note'>,
  input: McpContentWriteInput,
  codec: McpContentWriteCodec,
  deps: McpContentWriteDependencies,
): Promise<TimelineNoteMutationResult> {
  if (input.assistantConversationId && !input.assistantProposalRef) {
    invalid('Review and confirm the current Assistant proposal before changing a Timeline note.');
  }
  const requiredScopes = [MCP_TIMELINE_NOTES_SCOPE, TIMELINE_NOTES_WRITE_SCOPE];
  assertInputScopes(input, requiredScopes);
  const createArgs = tool === 'create_timeline_note'
    ? parseArguments(MCP_CONTENT_WRITE_INPUTS.create_timeline_note, input.arguments)
    : null;
  const updateArgs = tool === 'update_timeline_note'
    ? parseArguments(MCP_CONTENT_WRITE_INPUTS.update_timeline_note, input.arguments)
    : null;
  const noteId = updateArgs
    ? decodeNoteId(updateArgs.noteRef, input, codec)
    : null;
  try {
    const request = createArgs
      ? (({ mutationId, details, ...fields }) => ({
        ...fields,
        ...(details == null ? {} : { details }),
        mode: 'create' as const,
        clientMutationId: mutationId,
      }))(createArgs)
      : (({ noteRef, details, ...fields }) => {
        void noteRef;
        return {
          ...fields,
          ...(details == null ? {} : { details }),
          mode: 'update' as const,
          noteId: noteId!,
        };
      })(updateArgs!);
    const note = await saveTimelineNote(input.uid, request, {
      db: deps.db,
      now: deps.now,
      transactionPrecondition: transaction => assertConnectionAuthorityInTransaction(
        deps,
        transaction,
        input,
        requiredScopes,
      ),
    });
    const result = {
      operation: tool === 'create_timeline_note' ? 'created' as const : 'updated' as const,
      noteRef: codec.encodeNoteRef({ id: note.id }, input.uid, input.connectionId),
      revision: note.revision,
      note: publicTimelineNote(note),
    };
    return MCP_CONTENT_WRITE_OUTPUTS[tool].parse(result) as TimelineNoteMutationResult;
  } catch (error) {
    if (error instanceof TimelineNoteConflictError) {
      invalid(tool === 'create_timeline_note'
        ? 'This mutationId was already used for different note content. Use a new UUID for a new note.'
        : 'The Timeline note changed since it was read. Read it again before updating.');
    }
    if (error instanceof TimelineNoteNotFoundError) {
      throw new McpContentWriteError('detail_not_available', 'The Timeline note is no longer available.');
    }
    if (error instanceof TimelineNoteUnavailableError) {
      invalid('This account is unavailable or being deleted.');
    }
    if (error instanceof TimelineNoteValidationError) {
      invalid(error.message);
    }
    throw error;
  }
}

export function createMcpTimelineNote(
  input: McpContentWriteInput,
  codec: McpContentWriteCodec,
  deps = defaultMcpContentWriteDependencies(),
) {
  return mutateTimelineNote('create_timeline_note', input, codec, deps);
}

export function updateMcpTimelineNote(
  input: McpContentWriteInput,
  codec: McpContentWriteCodec,
  deps = defaultMcpContentWriteDependencies(),
) {
  return mutateTimelineNote('update_timeline_note', input, codec, deps);
}

export async function deleteMcpTimelineNote(
  input: McpContentWriteInput,
  codec: McpContentWriteCodec,
  deps = defaultMcpContentWriteDependencies(),
) {
  if (input.assistantConversationId && !input.assistantProposalRef) {
    invalid('Review and confirm the current Assistant proposal before deleting a Timeline note.');
  }
  const requiredScopes = [MCP_TIMELINE_NOTES_SCOPE, TIMELINE_NOTES_WRITE_SCOPE];
  assertInputScopes(input, requiredScopes);
  const args = parseArguments(MCP_CONTENT_WRITE_INPUTS.delete_timeline_note, input.arguments);
  const noteId = decodeNoteId(args.noteRef, input, codec);
  try {
    const result = await deleteTimelineNote(input.uid, {
      noteId,
      expectedRevision: args.expectedRevision,
    }, {
      db: deps.db,
      now: deps.now,
      transactionPrecondition: transaction => assertConnectionAuthorityInTransaction(
        deps,
        transaction,
        input,
        requiredScopes,
      ),
    });
    return MCP_CONTENT_WRITE_OUTPUTS.delete_timeline_note.parse({
      operation: 'deleted',
      noteRef: args.noteRef,
      deleted: result.deleted,
    });
  } catch (error) {
    if (error instanceof TimelineNoteConflictError) {
      invalid('The Timeline note changed since it was read. Read it again before deleting.');
    }
    if (error instanceof TimelineNoteUnavailableError) {
      invalid('This account is unavailable or being deleted.');
    }
    throw error;
  }
}
