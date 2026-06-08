import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, ResolveFn, Router, RouterStateSnapshot } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  DataAltitude,
  DataAltitudeSmooth,
  DataDistance,
  DataGNSSDistance,
  DataGrade,
  DataGradeSmooth,
  DataLatitudeDegrees,
  DataLongitudeDegrees,
  RouteFileInterface,
  User,
} from '@sports-alliance/sports-lib';
import { EMPTY, from } from 'rxjs';
import { catchError, map, switchMap, take } from 'rxjs/operators';
import { FirestoreRouteJSON, OriginalRouteFileMetaData } from '@shared/app-route.interface';
import { AppAuthService } from '../authentication/app.auth.service';
import { AppRouteHydrationService } from '../services/app.route-hydration.service';
import { AppRouteService } from '../services/app.route.service';
import { LoggerService } from '../services/logger.service';

export interface RouteResolverData {
  routeDocument: FirestoreRouteJSON;
  routeFile: RouteFileInterface;
  sourceFile: OriginalRouteFileMetaData;
  user: User | null;
}

export const ROUTE_DETAIL_STREAM_TYPES = [
  DataLatitudeDegrees.type,
  DataLongitudeDegrees.type,
  DataAltitude.type,
  DataAltitudeSmooth.type,
  DataDistance.type,
  DataGNSSDistance.type,
  DataGrade.type,
  DataGradeSmooth.type,
] as const;

export const routeResolver: ResolveFn<RouteResolverData> = (
  route: ActivatedRouteSnapshot,
  _state: RouterStateSnapshot,
) => {
  const authService = inject(AppAuthService);
  const routeService = inject(AppRouteService);
  const routeHydrationService = inject(AppRouteHydrationService);
  const router = inject(Router);
  const snackBar = inject(MatSnackBar);
  const logger = inject(LoggerService);

  const routeID = route.paramMap.get('routeID');
  const targetUserID = route.paramMap.get('userID');

  if (!routeID || !targetUserID) {
    router.navigate(['/routes']);
    return EMPTY;
  }

  return authService.user$.pipe(
    take(1),
    switchMap((user: User | null) => routeService.getRoute(new User(targetUserID), routeID).pipe(
      take(1),
      switchMap((routeDocument) => {
        if (!routeDocument) {
          snackBar.open('Route not found', 'Close', { duration: 3000 });
          router.navigate(['/routes']);
          return EMPTY;
        }

        return from(routeHydrationService.hydrateRouteFile(routeDocument, {
          streamTypes: [...ROUTE_DETAIL_STREAM_TYPES],
        })).pipe(
          map(({ routeFile, sourceFile }) => ({
            routeDocument,
            routeFile,
            sourceFile,
            user,
          })),
        );
      }),
    )),
    catchError((error) => {
      logger.error('[routeResolver] Error resolving route details:', error);
      snackBar.open(resolveRouteResolverErrorMessage(error), 'Close', { duration: 5000 });
      router.navigate(['/routes']);
      return EMPTY;
    }),
  );
};

function resolveRouteResolverErrorMessage(error: unknown): string {
  const errorCode = `${(error as { code?: unknown })?.code || ''}`;
  const message = `${(error as { message?: unknown })?.message || error || ''}`;

  if (
    errorCode === 'permission-denied'
    || message.includes('Missing or insufficient permissions')
  ) {
    return 'Route unavailable: you do not have permission to open it.';
  }

  if (message.includes('original source file') || message.includes('missing its original')) {
    return 'Route unavailable: original source file is missing.';
  }

  if (message.includes('Unsupported route source file type')) {
    return 'Route unavailable: unsupported route file type.';
  }

  return 'Route unavailable: original route file could not be parsed.';
}
