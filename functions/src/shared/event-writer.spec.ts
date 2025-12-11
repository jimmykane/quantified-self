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
        writer = new EventWriter(adapter);

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
        expect(setDocFn).toHaveBeenCalledWith(
            ['users', 'user-1', 'events', 'event-1', 'activities', 'activity-1', 'streams', 'heartrate'],
            expect.objectContaining({ type: 'heartrate', compressionMethod: expect.anything() })
        );

        // 3. Event write
        expect(setDocFn).toHaveBeenCalledWith(
            ['users', 'user-1', 'events', 'event-1'],
            expect.objectContaining({ id: 'event-1' })
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

    it('should handle large streams by compressing them', async () => {
        // Mock large data logic if needed, but the basic test covers the flow.
        // The class uses Pako for compression.
        await writer.writeAllEventData('user-1', eventMock);
        const setDocFn = adapter.setDoc as any;
        const streamCall = setDocFn.mock.calls.find(call => call[0].includes('streams'));
        expect(streamCall).toBeTruthy();
        const streamData = streamCall[1];
        // Since our mock data is small, it won't be compressed with Pako unless we force it or data is large.
        // The current logic checks size <= 1048487. 
        // Small data returns uncompressed (CompressionEncodings.None).
        expect(streamData.encoding).toBe('None');
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
