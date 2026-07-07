import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, Subject } from 'rxjs';
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
    where,
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
        where: vi.fn((field: string, op: string, value: unknown) => ({ type: 'where', field, op, value })),
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

    it('keeps nullable metric sorts on the default server query', async () => {
        vi.mocked(collectionData).mockReturnValue(of([{ id: 'route-1', name: 'Route 1' }]));

        await firstValueFrom(service.getRoutes({ uid: 'user-1' }, 25, { active: 'distance', direction: 'asc' }));

        expect(orderBy).toHaveBeenCalledWith('importedAt', 'desc');
        expect(orderBy).toHaveBeenCalledTimes(1);
        expect(query).toHaveBeenCalledWith(
            { path: 'users/user-1/routes' },
            { type: 'orderBy', field: 'importedAt', direction: 'desc' },
            { type: 'limit', value: 25 },
        );
        expect(collectionData).toHaveBeenCalledTimes(1);
    });

    it('keeps nullable grade metric sorts on the default server query', async () => {
        vi.mocked(collectionData).mockReturnValue(of([{ id: 'route-1', name: 'Route 1' }]));

        await firstValueFrom(service.getRoutes({ uid: 'user-1' }, 25, { active: 'minGrade', direction: 'desc' }));

        expect(orderBy).toHaveBeenCalledWith('importedAt', 'desc');
    });

    it('lists routes ordered by guaranteed point count', async () => {
        vi.mocked(collectionData).mockReturnValue(of([{ id: 'route-1', name: 'Route 1' }]));

        await firstValueFrom(service.getRoutes({ uid: 'user-1' }, 25, { active: 'pointCount', direction: 'asc' }));

        expect(orderBy).toHaveBeenCalledWith('pointCount', 'asc');
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
            stats: { Distance: 999 },
            preview: { version: 1, encoding: 'polyline5', precision: 5, sourcePointCount: 2, pointCount: 2, segments: [] },
            previewReady: true,
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

    it('watches route preview eligibility with a bounded preview query', async () => {
        vi.mocked(collectionData).mockReturnValue(of([routeWithPreview('route-1')]));

        const result = await firstValueFrom(service.watchHasAnyRoutePreview('user-1'));

        expect(collection).toHaveBeenCalledWith(firestoreMock, 'users', 'user-1', 'routes');
        expect(where).toHaveBeenCalledWith('previewReady', '==', true);
        expect(orderBy).toHaveBeenCalledWith('importedAt', 'desc');
        expect(limit).toHaveBeenCalledWith(1);
        expect(query).toHaveBeenCalledWith(
            { path: 'users/user-1/routes' },
            { type: 'where', field: 'previewReady', op: '==', value: true },
            { type: 'orderBy', field: 'importedAt', direction: 'desc' },
            { type: 'limit', value: 1 },
        );
        expect(result).toBe(true);
    });

    it('fails route preview eligibility closed without a user id', async () => {
        await expect(firstValueFrom(service.watchHasAnyRoutePreview(''))).resolves.toBe(false);
        await expect(firstValueFrom(service.watchHasAnyRoutePreview('   '))).resolves.toBe(false);

        expect(collectionData).not.toHaveBeenCalled();
    });

    it('trims route preview watcher user ids before querying', async () => {
        vi.mocked(collectionData).mockReturnValue(of([routeWithPreview('route-1')]));

        await firstValueFrom(service.watchHasAnyRoutePreview('  user-1  '));

        expect(collection).toHaveBeenCalledWith(firestoreMock, 'users', 'user-1', 'routes');
    });

    it('loads recent route candidates and keeps only the requested preview-ready documents', async () => {
        vi.mocked(collectionData).mockReturnValue(of([
            routeWithPreview('route-1'),
            routeWithoutPreview('route-2'),
            {
                ...routeWithPreview('route-3'),
                preview: {
                    version: 1,
                    encoding: 'polyline5',
                    precision: 5,
                    sourcePointCount: 2,
                    pointCount: 0,
                    segments: [],
                },
            },
            routeWithPreview('route-4'),
            routeWithPreview('route-5'),
        ]));

        const result = await firstValueFrom(service.watchRecentRoutePreviews({ uid: 'user-1' }, 2));

        expect(orderBy).toHaveBeenCalledWith('importedAt', 'desc');
        expect(limit).toHaveBeenCalledWith(8);
        expect(result.map(route => route.id)).toEqual(['route-1', 'route-4']);
    });

    it('suppresses unchanged recent route preview emissions', () => {
        const source = new Subject<any[]>();
        const emissions: any[][] = [];
        vi.mocked(collectionData).mockReturnValue(source.asObservable());

        const subscription = service.watchRecentRoutePreviews({ uid: 'user-1' }, 2)
            .subscribe(routes => emissions.push(routes));

        source.next([routeWithPreview('route-1'), routeWithoutPreview('route-2')]);
        source.next([routeWithPreview('route-1'), routeWithoutPreview('route-2')]);
        source.next([routeWithPreview('route-1', new Date('2026-02-01T00:00:00.000Z')), routeWithoutPreview('route-2')]);
        subscription.unsubscribe();

        expect(emissions.map(routes => routes.map(route => route.id))).toEqual([
            ['route-1'],
            ['route-1'],
        ]);
    });

    it('fails recent route preview loading closed without a trimmed user id', async () => {
        await expect(firstValueFrom(service.watchRecentRoutePreviews({ uid: '   ' }, 2))).resolves.toEqual([]);

        expect(collectionData).not.toHaveBeenCalled();
    });

    it('trims recent route preview user ids before querying candidates', async () => {
        vi.mocked(collectionData).mockReturnValue(of([routeWithPreview('route-1')]));

        await firstValueFrom(service.watchRecentRoutePreviews({ uid: '  user-1  ' }, 2));

        expect(collection).toHaveBeenCalledWith(firestoreMock, 'users', 'user-1', 'routes');
        expect(collection).not.toHaveBeenCalledWith(firestoreMock, 'users', '  user-1  ', 'routes');
    });

    it('falls back to preview-ready route documents when the recent candidate window is sparse', async () => {
        const recentCandidates = Array.from({ length: 12 }, (_value, index) => routeWithoutPreview(`route-${index}`));
        recentCandidates[0] = routeWithPreview('recent-preview', new Date('2026-01-01T00:00:00.000Z'));
        vi.mocked(collectionData)
            .mockReturnValueOnce(of(recentCandidates))
            .mockReturnValueOnce(of([
                routeWithPreview('older-preview', new Date('2024-01-01T00:00:00.000Z')),
                routeWithPreview('newer-preview', new Date('2025-01-01T00:00:00.000Z')),
                routeWithPreview('recent-preview', new Date('2026-01-01T00:00:00.000Z')),
            ]));

        const result = await firstValueFrom(service.watchRecentRoutePreviews({ uid: 'user-1' }, 3));

        expect(limit).toHaveBeenCalledWith(12);
        expect(where).toHaveBeenCalledWith('previewReady', '==', true);
        expect(query).toHaveBeenLastCalledWith(
            { path: 'users/user-1/routes' },
            { type: 'where', field: 'previewReady', op: '==', value: true },
            { type: 'orderBy', field: 'importedAt', direction: 'desc' },
            { type: 'limit', value: 3 },
        );
        expect(limit).toHaveBeenCalledWith(3);
        expect(result.map(route => route.id)).toEqual(['recent-preview', 'newer-preview', 'older-preview']);
    });

    it('keeps recent preview candidates when the preview-ready fallback query fails', async () => {
        const recentCandidates = Array.from({ length: 8 }, (_value, index) => routeWithoutPreview(`route-${index}`));
        recentCandidates[0] = routeWithPreview('recent-preview', new Date('2026-01-01T00:00:00.000Z'));
        vi.mocked(collectionData)
            .mockReturnValueOnce(of(recentCandidates))
            .mockImplementationOnce(() => {
                throw new Error('preview query failed');
            });

        const result = await firstValueFrom(service.watchRecentRoutePreviews({ uid: 'user-1' }, 2));

        expect(result.map(route => route.id)).toEqual(['recent-preview']);
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

    it('filters route source metadata down to non-empty paths', () => {
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
                { path: '   ', startDate: new Date(), extension: 'fit' },
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
            originalFile: { path: '   ', startDate: new Date(), extension: 'gpx' },
        });

        expect(legacy).toEqual([]);
    });

    it('downloads original route files through the shared original-file hydration service', async () => {
        const result = await service.downloadFile('users/user-1/routes/route-1/original.gpx', { metadataCacheTtlMs: 0 });

        expect(originalFileHydrationServiceMock.downloadFile).toHaveBeenCalledWith(
            'users/user-1/routes/route-1/original.gpx',
            { metadataCacheTtlMs: 0 },
        );
        expect(result.byteLength).toBe(3);
    });

    it('downloads raw original route files without decompression', async () => {
        const result = await service.downloadOriginalFile('users/user-1/routes/route-1/original.fit.gz', { metadataCacheTtlMs: 0 });

        expect(originalFileHydrationServiceMock.downloadFile).toHaveBeenCalledWith(
            'users/user-1/routes/route-1/original.fit.gz',
            { metadataCacheTtlMs: 0, decompress: false },
        );
        expect(result.byteLength).toBe(3);
    });
});

function routeWithPreview(id: string, importedAt?: Date): any {
    return {
        id,
        userID: 'user-1',
        name: 'Route',
        srcFileType: 'gpx',
        createdAt: null,
        routes: [],
        routeCount: 1,
        waypointCount: 0,
        pointCount: 2,
        importedAt,
        activityTypes: [],
        streamTypes: [],
        previewReady: true,
        preview: {
            version: 1,
            encoding: 'polyline5',
            precision: 5,
            sourcePointCount: 2,
            pointCount: 2,
            segments: [{
                sourcePointCount: 2,
                pointCount: 2,
                encodedPolyline: 'abc',
            }],
        },
    };
}

function routeWithoutPreview(id: string): any {
    return {
        id,
        userID: 'user-1',
        name: 'Route',
        srcFileType: 'gpx',
        createdAt: null,
        routes: [],
        routeCount: 1,
        waypointCount: 0,
        pointCount: 2,
        activityTypes: [],
        streamTypes: [],
    };
}
