import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    Firestore,
    collection,
    collectionData,
    deleteDoc,
    doc,
    getCountFromServer,
    limit,
    orderBy,
    query,
    updateDoc,
} from 'app/firebase/firestore';
import { ROUTE_NAME_MAX_LENGTH } from '../helpers/route-name.helper';
import { AppRouteService } from './app.route.service';
import { AppOriginalFileHydrationService } from './app.original-file-hydration.service';

vi.mock('app/firebase/firestore', async (importOriginal) => {
    const actual = await importOriginal<typeof import('app/firebase/firestore')>();
    return {
        ...actual,
        collection: vi.fn((_firestore: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
        collectionData: vi.fn(),
        deleteDoc: vi.fn(),
        doc: vi.fn((_firestore: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
        getCountFromServer: vi.fn(),
        limit: vi.fn((value: number) => ({ type: 'limit', value })),
        orderBy: vi.fn((field: string, direction: string) => ({ type: 'orderBy', field, direction })),
        query: vi.fn((collectionRef: unknown, ...constraints: unknown[]) => ({ collectionRef, constraints })),
        updateDoc: vi.fn(),
    };
});

describe('AppRouteService', () => {
    let service: AppRouteService;
    const firestoreMock = {} as Firestore;
    let originalFileHydrationServiceMock: Pick<AppOriginalFileHydrationService, 'downloadFile'>;

    beforeEach(() => {
        vi.clearAllMocks();
        originalFileHydrationServiceMock = {
            downloadFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
        };
        TestBed.configureTestingModule({
            providers: [
                AppRouteService,
                { provide: Firestore, useValue: firestoreMock },
                { provide: AppOriginalFileHydrationService, useValue: originalFileHydrationServiceMock },
            ],
        });
        service = TestBed.inject(AppRouteService);
    });

    it('lists routes from the user scoped routes collection ordered by import time', async () => {
        vi.mocked(collectionData).mockReturnValue(of([{ id: 'route-1', name: 'Route 1' }]));

        const result = await firstValueFrom(service.getRoutes({ uid: 'user-1' }, 25));

        expect(collection).toHaveBeenCalledWith(firestoreMock, 'users', 'user-1', 'routes');
        expect(orderBy).toHaveBeenCalledWith('importedAt', 'desc');
        expect(limit).toHaveBeenCalledWith(25);
        expect(query).toHaveBeenCalledWith(
            { path: 'users/user-1/routes' },
            { type: 'orderBy', field: 'importedAt', direction: 'desc' },
            { type: 'limit', value: 25 },
        );
        expect(collectionData).toHaveBeenCalledWith(
            {
                collectionRef: { path: 'users/user-1/routes' },
                constraints: [
                    { type: 'orderBy', field: 'importedAt', direction: 'desc' },
                    { type: 'limit', value: 25 },
                ],
            },
            { idField: 'id' },
        );
        expect(result).toEqual([{ id: 'route-1', name: 'Route 1' }]);
    });

    it('counts routes from the user scoped routes collection', async () => {
        vi.mocked(getCountFromServer).mockResolvedValue({ data: () => ({ count: 7 }) } as any);

        await expect(service.getRouteCount({ uid: 'user-1' })).resolves.toBe(7);

        expect(collection).toHaveBeenCalledWith(firestoreMock, 'users', 'user-1', 'routes');
        expect(getCountFromServer).toHaveBeenCalledWith({ path: 'users/user-1/routes' });
    });

    it('strips server-owned route fields from frontend updates', async () => {
        vi.mocked(updateDoc).mockResolvedValue(undefined);

        await service.updateRouteProperties({ uid: 'user-1' }, 'route-1', {
            name: 'Renamed Route',
            creator: { name: 'Injected Device' },
            pointCount: 0,
            originalFiles: [{ path: 'users/other/routes/route-1/original.gpx', startDate: new Date() }],
            routes: [],
            notes: 'Owner note',
        } as any);

        expect(doc).toHaveBeenCalledWith(firestoreMock, 'users', 'user-1', 'routes', 'route-1');
        expect(updateDoc).toHaveBeenCalledWith(
            { path: 'users/user-1/routes/route-1' },
            {
                name: 'Renamed Route',
                notes: 'Owner note',
            },
        );
    });

    it('does not call updateDoc when only server-owned route fields are passed', async () => {
        await service.updateRouteProperties({ uid: 'user-1' }, 'route-1', {
            pointCount: 0,
            routes: [],
            originalFile: { path: 'users/user-1/routes/route-1/original.gpx', startDate: new Date() },
        } as any);

        expect(updateDoc).not.toHaveBeenCalled();
    });

    it('normalizes route names through the dedicated route name update path', async () => {
        vi.mocked(updateDoc).mockResolvedValue(undefined);

        await service.updateRouteName({ uid: 'user-1' }, 'route-1', '  Renamed   Route  ');

        expect(doc).toHaveBeenCalledWith(firestoreMock, 'users', 'user-1', 'routes', 'route-1');
        expect(updateDoc).toHaveBeenCalledWith(
            { path: 'users/user-1/routes/route-1' },
            { name: 'Renamed Route' },
        );
    });

    it('rejects blank or oversized route names before writing', async () => {
        await expect(service.updateRouteName({ uid: 'user-1' }, 'route-1', '   '))
            .rejects.toThrow('Route name is required.');
        await expect(service.updateRouteName({ uid: 'user-1' }, 'route-1', 'x'.repeat(ROUTE_NAME_MAX_LENGTH + 1)))
            .rejects.toThrow(`Route name must be ${ROUTE_NAME_MAX_LENGTH} characters or fewer.`);

        expect(updateDoc).not.toHaveBeenCalled();
    });

    it('deletes route documents from the user scoped route collection', async () => {
        vi.mocked(deleteDoc).mockResolvedValue(undefined);

        await service.deleteRoute({ uid: 'user-1' }, 'route-1');

        expect(doc).toHaveBeenCalledWith(firestoreMock, 'users', 'user-1', 'routes', 'route-1');
        expect(deleteDoc).toHaveBeenCalledWith({ path: 'users/user-1/routes/route-1' });
    });

    it('returns canonical original route files with legacy fallback', () => {
        const canonical = service.getOriginalRouteFiles({
            userID: 'user-1',
            name: 'Route',
            srcFileType: 'fit',
            createdAt: null,
            routes: [],
            routeCount: 0,
            waypointCount: 0,
            pointCount: 0,
            activityTypes: [],
            streamTypes: [],
            originalFiles: [
                { path: 'users/user-1/routes/route-1/original.fit', startDate: new Date(), extension: 'fit' },
            ],
        });

        expect(canonical).toHaveLength(1);
        expect(canonical[0].path).toBe('users/user-1/routes/route-1/original.fit');

        const legacy = service.getOriginalRouteFiles({
            userID: 'user-1',
            name: 'Route',
            srcFileType: 'gpx',
            createdAt: null,
            routes: [],
            routeCount: 0,
            waypointCount: 0,
            pointCount: 0,
            activityTypes: [],
            streamTypes: [],
            originalFile: { path: 'users/user-1/routes/route-1/original.gpx', startDate: new Date(), extension: 'gpx' },
        });

        expect(legacy).toHaveLength(1);
        expect(legacy[0].path).toBe('users/user-1/routes/route-1/original.gpx');
    });

    it('downloads original route files through the shared original-file hydration service', async () => {
        const result = await service.downloadFile('users/user-1/routes/route-1/original.gpx', { metadataCacheTtlMs: 0 });

        expect(originalFileHydrationServiceMock.downloadFile).toHaveBeenCalledWith(
            'users/user-1/routes/route-1/original.gpx',
            { metadataCacheTtlMs: 0 },
        );
        expect(result.byteLength).toBe(3);
    });
});
