import { TestBed } from '@angular/core/testing';
import { AppEventService } from './app.event.service';
import { Firestore, doc, docData, collection, collectionData, deleteDoc, updateDoc, writeBatch, query, where, getDocs, getDocsFromCache, onSnapshot } from '@angular/fire/firestore';
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
        getEventFromJSON: vi.fn(),
        getActivityFromJSON: vi.fn(),
        sanitize: vi.fn(),
        getCountFromServer: vi.fn(),
        getBytes: vi.fn(),
        batchUpdate: vi.fn(),
        batchCommit: vi.fn(),
    };
});

function hasStreamsKey(value: unknown): boolean {
    if (value === null || value === undefined) {
        return false;
    }
    if (Array.isArray(value)) {
        return value.some(hasStreamsKey);
    }
    if (typeof value !== 'object') {
        return false;
    }

    const record = value as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(record, 'streams')) {
        return true;
    }
    return Object.values(record).some(hasStreamsKey);
}

function createQueryDoc(id: string, data: Record<string, unknown>) {
    return {
        id,
        data: () => data,
    };
}

function createQuerySnapshot(
    docs: Array<{ id: string; data: () => Record<string, unknown> }>,
    docChanges: Array<{ type: 'added' | 'modified' | 'removed'; doc: { id: string; data: () => Record<string, unknown> }; oldIndex: number; newIndex: number }>
) {
    return {
        docs,
        size: docs.length,
        metadata: {
            fromCache: false,
            hasPendingWrites: false,
        },
        docChanges: vi.fn(() => docChanges),
    };
}

function createMockEvent(json: Record<string, unknown>) {
    return {
        ...json,
        id: null as string | null,
        clearActivities: vi.fn(),
        addActivities: vi.fn(),
        setID(id: string) {
            this.id = id;
            return this;
        },
        getID() {
            return this.id;
        },
        getActivities() {
            return [];
        },
        toJSON() {
            return { ...json, id: this.id };
        },
    };
}

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
        getDocs: vi.fn(),
        getDocsFromCache: vi.fn(),
        onSnapshot: vi.fn(),
        deleteDoc: vi.fn(),
        updateDoc: vi.fn(),
        writeBatch: vi.fn(() => ({
            update: mocks.batchUpdate,
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
        ref: vi.fn((_storage: unknown, path: string) => ({ bucket: 'quantified-self-io', fullPath: path })),
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
    const mockLogger = { log: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn(), captureMessage: vi.fn(), captureException: vi.fn() };
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

    it('should reuse one-shot event parsing for an identical initial live snapshot', async () => {
        const user = { uid: 'user-seeded' } as any;
        const eventDoc = createQueryDoc('event-1', {
            name: 'Seeded Event',
            startDate: 1710000000000,
        });

        (collection as Mock).mockReturnValue({});
        (query as Mock).mockReturnValue({});
        (getDocs as Mock).mockResolvedValue({
            docs: [eventDoc],
            size: 1,
            metadata: {
                fromCache: false,
                hasPendingWrites: false,
            },
        });
        (onSnapshot as Mock).mockImplementation((_queryRef, _options, next) => {
            next(createQuerySnapshot(
                [eventDoc],
                [{ type: 'added', doc: eventDoc, oldIndex: -1, newIndex: 0 }]
            ) as any);
            return vi.fn();
        });
        mocks.getEventFromJSON.mockImplementation((json: Record<string, unknown>) => createMockEvent(json));

        const onceResult = await firstValueFrom(service.getEventsOnceByWithMeta(user, [], 'startDate', false, 0));
        const liveEvents = await firstValueFrom(service.getEventsBy(user, [], 'startDate', false, 0));

        expect(mocks.getEventFromJSON).toHaveBeenCalledTimes(1);
        expect(liveEvents[0]).toBe(onceResult.events[0]);
        expect(mockLogger.log).toHaveBeenCalledWith(
            '[perf] app_event_service_get_events_deserialize',
            expect.objectContaining({
                changedDocs: 0,
                reusedSeedDocs: 1,
                userID: user.uid,
            }),
        );
    });

    it('should deserialize only changed docs when a seeded live snapshot differs', async () => {
        const user = { uid: 'user-partial-seed' } as any;
        const firstDoc = createQueryDoc('event-1', {
            name: 'First Event',
            startDate: 1710000000000,
        });
        const secondDoc = createQueryDoc('event-2', {
            name: 'Second Event',
            startDate: 1710003600000,
        });
        const updatedSecondDoc = createQueryDoc('event-2', {
            name: 'Second Event Updated',
            startDate: 1710003600000,
        });

        (collection as Mock).mockReturnValue({});
        (query as Mock).mockReturnValue({});
        (getDocs as Mock).mockResolvedValue({
            docs: [firstDoc, secondDoc],
            size: 2,
            metadata: {
                fromCache: false,
                hasPendingWrites: false,
            },
        });
        (onSnapshot as Mock).mockImplementation((_queryRef, _options, next) => {
            next(createQuerySnapshot(
                [firstDoc, updatedSecondDoc],
                [
                    { type: 'added', doc: firstDoc, oldIndex: -1, newIndex: 0 },
                    { type: 'added', doc: updatedSecondDoc, oldIndex: -1, newIndex: 1 },
                ]
            ) as any);
            return vi.fn();
        });
        mocks.getEventFromJSON.mockImplementation((json: Record<string, unknown>) => createMockEvent(json));

        const onceResult = await firstValueFrom(service.getEventsOnceByWithMeta(user, [], 'startDate', false, 0));
        const liveEvents = await firstValueFrom(service.getEventsBy(user, [], 'startDate', false, 0));

        expect(mocks.getEventFromJSON).toHaveBeenCalledTimes(3);
        expect(liveEvents[0]).toBe(onceResult.events[0]);
        expect(liveEvents[1]).not.toBe(onceResult.events[1]);
        expect((liveEvents[1] as any).name).toBe('Second Event Updated');
        expect(mockLogger.log).toHaveBeenCalledWith(
            '[perf] app_event_service_get_events_deserialize',
            expect.objectContaining({
                changedDocs: 1,
                reusedSeedDocs: 1,
                userID: user.uid,
            }),
        );
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

    it('should get activities once by event without subscribing to live updates', async () => {
        const userId = 'user1';
        const eventId = 'event-once-1';
        const user = { uid: userId } as any;
        const activityId = 'activity-once-1';
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
        (query as Mock).mockReturnValue({});
        (getDocs as Mock).mockResolvedValue({
            docs: [
                {
                    id: activityId,
                    data: () => mockActivityData,
                }
            ],
            size: 1,
            metadata: {
                fromCache: false,
                hasPendingWrites: false,
            },
        });

        const activities = await firstValueFrom(service.getActivitiesOnceByEvent(user, eventId));

        expect(getDocs).toHaveBeenCalledTimes(1);
        expect(collectionData).not.toHaveBeenCalled();
        expect(activities.length).toBe(1);
        expect(mocks.getActivityFromJSON).toHaveBeenCalledTimes(1);
        expect(mockLogger.info).toHaveBeenCalledWith(
            '[perf] app_event_service_get_activities_once_get_docs',
            expect.objectContaining({
                snapshots: 1,
                userID: userId,
                eventID: eventId,
            }),
        );
    });

    it('should return cached one-shot activities when preferCache is enabled and cache has data', async () => {
        const userId = 'user1';
        const eventId = 'event-cached';
        const user = { uid: userId } as any;
        const activityId = 'activity-cache-1';
        const mockActivityData = { id: activityId, eventID: eventId, type: 'Run' };

        (collection as Mock).mockReturnValue({});
        (query as Mock).mockReturnValue({});
        (getDocsFromCache as Mock).mockResolvedValue({
            docs: [
                {
                    id: activityId,
                    data: () => mockActivityData,
                }
            ],
            size: 1,
            metadata: {
                fromCache: true,
                hasPendingWrites: false,
            },
        });

        const activities = await firstValueFrom(service.getActivitiesOnceByEventWithOptions(user, eventId, {
            preferCache: true,
            warmServer: false,
        }));

        expect(getDocsFromCache).toHaveBeenCalledTimes(1);
        expect(getDocs).not.toHaveBeenCalled();
        expect(activities.length).toBe(1);
        expect(mockLogger.info).toHaveBeenCalledWith(
            '[perf] app_event_service_get_activities_once_cache_first_hit',
            expect.objectContaining({
                snapshots: 1,
                fromCache: true,
                userID: userId,
                eventID: eventId,
            }),
        );
    });

    it('should fall back to server one-shot activities when preferCache is enabled but cache is empty', async () => {
        const userId = 'user1';
        const eventId = 'event-cache-fallback';
        const user = { uid: userId } as any;
        const activityId = 'activity-server-1';
        const mockActivityData = { id: activityId, eventID: eventId, type: 'Ride' };

        (collection as Mock).mockReturnValue({});
        (query as Mock).mockReturnValue({});
        (getDocsFromCache as Mock).mockResolvedValue({
            docs: [],
            size: 0,
            metadata: {
                fromCache: true,
                hasPendingWrites: false,
            },
        });
        (getDocs as Mock).mockResolvedValue({
            docs: [
                {
                    id: activityId,
                    data: () => mockActivityData,
                }
            ],
            size: 1,
            metadata: {
                fromCache: false,
                hasPendingWrites: false,
            },
        });

        const activities = await firstValueFrom(service.getActivitiesOnceByEventWithOptions(user, eventId, {
            preferCache: true,
            warmServer: false,
        }));

        expect(getDocsFromCache).toHaveBeenCalledTimes(1);
        expect(getDocs).toHaveBeenCalledTimes(1);
        expect(activities.length).toBe(1);
        expect(mockLogger.info).toHaveBeenCalledWith(
            '[perf] app_event_service_get_activities_once_cache_first_fallback',
            expect.objectContaining({
                reason: 'empty_cache',
                userID: userId,
                eventID: eventId,
            }),
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

    it('should sanitize updateEventProperties payload by stripping streams and top-level activities', async () => {
        const user = { uid: 'user1' } as any;
        const payload = {
            name: 'Updated event name',
            activities: [{ id: 'activity1' }],
            details: {
                streams: [{ type: 'Power', values: [100, 200] }],
                nested: [{ streams: [{ type: 'Pace', values: [1, 2, 3] }] }],
            },
        };

        (doc as Mock).mockReturnValue({});
        (updateDoc as Mock).mockResolvedValue(undefined);

        await service.updateEventProperties(user, 'event1', payload);

        expect(updateDoc).toHaveBeenCalledTimes(1);
        const writtenPayload = (updateDoc as Mock).mock.calls[0][1];
        expect(writtenPayload.name).toBe('Updated event name');
        expect(writtenPayload.activities).toBeUndefined();
        expect(hasStreamsKey(writtenPayload)).toBe(false);
    });

    it('should strip server-owned original file metadata in updateEventProperties', async () => {
        const user = { uid: 'user1' } as any;
        const payload = {
            name: 'Updated event name',
            originalFile: { path: 'users/u1/events/e1/original.fit' },
            originalFiles: [{ path: 'users/u1/events/e1/original.fit' }],
        };

        (doc as Mock).mockReturnValue({});
        (updateDoc as Mock).mockResolvedValue(undefined);

        await service.updateEventProperties(user, 'event1', payload);

        expect(updateDoc).toHaveBeenCalledTimes(1);
        const writtenPayload = (updateDoc as Mock).mock.calls[0][1];
        expect(writtenPayload.name).toBe('Updated event name');
        expect(writtenPayload.originalFile).toBeUndefined();
        expect(writtenPayload.originalFiles).toBeUndefined();
    });

    it('should keep primitive update payloads unchanged in updateEventProperties', async () => {
        const user = { uid: 'user1' } as any;
        (doc as Mock).mockReturnValue({});
        (updateDoc as Mock).mockResolvedValue(undefined);

        await service.updateEventProperties(user, 'event1', 'deviceName');

        expect(updateDoc).toHaveBeenCalledTimes(1);
        expect((updateDoc as Mock).mock.calls[0][1]).toBe('deviceName');
    });

    it('should keep array update payloads unchanged in updateEventProperties', async () => {
        const user = { uid: 'user1' } as any;
        const patch = ['invalid-array-patch'];
        (doc as Mock).mockReturnValue({});
        (updateDoc as Mock).mockResolvedValue(undefined);

        await service.updateEventProperties(user, 'event1', patch as any);

        expect(updateDoc).toHaveBeenCalledTimes(1);
        expect((updateDoc as Mock).mock.calls[0][1]).toEqual(patch);
    });

    it('should sanitize updateActivityProperties payload by stripping streams and immutable identity fields', async () => {
        const user = { uid: 'user1' } as any;
        const payload = {
            creator: { name: 'Renamed Device' },
            eventID: 'event-hijack',
            userID: 'other-user',
            eventStartDate: new Date('2026-01-01T00:00:00.000Z'),
            details: {
                streams: [{ type: 'Power', values: [100, 200] }],
            },
        };

        (doc as Mock).mockReturnValue({});
        (updateDoc as Mock).mockResolvedValue(undefined);

        await service.updateActivityProperties(user, 'activity1', payload);

        expect(updateDoc).toHaveBeenCalledTimes(1);
        const writtenPayload = (updateDoc as Mock).mock.calls[0][1];
        expect(writtenPayload.creator).toEqual({ name: 'Renamed Device' });
        expect(writtenPayload.eventID).toBeUndefined();
        expect(writtenPayload.userID).toBeUndefined();
        expect(writtenPayload.eventStartDate).toBeUndefined();
        expect(hasStreamsKey(writtenPayload)).toBe(false);
    });

    it('should atomically patch activity and event using batch.update with sanitized payloads', async () => {
        const user = { uid: 'user1' } as any;
        const activityPatch = {
            creator: { name: 'Device B' },
            eventID: 'hijack',
            userID: 'other-user',
            eventStartDate: new Date('2026-01-01T00:00:00.000Z'),
            nested: {
                streams: [{ type: 'Pace', values: [1, 2, 3] }],
            },
        };
        const eventPatch = {
            stats: { heartRateAvg: 140 },
            activities: [{ id: 'activity-1' }],
            originalFile: { path: 'users/u1/events/e1/original.fit' },
            originalFiles: [{ path: 'users/u1/events/e1/original.fit' }],
        };

        (doc as Mock).mockReturnValue({});
        mocks.batchCommit.mockResolvedValue(undefined);

        await service.updateActivityAndEventProperties(
            user,
            'event1',
            'activity1',
            activityPatch,
            eventPatch,
        );

        expect(writeBatch).toHaveBeenCalledTimes(1);
        expect(mocks.batchUpdate).toHaveBeenCalledTimes(2);

        const writtenActivityPatch = mocks.batchUpdate.mock.calls[0][1];
        expect(writtenActivityPatch.creator).toEqual({ name: 'Device B' });
        expect(writtenActivityPatch.eventID).toBeUndefined();
        expect(writtenActivityPatch.userID).toBeUndefined();
        expect(writtenActivityPatch.eventStartDate).toBeUndefined();
        expect(hasStreamsKey(writtenActivityPatch)).toBe(false);

        const writtenEventPatch = mocks.batchUpdate.mock.calls[1][1];
        expect(writtenEventPatch.stats).toEqual({ heartRateAvg: 140 });
        expect(writtenEventPatch.activities).toBeUndefined();
        expect(writtenEventPatch.originalFile).toBeUndefined();
        expect(writtenEventPatch.originalFiles).toBeUndefined();
        expect(hasStreamsKey(writtenEventPatch)).toBe(false);
        expect(mocks.batchCommit).toHaveBeenCalledTimes(1);
    });

    it('should return event count from Firestore aggregate query', async () => {
        const user = { uid: 'user-count' } as any;
        mocks.getCountFromServer.mockResolvedValueOnce({ data: () => ({ count: 42 }) });

        const count = await service.getEventCount(user);

        expect(count).toBe(42);
    });

    it('should build Firestore query with startDate precedence, filters, and cursors', () => {
        const user = { uid: 'user-query' } as any;
        const startCursor = { id: 'start' } as any;
        const endCursor = { id: 'end' } as any;
        const clauses = [
            { fieldPath: 'startDate', opStr: '>=', value: new Date('2026-01-01T00:00:00.000Z') },
            { fieldPath: 'privacy', opStr: '==', value: 'public' },
        ];

        (collection as Mock).mockReturnValue('events-ref');
        (where as Mock).mockImplementation((field: string, op: string, value: unknown) => `where:${field}:${op}:${String(value)}`);
        (query as Mock).mockReturnValue('query-result');

        const builtQuery = (service as any).getEventQueryForUser(user, clauses, 'name', true, 25, startCursor, endCursor);

        expect(builtQuery).toBe('query-result');
        expect(query).toHaveBeenCalledTimes(1);
        expect((query as Mock).mock.calls[0][0]).toBe('events-ref');
        expect((query as Mock).mock.calls[0]).toHaveLength(8);
        expect(where).toHaveBeenCalledWith('startDate', '>=', clauses[0].value);
        expect(where).toHaveBeenCalledWith('privacy', '==', 'public');
    });

    it('should build Firestore query without limit/cursors when disabled', () => {
        const user = { uid: 'user-query' } as any;

        (collection as Mock).mockReturnValue('events-ref');
        (query as Mock).mockReturnValue('query-without-limit');

        const builtQuery = (service as any).getEventQueryForUser(user, [], 'startDate', false, 0);

        expect(builtQuery).toBe('query-without-limit');
        expect(where).not.toHaveBeenCalled();
        expect(query).toHaveBeenCalledTimes(1);
        expect((query as Mock).mock.calls[0][0]).toBe('events-ref');
        expect((query as Mock).mock.calls[0]).toHaveLength(2);
    });

    it('should emit empty events array when _getEventsAndActivities receives no snapshots', async () => {
        vi.spyOn(service as any, 'getEventQueryForUser').mockReturnValue('events-query');
        (collectionData as Mock).mockReturnValue(of([]));

        const result = await firstValueFrom((service as any)._getEventsAndActivities({ uid: 'user-empty' } as any));

        expect(result).toEqual([]);
    });

    it('should hydrate events with activities in _getEventsAndActivities when snapshots exist', async () => {
        const importedEvent = {
            setID: vi.fn().mockReturnThis(),
            addActivities: vi.fn(),
            getID: vi.fn().mockReturnValue('event-hydrated'),
            clearActivities: vi.fn(),
        } as any;
        mocks.getEventFromJSON.mockReturnValueOnce(importedEvent);

        vi.spyOn(service as any, 'getEventQueryForUser').mockReturnValue('events-query');
        (collectionData as Mock).mockReturnValueOnce(of([
            {
                id: 'event-hydrated',
                startDate: new Date('2026-01-01T00:00:00.000Z'),
            },
        ]));
        const getActivitiesSpy = vi.spyOn(service, 'getActivities').mockReturnValueOnce(of([{ id: 'activity-1' } as any]));

        const result = await firstValueFrom((service as any)._getEventsAndActivities({ uid: 'user-hydrated' } as any));

        expect(getActivitiesSpy).toHaveBeenCalledWith({ uid: 'user-hydrated' }, 'event-hydrated');
        expect(importedEvent.addActivities).toHaveBeenCalledWith([{ id: 'activity-1' }]);
        expect(result).toEqual([importedEvent]);
    });

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

        it('should forward streamTypes to parseEventFromOriginalFiles and attach all returned streams', async () => {
            const hydrationService = (service as any).originalFileHydrationService;
            // The mock parser returns streams it has already filtered — in production the
            // real parser would only return Distance and Power when streamTypes is ['Distance','Power'].
            // Here we make the mock reflect that by returning only those two.
            const filteredParsedStreams = [{ type: 'Distance' }, { type: 'Power' }] as any[];
            const existingActivity = {
                getID: () => 'a-1',
                clearStreams: vi.fn(),
                addStreams: vi.fn(),
            } as any;
            const parsedActivity = {
                getID: () => 'a-1',
                getAllStreams: vi.fn().mockReturnValue(filteredParsedStreams),
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

            // Filtering is delegated to the parser — streamTypes must appear in the parse options.
            expect(hydrationService.parseEventFromOriginalFiles).toHaveBeenCalledWith(
                event,
                expect.objectContaining({ streamTypes: ['Distance', 'Power'] }),
            );
            // All streams the parser returned are attached as-is (no second client-side filter).
            expect(existingActivity.clearStreams).toHaveBeenCalledTimes(1);
            expect(existingActivity.addStreams).toHaveBeenCalledWith(filteredParsedStreams);
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
