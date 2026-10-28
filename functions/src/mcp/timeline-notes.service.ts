import * as admin from 'firebase-admin';
import { FieldPath } from 'firebase-admin/firestore';
import { z } from 'zod';
import {
  decodeTimelineNote, isTimelineDate, TIMELINE_NOTE_CATEGORIES,
  TIMELINE_NOTES_COLLECTION, timelineNoteEnd,
} from '../../../shared/timeline-notes';
import { getUserDeletionGuardState } from '../shared/user-deletion-guard';

export const MCP_TIMELINE_NOTES_SCOPE = 'timeline-notes:read';
export const MCP_TIMELINE_NOTES_LIMITS = { page: 64, records: 512, inputBytes: 2 * 1024 * 1024,
  outputBytes: 128 * 1024, cursorLength: 16_384 } as const;
const date = z.string().refine(isTimelineDate).meta({ format: 'date' });
const count = z.number().int().nonnegative();
export const MCP_TIMELINE_NOTES_SCHEMA = z.strictObject({
  startDate: date, endDate: date,
  notes: z.array(z.strictObject({
    category: z.enum(TIMELINE_NOTE_CATEGORIES), title: z.string().min(1).max(120),
    details: z.string().max(2_000).nullable(), startDate: date, endDate: date.nullable(),
    timeZone: z.string().min(1).max(100), effectiveEndDate: date,
  })).max(64),
  scanComplete: z.boolean(), recordsScanned: count.max(512), skippedRecords: count.max(512),
  limitsReached: z.array(z.enum(['limit', 'records', 'input_bytes', 'output_bytes'])).max(4),
  nextCursor: z.string().max(MCP_TIMELINE_NOTES_LIMITS.cursorLength).nullable(),
});
export type McpTimelineNotesResult = z.infer<typeof MCP_TIMELINE_NOTES_SCHEMA>;
export interface McpTimelineNotesInput {
  uid: string; connectionId: string; scopes: readonly string[];
  startDate: string; endDate: string; limit?: number; cursor?: string;
}
type Phase = 'closed' | 'ongoing';
// Persist query values, not a reference that becomes unusable when its document is deleted.
const positionSchema = z.strictObject({ endDate: z.string().max(1_500).nullable(),
  startDate: z.string().max(1_500), id: z.string().min(1).max(1_500) });
type Position = z.infer<typeof positionSchema>;
const cursorSchema = z.strictObject({ startDate: date, endDate: date,
  phase: z.enum(['closed', 'ongoing']), evaluatedAtMs: z.number().int().nonnegative().safe(),
  position: positionSchema.nullable(),
});
interface Document { id: string; data: Record<string, unknown> }
export interface McpTimelineNotesReads {
  activeOwner(uid: string): Promise<boolean>;
  fetchPage(uid: string, range: { startDate: string; endDate: string }, phase: Phase,
    limit: number, position: Position | null): Promise<Document[]>;
}
export interface McpTimelineNotesCodec {
  encode(value: Record<string, unknown>, uid: string, connectionId: string): string;
  decode(value: string, uid: string, connectionId: string): Record<string, unknown>;
}
export class McpTimelineNotesError extends Error {
  constructor(readonly code: 'invalid_request' | 'temporarily_unavailable', message: string) { super(message); }
}
export const firestoreTimelineNotesReads: McpTimelineNotesReads = {
  async activeOwner(uid) { return !(await getUserDeletionGuardState(admin.firestore(), uid)).shouldSkip; },
  async fetchPage(uid, range, phase, limit, position) {
    let query = admin.firestore().collection('users').doc(uid).collection(TIMELINE_NOTES_COLLECTION)
      .where('startDate', '<=', range.endDate)
      .where('endDate', phase === 'closed' ? '>=' : '==', phase === 'closed' ? range.startDate : null)
      .orderBy('endDate').orderBy('startDate').orderBy(FieldPath.documentId())
      .select('category', 'title', 'details', 'startDate', 'endDate', 'timeZone',
        'revision', 'createdAtMs', 'updatedAtMs').limit(limit);
    if (position) query = query.startAfter(position.endDate, position.startDate, position.id);
    return (await query.get()).docs.map(doc => ({ id: doc.id, data: doc.data() }));
  },
};

/** Full private text is authorized only here, never through a metric or chart-visibility grant. */
export async function queryMcpTimelineNotes(input: McpTimelineNotesInput, reads: McpTimelineNotesReads,
  codec: McpTimelineNotesCodec, nowMs = Date.now()): Promise<McpTimelineNotesResult> {
  if (!input.scopes.includes(MCP_TIMELINE_NOTES_SCOPE)) {
    throw new McpTimelineNotesError('invalid_request', 'Timeline notes permission is required. Reauthorize to enable it.');
  }
  const limit = input.limit ?? 32;
  if (!isTimelineDate(input.startDate) || !isTimelineDate(input.endDate)
    || input.endDate < input.startDate
    || Date.parse(input.endDate) - Date.parse(input.startDate) > 365 * 86_400_000
    || !Number.isInteger(limit) || limit < 1 || limit > 64) {
    throw new McpTimelineNotesError('invalid_request', 'Choose an inclusive window of at most 366 days and a limit from 1 to 64.');
  }
  let state: z.infer<typeof cursorSchema> = { startDate: input.startDate, endDate: input.endDate,
    phase: 'closed', evaluatedAtMs: nowMs, position: null };
  if (input.cursor !== undefined) {
    try {
      if (typeof input.cursor !== 'string' || input.cursor.length > MCP_TIMELINE_NOTES_LIMITS.cursorLength) throw new Error();
      state = cursorSchema.parse(codec.decode(input.cursor, input.uid, input.connectionId));
      if (state.startDate !== input.startDate || state.endDate !== input.endDate
        || state.evaluatedAtMs > nowMs || (state.phase === 'ongoing' && state.position?.endDate !== null && state.position)) throw new Error();
    } catch { throw new McpTimelineNotesError('invalid_request', 'The pagination cursor is invalid.'); }
  }
  const result: McpTimelineNotesResult = { startDate: input.startDate, endDate: input.endDate,
    notes: [], scanComplete: false, recordsScanned: 0, skippedRecords: 0, limitsReached: [], nextCursor: null };
  let bytes = 0;
  const stop = (reason: McpTimelineNotesResult['limitsReached'][number]) => {
    result.limitsReached.push(reason);
    result.nextCursor = codec.encode(state, input.uid, input.connectionId);
    if (result.nextCursor.length > MCP_TIMELINE_NOTES_LIMITS.cursorLength
      || Buffer.byteLength(JSON.stringify(result), 'utf8') > MCP_TIMELINE_NOTES_LIMITS.outputBytes) {
      throw new McpTimelineNotesError('temporarily_unavailable', 'Timeline notes could not be paged safely.');
    }
    return MCP_TIMELINE_NOTES_SCHEMA.parse(result);
  };
  // Recheck deletion before reads and before releasing the result. Errors never contain note text or identity.
  const assertOwner = async () => {
    if (!await reads.activeOwner(input.uid)) throw new McpTimelineNotesError('invalid_request', 'Timeline notes are unavailable for this account.');
  };
  await assertOwner();
  while (true) {
    const size = Math.min(MCP_TIMELINE_NOTES_LIMITS.page, MCP_TIMELINE_NOTES_LIMITS.records - result.recordsScanned);
    if (!size) { await assertOwner(); return stop('records'); }
    const documents = await reads.fetchPage(input.uid, input, state.phase, size, state.position);
    result.recordsScanned += documents.length;
    for (const document of documents) {
      const projectedBytes = Buffer.byteLength(JSON.stringify(document.data), 'utf8');
      if (bytes + projectedBytes > MCP_TIMELINE_NOTES_LIMITS.inputBytes) { await assertOwner(); return stop('input_bytes'); }
      bytes += projectedBytes;
      const note = decodeTimelineNote(document.id, document.data);
      const effectiveEndDate = note ? timelineNoteEnd(note, state.evaluatedAtMs) : null;
      const overlaps = note && note.startDate <= input.endDate && effectiveEndDate! >= input.startDate
        && note.startDate <= effectiveEndDate! && (state.phase === 'ongoing' ? note.endDate === null : note.endDate !== null);
      if (overlaps) {
        // Do not advance past the first unreturned note, even when the limit falls at a phase boundary.
        if (result.notes.length === limit) { await assertOwner(); return stop('limit'); }
        const projected = { category: note.category, title: note.title, details: note.details ?? null,
          startDate: note.startDate, endDate: note.endDate, timeZone: note.timeZone, effectiveEndDate: effectiveEndDate! };
        // Reserve the maximum cursor and metadata envelope so full text is never truncated.
        if (Buffer.byteLength(JSON.stringify({ ...result, notes: [...result.notes, projected] }), 'utf8')
          > MCP_TIMELINE_NOTES_LIMITS.outputBytes - MCP_TIMELINE_NOTES_LIMITS.cursorLength - 512) {
          await assertOwner(); return stop('output_bytes');
        }
        result.notes.push(projected);
      } else result.skippedRecords += 1;
      const position = positionSchema.safeParse({ id: document.id, endDate: document.data.endDate, startDate: document.data.startDate });
      if (!position.success) throw new McpTimelineNotesError('temporarily_unavailable', 'Timeline notes could not be paged safely.');
      state.position = position.data;
    }
    if (documents.length < size) {
      if (state.phase === 'ongoing') break;
      state = { ...state, phase: 'ongoing', position: null };
    }
  }
  await assertOwner();
  result.scanComplete = true;
  return MCP_TIMELINE_NOTES_SCHEMA.parse(result);
}
