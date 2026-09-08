import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { decodeTimelineNote, isTimelineNoteVisible, timelineToday, timelineNoteOverlaps, validateTimelineFields } from '../../../shared/timeline-notes';
const mocks = vi.hoisted(() => ({ guard: vi.fn() }));
vi.mock('../shared/user-deletion-guard', () => ({ getUserDeletionGuardStateInTransaction: mocks.guard }));
import { deleteTimelineNote, saveTimelineNote, validateSaveTimelineNote } from './mutations';

const now = Date.UTC(2026, 8, 7, 12);
const fields = { category: 'sickness', title: 'A private note', details: '<b>plain text</b>', startDate: '2026-09-01', endDate: null, timeZone: 'Europe/Helsinki' };
const create = { ...fields, mode: 'create', clientMutationId: '123e4567-e89b-42d3-a456-426614174000' };
function database() {
  const stored = new Map<string, unknown>();
  interface Ref { path: string; doc: (id: string) => Ref; collection: (id: string) => Ref }
  const ref = (path: string): Ref => ({ path, doc: id => ref(`${path}/${id}`), collection: id => ref(`${path}/${id}`) });
  const tx = { get: vi.fn(async (r: Ref) => ({ exists: stored.has(r.path), data: () => stored.get(r.path) })),
    set: vi.fn((r: Ref, data: unknown) => stored.set(r.path, data)), delete: vi.fn((r: Ref) => stored.delete(r.path)) };
  const db = { collection: (name: string) => ref(name), runTransaction: async (run: (t: typeof tx) => unknown) => run(tx) } as unknown as Firestore;
  return { deps: { db, now: () => now }, stored, tx };
}
describe('Timeline notes', () => {
  beforeEach(() => mocks.guard.mockResolvedValue({ shouldSkip: false }));
  it.each([null, 1, 'RED', '#ff0000', 'url(secret)', {}, []])('rejects unsupported colors %j', color => {
    expect(() => validateSaveTimelineNote({ ...create, color }, now)).toThrow();
  });
  it('saves and resets colors with safe retries and preserves them for older clients', async () => {
    const fake = database();
    const note = await saveTimelineNote('owner', { ...create, color: 'purple' }, fake.deps);
    expect(note.color).toBe('purple');
    expect(decodeTimelineNote(note.id, note)?.color).toBe('purple');
    expect(decodeTimelineNote(note.id, { ...note, color: 'url(secret)' })).toBeNull();
    expect(await saveTimelineNote('owner', { ...create, color: 'purple' }, fake.deps)).toEqual(note);
    await expect(saveTimelineNote('owner', { ...create, color: 'blue' }, fake.deps)).rejects.toThrow();
    const update = { ...fields, mode: 'update', noteId: note.id, expectedRevision: 1, endDate: '2026-09-07' };
    const edited = await saveTimelineNote('owner', update, fake.deps);
    expect(edited).toMatchObject({ color: 'purple', revision: 2 });
    expect(await saveTimelineNote('owner', update, fake.deps)).toEqual(edited);
    const reset = { ...update, expectedRevision: 2, color: 'default' };
    const resetNote = await saveTimelineNote('owner', reset, fake.deps);
    expect(resetNote).toMatchObject({ color: 'default', revision: 3 });
    expect(await saveTimelineNote('owner', reset, fake.deps)).toEqual(resetNote);
    await expect(saveTimelineNote('owner', { ...reset, color: 'red' }, fake.deps)).rejects.toThrow();
  });
  it('treats omitted/default colors equally without changing legacy notes', async () => {
    const fake = database();
    const note = await saveTimelineNote('owner', create, fake.deps);
    expect(note.color).toBeUndefined();
    expect(await saveTimelineNote('owner', { ...create, color: 'default' }, fake.deps)).toEqual(note);
  });
  it.each([null, 0, 1, 'false', [], {}])('rejects non-boolean per-note visibility %j', showOnCharts => {
    expect(() => validateSaveTimelineNote({ ...create, showOnCharts }, now)).toThrow();
  });
  it('keeps legacy notes visible and decodes explicit visibility without coercion', async () => {
    const fake = database();
    const note = await saveTimelineNote('owner', create, fake.deps);
    expect(isTimelineNoteVisible(decodeTimelineNote(note.id, note)!)).toBe(true);
    expect(isTimelineNoteVisible(decodeTimelineNote(note.id, { ...note, showOnCharts: false })!)).toBe(false);
    expect(decodeTimelineNote(note.id, { ...note, showOnCharts: 'false' })).toBeNull();
    // Adding an explicit true to an identical legacy create retry is not a different draft.
    expect(await saveTimelineNote('owner', { ...create, showOnCharts: true }, fake.deps)).toEqual(note);
  });
  it('saves visibility with safe retries, revision conflicts, and deletion guards', async () => {
    const fake = database();
    const note = await saveTimelineNote('owner', { ...create, showOnCharts: false }, fake.deps);
    expect(note.showOnCharts).toBe(false);
    expect(await saveTimelineNote('owner', { ...create, showOnCharts: false }, fake.deps)).toEqual(note);
    await expect(saveTimelineNote('owner', create, fake.deps)).rejects.toThrow();
    const show = { ...fields, mode: 'update', noteId: note.id, expectedRevision: 1, showOnCharts: true };
    const shown = await saveTimelineNote('owner', show, fake.deps);
    expect(shown).toMatchObject({ showOnCharts: true, revision: 2 });
    expect(await saveTimelineNote('owner', show, fake.deps)).toEqual(shown);
    await expect(saveTimelineNote('owner', { ...show, showOnCharts: false }, fake.deps)).rejects.toThrow();
    fake.tx.set.mockClear();
    mocks.guard.mockResolvedValue({ shouldSkip: true });
    await expect(saveTimelineNote('owner', { ...show, expectedRevision: 2, showOnCharts: false }, fake.deps)).rejects.toThrow();
    expect(fake.tx.set).not.toHaveBeenCalled();
  });
  it('preserves a hidden note when an older client edits or ends it without the visibility field', async () => {
    const fake = database();
    const note = await saveTimelineNote('owner', { ...create, showOnCharts: false }, fake.deps);
    const request = { ...fields, mode: 'update', noteId: note.id, expectedRevision: 1, endDate: '2026-09-07' };
    const edited = await saveTimelineNote('owner', request, fake.deps);
    expect(edited).toMatchObject({ showOnCharts: false, endDate: '2026-09-07', revision: 2 });
    expect(await saveTimelineNote('owner', request, fake.deps)).toEqual(edited);
    expect(fake.stored.get(`users/owner/timelineNotes/${note.id}`)).toMatchObject({ showOnCharts: false });
  });
  it('accepts leap dates, future bounded notes, and fixed calendar dates across travel/DST', () => {
    expect(validateTimelineFields({ ...fields, startDate: '2024-02-29', endDate: '2024-03-31' }, now).startDate).toBe('2024-02-29');
    expect(validateTimelineFields({ ...fields, startDate: '2027-01-01', endDate: '2027-01-01' }, now).endDate).toBe('2027-01-01');
    expect(timelineToday('Pacific/Auckland', Date.UTC(2026, 8, 7, 23))).toBe('2026-09-08');
    expect(timelineToday('America/Los_Angeles', Date.UTC(2026, 8, 7, 1))).toBe('2026-09-06');
  });
  it.each([{ startDate: '2023-02-29' }, { endDate: '2026-08-31' }, { timeZone: 'fake' }, { title: '' },
    { title: 'a'.repeat(121) }, { details: 'a'.repeat(2001) }, { startDate: '2027-01-01' }, { provider: 'Garmin' },
    { clientMutationId: 'bad' }, { expectedRevision: 0 }])('rejects malformed creates %j', patch => {
    expect(() => validateSaveTimelineNote({ ...create, ...patch }, now)).toThrow();
  });
  it('includes earlier overlapping and inclusive final days, and clips ongoing at today', () => {
    const note = validateTimelineFields(fields, now);
    expect(timelineNoteOverlaps(note, { startDate: '2026-09-07', endDate: '2026-09-09' }, now)).toBe(true);
    expect(timelineNoteOverlaps(note, { startDate: '2026-09-08', endDate: '2026-09-09' }, now)).toBe(false);
    expect(timelineNoteOverlaps({ ...note, endDate: '2026-09-08' }, { startDate: '2026-09-08', endDate: '2026-09-09' }, now)).toBe(true);
  });
  it('rejects unsupported controls while preserving plain-text whitespace and Unicode', () => {
    for (const code of [...Array(32).keys(), 127].filter(code => ![9, 10, 13].includes(code))) {
      for (const field of ['title', 'details']) {
        expect(() => validateTimelineFields({ ...fields, [field]: `Before${String.fromCharCode(code)}after` }, now)).toThrow();
      }
    }
    expect(validateTimelineFields({ ...fields, details: 'Notes\twith\nnewlines\r\nand Unicode: ταξίδι 🧳' }, now).details)
      .toBe('Notes\twith\nnewlines\r\nand Unicode: ταξίδι 🧳');
  });
  it('creates once, updates under revision fence, and never revives a deleted note', async () => {
    const fake = database();
    const first = await saveTimelineNote('owner', create, fake.deps);
    expect(first.revision).toBe(1);
    expect(await saveTimelineNote('owner', { ...create, clientMutationId: create.clientMutationId.toUpperCase() }, fake.deps)).toEqual(first);
    const edited = await saveTimelineNote('owner', { ...fields, title: 'Edited', mode: 'update', noteId: first.id, expectedRevision: 1 }, fake.deps);
    expect(edited.revision).toBe(2);
    await expect(saveTimelineNote('owner', { ...fields, mode: 'update', noteId: first.id, expectedRevision: 1 }, fake.deps)).rejects.toThrow();
    await deleteTimelineNote('owner', { noteId: first.id, expectedRevision: 2 }, fake.deps);
    expect([...fake.stored.values()]).toEqual([{ deleted: true }]);
    await expect(saveTimelineNote('owner', create, fake.deps)).rejects.toThrow();
    expect(await deleteTimelineNote('owner', { noteId: first.id, expectedRevision: 2 }, fake.deps)).toEqual({ deleted: false });
  });
  it('isolates owners and returns only explicit fields', async () => {
    const fake = database();
    const first = await saveTimelineNote('one', create, fake.deps);
    const second = await saveTimelineNote('two', create, fake.deps);
    expect(second.id).not.toBe(first.id);
    await expect(deleteTimelineNote('two', { noteId: first.id, expectedRevision: 1 }, fake.deps)).resolves.toEqual({ deleted: false });
    expect(decodeTimelineNote(first.id, { ...first, providerAccountId: 'secret' })).not.toHaveProperty('providerAccountId');
    expect(JSON.stringify([...fake.stored.values()])).not.toContain(create.clientMutationId);
  });
  it('retries an acknowledged update without another revision and rejects a changed create retry', async () => {
    const fake = database(); const first = await saveTimelineNote('owner', create, fake.deps);
    await expect(saveTimelineNote('owner', { ...create, title: 'Different draft' }, fake.deps)).rejects.toThrow();
    const request = { ...fields, title: 'Edited', mode: 'update', noteId: first.id, expectedRevision: 1 };
    const second = await saveTimelineNote('owner', request, fake.deps);
    expect(await saveTimelineNote('owner', request, fake.deps)).toEqual(second);
    expect(second.revision).toBe(2);
    expect(decodeTimelineNote(first.id, { ...first, endDate: undefined })).toBeNull();
  });
  it('blocks creates, updates, deletes and receipts during deletion', async () => {
    const fake = database();
    const note = await saveTimelineNote('owner', create, fake.deps);
    fake.tx.set.mockClear();
    mocks.guard.mockResolvedValue({ shouldSkip: true });
    await expect(saveTimelineNote('owner', create, fake.deps)).rejects.toThrow();
    await expect(saveTimelineNote('owner', { ...fields, mode: 'update', noteId: note.id, expectedRevision: 1 }, fake.deps)).rejects.toThrow();
    await expect(deleteTimelineNote('owner', { noteId: note.id, expectedRevision: 1 }, fake.deps)).rejects.toThrow();
    expect(fake.tx.set).not.toHaveBeenCalled();
    expect(fake.tx.delete).not.toHaveBeenCalled();
  });
});
