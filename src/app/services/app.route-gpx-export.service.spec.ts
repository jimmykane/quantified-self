import { TestBed } from '@angular/core/testing';
import { RouteExporterGPX, RouteFileInterface } from '@sports-alliance/sports-lib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FirestoreRouteJSON } from '@shared/app-route.interface';
import { AppRouteGPXExportService } from './app.route-gpx-export.service';
import { AppRouteHydrationService } from './app.route-hydration.service';

describe('AppRouteGPXExportService', () => {
  let service: AppRouteGPXExportService;
  let routeHydrationServiceMock: any;
  let routeFileMock: RouteFileInterface;

  const routeDocument: FirestoreRouteJSON = {
    id: 'route-1',
    userID: 'user-1',
    name: 'Export Route',
    srcFileType: 'fit',
    routes: [],
    routeCount: 1,
    waypointCount: 0,
    pointCount: 0,
    activityTypes: [],
    streamTypes: [],
    originalFiles: [{
      path: 'users/user-1/routes/route-1/original.fit',
      extension: 'fit',
    }],
  };

  beforeEach(() => {
    routeFileMock = {
      getRoutes: vi.fn(() => []),
      getWaypoints: vi.fn(() => []),
    } as unknown as RouteFileInterface;
    routeHydrationServiceMock = {
      hydrateRouteFile: vi.fn().mockResolvedValue({
        routeDocument,
        routeFile: routeFileMock,
        sourceFile: routeDocument.originalFiles![0],
      }),
    };
    vi.spyOn(RouteExporterGPX.prototype, 'getAsString').mockResolvedValue('<gpx><rte></rte></gpx>');

    TestBed.configureTestingModule({
      providers: [
        AppRouteGPXExportService,
        { provide: AppRouteHydrationService, useValue: routeHydrationServiceMock },
      ],
    });
    service = TestBed.inject(AppRouteGPXExportService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exports an already hydrated route file as GPX', async () => {
    const blob = await service.getRouteFileAsGPXBlob(routeFileMock);

    expect(RouteExporterGPX.prototype.getAsString).toHaveBeenCalledWith(routeFileMock);
    expect(blob.type).toBe('application/gpx+xml');
    expect(blob.size).toBeGreaterThan(0);
  });

  it('hydrates a saved route document before exporting generated GPX', async () => {
    const result = await service.getRouteDocumentAsGPXBlob(routeDocument, {
      streamTypes: ['Distance'],
      metadataCacheTtlMs: 1000,
    });

    expect(routeHydrationServiceMock.hydrateRouteFile).toHaveBeenCalledWith(routeDocument, {
      streamTypes: ['Distance'],
      metadataCacheTtlMs: 1000,
    });
    expect(RouteExporterGPX.prototype.getAsString).toHaveBeenCalledWith(routeFileMock);
    expect(result.hydratedRoute.routeDocument).toBe(routeDocument);
    expect(result.blob.size).toBeGreaterThan(0);
  });
});
