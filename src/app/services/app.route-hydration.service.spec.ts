import { TestBed } from '@angular/core/testing';
import { RouteFileInterface, RouteImporterFIT, RouteImporterGPX } from '@sports-alliance/sports-lib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FirestoreRouteJSON } from '@shared/app-route.interface';
import { AppFileService } from './app.file.service';
import { AppRouteHydrationService } from './app.route-hydration.service';
import { AppRouteService } from './app.route.service';

describe('AppRouteHydrationService', () => {
  let service: AppRouteHydrationService;
  let routeServiceMock: any;
  let fileServiceMock: any;
  let routeFileMock: RouteFileInterface;
  let parsedRouteMock: any;

  const routeDocument: FirestoreRouteJSON = {
    id: 'route-1',
    userID: 'user-1',
    name: 'Test Route',
    srcFileType: 'gpx',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    routes: [{
      id: 'segment-1',
      name: 'Segment 1',
      activityType: 'Running',
      pointCount: 2,
      streamTypes: [],
      stats: {},
    }],
    routeCount: 1,
    waypointCount: 0,
    pointCount: 2,
    activityTypes: ['Running'],
    streamTypes: [],
    originalFiles: [{
      path: 'users/user-1/routes/route-1/original.gpx',
      extension: 'gpx',
    }],
  };

  beforeEach(() => {
    parsedRouteMock = {
      name: 'Original imported segment',
      getID: vi.fn(() => null),
      setID: vi.fn(),
    };
    routeFileMock = {
      name: 'Original imported route',
      setID: vi.fn(),
      getRoutes: vi.fn(() => [parsedRouteMock]),
    } as unknown as RouteFileInterface;
    routeServiceMock = {
      getOriginalRouteFiles: vi.fn((route: FirestoreRouteJSON) => route.originalFiles || []),
      downloadFile: vi.fn().mockResolvedValue(new TextEncoder().encode('<gpx></gpx>').buffer),
    };
    fileServiceMock = {
      getExtensionFromPath: vi.fn((_path: string, fallback: string) => fallback),
    };

    vi.spyOn(RouteImporterGPX, 'getFromString').mockResolvedValue(routeFileMock);
    vi.spyOn(RouteImporterFIT, 'getFromArrayBuffer').mockResolvedValue(routeFileMock);

    TestBed.configureTestingModule({
      providers: [
        AppRouteHydrationService,
        { provide: AppRouteService, useValue: routeServiceMock },
        { provide: AppFileService, useValue: fileServiceMock },
      ],
    });
    service = TestBed.inject(AppRouteHydrationService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('downloads the original GPX route file through the shared cache path and parses it', async () => {
    const result = await service.hydrateRouteFile(routeDocument, {
      streamTypes: ['Distance'],
      metadataCacheTtlMs: 123,
    });

    expect(routeServiceMock.downloadFile).toHaveBeenCalledWith(
      'users/user-1/routes/route-1/original.gpx',
      { metadataCacheTtlMs: 123 },
    );
    expect(RouteImporterGPX.getFromString).toHaveBeenCalledWith(
      '<gpx></gpx>',
      expect.any(Function),
      expect.objectContaining({
        generateUnitStreams: false,
        gpx: expect.objectContaining({
          importTimedTracksAsRoutes: true,
        }),
        streams: expect.objectContaining({
          includeTypes: ['Distance'],
        }),
      }),
      'Test Route',
    );
    expect(routeFileMock.name).toBe('Test Route');
    expect(parsedRouteMock.name).toBe('Test Route');
    expect(routeFileMock.setID).toHaveBeenCalledWith('route-1');
    expect(parsedRouteMock.setID).toHaveBeenCalledWith('segment-1');
    expect(result.routeFile).toBe(routeFileMock);
    expect(result.sourceFile.path).toBe('users/user-1/routes/route-1/original.gpx');
  });

  it('parses FIT route source files', async () => {
    const fitRouteDocument = {
      ...routeDocument,
      srcFileType: 'fit',
      originalFiles: [{ path: 'users/user-1/routes/route-1/original.fit', extension: 'fit' }],
    };
    const fitBuffer = new Uint8Array([1, 2, 3]).buffer;
    routeServiceMock.downloadFile.mockResolvedValueOnce(fitBuffer);

    await service.hydrateRouteFile(fitRouteDocument);

    expect(RouteImporterFIT.getFromArrayBuffer).toHaveBeenCalledWith(
      fitBuffer,
      expect.objectContaining({
        generateUnitStreams: false,
        gpx: expect.objectContaining({ importTimedTracksAsRoutes: true }),
      }),
      'Test Route',
    );
  });

  it('keeps multi-segment child names while still applying the saved parent route name', async () => {
    const firstRoute = { name: 'Imported segment A', getID: vi.fn(() => null), setID: vi.fn() };
    const secondRoute = { name: 'Imported segment B', getID: vi.fn(() => null), setID: vi.fn() };
    routeFileMock = {
      name: 'Imported parent name',
      setID: vi.fn(),
      getRoutes: vi.fn(() => [firstRoute, secondRoute]),
    } as unknown as RouteFileInterface;
    vi.spyOn(RouteImporterGPX, 'getFromString').mockResolvedValueOnce(routeFileMock);

    await service.hydrateRouteFile({
      ...routeDocument,
      routes: [
        { ...routeDocument.routes![0], id: 'segment-1', name: 'Stored segment 1' },
        { ...routeDocument.routes![0], id: 'segment-2', name: 'Stored segment 2' },
      ],
      routeCount: 2,
      pointCount: 4,
    });

    expect(routeFileMock.name).toBe('Test Route');
    expect(firstRoute.name).toBe('Imported segment A');
    expect(secondRoute.name).toBe('Imported segment B');
  });

  it('throws for route documents without an original source file', async () => {
    await expect(service.hydrateRouteFile({ ...routeDocument, originalFiles: [] })).rejects.toThrow(
      'Saved route is missing its original source file.',
    );
  });

  it('throws for unsupported route file extensions', async () => {
    await expect(service.hydrateRouteFile({
      ...routeDocument,
      srcFileType: 'tcx',
      originalFiles: [{ path: 'users/user-1/routes/route-1/original.tcx', extension: 'tcx' }],
    })).rejects.toThrow('Unsupported route source file type: tcx');
  });
});
