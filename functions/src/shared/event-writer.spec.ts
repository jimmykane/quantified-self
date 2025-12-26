import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventWriter, FirestoreAdapter, LogAdapter } from './event-writer';




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
            extension: 'fit',
            startDate: new Date(),
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
                originalFile: expect.objectContaining({
                    path: 'users/user-1/events/event-1/original.fit',
                    bucket: 'quantified-self-io',
                    startDate: originalFile.startDate,
                }),
                originalFiles: expect.arrayContaining([
                    expect.objectContaining({
                        path: 'users/user-1/events/event-1/original.fit',
                        bucket: 'quantified-self-io',
                        startDate: originalFile.startDate,
                    })
                ])
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
        const streamCall = setDocFn.mock.calls.find((call: any) => call[0].includes('streams'));
        expect(streamCall).toBeUndefined();
    });

    it('should strip streams from activity document', async () => {
        await writer.writeAllEventData('user-1', eventMock);
        const setDocFn = adapter.setDoc as any;

        // Find the activity write call
        const activityCall = setDocFn.mock.calls.find((call: any) =>
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
        const eventCall = setDocFn.mock.calls.find((call: any) =>
            call[0].length === 4 && call[0][3] === 'event-1'
        );

        expect(eventCall).toBeTruthy();
        const eventData = eventCall[1];
        expect(eventData).not.toHaveProperty('activities');
        expect(eventData.id).toBe('event-1');
    });

    describe('LogAdapter', () => {
        let mockLogger: LogAdapter;

        beforeEach(() => {
            mockLogger = {
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
            };
        });

        it('should use custom logger when provided', async () => {
            const writerWithLogger = new EventWriter(adapter, storageAdapter, undefined, mockLogger);
            await writerWithLogger.writeAllEventData('user-1', eventMock);

            expect(mockLogger.info).toHaveBeenCalled();
        });

        it('should log info on successful write', async () => {
            const writerWithLogger = new EventWriter(adapter, storageAdapter, undefined, mockLogger);
            await writerWithLogger.writeAllEventData('user-1', eventMock);

            // Should log at start
            expect(mockLogger.info).toHaveBeenCalledWith(
                'writeAllEventData called',
                expect.objectContaining({ userID: 'user-1', eventID: 'event-1' })
            );
        });

        it('should log info during file upload', async () => {
            const writerWithLogger = new EventWriter(adapter, storageAdapter, undefined, mockLogger);
            const originalFile = {
                data: Buffer.from('test'),
                extension: 'fit',
                startDate: new Date(),
            };

            await writerWithLogger.writeAllEventData('user-1', eventMock, originalFile);

            // Should log upload progress
            expect(mockLogger.info).toHaveBeenCalledWith(
                expect.stringContaining('Uploading file'),
                expect.any(String)
            );
            // Should log upload complete
            expect(mockLogger.info).toHaveBeenCalledWith(
                expect.stringContaining('Upload complete')
            );
        });

        it('should log warn when no storage adapter is provided', async () => {
            const writerWithoutStorage = new EventWriter(adapter, undefined, undefined, mockLogger);
            const originalFile = {
                data: Buffer.from('test'),
                extension: 'fit',
            };

            await writerWithoutStorage.writeAllEventData('user-1', eventMock, originalFile);

            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.stringContaining('Skipping file upload'),
                expect.any(String),
                expect.any(Boolean)
            );
        });

        it('should log error when write fails', async () => {
            const failingAdapter: FirestoreAdapter = {
                setDoc: vi.fn().mockRejectedValue(new Error('Firestore write failed')),
                createBlob: vi.fn((data) => data),
                generateID: vi.fn().mockReturnValue('generated-id'),
            };

            const writerWithFailingAdapter = new EventWriter(failingAdapter, undefined, undefined, mockLogger);

            await expect(writerWithFailingAdapter.writeAllEventData('user-1', eventMock))
                .rejects.toThrow('Could not write event data');

            expect(mockLogger.error).toHaveBeenCalled();
        });

        it('should use default console logger when no logger is provided', async () => {
            // Spy on console methods
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });

            const writerWithDefaultLogger = new EventWriter(adapter, storageAdapter);
            await writerWithDefaultLogger.writeAllEventData('user-1', eventMock);

            // Default logger should use console.log for info
            expect(consoleSpy).toHaveBeenCalled();

            consoleSpy.mockRestore();
        });
    });
});

