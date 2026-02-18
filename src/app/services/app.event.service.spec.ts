import { TestBed } from '@angular/core/testing';
import { AppEventService } from './app.event.service';
import { Firestore, doc, docData, collection, collectionData, deleteDoc, setDoc, writeBatch } from '@angular/fire/firestore';
import { Storage } from '@angular/fire/storage';
import { Auth } from '@angular/fire/auth';
import { AppAnalyticsService } from './app.analytics.service';
import { AppUserService } from './app.user.service';
import { LoggerService } from './logger.service';
import { AppFileService } from './app.file.service';
import { BrowserCompatibilityService } from './browser.compatibility.service';
import { AppEventUtilities } from '../utils/app.event.utilities';
import { vi, describe, it, expect, beforeEach, afterEach, Mock } from 'vitest';
import { of, firstValueFrom, Subject } from 'rxjs';
import { AppCacheService } from './app.cache.service';
import { getMetadata } from '@angular/fire/storage';
import { webcrypto } from 'node:crypto';

// Polyfill crypto for JSDOM environment
if (!globalThis.crypto || !globalThis.crypto.subtle) {
    Object.defineProperty(globalThis, 'crypto', {
        value: webcrypto,
        configurable: true,
        enumerable: true,
        writable: true
    });
}

// Hoist mocks
const mocks = vi.hoisted(() => {
    return {
        writeAllEventData: vi.fn(),
        getEventFromJSON: vi.fn(),
        getActivityFromJSON: vi.fn(),
        sanitize: vi.fn(),
        getCountFromServer: vi.fn(),
        getBytes: vi.fn(),
        batchSet: vi.fn(),
        batchCommit: vi.fn(),
    };
});

// Mock @angular/fire/firestore
vi.mock('@angular/fire/firestore', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@angular/fire/firestore')>();
    return {
        ...actual,
        doc: vi.fn(),
        docData: vi.fn(),
        collection: vi.fn(),
        collectionData: vi.fn(),
        query: vi.fn(),
        where: vi.fn(),
        deleteDoc: vi.fn(),
        setDoc: vi.fn(),
        writeBatch: vi.fn(() => ({
            set: mocks.batchSet,
            commit: mocks.batchCommit,
        })),
        getCountFromServer: mocks.getCountFromServer,
        runInInjectionContext: vi.fn((injector, fn) => fn()),
    };
});

// Mock @angular/fire/storage
vi.mock('@angular/fire/storage', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@angular/fire/storage')>();
    return {
        ...actual,
        ref: vi.fn(),
        getBytes: mocks.getBytes,
        uploadBytes: vi.fn(),
        getMetadata: vi.fn(),
        runInInjectionContext: vi.fn((injector, fn) => fn()),
    };
});

// Mock @sports-alliance/sports-lib
vi.mock('@sports-alliance/sports-lib', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@sports-alliance/sports-lib')>();
    return {
        ...actual,
        EventImporterJSON: {
            getEventFromJSON: mocks.getEventFromJSON,
            getActivityFromJSON: mocks.getActivityFromJSON,
        },
    };
});

// Mock EventJSONSanitizer
vi.mock('../utils/event-json-sanitizer', () => ({
    EventJSONSanitizer: {
        sanitize: mocks.sanitize
    }
}));

// Mock EventWriter as a class
vi.mock('../../../functions/src/shared/event-writer', () => {
    return {
        EventWriter: class {
            writeAllEventData = mocks.writeAllEventData;
        },
        FirestoreAdapter: {},
        StorageAdapter: {},
        OriginalFile: {}
    };
});

describe('AppEventService', () => {
    let service: AppEventService;
    const mockFirestore = {};
    const mockStorage = { getBucketName: () => 'test-bucket' };
    const mockAuth = {};
    const mockAnalytics = { logEvent: vi.fn() };
    const mockUser = {
        isPro: vi.fn().mockResolvedValue(true),
        getSubscriptionRole: vi.fn().mockResolvedValue('pro'),
        uid: 'test-uid'
    };
    const mockLogger = { log: vi.fn(), error: vi.fn(), warn: vi.fn(), captureMessage: vi.fn(), captureException: vi.fn() };
    const mockFileService = {};
    const mockCompatibility = { checkCompressionSupport: vi.fn().mockReturnValue(true) };

    const originalCompressionStream = globalThis.CompressionStream;
    const originalResponse = globalThis.Response;

    const mockCacheService = {
        getFile: vi.fn(),
        setFile: vi.fn()
    };

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                AppEventService,
                { provide: Firestore, useValue: mockFirestore },
                { provide: Storage, useValue: mockStorage },
                { provide: Auth, useValue: mockAuth },
                { provide: AppAnalyticsService, useValue: mockAnalytics },
                { provide: AppUserService, useValue: mockUser },
                { provide: LoggerService, useValue: mockLogger },
                { provide: AppFileService, useValue: mockFileService },
                { provide: BrowserCompatibilityService, useValue: mockCompatibility },
                { provide: AppFileService, useValue: mockFileService },
                { provide: BrowserCompatibilityService, useValue: mockCompatibility },
                { provide: AppEventUtilities, useValue: { enrich: vi.fn() } },
                { provide: AppCacheService, useValue: mockCacheService }
            ]
        });
        service = TestBed.inject(AppEventService);
        vi.clearAllMocks();

        // Default mock implementations
        mocks.sanitize.mockImplementation((json: any) => ({ sanitizedJson: json, unknownTypes: [], issues: [] }));
        // Reset static dedupe sets between tests
        (AppEventService as any).reportedUnknownTypes = new Map<string, number>();
        (AppEventService as any).reportedSanitizerIssues = new Map<string, number>();
        (AppEventService as any).reportedSanitizerEvents = new Map<string, number>();
        mocks.getEventFromJSON.mockReturnValue({
            setID: vi.fn().mockReturnThis(),
            clearActivities: vi.fn(),
            addActivities: vi.fn(),
            getID: vi.fn().mockReturnValue('event1'),
            toJSON: vi.fn().mockReturnValue({}),
            getActivities: vi.fn().mockReturnValue([]),
            startDate: new Date()
        });
        mocks.getActivityFromJSON.mockReturnValue({
            setID: vi.fn().mockReturnThis(),
            toJSON: vi.fn().mockReturnValue({})
        });
        mocks.getCountFromServer.mockResolvedValue({ data: () => ({ count: 0 }) });
        mocks.batchCommit.mockResolvedValue(undefined);
        mocks.writeAllEventData.mockResolvedValue(true);

        // Polyfills
        // @ts-expect-error - JSDOM does not provide CompressionStream
        globalThis.CompressionStream = vi.fn().mockImplementation(() => ({
            writable: {}, readable: {}
        }));
        // @ts-expect-error - JSDOM does not provide Response in this shape
        globalThis.Response = vi.fn().mockImplementation((_data) => ({
            body: {
                pipeThrough: vi.fn().mockReturnValue({}),
            },
            arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8))
        }));
    });

    afterEach(() => {
        // @ts-expect-error - JSDOM does not provide CompressionStream
        globalThis.CompressionStream = originalCompressionStream;
        // @ts-expect-error - JSDOM does not provide Response in this shape
        globalThis.Response = originalResponse;
        vi.restoreAllMocks();
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    it('should skip compression if browser not supported', async () => {
        mockCompatibility.checkCompressionSupport.mockReturnValue(false);
        const mockEvent = {
            getID: () => '1',
            startDate: new Date(),
            getActivities: () => [],
            setID: vi.fn()
        } as any;
        const originalFiles = [{ extension: 'gpx', data: 'content', startDate: new Date() }] as any;

        await service.writeAllEventData({ uid: 'user1' } as any, mockEvent, originalFiles);

        expect(globalThis.CompressionStream).not.toHaveBeenCalled();
        expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Compression skipped'));
        expect(mocks.writeAllEventData).toHaveBeenCalled();
    });

    it('should get event and activities correctly', async () => {
        const userId = 'user1';
        const eventId = 'event1';
        const user = { uid: userId } as any;

        const mockEventData = { id: eventId, name: 'Test Event' };
        const mockActivityData = { id: 'act1', type: 'Run' };

        (doc as Mock).mockReturnValue({}); // eventDoc
        (docData as Mock).mockReturnValue(of(mockEventData));
        (collection as Mock).mockReturnValue({}); // activitiesCollection
        (collectionData as Mock).mockReturnValue(of([mockActivityData]));

        const result = await service.getEventAndActivities(user, eventId).toPromise();

        expect(doc).toHaveBeenCalledWith(expect.anything(), 'users', userId, 'events', eventId);
        expect(docData).toHaveBeenCalled();
        expect(collection).toHaveBeenCalledWith(expect.anything(), 'users', userId, 'activities');
        expect(collectionData).toHaveBeenCalled();

        expect(mockLogger.error).not.toHaveBeenCalled();
        expect(result).toBeTruthy();
        expect(result!.getID()).toBe('event1');
    });

    it('should emit live event details updates when event metadata changes', async () => {
        const userId = 'user1';
        const eventId = 'event1';
        const user = { uid: userId } as any;

        const firstSnapshot = { id: eventId, name: 'Initial Name' };
        const secondSnapshot = { id: eventId, name: 'Updated Name' };
        const mockActivityData = { id: 'act1', eventID: eventId, type: 'Run' };
        const eventSnapshots$ = new Subject<any>();
        const emissions: any[] = [];

        (doc as Mock).mockReturnValue({});
        (collection as Mock).mockReturnValue({});
        (docData as Mock).mockReturnValue(eventSnapshots$.asObservable());
        (collectionData as Mock).mockReturnValue(of([mockActivityData]));
        mocks.sanitize.mockImplementation((json: any) => ({ sanitizedJson: json, unknownTypes: [], issues: [] }));
        mocks.getEventFromJSON.mockImplementation((json: any) => {
            const event: any = {
                name: json.name,
                activities: [],
                setID: vi.fn().mockReturnThis(),
                clearActivities: vi.fn(() => {
                    event.activities = [];
                }),
                addActivities: vi.fn((activities: any[]) => {
                    event.activities = activities;
                }),
                getActivities: vi.fn(() => event.activities),
                getID: vi.fn(() => eventId),
            };
            return event;
        });

        const subscription = service.getEventDetailsLive(user, eventId).subscribe((event) => {
            emissions.push(event);
        });
        eventSnapshots$.next(firstSnapshot);
        eventSnapshots$.next(secondSnapshot);
        await Promise.resolve();
        subscription.unsubscribe();

        expect(emissions).toHaveLength(2);
        expect((emissions[0] as any).name).toBe('Initial Name');
        expect((emissions[1] as any).name).toBe('Updated Name');
    });

    it('should suppress duplicate live event-detail emissions for unchanged snapshots', async () => {
        const userId = 'user1';
        const eventId = 'event1';
        const user = { uid: userId } as any;

        const snapshot = { id: eventId, name: 'Same Name' };
        const mockActivityData = { id: 'act1', eventID: eventId, type: 'Run' };
        const eventSnapshots$ = new Subject<any>();
        const emissions: any[] = [];

        (doc as Mock).mockReturnValue({});
        (collection as Mock).mockReturnValue({});
        (docData as Mock).mockReturnValue(eventSnapshots$.asObservable());
        (collectionData as Mock).mockReturnValue(of([mockActivityData]));
        mocks.sanitize.mockImplementation((json: any) => ({ sanitizedJson: json, unknownTypes: [], issues: [] }));
        mocks.getEventFromJSON.mockImplementation((json: any) => {
            const event: any = {
                name: json.name,
                activities: [],
                setID: vi.fn().mockReturnThis(),
                clearActivities: vi.fn(() => {
                    event.activities = [];
                }),
                addActivities: vi.fn((activities: any[]) => {
                    event.activities = activities;
                }),
                getActivities: vi.fn(() => event.activities),
                getID: vi.fn(() => eventId),
            };
            return event;
        });

        const subscription = service.getEventDetailsLive(user, eventId).subscribe((event) => {
            emissions.push(event);
        });
        eventSnapshots$.next(snapshot);
        eventSnapshots$.next(snapshot);
        await Promise.resolve();
        subscription.unsubscribe();

        expect(emissions).toHaveLength(1);
        expect((emissions[0] as any).name).toBe('Same Name');
    });

    it('should warn and send to Sentry when sanitizer reports malformed activity issues', async () => {
        const userId = 'user1';
        const eventId = 'event1';
        const user = { uid: userId } as any;
        const activityId = 'activity-1';

        const mockActivityData = {
            id: activityId,
            eventID: eventId,
            stats: {},
            laps: [],
            streams: [],
            intensityZones: [],
            events: [{ type: 'Jump Event', data: null }]
        };
        const issues = [{
            kind: 'malformed_event_payload',
            location: 'events',
            path: 'events[0].Jump Event',
            type: 'Jump Event',
            reason: 'Removed event with malformed payload'
        }];

        (collection as Mock).mockReturnValue({});
        (collectionData as Mock).mockReturnValue(of([mockActivityData]));
        mocks.sanitize.mockReturnValue({
            sanitizedJson: { ...mockActivityData, events: [] },
            unknownTypes: [],
            issues
        });

        const activities = await firstValueFrom(service.getActivities(user, eventId));

        expect(activities.length).toBe(1);
        expect(mockLogger.warn).toHaveBeenCalledWith(
            '[AppEventService] Sanitized malformed activity data',
            expect.objectContaining({
                eventID: eventId,
                activityID: activityId,
                issues
            })
        );
        expect(mockLogger.captureException).toHaveBeenCalledWith(
            expect.any(Error),
            expect.objectContaining({
                extra: expect.objectContaining({
                    eventID: eventId,
                    activityID: activityId,
                    issues
                })
            })
        );
    });

    it('should keep unknown-type reporting via captureMessage without captureException', async () => {
        const userId = 'user1';
        const eventId = 'event1';
        const user = { uid: userId } as any;
        const activityId = 'activity-2';

        const mockActivityData = {
            id: activityId,
            eventID: eventId,
            stats: { UnknownType: 10 },
            laps: [],
            streams: [],
            intensityZones: [],
            events: []
        };

        (collection as Mock).mockReturnValue({});
        (collectionData as Mock).mockReturnValue(of([mockActivityData]));
        mocks.sanitize.mockReturnValue({
            sanitizedJson: { ...mockActivityData, stats: {} },
            unknownTypes: ['UnknownType'],
            issues: [{
                kind: 'unknown_data_type',
                location: 'stats',
                path: 'stats.UnknownType',
                type: 'UnknownType',
                reason: 'Removed unknown stat data type'
            }]
        });

        const activities = await firstValueFrom(service.getActivities(user, eventId));

        expect(activities.length).toBe(1);
        expect(mockLogger.captureMessage).toHaveBeenCalledWith(
            'Unknown Data Types in getActivities',
            expect.objectContaining({
                extra: expect.objectContaining({
                    eventID: eventId,
                    activityID: activityId,
                    types: ['UnknownType']
                })
            })
        );
        expect(mockLogger.captureException).not.toHaveBeenCalled();
    });

    it('should cap issue payload size and include Sentry fingerprint', async () => {
        const eventId = 'event-issues-cap';
        const activityId = 'activity-cap';
        const user = { uid: 'user1' } as any;

        const mockActivityData = {
            id: activityId,
            eventID: eventId,
            stats: {},
            laps: [],
            streams: [],
            intensityZones: [],
            events: []
        };

        const manyIssues = Array.from({ length: 25 }, (_, i) => ({
            kind: 'malformed_event_payload',
            location: 'events',
            path: `events[${i}].Jump Event`,
            type: 'Jump Event',
            reason: 'Removed event with malformed payload'
        }));

        (collection as Mock).mockReturnValue({});
        (collectionData as Mock).mockReturnValue(of([mockActivityData]));
        mocks.sanitize.mockReturnValue({
            sanitizedJson: mockActivityData,
            unknownTypes: [],
            issues: manyIssues
        });

        await firstValueFrom(service.getActivities(user, eventId));

        expect(mockLogger.captureException).toHaveBeenCalledTimes(1);
        expect(mockLogger.captureException).toHaveBeenCalledWith(
            expect.any(Error),
            expect.objectContaining({
                fingerprint: expect.arrayContaining(['activity-sanitizer', eventId, activityId, 'malformed_event_payload']),
                extra: expect.objectContaining({
                    issueCount: 25,
                    issuesTruncated: 5,
                    issues: expect.any(Array)
                })
            })
        );

        const captureArgs = (mockLogger.captureException as Mock).mock.calls[0][1];
        expect(captureArgs.extra.issues.length).toBe(20);
    });

    it('should rate-limit Sentry malformed-data reports with same summary signature', async () => {
        const eventId = 'event-rate-limit';
        const activityId = 'activity-rate-limit';
        const user = { uid: 'user1' } as any;

        const mockActivityData = {
            id: activityId,
            eventID: eventId,
            stats: {},
            laps: [],
            streams: [],
            intensityZones: [],
            events: []
        };

        (collection as Mock).mockReturnValue({});
        (collectionData as Mock).mockReturnValue(of([mockActivityData]));
        mocks.sanitize
            .mockReturnValueOnce({
                sanitizedJson: mockActivityData,
                unknownTypes: [],
                issues: [{
                    kind: 'malformed_event_payload',
                    location: 'events',
                    path: 'events[0].Jump Event',
                    type: 'Jump Event',
                    reason: 'Removed event with malformed payload'
                }]
            })
            .mockReturnValueOnce({
                sanitizedJson: mockActivityData,
                unknownTypes: [],
                issues: [{
                    kind: 'malformed_event_payload',
                    location: 'events',
                    path: 'events[1].Jump Event',
                    type: 'Jump Event',
                    reason: 'Removed event with malformed payload'
                }]
            });

        await firstValueFrom(service.getActivities(user, eventId));
        await firstValueFrom(service.getActivities(user, eventId));

        // Warn happens for new issue keys, but Sentry exception is deduped by summary signature TTL cache.
        expect(mockLogger.warn).toHaveBeenCalledTimes(2);
        expect(mockLogger.captureException).toHaveBeenCalledTimes(1);
    });

    it('should delete all event data', async () => {
        const userId = 'user1';
        const eventId = 'event1';
        const user = { uid: userId } as any;

        (doc as Mock).mockReturnValue({});
        (deleteDoc as Mock).mockResolvedValue(undefined);

        const result = await service.deleteAllEventData(user, eventId);

        expect(doc).toHaveBeenCalledWith(expect.anything(), 'users', userId, 'events', eventId);
        expect(deleteDoc).toHaveBeenCalled();
        expect(result).toBe(true);
    });

    it('should strip streams before writing activity in setActivity', async () => {
        const user = { uid: 'user1' } as any;
        const event = { getID: () => 'event1', startDate: new Date('2026-01-01T00:00:00.000Z') } as any;
        const activity = {
            getID: () => 'activity1',
            toJSON: () => ({
                stats: {},
                streams: [
                    { type: 'Pace', values: [1, 2, 3] }
                ]
            })
        } as any;

        (doc as Mock).mockReturnValue({});
        (setDoc as Mock).mockResolvedValue(undefined);

        await service.setActivity(user, event, activity);

        expect(setDoc).toHaveBeenCalledTimes(1);
        const writtenPayload = (setDoc as Mock).mock.calls[0][1];
        expect(writtenPayload).not.toHaveProperty('streams');
        expect(writtenPayload.eventID).toBe('event1');
        expect(writtenPayload.userID).toBe('user1');
        expect(writtenPayload.eventStartDate).toEqual(event.startDate);
    });

    it('should preserve original file metadata and merge on setEvent', async () => {
        const user = { uid: 'user1' } as any;
        const event = {
            getID: () => 'event1',
            toJSON: () => ({ name: 'My Event' }),
            originalFiles: [{ path: 'users/user1/events/event1/original.fit', startDate: new Date('2026-01-01T00:00:00.000Z') }],
            originalFile: { path: 'users/user1/events/event1/original.fit', startDate: new Date('2026-01-01T00:00:00.000Z') },
        } as any;

        (doc as Mock).mockReturnValue({});
        (setDoc as Mock).mockResolvedValue(undefined);

        await service.setEvent(user, event);

        expect(setDoc).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                name: 'My Event',
                originalFiles: event.originalFiles,
                originalFile: event.originalFile,
            }),
            { merge: true }
        );
    });

    it('should atomically write activity and event in writeActivityAndEventData', async () => {
        const user = { uid: 'user1' } as any;
        const event = {
            getID: () => 'event1',
            startDate: new Date('2026-01-01T00:00:00.000Z'),
            toJSON: () => ({ name: 'My Event' }),
            originalFile: { path: 'users/user1/events/event1/original.fit', startDate: new Date('2026-01-01T00:00:00.000Z') },
        } as any;
        const activity = {
            getID: () => 'activity1',
            toJSON: () => ({
                creator: { name: 'Device A' },
                streams: [{ type: 'Pace', values: [1, 2, 3] }]
            }),
        } as any;

        (doc as Mock).mockReturnValue({});

        await service.writeActivityAndEventData(user, event, activity);

        expect(writeBatch).toHaveBeenCalledTimes(1);
        expect(mocks.batchSet).toHaveBeenCalledTimes(2);
        expect(mocks.batchSet).toHaveBeenNthCalledWith(
            1,
            expect.anything(),
            expect.objectContaining({
                creator: { name: 'Device A' },
                userID: 'user1',
                eventID: 'event1',
                eventStartDate: event.startDate,
            }),
            { merge: true }
        );
        const firstPayload = mocks.batchSet.mock.calls[0][1];
        expect(firstPayload.streams).toBeUndefined();

        expect(mocks.batchSet).toHaveBeenNthCalledWith(
            2,
            expect.anything(),
            expect.objectContaining({
                name: 'My Event',
                originalFile: event.originalFile,
            }),
            { merge: true }
        );
        expect(mocks.batchCommit).toHaveBeenCalledTimes(1);
    });

    it('should call EventWriter in writeAllEventData', async () => {
        const mockEvent = {
            getID: () => '1',
            startDate: new Date(),
            getActivities: () => [],
            setID: vi.fn()
        } as any;
        const user = { uid: 'user1' } as any;
        (doc as Mock).mockReturnValue({});

        await service.writeAllEventData(user, mockEvent);

        expect(mocks.writeAllEventData).toHaveBeenCalled();
        expect(doc).toHaveBeenCalledWith(expect.anything(), 'users', 'user1', 'events', '1', 'metaData', 'processing');
        expect(setDoc).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            sportsLibVersion: expect.any(String),
            processedAt: expect.anything(),
        }));
    });

    describe('ID generation with zero bucketing', () => {
        it('should call generateEventID with thresholdMs=0 for frontend uploads', async () => {
            // Mock generateEventID to track calls
            const generateEventIDSpy = vi.spyOn(await import('../../../functions/src/shared/id-generator'), 'generateEventID');
            generateEventIDSpy.mockResolvedValue('mock-event-id');

            const mockEvent = {
                getID: () => null, // No ID yet - should trigger generation
                startDate: new Date('2025-12-28T12:00:00.000Z'),
                getActivities: () => [],
                setID: vi.fn()
            } as any;
            const user = { uid: 'user1' } as any;

            await service.writeAllEventData(user, mockEvent);

            expect(generateEventIDSpy).toHaveBeenCalledWith('user1', mockEvent.startDate, 0);
            expect(mockEvent.setID).toHaveBeenCalledWith('mock-event-id');

            generateEventIDSpy.mockRestore();
        });

        it('should generate unique IDs for events with same startDate (no bucketing)', async () => {
            const { generateEventID } = await import('../../../functions/src/shared/id-generator');

            // Same timestamp, different milliseconds shouldn't matter with threshold=0
            const date1 = new Date('2025-12-28T12:00:00.000Z');
            const date2 = new Date('2025-12-28T12:00:00.001Z'); // 1ms later

            const id1 = await generateEventID('user1', date1, 0);
            const id2 = await generateEventID('user1', date2, 0);

            expect(id1).not.toBe(id2);
        });

        it('should skip ID generation if event already has ID', async () => {
            const generateEventIDSpy = vi.spyOn(await import('../../../functions/src/shared/id-generator'), 'generateEventID');
            const mockEvent = {
                getID: () => 'existing-id', // Already has ID
                startDate: new Date(),
                getActivities: () => [],
                setID: vi.fn()
            } as any;
            const user = { uid: 'user1' } as any;

            await service.writeAllEventData(user, mockEvent);

            expect(generateEventIDSpy).not.toHaveBeenCalled();
            expect(mockEvent.setID).not.toHaveBeenCalled();

            generateEventIDSpy.mockRestore();
        });
    });

    describe('Upload Limit Enforcement', () => {
        it('should bypass limit check if grace period is active', async () => {
            const mockEvent = {
                getID: () => '1',
                startDate: new Date(),
                getActivities: () => [],
                setID: vi.fn(),
                toJSON: () => ({})
            } as any;
            const user = { uid: 'user1', gracePeriodUntil: Date.now() + 100000 } as any;

            // Mock userService to return non-pro
            mockUser.isPro.mockResolvedValue(false);
            mockUser.getSubscriptionRole.mockResolvedValue('free');

            // Mock count to be over limit
            mocks.getCountFromServer.mockResolvedValue({ data: () => ({ count: 15 }) });

            await service.writeAllEventData(user, mockEvent);

            expect(mocks.writeAllEventData).toHaveBeenCalled();
            // Should NOT have thrown an error
        });

        it('should throw error if NOT pro, NOT in grace period, and OVER limit', async () => {
            const mockEvent = {
                getID: () => '1',
                startDate: new Date(),
                getActivities: () => [],
                setID: vi.fn(),
                toJSON: () => ({})
            } as any;
            const user = { uid: 'user1' } as any;

            // Mock userService to return non-pro
            mockUser.isPro.mockResolvedValue(false);
            mockUser.getSubscriptionRole.mockResolvedValue('free');

            // Mock count to be over limit
            mocks.getCountFromServer.mockResolvedValue({ data: () => ({ count: 15 }) });

            await expect(service.writeAllEventData(user, mockEvent)).rejects.toThrow(/Upload limit reached/);
        });
    });

    // Note: Testing compressed file size rejection would require complex mocking
    // of the Response/CompressionStream chain. The size check is verified to work
    // by the implementation in app.event.service.ts lines 347-350.


    it('should reject non-compressible files larger than 10MB', async () => {
        const largeBuffer = new ArrayBuffer(11 * 1024 * 1024);
        const mockEvent = {
            getID: () => '1',
            startDate: new Date(),
            getActivities: () => [],
            setID: vi.fn()
        } as any;
        // FIT is non-compressible
        const originalFiles = [{ extension: 'fit', data: largeBuffer, startDate: new Date() }] as any;

        await expect(service.writeAllEventData({ uid: 'user1' } as any, mockEvent, originalFiles))
            .rejects.toThrow('File is too large');
    });

    it('should allow compressed files under 10MB', async () => {
        // Mock Response to return a small compressed buffer (5MB)
        const smallBuffer = new ArrayBuffer(5 * 1024 * 1024);
        // @ts-expect-error - JSDOM Response mocked for compression test
        globalThis.Response = vi.fn().mockImplementation(() => ({
            body: {
                pipeThrough: vi.fn().mockReturnValue({}),
            },
            arrayBuffer: vi.fn().mockResolvedValue(smallBuffer)
        }));

        const mockEvent = {
            getID: () => '1',
            startDate: new Date(),
            getActivities: () => [],
            setID: vi.fn()
        } as any;
        const originalFiles = [{ extension: 'gpx', data: new ArrayBuffer(100), startDate: new Date() }] as any;

        await expect(service.writeAllEventData({ uid: 'user1' } as any, mockEvent, originalFiles))
            .resolves.not.toThrow();
    });
    // ... existing tests ...

    describe('downloadFile', () => {
        const testPath = 'test/path/file.json';
        const testBuffer = new ArrayBuffer(8);
        const testGeneration = '12345';

        beforeEach(() => {
            // Default mocks
            vi.mocked(getMetadata).mockResolvedValue({ generation: testGeneration } as any);
            vi.mocked(mocks.getBytes).mockResolvedValue(testBuffer);
            // @ts-expect-error - mock private service method for test
            service.fileService.decompressIfNeeded = vi.fn().mockResolvedValue(testBuffer);
        });

        it('should return cached file if generation matches (Cache Hit)', async () => {
            mockCacheService.getFile.mockResolvedValue({ buffer: testBuffer, generation: testGeneration });

            const result = await service.downloadFile(testPath);

            expect(getMetadata).toHaveBeenCalled();
            expect(mockCacheService.getFile).toHaveBeenCalledWith(testPath);
            expect(mocks.getBytes).not.toHaveBeenCalled(); // Should NOT download
            expect(result).toBe(testBuffer);
        });

        it('should download and cache file if cache is empty (Cache Miss)', async () => {
            mockCacheService.getFile.mockResolvedValue(undefined);

            const result = await service.downloadFile(testPath);

            expect(getMetadata).toHaveBeenCalled();
            expect(mockCacheService.getFile).toHaveBeenCalledWith(testPath);
            expect(mocks.getBytes).toHaveBeenCalled(); // Should download
            expect(mockCacheService.setFile).toHaveBeenCalledWith(testPath, { buffer: testBuffer, generation: testGeneration });
            expect(result).toBe(testBuffer);
        });

        it('should download and cache file if generation does not match (Cache Stale)', async () => {
            const staleGeneration = '00000';
            mockCacheService.getFile.mockResolvedValue({ buffer: testBuffer, generation: staleGeneration });

            const result = await service.downloadFile(testPath);

            expect(getMetadata).toHaveBeenCalled();
            expect(mockCacheService.getFile).toHaveBeenCalledWith(testPath);
            expect(mocks.getBytes).toHaveBeenCalled(); // Should download
            expect(mockCacheService.setFile).toHaveBeenCalledWith(testPath, { buffer: testBuffer, generation: testGeneration });
            expect(result).toBe(testBuffer);
        });

        it('should fallback to download if metadata fetch fails', async () => {
            vi.mocked(getMetadata).mockRejectedValue(new Error('Metadata Error'));

            const result = await service.downloadFile(testPath);

            expect(getMetadata).toHaveBeenCalled();
            expect(mocks.getBytes).toHaveBeenCalled(); // Fallback download
            expect(mockCacheService.setFile).not.toHaveBeenCalled(); // Should skip caching on error
            expect(result).toBe(testBuffer);
        });

        it('should fallback to download if cache get fails', async () => {
            vi.mocked(getMetadata).mockResolvedValue({ generation: testGeneration } as any);
            mockCacheService.getFile.mockRejectedValue(new Error('Cache Error'));

            const result = await service.downloadFile(testPath);

            expect(mocks.getBytes).toHaveBeenCalled();
            expect(result).toBe(testBuffer);
        });
    });

    describe('activity ID transfer', () => {
        it('should transfer activity IDs from existing activities during client-side parsing (Single File)', async () => {
            const activityId = 'act1';

            // Mock activities from Firestore
            const mockActivity = {
                getID: vi.fn().mockReturnValue(activityId),
                setID: vi.fn().mockReturnThis(),
            } as any;

            const mockEvent = {
                getActivities: vi.fn().mockReturnValue([mockActivity]),
                originalFile: { path: 'path/to/file.fit' },
                getID: vi.fn().mockReturnValue('event1')
            } as any;

            // Mock re-parsed activity (without ID)
            const parsedActivity = {
                getID: vi.fn().mockReturnValue(null),
                setID: vi.fn().mockReturnThis(),
            } as any;
            const parsedEvent = {
                getActivities: vi.fn().mockReturnValue([parsedActivity]),
            } as any;

            // Mock fetchAndParseOneFile helper
            vi.spyOn(service as any, 'fetchAndParseOneFile').mockResolvedValue(parsedEvent);

            // Call calculateStreamsFromWithOrchestration
            const result = await (service as any).calculateStreamsFromWithOrchestration(mockEvent);

            expect(result).toBe(parsedEvent);
            expect(parsedActivity.setID).toHaveBeenCalledWith(activityId);
        });

        it('should preserve renamed creator name from existing activity during client-side parsing', async () => {
            const activityId = 'act1';

            const existingActivity = {
                getID: vi.fn().mockReturnValue(activityId),
                creator: { name: 'Renamed Device' },
            } as any;

            const mockEvent = {
                getActivities: vi.fn().mockReturnValue([existingActivity]),
                originalFile: { path: 'path/to/file.fit' },
                getID: vi.fn().mockReturnValue('event1')
            } as any;

            const parsedActivity = {
                getID: vi.fn().mockReturnValue(null),
                setID: vi.fn().mockReturnThis(),
                creator: { name: 'Original Parsed Name' },
            } as any;
            const parsedEvent = {
                getActivities: vi.fn().mockReturnValue([parsedActivity]),
            } as any;

            vi.spyOn(service as any, 'fetchAndParseOneFile').mockResolvedValue(parsedEvent);

            const result = await (service as any).calculateStreamsFromWithOrchestration(mockEvent);

            expect(result).toBe(parsedEvent);
            expect(parsedActivity.setID).toHaveBeenCalledWith(activityId);
            expect(parsedActivity.creator.name).toBe('Renamed Device');
        });

        it('should transfer activity IDs in merged events scenario (Multiple Files)', async () => {
            // Firestore activities
            const mockActivity1 = { getID: () => 'act1' } as any;
            const mockActivity2 = { getID: () => 'act2' } as any;

            const mockEvent = {
                getID: () => 'event1',
                getActivities: () => [mockActivity1, mockActivity2],
                originalFiles: [{ path: 'f1.fit' }, { path: 'f2.fit' }]
            } as any;

            // Mock re-parsed activities (without IDs)
            const parsedActivity1 = {
                getID: vi.fn().mockReturnValue(null),
                setID: vi.fn().mockReturnThis(),
            } as any;
            const parsedActivity2 = {
                getID: vi.fn().mockReturnValue(null),
                setID: vi.fn().mockReturnThis(),
            } as any;

            const parsedEvent1 = { getActivities: () => [parsedActivity1] } as any;
            const parsedEvent2 = { getActivities: () => [parsedActivity2] } as any;

            vi.spyOn(service as any, 'fetchAndParseOneFile')
                .mockResolvedValueOnce(parsedEvent1)
                .mockResolvedValueOnce(parsedEvent2);

            // Mock EventUtilities.mergeEvents
            const mergedEvent = {
                getActivities: () => [parsedActivity1, parsedActivity2]
            } as any;

            const { EventUtilities } = await import('@sports-alliance/sports-lib');
            vi.spyOn(EventUtilities, 'mergeEvents').mockReturnValue(mergedEvent);

            // Call calculateStreamsFromWithOrchestration
            const result = await (service as any).calculateStreamsFromWithOrchestration(mockEvent);

            expect(result).toBe(mergedEvent);
            expect(parsedActivity1.setID).toHaveBeenCalledWith('act1');
            expect(parsedActivity2.setID).toHaveBeenCalledWith('act2');
        });

        it('should handle mismatched activity counts gracefully (More parsed than Firestore)', async () => {
            const mockActivity1 = { getID: () => 'act1' } as any;
            const mockEvent = {
                getActivities: () => [mockActivity1],
                originalFile: { path: 'path/to/file.fit' },
                getID: () => 'event1'
            } as any;

            const parsedActivity1 = { getID: () => null, setID: vi.fn().mockReturnThis() } as any;
            const parsedActivity2 = { getID: () => null, setID: vi.fn().mockReturnThis() } as any;
            const parsedEvent = {
                getActivities: () => [parsedActivity1, parsedActivity2],
            } as any;

            vi.spyOn(service as any, 'fetchAndParseOneFile').mockResolvedValue(parsedEvent);

            const result = await (service as any).calculateStreamsFromWithOrchestration(mockEvent);

            expect(result).toBe(parsedEvent);
            expect(parsedActivity1.setID).toHaveBeenCalledWith('act1');
            expect(parsedActivity2.setID).not.toHaveBeenCalled(); // No corresponding Firestore activity
        });

        it('should handle mismatched activity counts gracefully (Fewer parsed than Firestore)', async () => {
            const mockActivity1 = { getID: () => 'act1' } as any;
            const mockActivity2 = { getID: () => 'act2' } as any;
            const mockEvent = {
                getActivities: () => [mockActivity1, mockActivity2],
                originalFile: { path: 'path/to/file.fit' },
                getID: () => 'event1'
            } as any;

            const parsedActivity1 = { getID: () => null, setID: vi.fn().mockReturnThis() } as any;
            const parsedEvent = {
                getActivities: () => [parsedActivity1],
            } as any;

            vi.spyOn(service as any, 'fetchAndParseOneFile').mockResolvedValue(parsedEvent);

            const result = await (service as any).calculateStreamsFromWithOrchestration(mockEvent);

            expect(result).toBe(parsedEvent);
            expect(parsedActivity1.setID).toHaveBeenCalledWith('act1');
        });

        it('should not crash if Firestore has no activities', async () => {
            const mockEvent = {
                getActivities: () => [],
                originalFile: { path: 'path/to/file.fit' },
                getID: () => 'event1'
            } as any;

            const parsedActivity1 = { getID: () => null, setID: vi.fn().mockReturnThis() } as any;
            const parsedEvent = {
                getActivities: () => [parsedActivity1],
            } as any;

            vi.spyOn(service as any, 'fetchAndParseOneFile').mockResolvedValue(parsedEvent);

            const result = await (service as any).calculateStreamsFromWithOrchestration(mockEvent);

            expect(result).toBe(parsedEvent);
            expect(parsedActivity1.setID).not.toHaveBeenCalled();
        });
    });

    describe('delegation', () => {
        it('should throw when event has no original file metadata', async () => {
            const event = {
                getID: () => 'event-1',
                originalFile: undefined,
                originalFiles: [],
                getActivities: vi.fn().mockReturnValue([]),
            } as any;

            await expect(firstValueFrom(
                service.attachStreamsToEventWithActivities({ uid: 'u1' } as any, event),
            )).rejects.toThrow('No original source file metadata found for event hydration.');
        });

        it('should delegate downloadFile to AppOriginalFileHydrationService', async () => {
            const hydrationService = (service as any).originalFileHydrationService;
            const expectedBuffer = new ArrayBuffer(4);
            vi.spyOn(hydrationService, 'downloadFile').mockResolvedValue(expectedBuffer);

            const result = await service.downloadFile('users/u1/events/e1/original.fit');

            expect(hydrationService.downloadFile).toHaveBeenCalledWith('users/u1/events/e1/original.fit');
            expect(result).toBe(expectedBuffer);
        });

        it('should forward downloadFile options to AppOriginalFileHydrationService', async () => {
            const hydrationService = (service as any).originalFileHydrationService;
            const expectedBuffer = new ArrayBuffer(4);
            vi.spyOn(hydrationService, 'downloadFile').mockResolvedValue(expectedBuffer);

            const result = await service.downloadFile(
                'users/u1/events/e1/original.fit',
                { metadataCacheTtlMs: 120000 },
            );

            expect(hydrationService.downloadFile).toHaveBeenCalledWith(
                'users/u1/events/e1/original.fit',
                { metadataCacheTtlMs: 120000 },
            );
            expect(result).toBe(expectedBuffer);
        });

        it('should delegate attachStreamsToEventWithActivities to parsing and attach streams only by default', async () => {
            const hydrationService = (service as any).originalFileHydrationService;
            const oldAscentStat = { getValue: () => 280.8 };
            const parsedStreams = [{ type: 'Speed' }, { type: 'Distance' }] as any[];
            const existingActivity = {
                getID: () => 'a-1',
                clearStreams: vi.fn(),
                addStreams: vi.fn(),
                getStat: vi.fn().mockImplementation((type: string) => type === 'Ascent' ? oldAscentStat : undefined),
            } as any;
            const parsedActivity = {
                getID: () => 'a-1',
                getAllStreams: vi.fn().mockReturnValue(parsedStreams),
            } as any;
            const parsedEvent = {
                setID: vi.fn().mockReturnThis(),
                getActivities: vi.fn().mockReturnValue([parsedActivity]),
            } as any;
            vi.spyOn(hydrationService, 'parseEventFromOriginalFiles').mockResolvedValue({
                finalEvent: parsedEvent,
                parsedEvents: [parsedEvent],
                sourceFilesCount: 1,
                failedFiles: []
            });

            const event = {
                getID: () => 'event-1',
                originalFile: { path: 'users/u1/events/e1/original.fit' },
                getActivities: vi.fn().mockReturnValue([existingActivity]),
                clearActivities: vi.fn(),
                addActivities: vi.fn(),
            } as any;

            const originalAscentStat = existingActivity.getStat('Ascent');
            const result = await firstValueFrom(service.attachStreamsToEventWithActivities({ uid: 'u1' } as any, event));

            expect(hydrationService.parseEventFromOriginalFiles).toHaveBeenCalledWith(
                event,
                expect.objectContaining({
                    strictAllFilesRequired: true,
                    preserveActivityIdsFromEvent: true,
                    mergeMultipleFiles: true,
                }),
            );
            expect(existingActivity.clearStreams).toHaveBeenCalledTimes(1);
            expect(existingActivity.addStreams).toHaveBeenCalledWith(parsedStreams);
            expect(existingActivity.getStat('Ascent')).toBe(originalAscentStat);
            expect(event.clearActivities).not.toHaveBeenCalled();
            expect(event.addActivities).not.toHaveBeenCalled();
            expect(result).toBe(event);
        });

        it('should pass metadata cache TTL to hydration parsing when provided', async () => {
            const hydrationService = (service as any).originalFileHydrationService;
            const parsedStreams = [{ type: 'Speed' }] as any[];
            const existingActivity = {
                getID: () => 'a-1',
                clearStreams: vi.fn(),
                addStreams: vi.fn(),
            } as any;
            const parsedActivity = {
                getID: () => 'a-1',
                getAllStreams: vi.fn().mockReturnValue(parsedStreams),
            } as any;
            const parsedEvent = {
                setID: vi.fn().mockReturnThis(),
                getActivities: vi.fn().mockReturnValue([parsedActivity]),
            } as any;
            vi.spyOn(hydrationService, 'parseEventFromOriginalFiles').mockResolvedValue({
                finalEvent: parsedEvent,
                parsedEvents: [parsedEvent],
                sourceFilesCount: 1,
                failedFiles: [],
            });

            const event = {
                getID: () => 'event-1',
                originalFile: { path: 'users/u1/events/e1/original.fit' },
                getActivities: vi.fn().mockReturnValue([existingActivity]),
                clearActivities: vi.fn(),
                addActivities: vi.fn(),
            } as any;

            await firstValueFrom(
                service.attachStreamsToEventWithActivities(
                    { uid: 'u1' } as any,
                    event,
                    undefined,
                    true,
                    false,
                    'attach_streams_only',
                    { metadataCacheTtlMs: 3600000 },
                ),
            );

            expect(hydrationService.parseEventFromOriginalFiles).toHaveBeenCalledWith(
                event,
                expect.objectContaining({
                    strictAllFilesRequired: true,
                    metadataCacheTtlMs: 3600000,
                }),
            );
        });

        it('should respect streamTypes filter when attaching streams in stream-only mode', async () => {
            const hydrationService = (service as any).originalFileHydrationService;
            const parsedStreams = [{ type: 'Speed' }, { type: 'Distance' }, { type: 'Power' }] as any[];
            const existingActivity = {
                getID: () => 'a-1',
                clearStreams: vi.fn(),
                addStreams: vi.fn(),
            } as any;
            const parsedActivity = {
                getID: () => 'a-1',
                getAllStreams: vi.fn().mockReturnValue(parsedStreams),
            } as any;
            const parsedEvent = {
                setID: vi.fn().mockReturnThis(),
                getActivities: vi.fn().mockReturnValue([parsedActivity]),
            } as any;
            vi.spyOn(hydrationService, 'parseEventFromOriginalFiles').mockResolvedValue({
                finalEvent: parsedEvent,
                parsedEvents: [parsedEvent],
                sourceFilesCount: 1,
                failedFiles: [],
            });
            const event = {
                getID: () => 'event-1',
                originalFile: { path: 'users/u1/events/e1/original.fit' },
                getActivities: vi.fn().mockReturnValue([existingActivity]),
                clearActivities: vi.fn(),
                addActivities: vi.fn(),
            } as any;

            await firstValueFrom(service.attachStreamsToEventWithActivities({ uid: 'u1' } as any, event, ['Distance', 'Power']));

            expect(existingActivity.clearStreams).toHaveBeenCalledTimes(1);
            expect(existingActivity.addStreams).toHaveBeenCalledWith([{ type: 'Distance' }, { type: 'Power' }]);
            expect(event.clearActivities).not.toHaveBeenCalled();
            expect(event.addActivities).not.toHaveBeenCalled();
        });

        it('should attach matched IDs only and warn on ID mismatch in stream-only mode', async () => {
            const hydrationService = (service as any).originalFileHydrationService;
            const existingActivityA = {
                getID: () => 'a-1',
                clearStreams: vi.fn(),
                addStreams: vi.fn(),
            } as any;
            const existingActivityB = {
                getID: () => 'a-2',
                clearStreams: vi.fn(),
                addStreams: vi.fn(),
            } as any;
            const parsedActivityA = {
                getID: () => 'a-1',
                getAllStreams: vi.fn().mockReturnValue([{ type: 'Speed' }]),
            } as any;
            const parsedActivityOther = {
                getID: () => 'b-9',
                getAllStreams: vi.fn().mockReturnValue([{ type: 'Power' }]),
            } as any;
            const parsedEvent = {
                setID: vi.fn().mockReturnThis(),
                getActivities: vi.fn().mockReturnValue([parsedActivityA, parsedActivityOther]),
            } as any;
            vi.spyOn(hydrationService, 'parseEventFromOriginalFiles').mockResolvedValue({
                finalEvent: parsedEvent,
                parsedEvents: [parsedEvent],
                sourceFilesCount: 1,
                failedFiles: [],
            });
            const event = {
                getID: () => 'event-1',
                originalFile: { path: 'users/u1/events/e1/original.fit' },
                getActivities: vi.fn().mockReturnValue([existingActivityA, existingActivityB]),
                clearActivities: vi.fn(),
                addActivities: vi.fn(),
            } as any;

            await firstValueFrom(service.attachStreamsToEventWithActivities({ uid: 'u1' } as any, event));

            expect(existingActivityA.clearStreams).toHaveBeenCalledTimes(1);
            expect(existingActivityA.addStreams).toHaveBeenCalledWith([{ type: 'Speed' }]);
            expect(existingActivityB.clearStreams).not.toHaveBeenCalled();
            expect(existingActivityB.addStreams).not.toHaveBeenCalled();
            expect(mockLogger.warn).toHaveBeenCalledWith(
                '[AppEventService] Stream-only hydration attached matched activity IDs only',
                expect.objectContaining({
                    eventID: 'event-1',
                    unmatchedExistingActivityIDs: ['a-2'],
                    unmatchedParsedActivityIDs: ['b-9'],
                }),
            );
        });

        it('should replace activities when hydrationMode is replace_activities', async () => {
            const hydrationService = (service as any).originalFileHydrationService;
            const parsedActivity = { getID: () => 'a-1' } as any;
            const parsedEvent = {
                setID: vi.fn().mockReturnThis(),
                getActivities: vi.fn().mockReturnValue([parsedActivity]),
            } as any;
            vi.spyOn(hydrationService, 'parseEventFromOriginalFiles').mockResolvedValue({
                finalEvent: parsedEvent,
                parsedEvents: [parsedEvent],
                sourceFilesCount: 1,
                failedFiles: [],
            });
            const event = {
                getID: () => 'event-1',
                originalFile: { path: 'users/u1/events/e1/original.fit' },
                getActivities: vi.fn().mockReturnValue([]),
                clearActivities: vi.fn(),
                addActivities: vi.fn(),
            } as any;

            const result = await firstValueFrom(
                service.attachStreamsToEventWithActivities(
                    { uid: 'u1' } as any,
                    event,
                    undefined,
                    true,
                    false,
                    'replace_activities',
                ),
            );

            expect(event.clearActivities).toHaveBeenCalledTimes(1);
            expect(event.addActivities).toHaveBeenCalledWith([parsedActivity]);
            expect(result).toBe(event);
            expect(hydrationService.parseEventFromOriginalFiles).toHaveBeenCalledWith(
                event,
                expect.objectContaining({
                    strictAllFilesRequired: true,
                }),
            );
        });

        it('should return parsed event directly when merge=false', async () => {
            const hydrationService = (service as any).originalFileHydrationService;
            const parsedEvent = {
                setID: vi.fn().mockReturnThis(),
                getActivities: vi.fn().mockReturnValue([{ getID: () => 'a-1' }]),
            } as any;
            vi.spyOn(hydrationService, 'parseEventFromOriginalFiles').mockResolvedValue({
                finalEvent: parsedEvent,
                parsedEvents: [parsedEvent],
                sourceFilesCount: 1,
                failedFiles: []
            });
            const event = {
                getID: () => 'event-1',
                originalFile: { path: 'users/u1/events/e1/original.fit' },
                clearActivities: vi.fn(),
                addActivities: vi.fn(),
            } as any;

            const result = await firstValueFrom(service.attachStreamsToEventWithActivities({ uid: 'u1' } as any, event, undefined, false));

            expect(parsedEvent.setID).toHaveBeenCalledWith('event-1');
            expect(result).toBe(parsedEvent);
            expect(event.clearActivities).not.toHaveBeenCalled();
            expect(hydrationService.parseEventFromOriginalFiles).toHaveBeenCalledWith(
                event,
                expect.objectContaining({
                    strictAllFilesRequired: true,
                }),
            );
        });

        it('should rethrow when parser throws in stream-only mode', async () => {
            const hydrationService = (service as any).originalFileHydrationService;
            vi.spyOn(hydrationService, 'parseEventFromOriginalFiles').mockRejectedValue(new Error('parse blew up'));
            const event = {
                getID: () => 'event-1',
                originalFile: { path: 'users/u1/events/e1/original.fit' },
                clearActivities: vi.fn(),
                addActivities: vi.fn(),
                getActivities: vi.fn().mockReturnValue([]),
            } as any;

            await expect(firstValueFrom(
                service.attachStreamsToEventWithActivities({ uid: 'u1' } as any, event),
            )).rejects.toThrow('parse blew up');
        });

        it('should rethrow when parser throws in replace_activities mode', async () => {
            const hydrationService = (service as any).originalFileHydrationService;
            vi.spyOn(hydrationService, 'parseEventFromOriginalFiles').mockRejectedValue(new Error('parse blew up'));
            const event = {
                getID: () => 'event-1',
                originalFile: { path: 'users/u1/events/e1/original.fit' },
                clearActivities: vi.fn(),
                addActivities: vi.fn(),
                getActivities: vi.fn().mockReturnValue([]),
            } as any;

            await expect(firstValueFrom(
                service.attachStreamsToEventWithActivities(
                    { uid: 'u1' } as any,
                    event,
                    undefined,
                    true,
                    false,
                    'replace_activities',
                ),
            )).rejects.toThrow('parse blew up');
        });

        it('should rethrow when parser returns no finalEvent in stream-only mode', async () => {
            const hydrationService = (service as any).originalFileHydrationService;
            vi.spyOn(hydrationService, 'parseEventFromOriginalFiles').mockResolvedValue({
                finalEvent: null,
                parsedEvents: [],
                sourceFilesCount: 1,
                failedFiles: [{ path: 'users/u1/events/e1/original.fit', reason: 'fail' }],
            });
            const event = {
                getID: () => 'event-1',
                originalFile: { path: 'users/u1/events/e1/original.fit' },
                clearActivities: vi.fn(),
                addActivities: vi.fn(),
                getActivities: vi.fn().mockReturnValue([]),
            } as any;

            await expect(firstValueFrom(
                service.attachStreamsToEventWithActivities({ uid: 'u1' } as any, event),
            )).rejects.toThrow('Could not build event from original source files');
        });

        it('should rethrow when parser returns no finalEvent in replace_activities mode', async () => {
            const hydrationService = (service as any).originalFileHydrationService;
            vi.spyOn(hydrationService, 'parseEventFromOriginalFiles').mockResolvedValue({
                finalEvent: null,
                parsedEvents: [],
                sourceFilesCount: 1,
                failedFiles: [{ path: 'users/u1/events/e1/original.fit', reason: 'fail' }],
            });
            const event = {
                getID: () => 'event-1',
                originalFile: { path: 'users/u1/events/e1/original.fit' },
                clearActivities: vi.fn(),
                addActivities: vi.fn(),
                getActivities: vi.fn().mockReturnValue([]),
            } as any;

            await expect(firstValueFrom(
                service.attachStreamsToEventWithActivities(
                    { uid: 'u1' } as any,
                    event,
                    undefined,
                    true,
                    false,
                    'replace_activities',
                ),
            )).rejects.toThrow('Could not build event from original source files');
        });
    });
});
