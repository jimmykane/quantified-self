import * as admin from 'firebase-admin';
import {
  TIMELINE_NOTES_COLLECTION, TIMELINE_NOTE_DELETIONS_COLLECTION, TimelineNoteValidationError,
  validateTimelineFields, decodeTimelineNote, isTimelineNoteVisible,
  type TimelineNote, type SaveTimelineNoteRequest, type DeleteTimelineNoteRequest,
} from '../../../shared/timeline-notes';
import { generateIDFromParts } from '../shared/id-generator';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';

export class TimelineNoteConflictError extends Error {}
export class TimelineNoteUnavailableError extends Error {}
export class TimelineNoteNotFoundError extends Error {}
export interface TimelineNoteDependencies { db: admin.firestore.Firestore; now: () => number }
const defaults = (): TimelineNoteDependencies => ({ db: admin.firestore(), now: Date.now });
const FIELD_KEYS = ['category', 'title', 'details', 'startDate', 'endDate', 'timeZone', 'showOnCharts'];

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TimelineNoteValidationError('Invalid note request.');
  return value as Record<string, unknown>;
}
function keys(data: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(data).some(key => !allowed.includes(key))) throw new TimelineNoteValidationError('Unsupported note fields.');
}
function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) >= Number.MAX_SAFE_INTEGER) {
    throw new TimelineNoteValidationError('Invalid note revision.');
  }
  return Number(value);
}
function noteId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new TimelineNoteValidationError('Invalid note identifier.');
  return value;
}
export function validateSaveTimelineNote(value: unknown, nowMs: number): SaveTimelineNoteRequest {
  const data = object(value);
  const fields = validateTimelineFields(data, nowMs);
  if (data.mode === 'create') {
    keys(data, [...FIELD_KEYS, 'mode', 'clientMutationId']);
    if (typeof data.clientMutationId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.clientMutationId)) {
      throw new TimelineNoteValidationError('Invalid note operation identifier.');
    }
    return { ...fields, mode: 'create', clientMutationId: data.clientMutationId.toLowerCase() };
  }
  if (data.mode !== 'update') throw new TimelineNoteValidationError('Choose create or update.');
  keys(data, [...FIELD_KEYS, 'mode', 'noteId', 'expectedRevision']);
  return { ...fields, mode: 'update', noteId: noteId(data.noteId), expectedRevision: revision(data.expectedRevision) };
}
export function validateDeleteTimelineNote(value: unknown): DeleteTimelineNoteRequest {
  const data = object(value);
  keys(data, ['noteId', 'expectedRevision']);
  return { noteId: noteId(data.noteId), expectedRevision: revision(data.expectedRevision) };
}

export async function saveTimelineNote(uid: string, value: unknown, deps = defaults()): Promise<TimelineNote> {
  const request = validateSaveTimelineNote(value, deps.now());
  const id = request.mode === 'create' ? await generateIDFromParts(['timeline-note', uid, request.clientMutationId]) : request.noteId;
  const root = deps.db.collection('users').doc(uid);
  const ref = root.collection(TIMELINE_NOTES_COLLECTION).doc(id);
  const removed = root.collection(TIMELINE_NOTE_DELETIONS_COLLECTION).doc(id);
  return deps.db.runTransaction(async tx => {
    const guard = await getUserDeletionGuardStateInTransaction(deps.db, tx, uid, deps.now());
    if (guard.shouldSkip) throw new TimelineNoteUnavailableError();
    const [snapshot, deletion] = await Promise.all([tx.get(ref), tx.get(removed)]);
    if (deletion.exists) throw new TimelineNoteNotFoundError();
    const current = snapshot.exists ? decodeTimelineNote(id, snapshot.data()) : null;
    if (snapshot.exists && !current) throw new TimelineNoteConflictError();
    const fields = validateTimelineFields(request as unknown as Record<string, unknown>, deps.now());
    // Older clients cannot express per-note visibility. Preserve it on edits, including End today.
    if (request.mode === 'update' && fields.showOnCharts === undefined && current?.showOnCharts !== undefined) {
      fields.showOnCharts = current.showOnCharts;
    }
    const sameFields = current && FIELD_KEYS.every(key => key === 'showOnCharts'
      ? isTimelineNoteVisible(current) === isTimelineNoteVisible(fields)
      : (current as unknown as Record<string, unknown>)[key] === (fields as unknown as Record<string, unknown>)[key]);
    if (request.mode === 'create' && current) {
      if (!sameFields) throw new TimelineNoteConflictError();
      return current;
    }
    if (request.mode === 'update') {
      if (!current) throw new TimelineNoteNotFoundError();
      // A lost successful response may be retried, but never overwrite a subsequent edit.
      if (current.revision === request.expectedRevision + 1 && sameFields) return current;
      if (current.revision !== request.expectedRevision) throw new TimelineNoteConflictError();
    }
    const now = deps.now();
    const note: TimelineNote = { ...fields, id, revision: (current?.revision ?? 0) + 1,
      createdAtMs: current?.createdAtMs ?? now, updatedAtMs: Math.max(now, current?.updatedAtMs ?? 0) };
    // Notes are permanent leaves: no provider source, metric, or child documents.
    tx.set(ref, { ...fields, revision: note.revision, createdAtMs: note.createdAtMs, updatedAtMs: note.updatedAtMs });
    return note;
  });
}

export async function deleteTimelineNote(uid: string, value: unknown, deps = defaults()): Promise<{ deleted: boolean }> {
  const request = validateDeleteTimelineNote(value);
  const root = deps.db.collection('users').doc(uid);
  const ref = root.collection(TIMELINE_NOTES_COLLECTION).doc(request.noteId);
  const removed = root.collection(TIMELINE_NOTE_DELETIONS_COLLECTION).doc(request.noteId);
  return deps.db.runTransaction(async tx => {
    if ((await getUserDeletionGuardStateInTransaction(deps.db, tx, uid, deps.now())).shouldSkip) throw new TimelineNoteUnavailableError();
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) {
      tx.set(removed, { deleted: true });
      return { deleted: false };
    }
    const current = decodeTimelineNote(request.noteId, snapshot.data());
    if (!current || current.revision !== request.expectedRevision) throw new TimelineNoteConflictError();
    // A leaf-only collection with no allowed descendants; account cleanup remains recursive.
    tx.delete(ref);
    tx.set(removed, { deleted: true });
    return { deleted: true };
  });
}
