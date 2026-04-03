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
    const mockBucket = vi.fn((bucketName?: string) => ({
        name: bucketName || 'quantified-self-io',
        file: mockFile,
    }));

    const mockWriteAllEventData = vi.fn().mockResolvedValue(undefined);
    const eventWriterCtorArgs: Array<{
        adapter: any;
        logger: any;
    }> = [];

    const fitImporter = { getFromArrayBuffer: vi.fn() };
    const gpxImporter = { getFromString: vi.fn() };
    const tcxImporter = { getFromXML: vi.fn() };
    const suuntoJSONImporter = { getFromJSONString: vi.fn() };
    const suuntoSMLImporter = { getFromXML: vi.fn() };
    const mergeEvents = vi.fn((events: any[]) => events[0]);
    const reGenerateStatsForEvent = vi.fn();
    const generateMissingStreamsAndStatsForActivity = vi.fn();
    const mockGenerateActivityIDFromSourceKey = vi.fn();
    const mockLoggerInfo = vi.fn();
    const mockLoggerWarn = vi.fn();
    const mockLoggerError = vi.fn();

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
        eventWriterCtorArgs,
        fitImporter,
        gpxImporter,
        tcxImporter,
        suuntoJSONImporter,
        suuntoSMLImporter,
        mergeEvents,
        reGenerateStatsForEvent,
        generateMissingStreamsAndStatsForActivity,
        mockGenerateActivityIDFromSourceKey,
        mockLoggerInfo,
        mockLoggerWarn,
        mockLoggerError,
        serverTimestamp,
        deleteField,
    };
});

vi.mock('firebase-functions/logger', () => ({
    info: (...args: unknown[]) => hoisted.mockLoggerInfo(...args),
    warn: (...args: unknown[]) => hoisted.mockLoggerWarn(...args),
    error: (...args: unknown[]) => hoisted.mockLoggerError(...args),
}));

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
    DataDistance: { type: 'distance' },
    DataDuration: { type: 'duration' },
    EventImporterFIT: hoisted.fitImporter,
    EventImporterGPX: hoisted.gpxImporter,
    EventImporterTCX: hoisted.tcxImporter,
    EventImporterSuuntoJSON: hoisted.suuntoJSONImporter,
    EventImporterSuuntoSML: hoisted.suuntoSMLImporter,
    ActivityUtilities: {
        generateMissingStreamsAndStatsForActivity: hoisted.generateMissingStreamsAndStatsForActivity,
    },
    EventUtilities: {
        mergeEvents: hoisted.mergeEvents,
        reGenerateStatsForEvent: hoisted.reGenerateStatsForEvent,
    },
}));

vi.mock('../shared/event-writer', () => ({
    EventWriter: vi.fn((adapter: any, _storageAdapter: any, _bucketName: any, logger: any) => {
        hoisted.eventWriterCtorArgs.push({ adapter, logger });
        return {
            writeAllEventData: (...args: any[]) => hoisted.mockWriteAllEventData(...args),
        };
    }),
}));

vi.mock('../shared/id-generator', () => ({
    generateActivityIDFromSourceKey: (...args: unknown[]) => hoisted.mockGenerateActivityIDFromSourceKey(...args),
}));

import {
    hasPaidOrGraceAccess,
    parseFromOriginalFilesStrict,
    applyPreservedFields,
    resolveActivityEditCarryover,
    assignReimportActivityIds,
    extractSourceFiles,
    persistReparsedEvent,
    parseUIDAllowlist,
    parseUidAndEventIdFromEventPath,
    resolveTargetSportsLibVersion,
    resolveTargetSportsLibVersionCode,
    sportsLibVersionToCode,
    shouldEventBeReparsed,
    writeReparseStatus,
    buildSportsLibReparseJobId,
    getEventAndActivitiesForReparse,
    reparseEventFromOriginalFiles,
    SPORTS_LIB_REPARSE_SKIP_REASON_NO_ORIGINAL_FILES,
    SPORTS_LIB_PRIMARY_BUCKET,
    SPORTS_LIB_LEGACY_APPSPOT_BUCKET,
    applyAutoHealedSourceBucketMetadata,
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
        hoisted.eventWriterCtorArgs.length = 0;

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
        hoisted.mockBucket.mockImplementation((bucketName?: string) => ({
            name: bucketName || SPORTS_LIB_PRIMARY_BUCKET,
            file: hoisted.mockFile,
        }));
        hoisted.mockDownload.mockResolvedValue([Buffer.from('fit-data')]);
        hoisted.mockWriteAllEventData.mockResolvedValue(undefined);
        hoisted.fitImporter.getFromArrayBuffer.mockResolvedValue(makeEvent());
        hoisted.gpxImporter.getFromString.mockResolvedValue(makeEvent());
        hoisted.tcxImporter.getFromXML.mockResolvedValue(makeEvent());
        hoisted.suuntoJSONImporter.getFromJSONString.mockResolvedValue(makeEvent());
        hoisted.suuntoSMLImporter.getFromXML.mockResolvedValue(makeEvent());
        hoisted.generateMissingStreamsAndStatsForActivity.mockImplementation(() => { });
        hoisted.mockGenerateActivityIDFromSourceKey.mockImplementation(
            async (eventID: string, sourceActivityKey: string) => `new-${eventID}-${sourceActivityKey}`,
        );
    });

    it('hasPaidOrGraceAccess should return true for basic claim', async () => {
        hoisted.mockGetUser.mockResolvedValue({ customClaims: { stripeRole: 'basic' } });
        await expect(hasPaidOrGraceAccess('u1')).resolves.toBe(true);
    });

    it('resolveTargetSportsLibVersion should return hardcoded target version', () => {
        expect(resolveTargetSportsLibVersion()).toBe(TARGET_SPORTS_LIB_VERSION);
    });

    it('resolveTargetSportsLibVersionCode should return encoded hardcoded target version', () => {
        expect(resolveTargetSportsLibVersionCode()).toBe(sportsLibVersionToCode(TARGET_SPORTS_LIB_VERSION));
    });

    it('sportsLibVersionToCode should encode valid semver and reject invalid versions', () => {
        expect(sportsLibVersionToCode('9.1.4')).toBe(9001004);
        expect(() => sportsLibVersionToCode('not-a-version')).toThrow('Invalid sports-lib version');
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

    it('parseFromOriginalFilesStrict should fallback to default bucket when metadata bucket object is missing', async () => {
        hoisted.mockBucket.mockImplementation((bucketName?: string) => ({
            name: bucketName || 'quantified-self-io',
            file: vi.fn(() => ({
                download: vi.fn(async () => {
                    if (bucketName === 'quantified-self-io.appspot.com') {
                        throw new Error('No such object: quantified-self-io.appspot.com/users/u1/events/e1/original.fit');
                    }
                    return [Buffer.from('fit-data')];
                }),
            })),
        }));

        const result = await parseFromOriginalFilesStrict([
            { path: 'users/u1/events/e1/original.fit', bucket: 'quantified-self-io.appspot.com' },
        ]);

        expect(result.sourceFilesCount).toBe(1);
        expect(hoisted.fitImporter.getFromArrayBuffer).toHaveBeenCalledTimes(1);
    });

    it('parseFromOriginalFilesStrict should recover when default bucket lookup throws', async () => {
        hoisted.mockBucket.mockImplementation((bucketName?: string) => {
            if (bucketName === undefined) {
                throw new Error('default bucket lookup failed');
            }
            return {
                name: bucketName,
                file: vi.fn(() => ({
                    download: vi.fn(async () => [Buffer.from('fit-data')]),
                })),
            };
        });

        const result = await parseFromOriginalFilesStrict([
            { path: 'users/u1/events/e1/original.fit', bucket: 'metadata-bucket' },
        ]);

        expect(result.sourceFilesCount).toBe(1);
        expect(hoisted.fitImporter.getFromArrayBuffer).toHaveBeenCalledTimes(1);
    });

    it('parseFromOriginalFilesStrict should treat blank metadata bucket names as absent', async () => {
        const result = await parseFromOriginalFilesStrict([
            { path: 'users/u1/events/e1/original.fit', bucket: '   ' },
        ]);

        expect(result.sourceFilesCount).toBe(1);
        expect(result.resolvedSourceBuckets[0].resolvedBucket).toBe(SPORTS_LIB_PRIMARY_BUCKET);
    });

    it('parseFromOriginalFilesStrict should treat numeric 404 error codes as not-found and fallback', async () => {
        hoisted.mockBucket.mockImplementation((bucketName?: string) => ({
            name: bucketName || SPORTS_LIB_PRIMARY_BUCKET,
            file: vi.fn(() => ({
                download: vi.fn(async () => {
                    if (bucketName === 'metadata-bucket') {
                        const error: any = new Error('missing');
                        error.code = 404;
                        throw error;
                    }
                    return [Buffer.from('fit-data')];
                }),
            })),
        }));

        const result = await parseFromOriginalFilesStrict([
            { path: 'users/u1/events/e1/original.fit', bucket: 'metadata-bucket' },
        ]);

        expect(result.sourceFilesCount).toBe(1);
    });

    it('parseFromOriginalFilesStrict should treat string not-found error codes as not-found and fallback', async () => {
        hoisted.mockBucket.mockImplementation((bucketName?: string) => ({
            name: bucketName || SPORTS_LIB_PRIMARY_BUCKET,
            file: vi.fn(() => ({
                download: vi.fn(async () => {
                    if (bucketName === 'metadata-bucket') {
                        const error: any = new Error('missing');
                        error.code = 'storage/object-not-found';
                        throw error;
                    }
                    return [Buffer.from('fit-data')];
                }),
            })),
        }));

        const result = await parseFromOriginalFilesStrict([
            { path: 'users/u1/events/e1/original.fit', bucket: 'metadata-bucket' },
        ]);

        expect(result.sourceFilesCount).toBe(1);
    });

    it('parseFromOriginalFilesStrict should fail when storage throws non-not-found errors', async () => {
        hoisted.mockBucket.mockImplementation((_bucketName?: string) => ({
            name: SPORTS_LIB_PRIMARY_BUCKET,
            file: vi.fn(() => ({
                download: vi.fn(async () => {
                    const error: any = new Error('permission denied');
                    error.code = 'permission-denied';
                    throw error;
                }),
            })),
        }));

        await expect(parseFromOriginalFilesStrict([
            { path: 'users/u1/events/e1/original.fit', bucket: 'metadata-bucket' },
        ])).rejects.toThrow('permission denied');
    });

    it('parseFromOriginalFilesStrict should fail when all candidate buckets are missing the object', async () => {
        hoisted.mockBucket.mockImplementation((_bucketName?: string) => ({
            name: SPORTS_LIB_PRIMARY_BUCKET,
            file: vi.fn(() => ({
                download: vi.fn(async () => {
                    const error: any = new Error('missing');
                    error.code = 'not_found';
                    throw error;
                }),
            })),
        }));

        await expect(parseFromOriginalFilesStrict([
            { path: 'users/u1/events/e1/original.fit', bucket: 'metadata-bucket' },
        ])).rejects.toThrow('No such object in any candidate bucket');
    });

    it('parseFromOriginalFilesStrict should surface fallback last error text when not-found errors have no message', async () => {
        hoisted.mockBucket.mockImplementation((_bucketName?: string) => ({
            name: SPORTS_LIB_PRIMARY_BUCKET,
            file: vi.fn(() => ({
                download: vi.fn(async () => {
                    const error: any = {
                        code: 'not_found',
                        toString: () => '',
                    };
                    throw error;
                }),
            })),
        }));

        await expect(parseFromOriginalFilesStrict([
            { path: 'users/u1/events/e1/original.fit', bucket: 'metadata-bucket' },
        ])).rejects.toThrow('Last error: No such object');
    });

    it('parseFromOriginalFilesStrict should fail when any source file fails', async () => {
        hoisted.fitImporter.getFromArrayBuffer.mockRejectedValue(new Error('bad-fit'));
        await expect(parseFromOriginalFilesStrict([
            { path: 'users/u1/events/e1/original.fit' }
        ])).rejects.toThrow('bad-fit');
    });

    it('parseFromOriginalFilesStrict should use fallback error reason when thrown value has no message', async () => {
        hoisted.fitImporter.getFromArrayBuffer.mockRejectedValue({});
        await expect(parseFromOriginalFilesStrict([
            { path: 'users/u1/events/e1/original.fit' },
        ])).rejects.toThrow('Could not parse source file');
    });

    it('parseFromOriginalFilesStrict should return usedFallbackBucket=false when metadata bucket matches resolved bucket', async () => {
        const result = await parseFromOriginalFilesStrict([
            { path: 'users/u1/events/e1/original.fit', bucket: SPORTS_LIB_PRIMARY_BUCKET },
        ]);

        expect(result.sourceFilesCount).toBe(1);
        expect(result.resolvedSourceBuckets[0].usedFallbackBucket).toBe(false);
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

    it('parseFromOriginalFilesStrict should stamp source keys deterministically when parsed order changes', async () => {
        const buildActivity = (input: {
            creator: string;
            start: string;
            end: string;
            type: string;
            duration: number;
            distance: number;
        }) => ({
            setID: vi.fn(),
            getID: vi.fn(() => null),
            creator: { name: input.creator },
            startDate: new Date(input.start),
            endDate: new Date(input.end),
            type: input.type,
            getStat: vi.fn((statType: string) => {
                if (statType === 'duration') {
                    return { getValue: () => input.duration };
                }
                if (statType === 'distance') {
                    return { getValue: () => input.distance };
                }
                return null;
            }),
        });

        const makeParsedEvent = (order: 'ab' | 'ba') => {
            const activityA = buildActivity({
                creator: 'alice',
                start: '2026-01-01T10:00:00.000Z',
                end: '2026-01-01T10:30:00.000Z',
                type: 'Run',
                duration: 1800,
                distance: 5000,
            });
            const activityB = buildActivity({
                creator: 'bob',
                start: '2026-01-01T12:00:00.000Z',
                end: '2026-01-01T13:00:00.000Z',
                type: 'Ride',
                duration: 3600,
                distance: 30000,
            });
            return {
                setID: vi.fn(),
                getActivities: vi.fn(() => (order === 'ab' ? [activityA, activityB] : [activityB, activityA])),
            };
        };

        hoisted.fitImporter.getFromArrayBuffer
            .mockResolvedValueOnce(makeParsedEvent('ab') as any)
            .mockResolvedValueOnce(makeParsedEvent('ba') as any);

        const firstParse = await parseFromOriginalFilesStrict([{ path: 'users/u1/events/e1/original.fit' }]);
        const secondParse = await parseFromOriginalFilesStrict([{ path: 'users/u1/events/e1/original.fit' }]);

        const keyBySignature = (activities: any[]) =>
            new Map(
                activities.map((activity) => [
                    `${activity.type}|${activity.startDate?.toISOString?.()}`,
                    activity.sourceActivityKey,
                ]),
            );

        const firstKeys = keyBySignature(firstParse.finalEvent.getActivities() as any[]);
        const secondKeys = keyBySignature(secondParse.finalEvent.getActivities() as any[]);

        expect(firstKeys.get('Run|2026-01-01T10:00:00.000Z')).toBe(secondKeys.get('Run|2026-01-01T10:00:00.000Z'));
        expect(firstKeys.get('Ride|2026-01-01T12:00:00.000Z')).toBe(secondKeys.get('Ride|2026-01-01T12:00:00.000Z'));
        expect(firstKeys.get('Run|2026-01-01T10:00:00.000Z')).toMatch(/^[a-f0-9]{64}:/);
        expect(firstKeys.get('Ride|2026-01-01T12:00:00.000Z')).toMatch(/^[a-f0-9]{64}:/);
    });

    it('parseFromOriginalFilesStrict should leave keys unset for unresolved indistinguishable duplicates', async () => {
        const buildDuplicateActivity = () => ({
            setID: vi.fn(),
            getID: vi.fn(() => null),
            creator: { name: 'same-device' },
            startDate: new Date('2026-01-01T10:00:00.000Z'),
            endDate: new Date('2026-01-01T10:30:00.000Z'),
            type: 'Run',
            getStat: vi.fn((statType: string) => {
                if (statType === 'duration') {
                    return { getValue: () => 1800 };
                }
                if (statType === 'distance') {
                    return { getValue: () => 5000 };
                }
                return null;
            }),
        });

        const parsedEvent = {
            setID: vi.fn(),
            getActivities: vi.fn(() => [buildDuplicateActivity(), buildDuplicateActivity()]),
        };
        hoisted.fitImporter.getFromArrayBuffer.mockResolvedValue(parsedEvent as any);

        const result = await parseFromOriginalFilesStrict([{ path: 'users/u1/events/e1/original.fit' }]);
        const activities = result.finalEvent.getActivities() as any[];

        expect(activities).toHaveLength(2);
        expect(activities[0].sourceActivityKey).toBeUndefined();
        expect(activities[1].sourceActivityKey).toBeUndefined();
    });

    it('parseFromOriginalFilesStrict should fail for unsupported extensions', async () => {
        await expect(parseFromOriginalFilesStrict([
            { path: 'unsupported.zip' }
        ])).rejects.toThrow('Unsupported original file extension');
    });

    it('parseFromOriginalFilesStrict should fail when no source files are provided', async () => {
        await expect(parseFromOriginalFilesStrict([])).rejects.toThrow('No source files produced a parsed event');
    });

    it('parseFromOriginalFilesStrict should fail for files without extension', async () => {
        await expect(parseFromOriginalFilesStrict([
            { path: 'users/u1/events/e1/original' }
        ])).rejects.toThrow('Unsupported original file extension');
    });

    it('parseFromOriginalFilesStrict should handle paths ending with a dot as empty extension', async () => {
        await expect(parseFromOriginalFilesStrict([
            { path: 'users/u1/events/e1/original.' }
        ])).rejects.toThrow('Unsupported original file extension');
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

    it('extractSourceFiles should normalize all supported startDate shapes', () => {
        const toDateValue = new Date('2026-01-01T00:00:00.000Z');
        const sourceFiles = extractSourceFiles({
            originalFiles: [
                { path: 'to-date.fit', startDate: { toDate: () => toDateValue } },
                { path: 'seconds.fit', startDate: { seconds: 10, nanoseconds: 500000000 } },
                { path: 'seconds-only.fit', startDate: { seconds: 10 } },
                { path: 'number.fit', startDate: 1000 },
                { path: 'string.fit', startDate: '2026-01-02T00:00:00.000Z' },
                { path: 'invalid.fit', startDate: 'not-a-date' },
                { path: 'unknown.fit', startDate: { foo: 'bar' } },
            ],
        });

        expect(sourceFiles[0].startDate?.toISOString()).toBe(toDateValue.toISOString());
        expect(sourceFiles[1].startDate?.getTime()).toBe(10500);
        expect(sourceFiles[2].startDate?.getTime()).toBe(10000);
        expect(sourceFiles[3].startDate?.getTime()).toBe(1000);
        expect(sourceFiles[4].startDate?.toISOString()).toBe('2026-01-02T00:00:00.000Z');
        expect(sourceFiles[5].startDate).toBeUndefined();
        expect(sourceFiles[6].startDate).toBeUndefined();
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

    it('applyPreservedFields should keep editable user fields', () => {
        const event: any = {};
        applyPreservedFields(event, {
            isMerge: false,
            mergeType: 'multi',
            description: 'desc',
            privacy: 'private',
            notes: 'notes',
            rpe: 7,
            feeling: 3,
            name: 'new-name',
        });
        expect(event.isMerge).toBe(false);
        expect(event.mergeType).toBe('multi');
        expect(event.description).toBe('desc');
        expect(event.privacy).toBe('private');
        expect(event.notes).toBe('notes');
        expect(event.rpe).toBe(7);
        expect(event.feeling).toBe(3);
        expect(event.name).toBeUndefined();
    });

    it('applyPreservedFields should not override isMerge when existing value is not boolean', () => {
        const event: any = { isMerge: true, mergeType: 'benchmark' };
        applyPreservedFields(event, {
            isMerge: 'nope',
            mergeType: 'invalid',
        } as any);

        expect(event.isMerge).toBe(true);
        expect(event.mergeType).toBe('benchmark');
    });

    it('resolveActivityEditCarryover should preserve creator names using deterministic matching when order changes', () => {
        const activityOne = {
            creator: { name: 'new1' },
            startDate: new Date('2026-01-01T10:00:00.000Z'),
            endDate: new Date('2026-01-01T10:30:00.000Z'),
            type: 'Run',
            getStat: vi.fn(() => null),
        };
        const activityTwo = {
            creator: { name: 'new2' },
            startDate: new Date('2026-01-01T12:00:00.000Z'),
            endDate: new Date('2026-01-01T12:30:00.000Z'),
            type: 'Ride',
            getStat: vi.fn(() => null),
        };
        const parsedEvent = {
            getActivities: () => [activityTwo, activityOne],
        } as any;

        const result = resolveActivityEditCarryover(parsedEvent, [
            {
                id: 'a1',
                data: () => ({
                    creator: { name: 'old1' },
                    startDate: new Date('2026-01-01T10:00:00.000Z'),
                    endDate: new Date('2026-01-01T10:30:00.000Z'),
                    type: 'Run',
                }),
            } as any,
            {
                id: 'a2',
                data: () => ({
                    creator: { name: 'old2' },
                    startDate: new Date('2026-01-01T12:00:00.000Z'),
                    endDate: new Date('2026-01-01T12:30:00.000Z'),
                    type: 'Ride',
                }),
            } as any,
        ]);

        expect(result.assignments.size).toBe(2);
        expect(activityOne.creator.name).toBe('old1');
        expect(activityTwo.creator.name).toBe('old2');
    });

    it('resolveActivityEditCarryover should leave creator unchanged on ambiguous matches', () => {
        const sharedStart = new Date('2026-01-01T10:00:00.000Z');
        const activityOne = { creator: { name: 'keep-me' }, startDate: sharedStart, type: 'Run', getStat: vi.fn(() => null) };
        const activityTwo = { creator: { name: 'keep-me-2' }, startDate: sharedStart, type: 'Run', getStat: vi.fn(() => null) };
        const parsedEvent = {
            getActivities: () => [activityOne, activityTwo],
        } as any;

        const result = resolveActivityEditCarryover(parsedEvent, [
            { id: 'a1', data: () => ({ creator: { name: 'old-1' }, startDate: sharedStart, type: 'Run' }) } as any,
            { id: 'a2', data: () => ({ creator: { name: 'old-2' }, startDate: sharedStart, type: 'Run' }) } as any,
        ]);

        expect(activityOne.creator.name).toBe('keep-me');
        expect(activityTwo.creator.name).toBe('keep-me-2');
        expect(result.assignments.size).toBe(0);
        expect(result.unmatchedParsedIndexes).toEqual([0, 1]);
        expect(result.unmatchedExistingIndexes).toEqual([0, 1]);
    });

    it('resolveActivityEditCarryover should decode legacy _value stats for strict matching', () => {
        const sharedStart = new Date('2026-01-01T10:00:00.000Z');
        const sharedEnd = new Date('2026-01-01T10:30:00.000Z');

        const parsedFirst = {
            creator: { name: 'new-first' },
            startDate: sharedStart,
            endDate: sharedEnd,
            type: 'Run',
            getStat: vi.fn((type: string) => {
                if (type === 'duration') {
                    return { getValue: () => 100 };
                }
                if (type === 'distance') {
                    return { getValue: () => 1000 };
                }
                return null;
            }),
        };
        const parsedSecond = {
            creator: { name: 'new-second' },
            startDate: sharedStart,
            endDate: sharedEnd,
            type: 'Run',
            getStat: vi.fn((type: string) => {
                if (type === 'duration') {
                    return { getValue: () => 200 };
                }
                if (type === 'distance') {
                    return { getValue: () => 2000 };
                }
                return null;
            }),
        };

        const parsedEvent = {
            getActivities: () => [parsedSecond, parsedFirst],
        } as any;

        const result = resolveActivityEditCarryover(parsedEvent, [
            {
                id: 'a-1',
                data: () => ({
                    creator: { name: 'old-first' },
                    startDate: sharedStart,
                    endDate: sharedEnd,
                    type: 'Run',
                    stats: {
                        duration: { _value: 100 },
                        distance: { _value: 1000 },
                    },
                }),
            } as any,
            {
                id: 'a-2',
                data: () => ({
                    creator: { name: 'old-second' },
                    startDate: sharedStart,
                    endDate: sharedEnd,
                    type: 'Run',
                    stats: {
                        duration: { _value: 200 },
                        distance: { _value: 2000 },
                    },
                }),
            } as any,
        ]);

        expect(result.assignments.size).toBe(2);
        expect(parsedFirst.creator.name).toBe('old-first');
        expect(parsedSecond.creator.name).toBe('old-second');
    });

    it('assignReimportActivityIds should always assign deterministic ids by sourceActivityKey', async () => {
        const combinedHash = 'a'.repeat(64);
        const sourceKeyOne = `${combinedHash}:${'1'.repeat(64)}:0`;
        const sourceKeyTwo = `${combinedHash}:${'2'.repeat(64)}:0`;
        const activityOne = {
            setID: vi.fn(),
            getID: vi.fn(() => 'old-id-1'),
            sourceActivityKey: sourceKeyOne,
        };
        const activityTwo = {
            setID: vi.fn(),
            getID: vi.fn(() => 'old-id-2'),
            sourceActivityKey: sourceKeyTwo,
        };
        const parsedEvent = {
            getActivities: () => [activityOne, activityTwo],
        } as any;

        await assignReimportActivityIds(parsedEvent, 'event-1', {
            combinedSourceContentHash: combinedHash,
        });

        expect(hoisted.mockGenerateActivityIDFromSourceKey).toHaveBeenNthCalledWith(1, 'event-1', sourceKeyOne);
        expect(hoisted.mockGenerateActivityIDFromSourceKey).toHaveBeenNthCalledWith(2, 'event-1', sourceKeyTwo);
        expect(activityOne.setID).toHaveBeenCalledWith(`new-event-1-${sourceKeyOne}`);
        expect(activityTwo.setID).toHaveBeenCalledWith(`new-event-1-${sourceKeyTwo}`);
    });

    it('assignReimportActivityIds should keep key-based ids stable even when parsed order changes', async () => {
        const combinedHash = 'c'.repeat(64);
        const sourceKeyA = `${combinedHash}:${'a'.repeat(64)}:0`;
        const sourceKeyB = `${combinedHash}:${'b'.repeat(64)}:0`;
        const firstOrder = [
            { setID: vi.fn(), sourceActivityKey: sourceKeyA },
            { setID: vi.fn(), sourceActivityKey: sourceKeyB },
        ];
        const secondOrder = [
            { setID: vi.fn(), sourceActivityKey: sourceKeyB },
            { setID: vi.fn(), sourceActivityKey: sourceKeyA },
        ];

        await assignReimportActivityIds({ getActivities: () => firstOrder } as any, 'event-2', {
            combinedSourceContentHash: combinedHash,
        });
        await assignReimportActivityIds({ getActivities: () => secondOrder } as any, 'event-2', {
            combinedSourceContentHash: combinedHash,
        });

        const idsByKeyFirst = new Map(firstOrder.map((activity: any) => [activity.sourceActivityKey, activity.setID.mock.calls[0][0]]));
        const idsByKeySecond = new Map(secondOrder.map((activity: any) => [activity.sourceActivityKey, activity.setID.mock.calls[0][0]]));

        expect(idsByKeyFirst.get(sourceKeyA)).toBe(idsByKeySecond.get(sourceKeyA));
        expect(idsByKeyFirst.get(sourceKeyB)).toBe(idsByKeySecond.get(sourceKeyB));
    });

    it('assignReimportActivityIds should restamp missing or non-SHA keys before assigning ids', async () => {
        const combinedHash = 'd'.repeat(64);
        const parsedActivities = [
            {
                setID: vi.fn(),
                startDate: new Date('2026-01-01T10:00:00.000Z'),
                endDate: new Date('2026-01-01T10:30:00.000Z'),
                type: 'Run',
                creator: { name: 'first' },
                getStat: vi.fn(() => null),
            },
            {
                setID: vi.fn(),
                sourceActivityKey: 'legacy-key',
                startDate: new Date('2026-01-01T12:00:00.000Z'),
                endDate: new Date('2026-01-01T12:30:00.000Z'),
                type: 'Ride',
                creator: { name: 'second' },
                getStat: vi.fn(() => null),
            },
        ];

        await assignReimportActivityIds({
            getActivities: () => parsedActivities,
        } as any, 'event-3', {
            combinedSourceContentHash: combinedHash,
        });

        expect(hoisted.mockGenerateActivityIDFromSourceKey).toHaveBeenCalledTimes(2);
        const firstKey = hoisted.mockGenerateActivityIDFromSourceKey.mock.calls[0]?.[1] as string;
        const secondKey = hoisted.mockGenerateActivityIDFromSourceKey.mock.calls[1]?.[1] as string;
        expect(firstKey).toMatch(/^[a-f0-9]{64}:[a-f0-9]{64}:[0-9]+$/);
        expect(secondKey).toMatch(/^[a-f0-9]{64}:[a-f0-9]{64}:[0-9]+$/);
        expect(firstKey.startsWith(`${combinedHash}:`)).toBe(true);
        expect(secondKey.startsWith(`${combinedHash}:`)).toBe(true);
    });

    it('assignReimportActivityIds should restamp malformed sha-prefix keys before assigning ids', async () => {
        const combinedHash = 'e'.repeat(64);
        const malformedKey = `${'a'.repeat(64)}:legacy-signature:0`;
        const parsedActivities = [
            {
                setID: vi.fn(),
                sourceActivityKey: malformedKey,
                startDate: new Date('2026-01-01T09:00:00.000Z'),
                endDate: new Date('2026-01-01T09:30:00.000Z'),
                type: 'Run',
                creator: { name: 'legacy' },
                getStat: vi.fn(() => null),
            },
        ];

        await assignReimportActivityIds({
            getActivities: () => parsedActivities,
        } as any, 'event-legacy', {
            combinedSourceContentHash: combinedHash,
        });

        expect(hoisted.mockGenerateActivityIDFromSourceKey).toHaveBeenCalledTimes(1);
        const assignedKey = hoisted.mockGenerateActivityIDFromSourceKey.mock.calls[0]?.[1] as string;
        expect(assignedKey).toMatch(/^[a-f0-9]{64}:[a-f0-9]{64}:[0-9]+$/);
        expect(assignedKey).not.toBe(malformedKey);
        expect(assignedKey.startsWith(`${combinedHash}:`)).toBe(true);
    });

    it('assignReimportActivityIds should fail when combinedSourceContentHash is missing or invalid', async () => {
        const missingHashEvent = {
            getActivities: () => [{ setID: vi.fn(), sourceActivityKey: `${'e'.repeat(64)}:${'1'.repeat(64)}:0` }],
        } as any;
        await expect(assignReimportActivityIds(missingHashEvent, 'event-3', {
            combinedSourceContentHash: '',
        }))
            .rejects
            .toThrow('Missing or invalid combinedSourceContentHash');

        const invalidHashEvent = {
            getActivities: () => [{ setID: vi.fn(), sourceActivityKey: `${'f'.repeat(64)}:${'2'.repeat(64)}:0` }],
        } as any;
        await expect(assignReimportActivityIds(invalidHashEvent, 'event-3', {
            combinedSourceContentHash: 'not-a-sha',
        }))
            .rejects
            .toThrow('Missing or invalid combinedSourceContentHash');
    });

    it('assignReimportActivityIds should fail on strict ambiguity after restamp', async () => {
        const combinedHash = 'f'.repeat(64);
        const ambiguousActivities = [
            {
                setID: vi.fn(),
                startDate: new Date('2026-01-01T10:00:00.000Z'),
                endDate: new Date('2026-01-01T10:30:00.000Z'),
                type: 'Run',
                creator: { name: 'same' },
                getStat: vi.fn(() => null),
            },
            {
                setID: vi.fn(),
                startDate: new Date('2026-01-01T10:00:00.000Z'),
                endDate: new Date('2026-01-01T10:30:00.000Z'),
                type: 'Run',
                creator: { name: 'same' },
                getStat: vi.fn(() => null),
            },
        ];

        await expect(assignReimportActivityIds({
            getActivities: () => ambiguousActivities,
        } as any, 'event-3', {
            combinedSourceContentHash: combinedHash,
        }))
            .rejects
            .toThrow('Ambiguous sourceActivityKey stamping');
    });

    it('persistReparsedEvent should delete stale activities and write processing metadata', async () => {
        const setCalls: Array<{ path: string; payload?: Record<string, unknown>; options?: Record<string, unknown> }> = [];
        hoisted.mockDoc.mockImplementation((path: string) => ({
            path,
            set: vi.fn(async (payload: Record<string, unknown>, options?: Record<string, unknown>) => {
                setCalls.push({ path, payload, options });
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
            { originalFiles: [{ path: 'orig.fit' }], isMerge: false, mergeType: 'multi' },
            [
                { id: 'a1', data: () => ({}) } as any,
                { id: 'a2', data: () => ({}) } as any,
            ],
            '9.0.99',
        );

        expect(result.staleActivitiesDeleted).toBe(1);
        expect(hoisted.mockBatchDelete).toHaveBeenCalledTimes(1);
        expect(hoisted.mockBatchCommit).toHaveBeenCalledTimes(1);
        const processingCall = setCalls.find(call => call.path.includes('/metaData/processing'));
        expect(processingCall).toBeTruthy();
        expect(processingCall?.payload).toEqual(expect.objectContaining({
            sportsLibVersion: '9.0.99',
            sportsLibVersionCode: sportsLibVersionToCode('9.0.99'),
            processedAt: 'SERVER_TIMESTAMP',
        }));
        const mergeMetadataCall = setCalls.find(call => call.path === 'users/u1/events/e1');
        expect(mergeMetadataCall?.payload).toEqual(expect.objectContaining({
            isMerge: false,
            mergeType: 'multi',
        }));
        expect(mergeMetadataCall?.options).toEqual({ merge: true });
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

    it('persistReparsedEvent should wire working firestore/log adapters into EventWriter', async () => {
        hoisted.mockCollection.mockImplementation((path: string) => {
            if (path === 'tmp') {
                return {
                    doc: vi.fn(() => ({ id: 'generated-id' })),
                } as any;
            }
            if (path.includes('/subscriptions')) {
                return makeCollectionQuery([]);
            }
            if (path.includes('/activities')) {
                return makeCollectionQuery([]);
            }
            return makeCollectionQuery([]);
        });

        hoisted.mockDoc.mockImplementation((path: string) => ({
            path,
            set: vi.fn().mockResolvedValue(undefined),
            get: vi.fn().mockResolvedValue({ exists: true, data: () => ({}) }),
        }));

        hoisted.mockWriteAllEventData.mockImplementationOnce(async () => {
            const ctorArgs = hoisted.eventWriterCtorArgs.at(-1);
            expect(ctorArgs).toBeTruthy();

            await ctorArgs!.adapter.setDoc(['users', 'u1', 'events', 'e1'], { probe: true });
            const blob = ctorArgs!.adapter.createBlob(Uint8Array.from([1, 2, 3]));
            expect(Buffer.isBuffer(blob)).toBe(true);
            expect(ctorArgs!.adapter.generateID()).toBe('generated-id');

            ctorArgs!.logger.info('info-test');
            ctorArgs!.logger.warn('warn-test');
            ctorArgs!.logger.error('error-test');
        });

        const parsedEvent = {
            setID: vi.fn(),
            getActivities: vi.fn(() => [{ getID: () => 'a1' }]),
        } as any;

        await persistReparsedEvent(
            'u1',
            'e1',
            parsedEvent,
            {},
            [{ id: 'a1', data: () => ({}) } as any],
            TARGET_SPORTS_LIB_VERSION,
        );

        expect(hoisted.mockDoc).toHaveBeenCalledWith('users/u1/events/e1');
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

    it('applyAutoHealedSourceBucketMetadata should skip invalid resolved entries and only rewrite mapped paths', () => {
        const existingEventDoc = {
            originalFile: { path: 'matched.fit', bucket: 'legacy-bucket' },
            originalFiles: [
                null,
                'invalid-entry' as any,
                { path: 'matched.fit', bucket: 'legacy-bucket' },
                { path: 'same.fit', bucket: 'quantified-self-io' },
                { path: 'unmapped.fit', bucket: 'legacy-bucket' },
            ],
        } as any;

        const result = applyAutoHealedSourceBucketMetadata(existingEventDoc, [
            { path: '', metadataBucket: 'x', resolvedBucket: 'quantified-self-io', usedFallbackBucket: false } as any,
            { path: 'invalid.fit', metadataBucket: 'x', resolvedBucket: '' as any, usedFallbackBucket: false } as any,
            { path: 'matched.fit', metadataBucket: 'legacy-bucket', resolvedBucket: 'quantified-self-io', usedFallbackBucket: false } as any,
            { path: 'same.fit', metadataBucket: 'quantified-self-io', resolvedBucket: 'quantified-self-io', usedFallbackBucket: false } as any,
            { path: 'missing-meta.fit', resolvedBucket: 'quantified-self-io', usedFallbackBucket: false } as any,
        ]);

        expect(result.healedEntries).toBe(2);
        expect((result.eventData as any).originalFile.bucket).toBe('quantified-self-io');
        expect((result.eventData as any).originalFiles[0]).toBeNull();
        expect((result.eventData as any).originalFiles[1]).toBe('invalid-entry');
        expect((result.eventData as any).originalFiles[2].bucket).toBe('quantified-self-io');
        expect((result.eventData as any).originalFiles[3].bucket).toBe('quantified-self-io');
        expect((result.eventData as any).originalFiles[4].bucket).toBe('legacy-bucket');
    });

    it('applyAutoHealedSourceBucketMetadata should return input unchanged when nothing can be healed', () => {
        const originalEventDoc = {
            originalFile: { path: 'source.fit', bucket: 'quantified-self-io' },
            originalFiles: [{ path: 'source.fit', bucket: 'quantified-self-io' }],
        } as any;

        const result = applyAutoHealedSourceBucketMetadata(originalEventDoc, [
            {
                path: 'source.fit',
                metadataBucket: 'quantified-self-io',
                resolvedBucket: 'quantified-self-io',
                usedFallbackBucket: false,
            } as any,
        ]);

        expect(result.healedEntries).toBe(0);
        expect(result.eventData).toBe(originalEventDoc);
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
                const where = vi.fn().mockReturnValue({
                    get: vi.fn().mockResolvedValue({
                        docs: [
                            { id: 'a-no-date', data: () => ({}) },
                            { id: 'a-late', data: () => ({ startDate: new Date('2020-01-02T00:00:00Z') }) },
                            { id: 'a-early', data: () => ({ startDate: new Date('2020-01-01T00:00:00Z') }) },
                        ],
                    }),
                });
                return {
                    where,
                };
            }
            return makeCollectionQuery([]);
        });

        const result = await getEventAndActivitiesForReparse('u1', 'e1');
        expect(result.eventRef.path).toBe('users/u1/events/e1');
        expect(result.activityDocs.map(doc => doc.id)).toEqual(['a-early', 'a-late', 'a-no-date']);
    });

    it('getEventAndActivitiesForReparse should sort ties and missing start dates deterministically', async () => {
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
                    where: vi.fn().mockReturnValue({
                        get: vi.fn().mockResolvedValue({
                            docs: [
                                { id: 'z-no', data: () => ({}) },
                                { id: 'b-start', data: () => ({ startDate: new Date('2020-01-01T00:00:00Z') }) },
                                { id: 'a-start', data: () => ({ startDate: new Date('2020-01-01T00:00:00Z') }) },
                                { id: 'a-no', data: () => ({}) },
                            ],
                        }),
                    }),
                };
            }
            return makeCollectionQuery([]);
        });

        const result = await getEventAndActivitiesForReparse('u1', 'e1');
        expect(result.activityDocs.map(doc => doc.id)).toEqual(['a-start', 'b-start', 'a-no', 'z-no']);
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
                rpe: 9,
                feeling: 2,
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
        const parsedActivities = parsedEvent.getActivities();
        expect(parsedActivities[0].setID).toHaveBeenCalledTimes(1);
        expect(parsedActivities[1].setID).toHaveBeenCalledTimes(1);
        expect(hoisted.mockGenerateActivityIDFromSourceKey).toHaveBeenCalledTimes(2);
        const firstSourceKey = hoisted.mockGenerateActivityIDFromSourceKey.mock.calls[0]?.[1] as string;
        const secondSourceKey = hoisted.mockGenerateActivityIDFromSourceKey.mock.calls[1]?.[1] as string;
        expect(firstSourceKey).toMatch(/^[a-f0-9]{64}:/);
        expect(secondSourceKey).toMatch(/^[a-f0-9]{64}:/);
        expect(firstSourceKey).not.toBe(secondSourceKey);
        const persistedEvent = hoisted.mockWriteAllEventData.mock.calls[0]?.[1] as Record<string, unknown>;
        expect(persistedEvent.description).toBe('keep-desc');
        expect(persistedEvent.privacy).toBe('private');
        expect(persistedEvent.notes).toBe('keep-notes');
        expect(persistedEvent.rpe).toBe(9);
        expect(persistedEvent.feeling).toBe(2);
    });

    it('reparseEventFromOriginalFiles should skip creator carryover and warn when matches are ambiguous', async () => {
        const sharedStart = new Date('2026-01-01T10:00:00.000Z');
        const parsedActivityOne = {
            getID: vi.fn(() => 'parsed-1'),
            setID: vi.fn(),
            creator: { name: 'new-creator-1' },
            startDate: sharedStart,
            type: 'Run',
            getStat: vi.fn(() => null),
        };
        const parsedActivityTwo = {
            getID: vi.fn(() => 'parsed-2'),
            setID: vi.fn(),
            creator: { name: 'new-creator-2' },
            startDate: sharedStart,
            type: 'Run',
            getStat: vi.fn(() => null),
        };
        const parsedEvent = makeEvent({
            getActivities: vi.fn(() => [parsedActivityOne, parsedActivityTwo]),
        });
        hoisted.fitImporter.getFromArrayBuffer.mockResolvedValue(parsedEvent);

        const result = await reparseEventFromOriginalFiles('u1', 'e1', {
            eventData: {
                originalFile: { path: 'users/u1/events/e1/original.fit' },
            },
            activityDocs: [
                { id: 'a-old-1', data: () => ({ creator: { name: 'old-1' }, startDate: sharedStart, type: 'Run' }) } as any,
                { id: 'a-old-2', data: () => ({ creator: { name: 'old-2' }, startDate: sharedStart, type: 'Run' }) } as any,
            ],
            targetSportsLibVersion: TARGET_SPORTS_LIB_VERSION,
        });

        expect(result.status).toBe('completed');
        expect(parsedActivityOne.creator.name).toBe('new-creator-1');
        expect(parsedActivityTwo.creator.name).toBe('new-creator-2');
        expect(parsedActivityOne.setID).toHaveBeenCalledTimes(1);
        expect(parsedActivityTwo.setID).toHaveBeenCalledTimes(1);
        expect(hoisted.mockGenerateActivityIDFromSourceKey).toHaveBeenCalledTimes(2);
        expect(hoisted.mockLoggerWarn).toHaveBeenCalledWith(
            '[sports-lib-reparse] Activity edit carryover skipped for unmatched identities',
            expect.objectContaining({
                eventID: 'e1',
                assignedCount: 0,
                unmatchedParsed: expect.any(Array),
                unmatchedExisting: expect.any(Array),
            }),
        );
    });

    it('reparseEventFromOriginalFiles should fail fast when duplicate fingerprints remain ambiguous', async () => {
        const sharedStart = new Date('2026-01-01T10:00:00.000Z');
        const sharedEnd = new Date('2026-01-01T10:30:00.000Z');
        const buildDuplicateActivity = () => ({
            getID: vi.fn(() => null),
            setID: vi.fn(),
            creator: { name: 'same-device' },
            startDate: sharedStart,
            endDate: sharedEnd,
            type: 'Run',
            getStat: vi.fn((statType: string) => {
                if (statType === 'duration') {
                    return { getValue: () => 1800 };
                }
                if (statType === 'distance') {
                    return { getValue: () => 5000 };
                }
                return null;
            }),
        });

        const parsedEvent = makeEvent({
            getActivities: vi.fn(() => [buildDuplicateActivity(), buildDuplicateActivity()]),
        });
        hoisted.fitImporter.getFromArrayBuffer.mockResolvedValue(parsedEvent);

        await expect(
            reparseEventFromOriginalFiles('u1', 'e1', {
                eventData: {
                    originalFile: { path: 'users/u1/events/e1/original.fit' },
                },
                activityDocs: [
                    {
                        id: 'old-a',
                        data: () => ({
                            sourceActivityKey: `${'a'.repeat(64)}:legacy-signature:0`,
                            creator: { name: 'same-device' },
                            startDate: sharedStart,
                            endDate: sharedEnd,
                            type: 'Run',
                            stats: {
                                duration: { _value: 1800 },
                                distance: { _value: 5000 },
                            },
                        }),
                    } as any,
                    {
                        id: 'old-b',
                        data: () => ({
                            sourceActivityKey: `${'b'.repeat(64)}:legacy-signature:1`,
                            creator: { name: 'same-device' },
                            startDate: sharedStart,
                            endDate: sharedEnd,
                            type: 'Run',
                            stats: {
                                duration: { _value: 1800 },
                                distance: { _value: 5000 },
                            },
                        }),
                    } as any,
                ],
                targetSportsLibVersion: TARGET_SPORTS_LIB_VERSION,
            }),
        ).rejects.toThrow('Ambiguous sourceActivityKey stamping');
    });

    it('reparseEventFromOriginalFiles should run activity-level sports-lib regeneration in regenerate mode', async () => {
        const preservedStat = { getType: () => 'preserved' };
        const generatedStat = { getType: () => 'generated' };
        let activityStats = new Map<string, unknown>([['preserved', preservedStat]]);
        const parsedActivity: any = {
            getID: vi.fn(() => 'a1'),
            setID: vi.fn(),
            creator: { name: 'A' },
            getStats: vi.fn(() => activityStats),
            clearStats: vi.fn(() => {
                activityStats = new Map<string, unknown>();
            }),
            getStat: vi.fn((type: string) => activityStats.get(type)),
            addStat: vi.fn((stat: { getType?: () => string; type?: string }) => {
                const type = typeof stat?.getType === 'function' ? stat.getType() : stat?.type;
                if (type) {
                    activityStats.set(type, stat);
                }
            }),
        };
        const parsedEvent = makeEvent({
            getActivities: vi.fn(() => [parsedActivity]),
        });
        hoisted.fitImporter.getFromArrayBuffer.mockResolvedValue(parsedEvent);
        hoisted.generateMissingStreamsAndStatsForActivity.mockImplementationOnce((activity: any) => {
            activity.addStat(generatedStat);
        });

        const result = await reparseEventFromOriginalFiles('u1', 'e1', {
            mode: 'regenerate',
            eventData: {
                originalFile: { path: 'users/u1/events/e1/original.fit' },
            },
            activityDocs: [
                { id: 'a-old-1', data: () => ({ creator: { name: 'creator-1' } }) } as any,
            ],
            targetSportsLibVersion: TARGET_SPORTS_LIB_VERSION,
        });

        expect(result.status).toBe('completed');
        expect(parsedActivity.clearStats).toHaveBeenCalledTimes(1);
        expect(hoisted.generateMissingStreamsAndStatsForActivity).toHaveBeenCalledTimes(1);
        expect(parsedActivity.getStat).toHaveBeenCalledWith('preserved');
        expect(activityStats.get('preserved')).toBe(preservedStat);
        expect(activityStats.get('generated')).toBe(generatedStat);
    });

    it('reparseEventFromOriginalFiles should skip activity-level regeneration in reimport mode', async () => {
        const parsedEvent = makeEvent();
        hoisted.fitImporter.getFromArrayBuffer.mockResolvedValue(parsedEvent);

        const result = await reparseEventFromOriginalFiles('u1', 'e1', {
            mode: 'reimport',
            eventData: {
                originalFile: { path: 'users/u1/events/e1/original.fit' },
            },
            activityDocs: [],
            targetSportsLibVersion: TARGET_SPORTS_LIB_VERSION,
        });

        expect(result.status).toBe('completed');
        expect(hoisted.generateMissingStreamsAndStatsForActivity).not.toHaveBeenCalled();
    });

    it('reparseEventFromOriginalFiles should preserve isMerge=false for multi-file events', async () => {
        const mergedEvent = makeEvent({ isMerge: true });
        hoisted.mergeEvents.mockReturnValueOnce(mergedEvent);
        hoisted.fitImporter.getFromArrayBuffer
            .mockResolvedValueOnce(makeEvent({ isMerge: false }))
            .mockResolvedValueOnce(makeEvent({ isMerge: false }));

        const result = await reparseEventFromOriginalFiles('u1', 'e1', {
            eventData: {
                isMerge: false,
                originalFiles: [
                    { path: 'users/u1/events/e1/first.fit' },
                    { path: 'users/u1/events/e1/second.fit' },
                ],
            },
            activityDocs: [],
            targetSportsLibVersion: TARGET_SPORTS_LIB_VERSION,
        });

        expect(result.status).toBe('completed');
        expect(hoisted.mergeEvents).toHaveBeenCalledTimes(1);
        const persistedEvent = hoisted.mockWriteAllEventData.mock.calls[0]?.[1] as Record<string, unknown>;
        expect(persistedEvent.isMerge).toBe(false);
    });

    it('reparseEventFromOriginalFiles should auto-heal source bucket metadata after fallback read', async () => {
        const parsedEvent = makeEvent();
        hoisted.fitImporter.getFromArrayBuffer.mockResolvedValue(parsedEvent);
        hoisted.mockBucket.mockImplementation((bucketName?: string) => ({
            name: bucketName || SPORTS_LIB_PRIMARY_BUCKET,
            file: vi.fn(() => ({
                download: vi.fn(async () => {
                    if (bucketName === SPORTS_LIB_LEGACY_APPSPOT_BUCKET) {
                        throw new Error(`No such object: ${SPORTS_LIB_LEGACY_APPSPOT_BUCKET}/users/u1/events/e1/original.fit`);
                    }
                    return [Buffer.from('fit-data')];
                }),
            })),
        }));

        const result = await reparseEventFromOriginalFiles('u1', 'e1', {
            eventData: {
                originalFile: {
                    path: 'users/u1/events/e1/original.fit',
                    bucket: SPORTS_LIB_LEGACY_APPSPOT_BUCKET,
                },
                originalFiles: [
                    null as any,
                    {
                        path: 'users/u1/events/e1/unrelated.fit',
                        bucket: SPORTS_LIB_PRIMARY_BUCKET,
                    },
                    {
                        path: 'users/u1/events/e1/original.fit',
                        bucket: SPORTS_LIB_LEGACY_APPSPOT_BUCKET,
                    },
                ],
            },
            activityDocs: [],
            targetSportsLibVersion: TARGET_SPORTS_LIB_VERSION,
        });

        expect(result.status).toBe('completed');
        const persistedEvent = hoisted.mockWriteAllEventData.mock.calls[0]?.[1] as Record<string, any>;
        expect(persistedEvent.originalFile.bucket).toBe(SPORTS_LIB_PRIMARY_BUCKET);
        expect(persistedEvent.originalFiles[0]).toBeNull();
        expect(persistedEvent.originalFiles[1].bucket).toBe(SPORTS_LIB_PRIMARY_BUCKET);
        expect(persistedEvent.originalFiles[2].bucket).toBe(SPORTS_LIB_PRIMARY_BUCKET);
    });

    it('reparseEventFromOriginalFiles should not rewrite bucket metadata when resolved bucket already matches', async () => {
        const parsedEvent = makeEvent();
        hoisted.fitImporter.getFromArrayBuffer.mockResolvedValue(parsedEvent);
        hoisted.mockBucket.mockImplementation((bucketName?: string) => ({
            name: bucketName || SPORTS_LIB_PRIMARY_BUCKET,
            file: vi.fn(() => ({
                download: vi.fn(async () => [Buffer.from('fit-data')]),
            })),
        }));

        const result = await reparseEventFromOriginalFiles('u1', 'e1', {
            eventData: {
                originalFile: {
                    path: 'users/u1/events/e1/original.fit',
                    bucket: SPORTS_LIB_PRIMARY_BUCKET,
                },
                originalFiles: [{
                    path: 'users/u1/events/e1/original.fit',
                    bucket: SPORTS_LIB_PRIMARY_BUCKET,
                }],
            },
            activityDocs: [],
            targetSportsLibVersion: TARGET_SPORTS_LIB_VERSION,
        });

        expect(result.status).toBe('completed');
        const persistedEvent = hoisted.mockWriteAllEventData.mock.calls[0]?.[1] as Record<string, any>;
        expect(persistedEvent.originalFile.bucket).toBe(SPORTS_LIB_PRIMARY_BUCKET);
        expect(persistedEvent.originalFiles[0].bucket).toBe(SPORTS_LIB_PRIMARY_BUCKET);
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
                    where: vi.fn().mockReturnValue({
                        get: vi.fn().mockResolvedValue({
                            docs: [
                                { id: 'a-old-2', data: () => ({ creator: { name: 'creator-2' }, startDate: new Date('2020-01-02T00:00:00Z') }) },
                                { id: 'a-old-1', data: () => ({ creator: { name: 'creator-1' }, startDate: new Date('2020-01-01T00:00:00Z') }) },
                            ],
                        }),
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
