import { inject } from '@angular/core';
import { Router, CanMatchFn } from '@angular/router';
import { map, take } from 'rxjs/operators';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppAuthService } from './app.auth.service';
import { LoggerService } from '../services/logger.service';

/**
 * Functional auth guard using modern Angular patterns.
 * Uses canMatch which is the recommended replacement for canLoad.
 */
export const authGuard: CanMatchFn = (route, segments) => {
  const authService = inject(AppAuthService);
  const router = inject(Router);
  const snackBar = inject(MatSnackBar);
  const logger = inject(LoggerService);
  const url = '/' + segments.map(s => s.path).join('/');

  return authService.authState$.pipe(
    take(1),
    map(authUser => {
      logger.log('[AuthGuard] evaluating route access', { url, authUid: authUser?.uid ?? 'none' });
      authService.redirectUrl = null;
      if (!authUser) {
        authService.redirectUrl = url;
        logger.warn('[AuthGuard] blocking route and redirecting to /login', { url });
        snackBar.open('You must login first', undefined, {
          duration: 2000,
        });
        return router.createUrlTree(['/login']);
      }
      logger.log('[AuthGuard] allowing route access', { url, authUid: authUser.uid });
      return true;
    })
  );
};
