import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as admin from 'firebase-admin';

const { firestoreMock, getUserByEmail } = vi.hoisted(() => ({
    firestoreMock: vi.fn(),
    getUserByEmail: vi.fn(),
}));

vi.mock('firebase-admin', () => ({
    apps: [{}],
    firestore: Object.assign(firestoreMock, {
        FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
    }),
    auth: () => ({ getUserByEmail }),
}));
vi.mock('firebase-functions/logger', () => ({ info: vi.fn(), error: vi.fn() }));

import { queueSingleEmail } from './queue_development_update_emails';
import { sendTestEmails } from './test-all-emails';

describe('manual mail UID ownership', () => {
    const recipient = { email: 'member@example.invalid', firstName: 'Test', lastName: 'User', originalIndex: 0 };

    beforeEach(() => {
        vi.clearAllMocks();
        getUserByEmail.mockReset().mockResolvedValue({ uid: 'user-1' });
    });

    function queueState() {
        const state = { userExists: true, deletionMarked: false, trackingExists: false };
        const set = vi.fn();
        const get = vi.fn(async (ref: { path: string }) => {
            if (ref.path === 'users/user-1') return { exists: state.userExists };
            if (ref.path === 'userDeletionTombstones/user-1') {
                return { exists: state.deletionMarked, data: () => ({ cleanupStatus: 'pending' }) };
            }
            return { exists: state.trackingExists };
        });
        const runTransaction = vi.fn(async (handler: (tx: { get: typeof get; set: typeof set }) => Promise<unknown>) =>
            handler({ get, set }));
        let nextId = 0;
        const db = {
            collection: (name: string) => ({ doc: (id = `mail-${++nextId}`) => ({ path: `${name}/${id}`, id }) }),
            runTransaction,
        } as unknown as admin.firestore.Firestore;
        firestoreMock.mockReturnValue(db);
        return { db, state, set, get, runTransaction };
    }

    it('adds the current Auth UID to CSV mail without changing its recipient or tracking deduplication', async () => {
        const queue = queueState();

        await expect(queueSingleEmail(queue.db, recipient, 'test-run')).resolves.toBe('queued');

        expect(getUserByEmail).toHaveBeenCalledWith(recipient.email);
        expect(queue.set).toHaveBeenCalledWith(expect.objectContaining({ path: 'mail/mail-1' }), expect.objectContaining({
            uid: 'user-1', to: recipient.email, template: expect.objectContaining({ name: 'development_update' }),
        }));
        expect(queue.get).toHaveBeenCalledWith(expect.objectContaining({ path: 'users/user-1' }));
        expect(queue.get).toHaveBeenCalledWith(expect.objectContaining({ path: 'userDeletionTombstones/user-1' }));

        queue.set.mockClear();
        queue.state.trackingExists = true;
        await expect(queueSingleEmail(queue.db, recipient, 'test-run')).resolves.toBe('already-queued');
        expect(queue.set).not.toHaveBeenCalled();
    });

    it('skips an exported CSV recipient whose Auth account no longer exists', async () => {
        const queue = queueState();
        getUserByEmail.mockRejectedValueOnce({ code: 'auth/user-not-found' });

        await expect(queueSingleEmail(queue.db, recipient, 'test-run')).resolves.toBe('skipped-deleted-user');

        expect(queue.runTransaction).not.toHaveBeenCalled();
    });

    it.each([
        { userExists: false, deletionMarked: false },
        { userExists: true, deletionMarked: true },
    ])('fences CSV mail when account state changes after Auth lookup: %j', async state => {
        const queue = queueState();
        Object.assign(queue.state, state);

        await expect(queueSingleEmail(queue.db, recipient, 'test-run')).resolves.toBe('skipped-deleted-user');

        expect(queue.set).not.toHaveBeenCalled();
    });

    it.each([false, true])('adds UID metadata to registered smoke-test recipients (inline=%s)', async inline => {
        const queue = queueState();

        await sendTestEmails(recipient.email, 'demo-mail-test', inline, ['registration_welcome']);

        expect(getUserByEmail).toHaveBeenCalledWith(recipient.email);
        expect(queue.set).toHaveBeenCalled();
        for (const [, data] of queue.set.mock.calls) {
            expect(data).toMatchObject({ uid: 'user-1', to: recipient.email });
            expect(data).not.toHaveProperty('toUids');
        }
        expect(queue.get).toHaveBeenCalledWith(expect.objectContaining({ path: 'userDeletionTombstones/user-1' }));
    });

    it('allows an explicitly selected external smoke-test inbox without inventing a UID', async () => {
        const queue = queueState();
        getUserByEmail.mockRejectedValueOnce({ code: 'auth/user-not-found' });

        await sendTestEmails(recipient.email, 'demo-mail-test', false, ['registration_welcome']);

        expect(queue.set).toHaveBeenCalled();
        for (const [, data] of queue.set.mock.calls) {
            expect(data.to).toBe(recipient.email);
            expect(data).not.toHaveProperty('uid');
        }
    });

    it.each([
        { userExists: false, deletionMarked: false },
        { userExists: true, deletionMarked: true },
    ])('fences account smoke-test mail after Auth lookup: %j', async state => {
        const queue = queueState();
        Object.assign(queue.state, state);

        await expect(sendTestEmails(recipient.email, 'demo-mail-test', false, ['registration_welcome']))
            .rejects.toThrow('missing or deleting account');

        expect(queue.set).not.toHaveBeenCalled();
    });

    it.each(['csv', 'smoke'])('aborts %s mail when Auth lookup fails instead of writing without UID', async script => {
        const queue = queueState();
        getUserByEmail.mockRejectedValueOnce(new Error('Auth temporarily unavailable'));

        await expect(script === 'csv'
            ? queueSingleEmail(queue.db, recipient, 'test-run')
            : sendTestEmails(recipient.email, 'demo-mail-test', false, ['registration_welcome']))
            .rejects.toThrow('Auth temporarily unavailable');

        expect(queue.runTransaction).not.toHaveBeenCalled();
        expect(queue.set).not.toHaveBeenCalled();
    });

    it.each(['csv', 'smoke'])('aborts %s mail when the deletion guard cannot be read', async script => {
        const queue = queueState();
        queue.get.mockRejectedValueOnce(new Error('Firestore temporarily unavailable'));

        await expect(script === 'csv'
            ? queueSingleEmail(queue.db, recipient, 'test-run')
            : sendTestEmails(recipient.email, 'demo-mail-test', false, ['registration_welcome']))
            .rejects.toThrow('Firestore temporarily unavailable');

        expect(queue.set).not.toHaveBeenCalled();
    });
});
