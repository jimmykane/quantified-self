import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
    auth: vi.fn(),
    collection: vi.fn(),
    create: vi.fn(),
    doc: vi.fn(),
    firestore: vi.fn(),
    firestoreDoc: vi.fn(),
    getUser: vi.fn(),
    getUserDeletionGuardState: vi.fn(),
    getUserDeletionGuardStateInTransaction: vi.fn(),
    onDocumentWritten: vi.fn((_options: unknown, handler: unknown) => handler),
    runTransaction: vi.fn(),
    state: {
        lifecycleExists: false,
        mailExists: false,
    },
    transactionGet: vi.fn(),
}));

vi.mock('firebase-functions/v2/firestore', () => ({
    onDocumentWritten: hoisted.onDocumentWritten,
}));

vi.mock('firebase-admin', () => ({
    auth: hoisted.auth,
    firestore: Object.assign(hoisted.firestore, {
        FieldValue: {
            serverTimestamp: () => 'SERVER_TIMESTAMP',
        },
        Timestamp: {
            fromDate: (date: Date) => ({ toDate: () => date }),
        },
    }),
}));

vi.mock('../shared/user-deletion-guard', () => ({
    getUserDeletionGuardState: hoisted.getUserDeletionGuardState,
    getUserDeletionGuardStateInTransaction: hoisted.getUserDeletionGuardStateInTransaction,
}));

vi.mock('firebase-functions/logger', () => ({
    info: vi.fn(),
}));

import {
    queueRegistrationWelcomeEmail,
    sendRegistrationWelcomeEmail,
} from './registration-welcome';
import {
    FOUNDER_EMAIL_FROM,
    FOUNDER_EMAIL_REPLY_TO,
} from './config';

describe('registration founder welcome', () => {
    beforeEach(() => {
        hoisted.auth.mockReset();
        hoisted.collection.mockReset();
        hoisted.create.mockReset();
        hoisted.doc.mockReset();
        hoisted.firestore.mockReset();
        hoisted.firestoreDoc.mockReset();
        hoisted.getUser.mockReset();
        hoisted.getUserDeletionGuardState.mockReset();
        hoisted.getUserDeletionGuardStateInTransaction.mockReset();
        hoisted.runTransaction.mockReset();
        hoisted.transactionGet.mockReset();
        hoisted.state.lifecycleExists = false;
        hoisted.state.mailExists = false;
        hoisted.create.mockReturnValue(undefined);
        hoisted.doc.mockImplementation((id: string) => ({ path: `mail/${id}` }));
        hoisted.collection.mockReturnValue({ doc: hoisted.doc });
        hoisted.firestoreDoc.mockImplementation((path: string) => ({ path }));
        hoisted.transactionGet.mockImplementation(async (ref: { path: string }) => ({
            exists: ref.path.includes('/system/emailLifecycle')
                ? hoisted.state.lifecycleExists
                : hoisted.state.mailExists,
        }));
        hoisted.runTransaction.mockImplementation(async (handler: (transaction: unknown) => Promise<unknown>) => handler({
            create: hoisted.create,
            get: hoisted.transactionGet,
        }));
        hoisted.firestore.mockReturnValue({
            collection: hoisted.collection,
            doc: hoisted.firestoreDoc,
            runTransaction: hoisted.runTransaction,
        });
        hoisted.auth.mockReturnValue({ getUser: hoisted.getUser });
        hoisted.getUser.mockResolvedValue({
            email: 'athlete@example.com',
            displayName: 'Ada Lovelace',
        });
        hoisted.getUserDeletionGuardState.mockResolvedValue({
            shouldSkip: false,
            userExists: true,
            deletionInProgress: false,
        });
        hoisted.getUserDeletionGuardStateInTransaction.mockResolvedValue({
            shouldSkip: false,
            userExists: true,
            deletionInProgress: false,
        });
    });

    it('configures a retrying users/{uid} write trigger', () => {
        expect(hoisted.onDocumentWritten).toHaveBeenCalledWith(
            expect.objectContaining({
                document: 'users/{uid}',
                region: 'europe-west3',
                retry: true,
            }),
            expect.any(Function),
        );
    });

    it('queues one create-only founder welcome when onboarding first becomes complete', async () => {
        await queueRegistrationWelcomeEmail(
            'user-1',
            { onboardingCompleted: false, email: 'untrusted@example.com' },
            { onboardingCompleted: true, email: 'also-untrusted@example.com' },
        );

        expect(hoisted.getUser).toHaveBeenCalledWith('user-1');
        expect(hoisted.doc).toHaveBeenCalledWith('registration_welcome_user-1');
        expect(hoisted.firestoreDoc).toHaveBeenCalledWith('users/user-1/system/emailLifecycle');
        expect(hoisted.create).toHaveBeenCalledWith(
            { path: 'users/user-1/system/emailLifecycle' },
            { registrationWelcomeQueuedAt: 'SERVER_TIMESTAMP' },
        );
        expect(hoisted.create).toHaveBeenCalledWith(
            { path: 'mail/registration_welcome_user-1' },
            expect.objectContaining({
            to: 'athlete@example.com',
            from: FOUNDER_EMAIL_FROM,
            replyTo: FOUNDER_EMAIL_REPLY_TO,
            template: {
                name: 'registration_welcome',
                data: {
                    first_name: 'Ada',
                    product_url: 'https://quantified-self.io',
                },
            },
            expireAt: expect.any(Object),
            }),
        );
    });

    it.each([
        [{ onboardingCompleted: true }, { onboardingCompleted: true }],
        [{ onboardingCompleted: false }, { onboardingCompleted: false }],
        [{ onboardingCompleted: false }, undefined],
    ])('does not queue for a non-transition update', async (before, after) => {
        await queueRegistrationWelcomeEmail('user-1', before, after);

        expect(hoisted.getUserDeletionGuardState).not.toHaveBeenCalled();
        expect(hoisted.create).not.toHaveBeenCalled();
    });

    it('skips a user whose account is missing or being deleted', async () => {
        hoisted.getUserDeletionGuardState.mockResolvedValue({
            shouldSkip: true,
            userExists: false,
            deletionInProgress: true,
        });

        await queueRegistrationWelcomeEmail(
            'user-1',
            { onboardingCompleted: false },
            { onboardingCompleted: true },
        );

        expect(hoisted.getUser).not.toHaveBeenCalled();
        expect(hoisted.create).not.toHaveBeenCalled();
    });

    it('skips a deleted Auth user', async () => {
        hoisted.getUser.mockRejectedValue({ code: 'auth/user-not-found' });

        await queueRegistrationWelcomeEmail(
            'user-1',
            undefined,
            { onboardingCompleted: true },
        );

        expect(hoisted.create).not.toHaveBeenCalled();
    });

    it('skips an Auth user without email', async () => {
        hoisted.getUser.mockResolvedValue({ displayName: 'Ada Lovelace' });

        await queueRegistrationWelcomeEmail(
            'user-1',
            undefined,
            { onboardingCompleted: true },
        );

        expect(hoisted.create).not.toHaveBeenCalled();
    });

    it('treats a durable lifecycle marker as success after the mail document TTL expires', async () => {
        hoisted.state.lifecycleExists = true;

        await expect(queueRegistrationWelcomeEmail(
            'user-1',
            undefined,
            { onboardingCompleted: true },
        )).resolves.toBeUndefined();

        expect(hoisted.create).not.toHaveBeenCalled();
    });

    it('backfills the durable marker without duplicating an existing mail document', async () => {
        hoisted.state.mailExists = true;

        await queueRegistrationWelcomeEmail(
            'user-1',
            undefined,
            { onboardingCompleted: true },
        );

        expect(hoisted.create).toHaveBeenCalledTimes(1);
        expect(hoisted.create).toHaveBeenCalledWith(
            { path: 'users/user-1/system/emailLifecycle' },
            { registrationWelcomeQueuedAt: 'SERVER_TIMESTAMP' },
        );
    });

    it('rechecks the deletion guard inside the queue transaction', async () => {
        hoisted.getUserDeletionGuardStateInTransaction.mockResolvedValue({
            shouldSkip: true,
            userExists: true,
            deletionInProgress: true,
        });

        await queueRegistrationWelcomeEmail(
            'user-1',
            undefined,
            { onboardingCompleted: true },
        );

        expect(hoisted.create).not.toHaveBeenCalled();
    });

    it('retries unexpected Auth and Firestore failures', async () => {
        const authFailure = new Error('Auth unavailable');
        hoisted.getUser.mockRejectedValueOnce(authFailure);

        await expect(queueRegistrationWelcomeEmail(
            'user-1',
            undefined,
            { onboardingCompleted: true },
        )).rejects.toBe(authFailure);

        const firestoreFailure = new Error('Firestore unavailable');
        hoisted.getUser.mockResolvedValue({ email: 'athlete@example.com' });
        hoisted.runTransaction.mockRejectedValueOnce(firestoreFailure);

        await expect(queueRegistrationWelcomeEmail(
            'user-1',
            undefined,
            { onboardingCompleted: true },
        )).rejects.toBe(firestoreFailure);
    });

    it('passes snapshots from the deployed trigger to the transition handler', async () => {
        await (sendRegistrationWelcomeEmail as any)({
            params: { uid: 'user-2' },
            data: {
                before: { data: () => ({ onboardingCompleted: false }) },
                after: { data: () => ({ onboardingCompleted: true }) },
            },
        });

        expect(hoisted.getUser).toHaveBeenCalledWith('user-2');
    });
});
