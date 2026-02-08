import { inject } from '@angular/core';
import { Router, CanMatchFn } from '@angular/router';
import { map, take, tap } from 'rxjs/operators';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppAuthService } from './app.auth.service';

/**
 * Functional auth guard using modern Angular patterns.
 * Uses canMatch which is the recommended replacement for canLoad.
 */
export const authGuard: CanMatchFn = (route, segments) => {
  const authService = inject(AppAuthService);
  const router = inject(Router);
  const snackBar = inject(MatSnackBar);
  const url = '/' + segments.map(s => s.path).join('/');

  return authService.user$.pipe(
    take(1),
    map(user => {
      authService.redirectUrl = null;
      if (!user) {
        authService.redirectUrl = url;
        snackBar.open('You must login first', undefined, {
          duration: 2000,
        });
        return router.createUrlTree(['/login']);
      }
      return true;
    })
  );
};
