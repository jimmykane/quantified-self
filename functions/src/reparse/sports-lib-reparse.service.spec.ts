import { describe, it, expect, vi, beforeEach } from 'vitest';
import { gzipSync } from 'node:zlib';
import { SPORTS_LIB_REPARSE_TARGET_VERSION } from './sports-lib-reparse.config';

const TARGET_SPORTS_LIB_VERSION = SPORTS_LIB_REPARSE_TARGET_VERSION;
const LOWER_SPORTS_LIB_VERSION = '0.0.0';
const HIGHER_SPORTS_LIB_VERSION = '9999.0.0';

const hoisted = vi.hoisted(() => {
    const mockGetUser = vi.fn();
    const mockCollection = vi.fn();
    const mockDoc = vi.fn();
    const mockBatchDelete = vi.fn();
    const mockBatchCommit = vi.fn().mockResolvedValue(undefined);
    const mockBatch = vi.fn(() => ({
        delete: mockBatchDelete,
        commit: mockBatchCommit,
    }));

    const mockDownload = vi.fn();
    const mockFile = vi.fn(() => ({ download: mockDownload }));
    const mockBucket = vi.fn(() => ({ file: mockFile }));

    const mockWriteAllEventData = vi.fn().mockResolvedValue(undefined);

    const fitImporter = { getFromArrayBuffer: vi.fn() };
    const gpxImporter = { getFromString: vi.fn() };
    const tcxImporter = { getFromXML: vi.fn() };
    const suuntoJSONImporter = { getFromJSONString: vi.fn() };
    const suuntoSMLImporter = { getFromXML: vi.fn() };
    const mergeEvents = vi.fn((events: any[]) => events[0]);
    const reGenerateStatsForEvent = vi.fn();

    const serverTimestamp = vi.fn(() => 'SERVER_TIMESTAMP');
    const deleteField = vi.fn(() => 'DELETE_FIELD');

    return {
        mockGetUser,
        mockCollection,
        mockDoc,
        mockBatch,
        mockBatchDelete,
        mockBatchCommit,
        mockDownload,
        mockFile,
        mockBucket,
        mockWriteAllEventData,
        fitImporter,
        gpxImporter,
        tcxImporter,
        suuntoJSONImporter,
        suuntoSMLImporter,
        mergeEvents,
        reGenerateStatsForEvent,
        serverTimestamp,
        deleteField,
    };
});

vi.mock('firebase-admin', () => {
    const firestoreFn = vi.fn(() => ({
        collection: hoisted.mockCollection,
        doc: hoisted.mockDoc,
        batch: hoisted.mockBatch,
    }));
    Object.assign(firestoreFn, {
        FieldValue: {
            serverTimestamp: hoisted.serverTimestamp,
            delete: hoisted.deleteField,
        },
        FieldPath: {
            documentId: () => '__name__',
        },
    });

    return {
        auth: vi.fn(() => ({
            getUser: hoisted.mockGetUser,
        })),
        firestore: firestoreFn,
        storage: vi.fn(() => ({
            bucket: hoisted.mockBucket,
        })),
    };
});

vi.mock('@sports-alliance/sports-lib', () => ({
    ActivityParsingOptions: class ActivityParsingOptions {
        constructor(public opts: unknown) { }
    },
    EventImporterFIT: hoisted.fitImporter,
    EventImporterGPX: hoisted.gpxImporter,
    EventImporterTCX: hoisted.tcxImporter,
    EventImporterSuuntoJSON: hoisted.suuntoJSONImporter,
    EventImporterSuuntoSML: hoisted.suuntoSMLImporter,
    EventUtilities: {
        mergeEvents: hoisted.mergeEvents,
        reGenerateStatsForEvent: hoisted.reGenerateStatsForEvent,
    },
}));

vi.mock('../shared/event-writer', () => ({
    EventWriter: vi.fn(() => ({
        writeAllEventData: hoisted.mockWriteAllEventData,
    })),
}));

import {
    hasPaidOrGraceAccess,
    parseFromOriginalFilesStrict,
    applyPreservedFields,
    mapActivityIdentity,
    extractSourceFiles,
    persistReparsedEvent,
    parseUIDAllowlist,
    parseUidAndEventIdFromEventPath,
    resolveTargetSportsLibVersion,
    shouldEventBeReparsed,
    writeReparseStatus,
    buildSportsLibReparseJobId,
    getEventAndActivitiesForReparse,
    reparseEventFromOriginalFiles,
    SPORTS_LIB_REPARSE_SKIP_REASON_NO_ORIGINAL_FILES,
} from './sports-lib-reparse.service';

function makeCollectionQuery(docs: any[] = []) {
    return {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue({
            empty: docs.length === 0,
            docs,
        }),
    };
}

function makeEvent(overrides?: Partial<any>) {
    const activityA = {
        getID: vi.fn(() => 'a1'),
        setID: vi.fn(),
        creator: { name: 'A' },
    };
    const activityB = {
        getID: vi.fn(() => 'a2'),
        setID: vi.fn(),
        creator: { name: 'B' },
    };
    return {
        setID: vi.fn(),
        getActivities: vi.fn(() => [activityA, activityB]),
        ...overrides,
    };
}

describe('sports-lib-reparse.service', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        hoisted.mockDoc.mockImplementation(() => ({
            get: vi.fn().mockResolvedValue({ exists: true, data: () => ({}) }),
            set: vi.fn().mockResolvedValue(undefined),
        }));
        hoisted.mockCollection.mockImplementation((path: string) => {
            if (path.includes('/subscriptions')) {
                return makeCollectionQuery([]);
            }
            if (path.includes('/activities')) {
                return makeCollectionQuery([]);
            }
            return makeCollectionQuery([]);
        });
        hoisted.mockDownload.mockResolvedValue([Buffer.from('fit-data')]);
        hoisted.fitImporter.getFromArrayBuffer.mockResolvedValue(makeEvent());
        hoisted.gpxImporter.getFromString.mockResolvedValue(makeEvent());
        hoisted.tcxImporter.getFromXML.mockResolvedValue(makeEvent());
        hoisted.suuntoJSONImporter.getFromJSONString.mockResolvedValue(makeEvent());
        hoisted.suuntoSMLImporter.getFromXML.mockResolvedValue(makeEvent());
    });

    it('hasPaidOrGraceAccess should return true for basic claim', async () => {
        hoisted.mockGetUser.mockResolvedValue({ customClaims: { stripeRole: 'basic' } });
        await expect(hasPaidOrGraceAccess('u1')).resolves.toBe(true);
    });

    it('resolveTargetSportsLibVersion should return hardcoded target version', () => {
        expect(resolveTargetSportsLibVersion()).toBe(TARGET_SPORTS_LIB_VERSION);
    });

    it('parseUIDAllowlist should parse and sanitize comma-separated values', () => {
        expect(parseUIDAllowlist(undefined)).toBeNull();
        expect(parseUIDAllowlist('')).toBeNull();
        expect(parseUIDAllowlist('   ')).toBeNull();
        expect(Array.from(parseUIDAllowlist(' u1, u2 ,,u3 ') || [])).toEqual(['u1', 'u2', 'u3']);
        expect(Array.from(parseUIDAllowlist('u1,u1') || [])).toEqual(['u1']);
    });

    it('parseUidAndEventIdFromEventPath should parse valid paths and reject invalid ones', () => {
        expect(parseUidAndEventIdFromEventPath('users/u1/events/e1')).toEqual({ uid: 'u1', eventId: 'e1' });
        expect(parseUidAndEventIdFromEventPath('users/u1/activities/a1')).toBeNull();
        expect(parseUidAndEventIdFromEventPath('invalid')).toBeNull();
    });

    it('hasPaidOrGraceAccess should return true for active grace claim', async () => {
        hoisted.mockGetUser.mockResolvedValue({ customClaims: { stripeRole: 'free', gracePeriodUntil: Date.now() + 10_000 } });
        await expect(hasPaidOrGraceAccess('u1')).resolves.toBe(true);
    });

    it('hasPaidOrGraceAccess should fallback to active subscription role', async () => {
        hoisted.mockGetUser.mockResolvedValue({ customClaims: { stripeRole: 'free' } });
        hoisted.mockCollection.mockImplementation((path: string) => {
            if (path.includes('/subscriptions')) {
                return makeCollectionQuery([{ data: () => ({ role: 'pro' }) }]);
            }
            return makeCollectionQuery([]);
        });
        await expect(hasPaidOrGraceAccess('u1')).resolves.toBe(true);
    });

    it('hasPaidOrGraceAccess should return false for free without grace/subscription', async () => {
        hoisted.mockGetUser.mockResolvedValue({ customClaims: { stripeRole: 'free' } });
        await expect(hasPaidOrGraceAccess('u1')).resolves.toBe(false);
    });

    it('hasPaidOrGraceAccess should fallback to system grace when auth user is missing', async () => {
        hoisted.mockGetUser.mockRejectedValue({ code: 'auth/user-not-found' });
        hoisted.mockDoc.mockImplementation((path: string) => ({
            get: vi.fn().mockResolvedValue(path === 'users/u1/system/status'
                ? { exists: true, data: () => ({ gracePeriodUntil: { toMillis: () => Date.now() + 60_000 } }) }
                : { exists: true, data: () => ({}) }),
            set: vi.fn().mockResolvedValue(undefined),
        }));

        await expect(hasPaidOrGraceAccess('u1')).resolves.toBe(true);
    });

    it('hasPaidOrGraceAccess should return false on auth errors when no fallback grants access', async () => {
        hoisted.mockGetUser.mockRejectedValue({ code: 'auth/internal-error' });
        hoisted.mockDoc.mockImplementation(() => ({
            get: vi.fn().mockResolvedValue({ exists: true, data: () => ({}) }),
            set: vi.fn().mockResolvedValue(undefined),
        }));

        await expect(hasPaidOrGraceAccess('u1')).resolves.toBe(false);
    });

    it('parseFromOriginalFilesStrict should parse gzip FIT files', async () => {
        const gz = gzipSync(Buffer.from('fit-file-content'));
        hoisted.mockDownload.mockResolvedValue([gz]);

        const result = await parseFromOriginalFilesStrict([
            { path: 'users/u1/events/e1/original.fit.gz' }
        ]);

        expect(result.sourceFilesCount).toBe(1);
        expect(hoisted.fitImporter.getFromArrayBuffer).toHaveBeenCalledTimes(1);
    });

    it('parseFromOriginalFilesStrict should fail when any source file fails', async () => {
        hoisted.fitImporter.getFromArrayBuffer.mockRejectedValue(new Error('bad-fit'));
        await expect(parseFromOriginalFilesStrict([
            { path: 'users/u1/events/e1/original.fit' }
        ])).rejects.toThrow('bad-fit');
    });

    it('parseFromOriginalFilesStrict should parse all supported extensions and merge multiple events', async () => {
        await parseFromOriginalFilesStrict([
            { path: 'a.fit' },
            { path: 'a.gpx' },
            { path: 'a.tcx' },
            { path: 'a.json' },
            { path: 'a.sml' },
        ]);

        expect(hoisted.fitImporter.getFromArrayBuffer).toHaveBeenCalledTimes(1);
        expect(hoisted.gpxImporter.getFromString).toHaveBeenCalledTimes(1);
        expect(hoisted.tcxImporter.getFromXML).toHaveBeenCalledTimes(1);
        expect(hoisted.suuntoJSONImporter.getFromJSONString).toHaveBeenCalledTimes(1);
        expect(hoisted.suuntoSMLImporter.getFromXML).toHaveBeenCalledTimes(1);
        expect(hoisted.mergeEvents).toHaveBeenCalledTimes(1);
    });

    it('parseFromOriginalFilesStrict should fail for unsupported extensions', async () => {
        await expect(parseFromOriginalFilesStrict([
            { path: 'unsupported.zip' }
        ])).rejects.toThrow('Unsupported original file extension');
    });

    it('parseFromOriginalFilesStrict should fail when no source files are provided', async () => {
        await expect(parseFromOriginalFilesStrict([])).rejects.toThrow('No source files produced a parsed event');
    });

    it('extractSourceFiles should prefer originalFiles and normalize metadata', () => {
        const sourceFiles = extractSourceFiles({
            originalFiles: [
                { path: 'a.fit', bucket: 'b', originalFilename: 'x.fit', startDate: { toMillis: () => 1000 } }
            ],
            originalFile: { path: 'legacy.fit' },
        });
        expect(sourceFiles).toHaveLength(1);
        expect(sourceFiles[0].path).toBe('a.fit');
        expect(sourceFiles[0].bucket).toBe('b');
    });

    it('extractSourceFiles should filter invalid originalFiles entries', () => {
        const sourceFiles = extractSourceFiles({
            originalFiles: [{ bucket: 'missing-path' }],
            originalFile: { path: 'legacy.fit', bucket: 'legacy-bucket' },
        });

        expect(sourceFiles).toEqual([]);
    });

    it('extractSourceFiles should fall back to originalFile when originalFiles is absent', () => {
        const sourceFiles = extractSourceFiles({
            originalFile: { path: 'legacy.fit', bucket: 'legacy-bucket' },
        });

        expect(sourceFiles).toHaveLength(1);
        expect(sourceFiles[0]).toEqual(expect.objectContaining({
            path: 'legacy.fit',
            bucket: 'legacy-bucket',
        }));
    });

    it('applyPreservedFields should keep only description/privacy/notes', () => {
        const event: any = {};
        applyPreservedFields(event, {
            description: 'desc',
            privacy: 'private',
            notes: 'notes',
            name: 'new-name',
        });
        expect(event.description).toBe('desc');
        expect(event.privacy).toBe('private');
        expect(event.notes).toBe('notes');
        expect(event.name).toBeUndefined();
    });

    it('mapActivityIdentity should preserve IDs and creator names by index', () => {
        const activityOne = { setID: vi.fn(), creator: { name: 'new1' } };
        const activityTwo = { setID: vi.fn(), creator: { name: 'new2' } };
        const parsedEvent = {
            getActivities: () => [activityOne, activityTwo]
        } as any;

        mapActivityIdentity(parsedEvent, [
            { id: 'a1', data: () => ({ creator: { name: 'old1' } }) } as any,
            { id: 'a2', data: () => ({ creator: { name: 'old2' } }) } as any,
        ]);

        expect(activityOne.setID).toHaveBeenCalledWith('a1');
        expect(activityTwo.setID).toHaveBeenCalledWith('a2');
        expect(activityOne.creator.name).toBe('old1');
        expect(activityTwo.creator.name).toBe('old2');
    });

    it('mapActivityIdentity should ignore missing existing docs and blank creator names', () => {
        const activityOne = { setID: vi.fn(), creator: { name: 'keep-me' } };
        const activityTwo = { setID: vi.fn() };
        const parsedEvent = {
            getActivities: () => [activityOne, activityTwo]
        } as any;

        mapActivityIdentity(parsedEvent, [
            { id: 'a1', data: () => ({ creator: { name: '   ' } }) } as any,
        ]);

        expect(activityOne.setID).toHaveBeenCalledWith('a1');
        expect(activityOne.creator.name).toBe('keep-me');
        expect(activityTwo.setID).not.toHaveBeenCalled();
    });

    it('persistReparsedEvent should delete stale activities and write processing metadata', async () => {
        const setCalls: string[] = [];
        hoisted.mockDoc.mockImplementation((path: string) => ({
            path,
            set: vi.fn(async () => {
                setCalls.push(path);
            }),
            get: vi.fn().mockResolvedValue({ exists: true, data: () => ({}) }),
        }));

        const parsedEvent = {
            setID: vi.fn(),
            getActivities: vi.fn(() => [{ getID: () => 'a1' }]),
        } as any;

        const result = await persistReparsedEvent(
            'u1',
            'e1',
            parsedEvent,
            { originalFiles: [{ path: 'orig.fit' }] },
            [
                { id: 'a1', data: () => ({}) } as any,
                { id: 'a2', data: () => ({}) } as any,
            ],
            '9.0.99',
        );

        expect(result.staleActivitiesDeleted).toBe(1);
        expect(hoisted.mockBatchDelete).toHaveBeenCalledTimes(1);
        expect(hoisted.mockBatchCommit).toHaveBeenCalledTimes(1);
        expect(setCalls.some(path => path.includes('/metaData/processing'))).toBe(true);
        expect(hoisted.mockWriteAllEventData).toHaveBeenCalled();
    });

    it('persistReparsedEvent should avoid batch delete when there are no stale activities', async () => {
        const parsedEvent = {
            setID: vi.fn(),
            getActivities: vi.fn(() => [{ getID: () => 'a1' }]),
        } as any;

        const result = await persistReparsedEvent(
            'u1',
            'e1',
            parsedEvent,
            {},
            [{ id: 'a1', data: () => ({}) } as any],
            TARGET_SPORTS_LIB_VERSION,
        );

        expect(result.staleActivitiesDeleted).toBe(0);
        expect(hoisted.mockBatchDelete).not.toHaveBeenCalled();
        expect(hoisted.mockBatchCommit).not.toHaveBeenCalled();
    });

    it('shouldEventBeReparsed should apply semver-based candidate logic', async () => {
        const missingProcessingRef = {
            path: 'users/u1/events/e-missing-doc',
            collection: vi.fn(() => ({
                doc: vi.fn(() => ({
                    get: vi.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
                })),
            })),
        } as any;
        const matchingRef = {
            path: 'users/u1/events/e-matching',
            collection: vi.fn(() => ({
                doc: vi.fn(() => ({
                    get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ sportsLibVersion: TARGET_SPORTS_LIB_VERSION }) }),
                })),
            })),
        } as any;
        const lowerRef = {
            path: 'users/u1/events/e-lower',
            collection: vi.fn(() => ({
                doc: vi.fn(() => ({
                    get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ sportsLibVersion: LOWER_SPORTS_LIB_VERSION }) }),
                })),
            })),
        } as any;
        const higherRef = {
            path: 'users/u1/events/e-higher',
            collection: vi.fn(() => ({
                doc: vi.fn(() => ({
                    get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ sportsLibVersion: HIGHER_SPORTS_LIB_VERSION }) }),
                })),
            })),
        } as any;
        const missingVersionRef = {
            path: 'users/u1/events/e-missing-version',
            collection: vi.fn(() => ({
                doc: vi.fn(() => ({
                    get: vi.fn().mockResolvedValue({ exists: true, data: () => ({}) }),
                })),
            })),
        } as any;
        const malformedVersionRef = {
            path: 'users/u1/events/e-malformed',
            collection: vi.fn(() => ({
                doc: vi.fn(() => ({
                    get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ sportsLibVersion: 'unknown' }) }),
                })),
            })),
        } as any;

        await expect(shouldEventBeReparsed(missingProcessingRef, TARGET_SPORTS_LIB_VERSION)).resolves.toBe(true);
        await expect(shouldEventBeReparsed(missingVersionRef, TARGET_SPORTS_LIB_VERSION)).resolves.toBe(true);
        await expect(shouldEventBeReparsed(matchingRef, TARGET_SPORTS_LIB_VERSION)).resolves.toBe(false);
        await expect(shouldEventBeReparsed(lowerRef, TARGET_SPORTS_LIB_VERSION)).resolves.toBe(true);
        await expect(shouldEventBeReparsed(higherRef, TARGET_SPORTS_LIB_VERSION)).resolves.toBe(false);
        await expect(shouldEventBeReparsed(malformedVersionRef, TARGET_SPORTS_LIB_VERSION))
            .rejects
            .toThrow('Invalid stored sports-lib version "unknown" at users/u1/events/e-malformed');
        await expect(shouldEventBeReparsed(matchingRef, 'not-semver'))
            .rejects
            .toThrow('Invalid target sports-lib version "not-semver"');
    });

    it('writeReparseStatus should write merged status payload to event metadata doc', async () => {
        const set = vi.fn().mockResolvedValue(undefined);
        hoisted.mockDoc.mockImplementation((path: string) => ({
            path,
            set,
            get: vi.fn().mockResolvedValue({ exists: true, data: () => ({}) }),
        }));

        await writeReparseStatus('u1', 'e1', {
            status: 'completed',
            targetSportsLibVersion: TARGET_SPORTS_LIB_VERSION,
            checkedAt: 'ts' as any,
        });

        expect(hoisted.mockDoc).toHaveBeenCalledWith('users/u1/events/e1/metaData/reparseStatus');
        expect(set).toHaveBeenCalledWith(expect.objectContaining({
            status: 'completed',
            targetSportsLibVersion: TARGET_SPORTS_LIB_VERSION,
        }), { merge: true });
    });

    it('buildSportsLibReparseJobId should be deterministic and version-sensitive', () => {
        const first = buildSportsLibReparseJobId('u1', 'e1', TARGET_SPORTS_LIB_VERSION);
        const second = buildSportsLibReparseJobId('u1', 'e1', TARGET_SPORTS_LIB_VERSION);
        const differentVersion = buildSportsLibReparseJobId('u1', 'e1', `${TARGET_SPORTS_LIB_VERSION}-different`);

        expect(first).toBe(second);
        expect(first).not.toBe(differentVersion);
    });

    it('getEventAndActivitiesForReparse should throw when event is missing', async () => {
        hoisted.mockDoc.mockImplementation((path: string) => ({
            path,
            get: vi.fn().mockResolvedValue(path === 'users/u1/events/e404'
                ? { exists: false, data: () => ({}) }
                : { exists: true, data: () => ({}) }),
            set: vi.fn().mockResolvedValue(undefined),
        }));

        await expect(getEventAndActivitiesForReparse('u1', 'e404')).rejects.toThrow('Event e404 was not found for user u1');
    });

    it('getEventAndActivitiesForReparse should return event and activity docs', async () => {
        hoisted.mockDoc.mockImplementation((path: string) => ({
            path,
            get: vi.fn().mockResolvedValue(path === 'users/u1/events/e1'
                ? { exists: true, data: () => ({ id: 'event-data' }) }
                : { exists: true, data: () => ({}) }),
            set: vi.fn().mockResolvedValue(undefined),
        }));
        hoisted.mockCollection.mockImplementation((path: string) => {
            if (path === 'users/u1/activities') {
                return {
                    where: vi.fn().mockReturnThis(),
                    orderBy: vi.fn().mockReturnThis(),
                    get: vi.fn().mockResolvedValue({ docs: [{ id: 'a1' }] }),
                };
            }
            return makeCollectionQuery([]);
        });

        const result = await getEventAndActivitiesForReparse('u1', 'e1');
        expect(result.eventRef.path).toBe('users/u1/events/e1');
        expect(result.activityDocs).toHaveLength(1);
    });

    it('reparseEventFromOriginalFiles should skip when event has no source files', async () => {
        const result = await reparseEventFromOriginalFiles('u1', 'e1', {
            eventData: {},
            activityDocs: [],
            targetSportsLibVersion: TARGET_SPORTS_LIB_VERSION,
        });

        expect(result.status).toBe('skipped');
        expect(result.reason).toBe(SPORTS_LIB_REPARSE_SKIP_REASON_NO_ORIGINAL_FILES);
    });

    it('reparseEventFromOriginalFiles should parse, preserve fields, and persist', async () => {
        const parsedEvent = makeEvent();
        hoisted.fitImporter.getFromArrayBuffer.mockResolvedValue(parsedEvent);

        const result = await reparseEventFromOriginalFiles('u1', 'e1', {
            eventData: {
                originalFile: { path: 'users/u1/events/e1/original.fit' },
                description: 'keep-desc',
                privacy: 'private',
                notes: 'keep-notes',
            },
            activityDocs: [
                { id: 'a-old-1', data: () => ({ creator: { name: 'creator-1' } }) } as any,
                { id: 'a-old-2', data: () => ({ creator: { name: 'creator-2' } }) } as any,
            ],
            targetSportsLibVersion: TARGET_SPORTS_LIB_VERSION,
        });

        expect(result.status).toBe('completed');
        expect(result.sourceFilesCount).toBe(1);
        expect(result.parsedActivitiesCount).toBe(2);
        expect(hoisted.reGenerateStatsForEvent).toHaveBeenCalledWith(parsedEvent);
        expect(hoisted.mockWriteAllEventData).toHaveBeenCalled();
    });

    it('reparseEventFromOriginalFiles should fetch event and activities when options are omitted', async () => {
        const parsedEvent = makeEvent();
        hoisted.fitImporter.getFromArrayBuffer.mockResolvedValue(parsedEvent);
        hoisted.mockDoc.mockImplementation((path: string) => ({
            path,
            get: vi.fn().mockResolvedValue(path === 'users/u1/events/e1'
                ? {
                    exists: true,
                    data: () => ({
                        originalFile: { path: 'users/u1/events/e1/original.fit' },
                        description: 'desc',
                    }),
                }
                : { exists: true, data: () => ({}) }),
            set: vi.fn().mockResolvedValue(undefined),
        }));
        hoisted.mockCollection.mockImplementation((path: string) => {
            if (path === 'users/u1/activities') {
                return {
                    where: vi.fn().mockReturnThis(),
                    orderBy: vi.fn().mockReturnThis(),
                    get: vi.fn().mockResolvedValue({
                        docs: [
                            { id: 'a-old-1', data: () => ({ creator: { name: 'creator-1' } }) },
                            { id: 'a-old-2', data: () => ({ creator: { name: 'creator-2' } }) },
                        ],
                    }),
                };
            }
            return makeCollectionQuery([]);
        });

        const result = await reparseEventFromOriginalFiles('u1', 'e1');
        expect(result.status).toBe('completed');
        expect(result.parsedActivitiesCount).toBe(2);
        expect(hoisted.mockWriteAllEventData).toHaveBeenCalled();
    });
});
