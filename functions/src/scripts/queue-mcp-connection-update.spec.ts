import { afterEach, describe, expect, it, vi } from 'vitest';

const { firestoreMock, authMock } = vi.hoisted(() => ({
    firestoreMock: vi.fn(),
    authMock: vi.fn(),
}));

vi.mock('firebase-admin', () => ({
    apps: [{}],
    firestore: firestoreMock,
    auth: authMock,
}));

import {
    buildCampaignMailDocument,
    deduplicateActivePaidSubscriptions,
    parseQueueOptions,
    queueMcpConnectionUpdate,
} from './queue-mcp-connection-update';

describe('queue-mcp-connection-update', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    function campaignQueueState() {
        const state = { userExists: true, deletionMarked: false, mailExists: false };
        const create = vi.fn();
        const get = vi.fn(async (ref: { path: string }) => {
            if (ref.path === 'users/user-1') return { exists: state.userExists };
            if (ref.path === 'userDeletionTombstones/user-1') {
                return { exists: state.deletionMarked, data: () => ({ cleanupStatus: 'pending' }) };
            }
            return { exists: state.mailExists };
        });
        const runTransaction = vi.fn(async (handler: (tx: { get: typeof get; create: typeof create }) => Promise<unknown>) =>
            handler({ get, create }));
        const subscriptions = {
            where: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({ docs: [{
                ref: { parent: { parent: { id: 'user-1' } } },
                get: () => 'pro',
            }] }),
        };
        firestoreMock.mockReturnValue({
            collectionGroup: vi.fn(() => subscriptions),
            collection: vi.fn((collection: string) => ({ doc: (uid: string) => ({ path: `${collection}/${uid}` }) })),
            // Selection sees an eligible account; state above models a subsequent
            // deletion before this recipient's turn in the paced write loop.
            getAll: vi.fn(async (...refs: Array<{ path: string }>) => refs.map(ref => ({
                exists: ref.path.startsWith('users/'),
                data: () => undefined,
            }))),
            runTransaction,
        });
        authMock.mockReturnValue({ getUsers: vi.fn().mockResolvedValue({ users: [{
            uid: 'user-1', email: 'member@example.com', displayName: 'Ada Lovelace',
        }] }) });
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        return { state, get, create, runTransaction, log };
    }

    it('defaults to dry-run and requires an explicit production count before writes', () => {
        expect(parseQueueOptions(['--project=quantified-self-io'])).toEqual({
            projectId: 'quantified-self-io',
            dryRun: true,
            intervalMs: 200,
        });
        expect(() => parseQueueOptions([
            '--project=quantified-self-io',
            '--dry-run=false',
        ])).toThrow(/expected-recipients/);
        expect(() => parseQueueOptions([
            '--project=another-project',
            '--dry-run=false',
            '--expected-recipients=1',
        ])).toThrow(/outside quantified-self-io/);
        expect(() => parseQueueOptions([
            '--project=quantified-self-io',
            '--interval-ms=99',
        ])).toThrow(/Usage/);
    });

    it('deduplicates active subscriptions by UID and keeps the highest paid role', () => {
        expect([...deduplicateActivePaidSubscriptions([
            { uid: 'basic-user', role: 'basic' },
            { uid: 'upgraded-user', role: 'basic' },
            { uid: 'upgraded-user', role: 'pro' },
            { uid: 'pro-user', role: 'pro' },
        ])]).toEqual([
            ['basic-user', 'basic'],
            ['upgraded-user', 'pro'],
            ['pro-user', 'pro'],
        ]);
    });

    it('builds a deletion-cleanup-compatible inline mail document', () => {
        const document = buildCampaignMailDocument({
            uid: 'user-1',
            role: 'pro',
            email: 'member@example.com',
            firstName: 'Ada',
        });

        expect(document.to).toBe('member@example.com');
        expect(document.uid).toBe('user-1');
        expect(document.message.subject).toBe('Reconnect your Quantified Self ChatGPT app');
        expect(document.message.html).toContain('Hi Ada');
        expect(document.message.text).toContain('select Manage');
        expect(document.message.html).not.toMatch(/{{[^}]+}}/);
    });

    it.each([
        { userExists: true, deletionMarked: true },
        { userExists: false, deletionMarked: false },
    ])('skips an account deleted after recipient selection: %j', async current => {
        const queue = campaignQueueState();
        Object.assign(queue.state, current);

        await queueMcpConnectionUpdate({
            projectId: 'quantified-self-io', dryRun: false, expectedRecipientCount: 1, intervalMs: 200,
        });

        expect(queue.create).not.toHaveBeenCalled();
        expect(queue.get).toHaveBeenCalledWith({ path: 'users/user-1' });
        expect(queue.get).toHaveBeenCalledWith({ path: 'userDeletionTombstones/user-1' });
        expect(JSON.parse(queue.log.mock.calls.at(-1)![0])).toEqual({
            campaignId: 'mcp_connection_update_2026_08', queued: 0, alreadyQueued: 0, skippedDeletedUsers: 1,
        });
    });

    it('queues an eligible recipient with explicit ownership after its transactional guard', async () => {
        const queue = campaignQueueState();

        await queueMcpConnectionUpdate({
            projectId: 'quantified-self-io', dryRun: false, expectedRecipientCount: 1, intervalMs: 200,
        });

        expect(queue.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            uid: 'user-1', to: 'member@example.com',
        }));
        expect(queue.get).toHaveBeenCalledWith({ path: 'users/user-1' });
        expect(JSON.parse(queue.log.mock.calls.at(-1)![0])).toMatchObject({
            queued: 1, alreadyQueued: 0, skippedDeletedUsers: 0,
        });
    });

    it('preserves an existing campaign mail without resetting its delivery', async () => {
        const queue = campaignQueueState();
        queue.state.mailExists = true;

        await queueMcpConnectionUpdate({
            projectId: 'quantified-self-io', dryRun: false, expectedRecipientCount: 1, intervalMs: 200,
        });

        expect(queue.create).not.toHaveBeenCalled();
        expect(JSON.parse(queue.log.mock.calls.at(-1)![0])).toMatchObject({
            queued: 0, alreadyQueued: 1, skippedDeletedUsers: 0,
        });
    });

    it('keeps dry runs read-only', async () => {
        const queue = campaignQueueState();

        await queueMcpConnectionUpdate({ projectId: 'quantified-self-io', dryRun: true, intervalMs: 200 });

        expect(queue.runTransaction).not.toHaveBeenCalled();
        expect(queue.create).not.toHaveBeenCalled();
        expect(queue.log).toHaveBeenCalledOnce();
        expect(JSON.parse(queue.log.mock.calls[0][0])).toMatchObject({ dryRun: true, eligibleRecipients: 1 });
    });

    it('fails closed when the transaction cannot read deletion state', async () => {
        const queue = campaignQueueState();
        queue.get.mockRejectedValueOnce(new Error('Deletion state unavailable'));

        await expect(queueMcpConnectionUpdate({
            projectId: 'quantified-self-io', dryRun: false, expectedRecipientCount: 1, intervalMs: 200,
        })).rejects.toThrow('Deletion state unavailable');

        expect(queue.create).not.toHaveBeenCalled();
    });
});
