import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ appCheck: vi.fn(), save: vi.fn(), remove: vi.fn(), log: vi.fn() }));
vi.mock('firebase-functions/v2/https', () => ({ onCall: (_: unknown, handler: unknown) => handler,
  HttpsError: class extends Error { constructor(public code: string, message: string) { super(message); } } }));
vi.mock('../utils', () => ({ enforceAppCheck: mocks.appCheck }));
vi.mock('firebase-functions/logger', () => ({ error: mocks.log }));
vi.mock('./mutations', () => ({ saveTimelineNote: mocks.save, deleteTimelineNote: mocks.remove,
  TimelineNoteConflictError: class extends Error {}, TimelineNoteNotFoundError: class extends Error {}, TimelineNoteUnavailableError: class extends Error {} }));
import { saveTimelineNoteCallable, deleteTimelineNoteCallable } from './callable';
describe('Timeline note callables', () => {
  it.each([saveTimelineNoteCallable, deleteTimelineNoteCallable])('enforces auth, App Check, and originating account', async handler => {
    const call = handler as unknown as (value: unknown) => Promise<unknown>;
    await expect(call({ data: {} })).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(call({ auth: { uid: 'owner' }, data: {} })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(call({ auth: { uid: 'owner' }, data: { expectedUserID: 'another' } })).rejects.toMatchObject({ code: 'failed-precondition' });
    mocks.appCheck.mockImplementationOnce(() => { throw new Error('App Check'); });
    await expect(call({ auth: { uid: 'owner' }, data: { expectedUserID: 'owner' } })).rejects.toThrow('App Check');
  });
  it('does not log private errors or accept caller-selected ownership', async () => {
    mocks.save.mockRejectedValueOnce(new Error('private text and identity'));
    const call = saveTimelineNoteCallable as unknown as (value: unknown) => Promise<unknown>;
    await expect(call({ auth: { uid: 'owner' }, data: { expectedUserID: 'owner', title: 'private' } })).rejects.toMatchObject({ code: 'internal' });
    expect(mocks.save).toHaveBeenCalledWith('owner', { title: 'private' });
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain('private');
  });
});
