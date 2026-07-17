import { inject } from '@angular/core';
import { Router, CanMatchFn } from '@angular/router';
import { combineLatest } from 'rxjs';
import { filter, map, startWith, take } from 'rxjs/operators';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppAuthService } from './app.auth.service';
import { AppUserService, isActionableProfileReadState } from '../services/app.user.service';

/**
 * Functional auth guard using modern Angular patterns.
 * Uses canMatch which is the recommended replacement for canLoad.
 */
export const authGuard: CanMatchFn = (route, segments) => {
  const authService = inject(AppAuthService);
  const userService = inject(AppUserService);
  const router = inject(Router);
  const snackBar = inject(MatSnackBar);
  const url = '/' + segments.map(s => s.path).join('/');

  return combineLatest([
    authService.authState$,
    authService.user$.pipe(startWith(null)),
    userService.profileReadState$,
  ]).pipe(
    filter(([firebaseUser, appUser, profileReadState]) => {
      if (!firebaseUser) {
        return true;
      }

      const hasActionableProfileFailure = 'uid' in profileReadState
        && profileReadState.uid === firebaseUser.uid
        && isActionableProfileReadState(profileReadState);
      if (hasActionableProfileFailure) {
        return true;
      }

      return !!appUser
        && appUser.uid === firebaseUser.uid
        && !userService.hasIncompleteProfileReads(firebaseUser.uid);
    }),
    take(1),
    map(([firebaseUser, user, profileReadState]) => {
      authService.redirectUrl = null;
      const hasActionableProfileFailure = !!firebaseUser
        && 'uid' in profileReadState
        && profileReadState.uid === firebaseUser.uid
        && isActionableProfileReadState(profileReadState);
      if (hasActionableProfileFailure) {
        authService.redirectUrl = url;
        return router.createUrlTree(['/login'], {
          queryParams: { returnUrl: url },
        });
      }

      if (!firebaseUser || !user) {
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
