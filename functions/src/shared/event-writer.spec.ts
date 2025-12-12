import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventWriter, FirestoreAdapter } from './event-writer';
import { EventInterface } from '@sports-alliance/sports-lib/lib/events/event.interface';
import { ActivityInterface } from '@sports-alliance/sports-lib/lib/activities/activity.interface';
import { StreamInterface } from '@sports-alliance/sports-lib/lib/streams/stream.interface';
import { CompressedJSONStreamInterface, CompressionMethods } from '@sports-alliance/sports-lib/lib/streams/compressed.stream.interface';

// Mock Pako since it's used internally
vi.mock('pako', () => ({
    gzip: vi.fn((data) => new Uint8Array(Buffer.from(data))),
}));

describe('EventWriter', () => {
    let adapter: FirestoreAdapter;
    let storageAdapter: any;
    let writer: EventWriter;
    let eventMock: any;
    let activityMock: any;
    let streamMock: any;

    beforeEach(() => {
        adapter = {
            setDoc: vi.fn().mockResolvedValue(undefined),
            createBlob: vi.fn((data) => data), // Simple pass-through for mock
            generateID: vi.fn().mockReturnValue('generated-id'),
        };
        storageAdapter = {
            uploadFile: vi.fn().mockResolvedValue(undefined),
            getBucketName: vi.fn().mockReturnValue('quantified-self-io'),
        };
        writer = new EventWriter(adapter, storageAdapter);

        streamMock = {
            type: 'heartrate',
            data: [1, 2, 3],
            toJSON: () => ({ type: 'heartrate', data: [1, 2, 3] }),
        };

        activityMock = {
            getID: vi.fn().mockReturnValue('activity-1'),
            setID: vi.fn(),
            toJSON: vi.fn().mockReturnValue({ id: 'activity-1', streams: {} }),
            getAllExportableStreams: vi.fn().mockReturnValue([streamMock]),
        };

        eventMock = {
            getID: vi.fn().mockReturnValue('event-1'),
            setID: vi.fn(),
            getActivities: vi.fn().mockReturnValue([activityMock]),
            toJSON: vi.fn().mockReturnValue({ id: 'event-1', activities: [] }),
        };
    });

    it('should write activities, streams, and event in order', async () => {
        await writer.writeAllEventData('user-1', eventMock);

        // Verify calls
        const setDocFn = adapter.setDoc as any;

        // 1. Activity write
        expect(setDocFn).toHaveBeenCalledWith(
            ['users', 'user-1', 'events', 'event-1', 'activities', 'activity-1'],
            expect.objectContaining({ id: 'activity-1' })
        );

        // 2. Stream write
        // 2. Stream write - SHOULD NOT BE CALLED ANYMORE
        expect(setDocFn).not.toHaveBeenCalledWith(
            expect.arrayContaining(['streams']),
            expect.anything()
        );

        // 3. Event write
        expect(setDocFn).toHaveBeenCalledWith(
            ['users', 'user-1', 'events', 'event-1'],
            expect.objectContaining({ id: 'event-1' })
        );
    });

    it('should upload original file if provided', async () => {
        const originalFile = {
            data: Buffer.from('test'),
            extension: 'fit'
        };
        await writer.writeAllEventData('user-1', eventMock, originalFile);

        expect(storageAdapter.uploadFile).toHaveBeenCalledWith(
            'users/user-1/events/event-1/original.fit',
            originalFile.data
        );

        const setDocFn = adapter.setDoc as any;
        expect(setDocFn).toHaveBeenCalledWith(
            ['users', 'user-1', 'events', 'event-1'],
            expect.objectContaining({
                originalFile: {
                    path: 'users/user-1/events/event-1/original.fit',
                    bucket: 'quantified-self-io',
                }
            })
        );
    });

    it('should generate IDs if missing', async () => {
        eventMock.getID.mockReturnValue(null);
        activityMock.getID.mockReturnValue(null);

        await writer.writeAllEventData('user-1', eventMock);

        expect(adapter.generateID).toHaveBeenCalled();
        expect(eventMock.setID).toHaveBeenCalledWith('generated-id');
        expect(activityMock.setID).toHaveBeenCalledWith('generated-id');
    });

    it('should NOT write streams even if large', async () => {
        // Streams are no longer written, so this test just ensures no stream writes occur
        await writer.writeAllEventData('user-1', eventMock);
        const setDocFn = adapter.setDoc as any;
        const streamCall = setDocFn.mock.calls.find(call => call[0].includes('streams'));
        expect(streamCall).toBeUndefined();
    });

    it('should strip streams from activity document', async () => {
        await writer.writeAllEventData('user-1', eventMock);
        const setDocFn = adapter.setDoc as any;

        // Find the activity write call
        const activityCall = setDocFn.mock.calls.find(call =>
            call[0].includes('activities') && !call[0].includes('streams')
        );

        expect(activityCall).toBeTruthy();
        const activityData = activityCall[1];
        expect(activityData).not.toHaveProperty('streams');
        expect(activityData.id).toBe('activity-1');
    });

    it('should strip activities from event document', async () => {
        // Ensure the mock returns activities initially so we can verify they are removed
        eventMock.toJSON.mockReturnValue({ id: 'event-1', activities: [{ id: 'activity-1' }] });

        await writer.writeAllEventData('user-1', eventMock);
        const setDocFn = adapter.setDoc as any;

        // Find the event write call (shortest path ending in event-1)
        const eventCall = setDocFn.mock.calls.find(call =>
            call[0].length === 4 && call[0][3] === 'event-1'
        );

        expect(eventCall).toBeTruthy();
        const eventData = eventCall[1];
        expect(eventData).not.toHaveProperty('activities');
        expect(eventData.id).toBe('event-1');
    });
});
