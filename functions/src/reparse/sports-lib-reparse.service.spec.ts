import { describe, it, expect, vi, beforeEach } from 'vitest';
import { gzipSync } from 'node:zlib';

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
});
