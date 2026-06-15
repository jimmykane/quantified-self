import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { User } from '@sports-alliance/sports-lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FirestoreRouteJSON } from '@shared/app-route.interface';
import { ROUTE_DETAIL_STREAM_TYPES } from '../resolvers/route.resolver';
import {
  AppRouteReprocessService,
  getRouteReprocessErrorMessage,
  getRouteReprocessProgressTitle,
  RouteReprocessError,
  RouteReprocessProgress,
} from './app.route-reprocess.service';
import { AppFunctionsService } from './app.functions.service';
import { AppRouteHydrationService } from './app.route-hydration.service';
import { AppRouteService } from './app.route.service';

describe('AppRouteReprocessService', () => {
  let service: AppRouteReprocessService;
  let routeServiceMock: any;
  let routeHydrationServiceMock: any;
  let functionsServiceMock: any;

  const routeDocument: FirestoreRouteJSON = {
    id: 'route-1',
    userID: 'user-1',
    name: 'Route',
    srcFileType: 'gpx',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    routes: [],
    routeCount: 0,
    waypointCount: 0,
    pointCount: 0,
    activityTypes: [],
    streamTypes: [],
    originalFiles: [{
      path: 'users/user-1/routes/route-1/original.gpx',
      extension: 'gpx',
    }],
  };

  beforeEach(() => {
    const refreshedRouteDocument = {
      ...routeDocument,
      stats: { Distance: 1000 },
      routeCount: 1,
      pointCount: 2,
    };
    routeServiceMock = {
      getOriginalRouteFiles: vi.fn((route: FirestoreRouteJSON) => route.originalFiles || []),
      getRoute: vi.fn().mockReturnValue(of(refreshedRouteDocument)),
    };
    routeHydrationServiceMock = {
      hydrateRouteFile: vi.fn().mockResolvedValue({
        routeDocument: refreshedRouteDocument,
        routeFile: { getRoutes: vi.fn(() => []) },
        sourceFile: refreshedRouteDocument.originalFiles![0],
      }),
    };
    functionsServiceMock = {
      call: vi.fn().mockResolvedValue({
        data: {
          routeId: 'route-1',
          status: 'completed',
          sourceFilesCount: 1,
          routeCount: 1,
          waypointCount: 3,
          pointCount: 42,
        },
      }),
    };

    TestBed.configureTestingModule({
      providers: [
        AppRouteReprocessService,
        { provide: AppRouteService, useValue: routeServiceMock },
        { provide: AppRouteHydrationService, useValue: routeHydrationServiceMock },
        { provide: AppFunctionsService, useValue: functionsServiceMock },
      ],
    });

    service = TestBed.inject(AppRouteReprocessService);
  });

  it('calls the backend callable, refetches the route, and hydrates detail data', async () => {
    const result = await service.reprocessRouteFromOriginalFile(new User('user-1'), routeDocument);

    expect(functionsServiceMock.call).toHaveBeenCalledWith('reprocessRoute', {
      routeId: 'route-1',
    });
    expect(routeServiceMock.getRoute).toHaveBeenCalledWith(expect.objectContaining({ uid: 'user-1' }), 'route-1');
    expect(routeHydrationServiceMock.hydrateRouteFile).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'route-1', routeCount: 1 }),
      { streamTypes: [...ROUTE_DETAIL_STREAM_TYPES] },
    );
    expect(result.sourceFilesCount).toBe(1);
    expect(result.routeCount).toBe(1);
    expect(result.waypointCount).toBe(3);
    expect(result.pointCount).toBe(42);
  });

  it('reprocesses and refetches route documents without hydrating detail data', async () => {
    const result = await service.reprocessRouteDocumentFromOriginalFile(new User('user-1'), routeDocument);

    expect(functionsServiceMock.call).toHaveBeenCalledWith('reprocessRoute', {
      routeId: 'route-1',
    });
    expect(routeServiceMock.getRoute).toHaveBeenCalledWith(expect.objectContaining({ uid: 'user-1' }), 'route-1');
    expect(routeHydrationServiceMock.hydrateRouteFile).not.toHaveBeenCalled();
    expect(result.routeDocument).toMatchObject({ id: 'route-1', routeCount: 1 });
    expect(result.sourceFilesCount).toBe(1);
    expect(result.routeCount).toBe(1);
    expect(result.waypointCount).toBe(3);
    expect(result.pointCount).toBe(42);
  });

  it('throws NO_ORIGINAL_FILES before calling the backend when route metadata is missing', async () => {
    routeServiceMock.getOriginalRouteFiles.mockReturnValueOnce([]);

    await expect(service.reprocessRouteFromOriginalFile(new User('user-1'), {
      ...routeDocument,
      originalFiles: [],
    })).rejects.toMatchObject({
      code: 'NO_ORIGINAL_FILES',
    });
    expect(functionsServiceMock.call).not.toHaveBeenCalled();
  });

  it('maps backend skipped NO_ORIGINAL_FILES to a typed error', async () => {
    functionsServiceMock.call.mockResolvedValueOnce({
      data: {
        routeId: 'route-1',
        status: 'skipped',
        reason: 'NO_ORIGINAL_FILES',
        sourceFilesCount: 0,
        routeCount: 0,
        waypointCount: 0,
        pointCount: 0,
      },
    });

    await expect(service.reprocessRouteFromOriginalFile(new User('user-1'), routeDocument)).rejects.toMatchObject({
      code: 'NO_ORIGINAL_FILES',
    });
  });

  it('maps callable failures and missing route IDs to typed errors', async () => {
    functionsServiceMock.call.mockRejectedValueOnce(new Error('functions/internal'));

    await expect(service.reprocessRouteFromOriginalFile(new User('user-1'), routeDocument)).rejects.toMatchObject({
      code: 'PARSE_FAILED',
    });

    await expect(service.reprocessRouteFromOriginalFile(new User('user-1'), {
      ...routeDocument,
      id: '',
    })).rejects.toMatchObject({
      code: 'PARSE_FAILED',
    });
  });

  it('maps account-deletion callable failures to the account unavailable error', async () => {
    functionsServiceMock.call.mockRejectedValueOnce(Object.assign(
      new Error('Account is being deleted or no longer exists.'),
      { code: 'functions/failed-precondition' },
    ));

    let caughtError: unknown;
    try {
      await service.reprocessRouteFromOriginalFile(new User('user-1'), routeDocument);
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toMatchObject({ code: 'ACCOUNT_DELETING' });
    expect(getRouteReprocessErrorMessage(caughtError)).toBe(
      'Account deletion is in progress. Route reprocess is unavailable.',
    );
  });

  it('maps deletion guard read failures to the route service unavailable error', async () => {
    functionsServiceMock.call.mockRejectedValueOnce(Object.assign(
      new Error('Could not verify account state. Please retry.'),
      { code: 'functions/unavailable' },
    ));

    let caughtError: unknown;
    try {
      await service.reprocessRouteFromOriginalFile(new User('user-1'), routeDocument);
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect(getRouteReprocessErrorMessage(caughtError)).toBe(
      'Route reprocess service is temporarily unavailable. Please try again shortly.',
    );
  });

  it('throws PERSIST_FAILED when the refreshed route cannot be loaded', async () => {
    routeServiceMock.getRoute.mockReturnValueOnce(of(null));

    await expect(service.reprocessRouteFromOriginalFile(new User('user-1'), routeDocument)).rejects.toMatchObject({
      code: 'PERSIST_FAILED',
    });
  });

  it('emits progress phases', async () => {
    const phases: RouteReprocessProgress['phase'][] = [];

    await service.reprocessRouteFromOriginalFile(new User('user-1'), routeDocument, {
      onProgress: (progress) => phases.push(progress.phase),
    });

    expect(phases).toEqual([
      'validating',
      'downloading',
      'parsing',
      'regenerating_stats',
      'persisting',
      'done',
    ]);
  });

  it('exposes RouteReprocessError for typed consumers', () => {
    const error = new RouteReprocessError('PARSE_FAILED', 'Could not parse');
    expect(error.name).toBe('RouteReprocessError');
    expect(error.code).toBe('PARSE_FAILED');
    expect(getRouteReprocessErrorMessage(error)).toBe('Could not parse the original route source file.');
    expect(getRouteReprocessProgressTitle('regenerating_stats')).toBe('Generating route statistics...');
  });
});
