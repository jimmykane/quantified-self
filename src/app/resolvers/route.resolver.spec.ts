import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, convertToParamMap } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouteFileInterface, User } from '@sports-alliance/sports-lib';
import { firstValueFrom, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FirestoreRouteJSON } from '@shared/app-route.interface';
import { AppAuthService } from '../authentication/app.auth.service';
import { AppRouteHydrationService } from '../services/app.route-hydration.service';
import { AppRouteService } from '../services/app.route.service';
import { LoggerService } from '../services/logger.service';
import { routeResolver } from './route.resolver';

describe('routeResolver', () => {
  let routeServiceMock: any;
  let routeHydrationServiceMock: any;
  let routerMock: any;
  let snackBarMock: any;
  let loggerMock: any;

  const routeDocument: FirestoreRouteJSON = {
    id: 'route-1',
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
  };
  const routeFile = {} as RouteFileInterface;
  const sourceFile = { path: 'users/user-1/routes/route-1/original.gpx' };

  beforeEach(() => {
    routeServiceMock = {
      getRoute: vi.fn().mockReturnValue(of(routeDocument)),
    };
    routeHydrationServiceMock = {
      hydrateRouteFile: vi.fn().mockResolvedValue({
        routeDocument,
        routeFile,
        sourceFile,
      }),
    };
    routerMock = {
      navigate: vi.fn(),
    };
    snackBarMock = {
      open: vi.fn(),
    };
    loggerMock = {
      error: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: AppAuthService, useValue: { user$: of(new User('user-1')) } },
        { provide: AppRouteService, useValue: routeServiceMock },
        { provide: AppRouteHydrationService, useValue: routeHydrationServiceMock },
        { provide: Router, useValue: routerMock },
        { provide: MatSnackBar, useValue: snackBarMock },
        { provide: LoggerService, useValue: loggerMock },
      ],
    });
  });

  it('resolves a saved route document and hydrated original route file', async () => {
    const result = await resolveRoute();

    expect(routeServiceMock.getRoute).toHaveBeenCalledWith(expect.objectContaining({ uid: 'user-1' }), 'route-1');
    expect(routeHydrationServiceMock.hydrateRouteFile).toHaveBeenCalledWith(
      routeDocument,
      expect.objectContaining({ streamTypes: expect.arrayContaining(['Distance']) }),
    );
    expect(result?.routeDocument).toBe(routeDocument);
    expect(result?.routeFile).toBe(routeFile);
    expect(result?.sourceFile).toBe(sourceFile);
  });

  it('navigates back to routes when the route document is missing', async () => {
    routeServiceMock.getRoute.mockReturnValueOnce(of(null));

    expect(await resolveRoute()).toBeNull();

    expect(snackBarMock.open).toHaveBeenCalledWith('Route not found', 'Close', { duration: 3000 });
    expect(routerMock.navigate).toHaveBeenCalledWith(['/routes']);
  });

  it('reports parse failures and navigates back to routes', async () => {
    routeHydrationServiceMock.hydrateRouteFile.mockRejectedValueOnce(new Error('No routes found in GPX'));

    expect(await resolveRoute()).toBeNull();

    expect(loggerMock.error).toHaveBeenCalled();
    expect(snackBarMock.open).toHaveBeenCalledWith(
      'Route unavailable: original route file could not be parsed.',
      'Close',
      { duration: 5000 },
    );
    expect(routerMock.navigate).toHaveBeenCalledWith(['/routes']);
  });

  it('reports missing original route files distinctly', async () => {
    routeHydrationServiceMock.hydrateRouteFile.mockRejectedValueOnce(new Error('Saved route is missing its original source file.'));

    expect(await resolveRoute()).toBeNull();

    expect(snackBarMock.open).toHaveBeenCalledWith(
      'Route unavailable: original source file is missing.',
      'Close',
      { duration: 5000 },
    );
    expect(routerMock.navigate).toHaveBeenCalledWith(['/routes']);
  });

  it('reports permission failures distinctly', async () => {
    routeServiceMock.getRoute.mockReturnValueOnce(throwError(() => ({ code: 'permission-denied' })));

    expect(await resolveRoute()).toBeNull();

    expect(snackBarMock.open).toHaveBeenCalledWith(
      'Route unavailable: you do not have permission to open it.',
      'Close',
      { duration: 5000 },
    );
    expect(routerMock.navigate).toHaveBeenCalledWith(['/routes']);
  });

  it('navigates back to routes when URL params are missing', async () => {
    expect(await resolveRoute({ userID: 'user-1' })).toBeNull();

    expect(routerMock.navigate).toHaveBeenCalledWith(['/routes']);
    expect(routeServiceMock.getRoute).not.toHaveBeenCalled();
  });

  async function resolveRoute(params: Record<string, string> = { userID: 'user-1', routeID: 'route-1' }) {
    const snapshot = {
      paramMap: convertToParamMap(params),
    } as ActivatedRouteSnapshot;
    const result = TestBed.runInInjectionContext(() => routeResolver(snapshot, {} as RouterStateSnapshot));
    return firstValueFrom(result as any, { defaultValue: null });
  }
});
