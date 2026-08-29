import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as admin from 'firebase-admin';
import { QueueDispatchMarkerResult } from '../queue/dispatch-marker';
import { SleepSyncQueueItemInterface } from '../queue/queue-item.interface';

const hoisted = vi.hoisted(() => ({
    onDocumentWritten: vi.fn((_options: unknown, handler: unknown) => handler),
    getUserDeletionGuardState: vi.fn(),
    deleteSleepQueueRevisionWithTombstone: vi.fn(),
    markQueueItemDispatchedIfUserActive: vi.fn(),
    enqueueSleepSyncTask: vi.fn(),
    loggerWarn: vi.fn(),
}));

vi.mock('firebase-admin', () => ({
    firestore: vi.fn(() => ({})),
}));

vi.mock('firebase-functions/logger', () => ({
    info: vi.fn(),
    warn: hoisted.loggerWarn,
    error: vi.fn(),
}));

vi.mock('firebase-functions/v2/firestore', () => ({
    onDocumentWritten: hoisted.onDocumentWritten,
}));

vi.mock('../shared/user-deletion-guard', () => ({
    getUserDeletionGuardState: hoisted.getUserDeletionGuardState,
}));

vi.mock('../queue/dispatch-marker', async importOriginal => ({
    ...(await importOriginal<typeof import('../queue/dispatch-marker')>()),
    markQueueItemDispatchedIfUserActive: hoisted.markQueueItemDispatchedIfUserActive,
}));

vi.mock('./queue-revision', async importOriginal => ({
    ...(await importOriginal<typeof import('./queue-revision')>()),
    deleteSleepQueueRevisionWithTombstone: hoisted.deleteSleepQueueRevisionWithTombstone,
}));

vi.mock('../utils', () => ({
    enqueueSleepSyncTask: hoisted.enqueueSleepSyncTask,
}));

import {
    dispatchGarminPingBatchOnWrite,
    dispatchGarminPingBatchQueueRevision,
    shouldDispatchGarminPingBatchWrite,
} from './garmin-ping-batch-dispatcher';

const registeredTriggerOptions = hoisted.onDocumentWritten.mock.calls[0]?.[0];

function queueItem(overrides: Partial<SleepSyncQueueItemInterface> = {}): SleepSyncQueueItemInterface {
    return {
        id: 'batch-1',
        dateCreated: 1_700_000_000_000,
        queueRevision: 'revision-1',
        retryCount: 0,
        processed: false,
        dispatchedToCloudTask: null,
        type: 'garmin_ping_batch',
        provider: 'GarminAPI',
        userID: 'uid-1',
        providerUserId: 'garmin-user-1',
        garminSummaryType: 'dailies',
        garminCallbackURLs: ['https://apis.garmin.com/wellness-api/rest/dailies?token=opaque'],
        ...overrides,
    };
}

describe('Garmin Ping batch Firestore dispatcher', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.getUserDeletionGuardState.mockResolvedValue({
            userExists: true,
            deletionInProgress: false,
            shouldSkip: false,
        });
        hoisted.enqueueSleepSyncTask.mockResolvedValue(true);
        hoisted.markQueueItemDispatchedIfUserActive
            .mockResolvedValue(QueueDispatchMarkerResult.Marked);
        hoisted.deleteSleepQueueRevisionWithTombstone.mockResolvedValue(true);
    });

    it('registers a retryable queue-write trigger outside the webhook handler', () => {
        expect(registeredTriggerOptions).toEqual(expect.objectContaining({
            document: 'sleepSyncQueue/{queueItemId}',
            region: 'europe-west2',
            retry: true,
        }));
        expect(dispatchGarminPingBatchOnWrite).toBeTypeOf('function');
    });

    it('dispatches creates and genuinely new queue revisions', () => {
        const firstRevision = queueItem();
        const secondRevision = queueItem({
            queueRevision: 'revision-2',
            retryCount: 0,
            dispatchedToCloudTask: null,
        });

        expect(shouldDispatchGarminPingBatchWrite(
            false,
            undefined,
            firstRevision,
        )).toBe(true);
        expect(shouldDispatchGarminPingBatchWrite(
            true,
            firstRevision,
            secondRevision,
        )).toBe(true);
    });

    it('does not redispatch retry-state writes for the same queue revision', () => {
        const dispatchedRevision = queueItem({
            dispatchedToCloudTask: 1_700_000_000_500,
        });
        const retryState = queueItem({
            retryCount: 1,
            dispatchedToCloudTask: null,
        });

        expect(shouldDispatchGarminPingBatchWrite(
            true,
            dispatchedRevision,
            retryState,
        )).toBe(false);
    });

    it('leaves same-revision retry writes to the existing Cloud Task backoff', async () => {
        const ref = {
            get: vi.fn(),
        } as unknown as admin.firestore.DocumentReference;
        const handler = dispatchGarminPingBatchOnWrite as unknown as (event: {
            data: {
                before: { exists: boolean; data: () => SleepSyncQueueItemInterface };
                after: {
                    exists: boolean;
                    data: () => SleepSyncQueueItemInterface;
                    ref: admin.firestore.DocumentReference;
                    id: string;
                };
            };
            params: { queueItemId: string };
            id: string;
        }) => Promise<void>;

        await handler({
            data: {
                before: {
                    exists: true,
                    data: () => queueItem({
                        dispatchedToCloudTask: 1_700_000_000_500,
                    }),
                },
                after: {
                    exists: true,
                    data: () => queueItem({
                        retryCount: 1,
                        dispatchedToCloudTask: null,
                    }),
                    ref,
                    id: 'batch-1',
                },
            },
            params: { queueItemId: 'batch-1' },
            id: 'retry-write-event',
        });

        expect(ref.get).not.toHaveBeenCalled();
        expect(hoisted.enqueueSleepSyncTask).not.toHaveBeenCalled();
    });

    it('uses the creation timestamp to distinguish legacy queue revisions', () => {
        const firstRevision = queueItem({ queueRevision: undefined });
        const retryState = queueItem({
            queueRevision: undefined,
            retryCount: 1,
        });
        const replacement = queueItem({
            queueRevision: undefined,
            dateCreated: firstRevision.dateCreated + 1,
        });

        expect(shouldDispatchGarminPingBatchWrite(
            true,
            firstRevision,
            retryState,
        )).toBe(false);
        expect(shouldDispatchGarminPingBatchWrite(
            true,
            firstRevision,
            replacement,
        )).toBe(true);
    });

    it('dispatches the current batch revision and guards the marker write', async () => {
        const item = queueItem();
        const ref = {
            get: vi.fn().mockResolvedValue({ exists: true, data: () => item }),
            parent: { id: 'sleepSyncQueue' },
        } as unknown as admin.firestore.DocumentReference;

        const result = await dispatchGarminPingBatchQueueRevision(
            item.id,
            ref,
            item,
            'event-1',
            1_700_000_001_000,
        );

        expect(result).toBe('dispatched');
        expect(hoisted.enqueueSleepSyncTask).toHaveBeenCalledWith(
            'batch-1',
            1_700_000_000_000,
            undefined,
            {
                queueRevision: 'revision-1',
                queueDateCreated: 1_700_000_000_000,
                recoveryTaskKey: 'firestore-event-1',
            },
        );
        const markerParams = hoisted.markQueueItemDispatchedIfUserActive.mock.calls[0][0];
        expect(markerParams.cleanupOnDeletedUser).toBe(false);
        expect(markerParams.isCurrent(item)).toBe(true);
        expect(markerParams.isCurrent(queueItem({ queueRevision: 'revision-2' }))).toBe(false);
        expect(markerParams.isCurrent(queueItem({ queueRevision: undefined }))).toBe(false);
    });

    it('does not dispatch a stale event snapshot after the queue revision changes', async () => {
        const eventItem = queueItem();
        const ref = {
            get: vi.fn().mockResolvedValue({
                exists: true,
                data: () => queueItem({ queueRevision: 'revision-2' }),
            }),
        } as unknown as admin.firestore.DocumentReference;

        await expect(dispatchGarminPingBatchQueueRevision(
            eventItem.id,
            ref,
            eventItem,
            'event-1',
        )).resolves.toBe('stale');
        expect(hoisted.enqueueSleepSyncTask).not.toHaveBeenCalled();
    });

    it('revision-guards cleanup when deletion begins after task creation', async () => {
        const item = queueItem();
        const ref = {
            get: vi.fn().mockResolvedValue({ exists: true, data: () => item }),
            parent: { id: 'sleepSyncQueue' },
        } as unknown as admin.firestore.DocumentReference;
        hoisted.markQueueItemDispatchedIfUserActive
            .mockResolvedValueOnce(QueueDispatchMarkerResult.SkippedDeletedUser);

        await expect(dispatchGarminPingBatchQueueRevision(
            item.id,
            ref,
            item,
            'event-1',
        )).resolves.toBe('deleted');
        expect(hoisted.enqueueSleepSyncTask).toHaveBeenCalledOnce();
        expect(hoisted.deleteSleepQueueRevisionWithTombstone).toHaveBeenCalledWith(
            ref,
            item.id,
            { queueRevision: item.queueRevision, dateCreated: item.dateCreated },
            'sleepSyncQueue',
            'user_deletion_guard',
        );
    });

    it('guards a legacy batch marker with its exact creation timestamp', async () => {
        const item = queueItem({ queueRevision: undefined });
        const ref = {
            get: vi.fn().mockResolvedValue({ exists: true, data: () => item }),
            parent: { id: 'sleepSyncQueue' },
        } as unknown as admin.firestore.DocumentReference;

        await expect(dispatchGarminPingBatchQueueRevision(
            item.id,
            ref,
            item,
            'event-legacy',
        )).resolves.toBe('dispatched');

        const markerParams = hoisted.markQueueItemDispatchedIfUserActive.mock.calls[0][0];
        expect(markerParams.isCurrent(item)).toBe(true);
        expect(markerParams.isCurrent(queueItem({
            queueRevision: undefined,
            dateCreated: item.dateCreated + 1,
        }))).toBe(false);
    });

    it('cleans up instead of dispatching after account deletion begins', async () => {
        const item = queueItem();
        const ref = {
            get: vi.fn().mockResolvedValue({ exists: true, data: () => item }),
            parent: { id: 'sleepSyncQueue' },
        } as unknown as admin.firestore.DocumentReference;
        hoisted.getUserDeletionGuardState.mockResolvedValue({
            userExists: true,
            deletionInProgress: true,
            shouldSkip: true,
        });

        await expect(dispatchGarminPingBatchQueueRevision(
            item.id,
            ref,
            item,
            'event-1',
        )).resolves.toBe('deleted');
        expect(hoisted.deleteSleepQueueRevisionWithTombstone).toHaveBeenCalledWith(
            ref,
            item.id,
            item,
            'sleepSyncQueue',
            'user_deletion_guard',
        );
        expect(hoisted.enqueueSleepSyncTask).not.toHaveBeenCalled();
    });

    it('retries the Firestore event when Cloud Task creation is not confirmed', async () => {
        const item = queueItem();
        const ref = {
            get: vi.fn().mockResolvedValue({ exists: true, data: () => item }),
            parent: { id: 'sleepSyncQueue' },
        } as unknown as admin.firestore.DocumentReference;
        hoisted.enqueueSleepSyncTask.mockResolvedValueOnce(false);

        await expect(dispatchGarminPingBatchQueueRevision(
            item.id,
            ref,
            item,
            'event-1',
        )).rejects.toThrow('Garmin Ping batch Cloud Task dispatch was not confirmed.');
        expect(hoisted.markQueueItemDispatchedIfUserActive).not.toHaveBeenCalled();
    });

    it('ignores non-batch and already-dispatched writes', async () => {
        const ref = { get: vi.fn() } as unknown as admin.firestore.DocumentReference;

        await expect(dispatchGarminPingBatchQueueRevision(
            'sleep-1',
            ref,
            queueItem({ type: 'garmin_ping' }),
            'event-1',
        )).resolves.toBe('ignored');
        await expect(dispatchGarminPingBatchQueueRevision(
            'batch-1',
            ref,
            queueItem({ dispatchedToCloudTask: 1_700_000_000_500 }),
            'event-2',
        )).resolves.toBe('ignored');
        expect(ref.get).not.toHaveBeenCalled();
    });
});
