import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRouteInterface, OriginalRouteFileMetaData, RouteJSONInterface } from '../../../shared/app-route.interface';
import { FirestoreAdapter, LogAdapter, StorageAdapter } from './event-writer';
import { buildFirestoreRoutePayload, RouteWriter } from './route-writer';

function makeLogger(): LogAdapter {
    return {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    };
}

function makeRouteFile(overrides: {
    id?: string | null;
    routes?: RouteJSONInterface[];
    waypoints?: unknown[];
    originalFiles?: OriginalRouteFileMetaData[];
    originalFile?: OriginalRouteFileMetaData;
} = {}): AppRouteInterface {
    let id = Object.prototype.hasOwnProperty.call(overrides, 'id') ? overrides.id : 'route-file-1';
    const routes = overrides.routes ?? [{
        id: 'segment-1',
        name: 'Hills',
        activityType: 'Running',
        stats: { Distance: 2500 },
        streams: [
            { type: 'LatitudeDegrees', data: [60.1, 60.2] },
            { type: 'LongitudeDegrees', data: [24.9, 25] },
            { type: 'Grade', data: [1, 2] },
        ],
        points: [
            { latitudeDegrees: 60.1, longitudeDegrees: 24.9, altitude: 12 },
            { latitudeDegrees: 60.2, longitudeDegrees: 25, altitude: 21 },
        ],
    }];

    return {
        name: 'Morning Route',
        srcFileType: 'gpx',
        createdAt: new Date('2026-01-02T03:04:05.000Z'),
        creator: { name: 'Test Device' },
        getID: () => id,
        setID: (newID: string) => {
            id = newID;
        },
        getRoutes: () => routes.map(route => ({
            getID: () => route.id,
            setID: (newID: string) => {
                route.id = newID;
            },
            toJSON: () => route,
        })),
        hasRoutes: () => routes.length > 0,
        getWaypoints: () => overrides.waypoints ?? [],
        toJSON: () => ({
            id: id || undefined,
            name: 'Morning Route',
            srcFileType: 'gpx',
            createdAt: new Date('2026-01-02T03:04:05.000Z').getTime(),
            creator: { name: 'Test Device' },
            routes,
            waypoints: overrides.waypoints ?? [],
        }),
        originalFiles: overrides.originalFiles,
        originalFile: overrides.originalFile,
    };
}

describe('RouteWriter', () => {
    let setDoc: ReturnType<typeof vi.fn>;
    let uploadFile: ReturnType<typeof vi.fn>;
    let adapter: FirestoreAdapter;
    let storageAdapter: StorageAdapter;

    beforeEach(() => {
        setDoc = vi.fn().mockResolvedValue(undefined);
        uploadFile = vi.fn().mockResolvedValue(undefined);
        adapter = {
            setDoc,
            createBlob: vi.fn(data => data),
            generateID: vi.fn(() => 'generated-route-id'),
        };
        storageAdapter = {
            uploadFile,
            getBucketName: () => 'test-bucket',
        };
    });

    it('builds a summary-only Firestore payload without route points or streams', () => {
        const payload = buildFirestoreRoutePayload('user-1', makeRouteFile());

        expect(payload).toMatchObject({
            id: 'route-file-1',
            userID: 'user-1',
            name: 'Morning Route',
            srcFileType: 'gpx',
            routeCount: 1,
            waypointCount: 0,
            pointCount: 2,
            activityTypes: ['Running'],
            streamTypes: ['Grade', 'LatitudeDegrees', 'LongitudeDegrees'],
            bounds: {
                minLatitudeDegrees: 60.1,
                maxLatitudeDegrees: 60.2,
                minLongitudeDegrees: 24.9,
                maxLongitudeDegrees: 25,
            },
        });
        expect(payload.routes[0]).toMatchObject({
            id: 'segment-1',
            name: 'Hills',
            pointCount: 2,
            streamTypes: ['Grade', 'LatitudeDegrees', 'LongitudeDegrees'],
            startPoint: { latitudeDegrees: 60.1, longitudeDegrees: 24.9, altitude: 12 },
            endPoint: { latitudeDegrees: 60.2, longitudeDegrees: 25, altitude: 21 },
        });
        expect(payload.routes[0]).not.toHaveProperty('points');
        expect(payload.routes[0]).not.toHaveProperty('streams');
    });

    it('writes the route document and uploads the original route file', async () => {
        const writer = new RouteWriter(adapter, storageAdapter, undefined, makeLogger());
        const routeFile = makeRouteFile();
        const originalFile = {
            data: Buffer.from('route'),
            extension: 'gpx',
            startDate: new Date('2026-01-02T03:04:05.000Z'),
            originalFilename: 'morning.gpx',
        };

        const persistedFiles = await writer.writeAllRouteData('user-1', routeFile, originalFile);

        expect(uploadFile).toHaveBeenCalledWith(
            'users/user-1/routes/route-file-1/uploads/generated-route-id/original.gpx',
            originalFile.data,
        );
        expect(setDoc).toHaveBeenCalledTimes(1);
        expect(setDoc).toHaveBeenCalledWith(
            ['users', 'user-1', 'routes', 'route-file-1'],
            expect.objectContaining({
                originalFile: expect.objectContaining({
                    path: 'users/user-1/routes/route-file-1/uploads/generated-route-id/original.gpx',
                    bucket: 'test-bucket',
                    originalFilename: 'morning.gpx',
                    extension: 'gpx',
                }),
                originalFiles: [
                    expect.objectContaining({
                        path: 'users/user-1/routes/route-file-1/uploads/generated-route-id/original.gpx',
                    }),
                ],
            }),
        );
        expect(persistedFiles).toEqual([
            expect.objectContaining({
                path: 'users/user-1/routes/route-file-1/uploads/generated-route-id/original.gpx',
                bucket: 'test-bucket',
                originalFilename: 'morning.gpx',
                extension: 'gpx',
            }),
        ]);
    });

    it('generates a route ID when missing before writing', async () => {
        const writer = new RouteWriter(adapter, storageAdapter, undefined, makeLogger());
        const routeFile = makeRouteFile({ id: null });

        await writer.writeAllRouteData('user-1', routeFile);

        expect(adapter.generateID).toHaveBeenCalled();
        expect(setDoc).toHaveBeenCalledWith(
            ['users', 'user-1', 'routes', 'generated-route-id'],
            expect.objectContaining({ id: 'generated-route-id' }),
        );
    });

    it('uses indexed original filenames when multiple route source files are stored', async () => {
        const writer = new RouteWriter(adapter, storageAdapter, undefined, makeLogger());

        await writer.writeAllRouteData('user-1', makeRouteFile(), [
            { data: Buffer.from('one'), extension: 'fit', startDate: new Date('2026-01-02T00:00:00.000Z') },
            { data: Buffer.from('two'), extension: 'gpx', startDate: new Date('2026-01-03T00:00:00.000Z') },
        ]);

        expect(uploadFile).toHaveBeenNthCalledWith(
            1,
            'users/user-1/routes/route-file-1/uploads/generated-route-id/original_0.fit',
            expect.any(Buffer),
        );
        expect(uploadFile).toHaveBeenNthCalledWith(
            2,
            'users/user-1/routes/route-file-1/uploads/generated-route-id/original_1.gpx',
            expect.any(Buffer),
        );
        expect(setDoc).toHaveBeenCalledWith(
            ['users', 'user-1', 'routes', 'route-file-1'],
            expect.objectContaining({
                originalFiles: [
                    expect.objectContaining({
                        path: 'users/user-1/routes/route-file-1/uploads/generated-route-id/original_0.fit',
                    }),
                    expect.objectContaining({
                        path: 'users/user-1/routes/route-file-1/uploads/generated-route-id/original_1.gpx',
                    }),
                ],
            }),
        );
    });

    it('preserves existing original metadata when no storage adapter is available', async () => {
        const existingOriginal = {
            path: 'users/user-1/routes/route-file-1/original.fit',
            startDate: new Date('2026-01-02T00:00:00.000Z'),
            extension: 'fit',
        };
        const writer = new RouteWriter(adapter, undefined, undefined, makeLogger());

        await writer.writeAllRouteData('user-1', makeRouteFile({
            originalFiles: [existingOriginal],
            originalFile: existingOriginal,
        }));

        expect(uploadFile).not.toHaveBeenCalled();
        expect(setDoc).toHaveBeenCalledWith(
            ['users', 'user-1', 'routes', 'route-file-1'],
            expect.objectContaining({
                originalFile: existingOriginal,
                originalFiles: [existingOriginal],
            }),
        );
    });
});
