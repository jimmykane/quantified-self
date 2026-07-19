import { Injectable, inject } from '@angular/core';
import { Router, CanMatchFn, UrlSegment } from '@angular/router';
import { AppAuthService } from './app.auth.service';
import { AppUserService, isActionableProfileReadState } from '../services/app.user.service';
import { LoggerService } from '../services/logger.service';
import { combineLatest, firstValueFrom } from 'rxjs';
import { filter, startWith, take } from 'rxjs/operators';
import { AppUserUtilities } from '../utils/app.user.utilities';

@Injectable({
    providedIn: 'root'
})
class PermissionsService {
    constructor(
        private router: Router,
        private authService: AppAuthService,
        private userService: AppUserService,
        private logger: LoggerService
    ) { }

    async canMatch(segments: UrlSegment[]): Promise<boolean | import('@angular/router').UrlTree> {
        try {
            this.logger.log('[PaidGuard] Checking access...');
            const [firebaseUser, user, profileReadState] = await firstValueFrom(
                combineLatest([
                    this.authService.authState$,
                    this.authService.user$.pipe(startWith(null)),
                    this.userService.profileReadState$,
                ]).pipe(
                    filter(([currentFirebaseUser, currentAppUser, currentProfileReadState]) => {
                        if (!currentFirebaseUser) {
                            return true;
                        }

                        const hasActionableProfileFailure = 'uid' in currentProfileReadState
                            && currentProfileReadState.uid === currentFirebaseUser.uid
                            && isActionableProfileReadState(currentProfileReadState);
                        return hasActionableProfileFailure
                            || (!!currentAppUser
                                && currentAppUser.uid === currentFirebaseUser.uid
                                && !this.userService.hasIncompleteProfileReads(currentFirebaseUser.uid));
                    }),
                    take(1)
                )
            );

            const hasActionableProfileFailure = !!firebaseUser
                && 'uid' in profileReadState
                && profileReadState.uid === firebaseUser.uid
                && isActionableProfileReadState(profileReadState);
            if (hasActionableProfileFailure) {
                const url = '/' + segments.map(segment => segment.path).join('/');
                this.authService.redirectUrl = url;
                return this.router.createUrlTree(['/login'], {
                    queryParams: { returnUrl: url },
                });
            }

            if (!firebaseUser || !user) {
                this.logger.log('[PaidGuard] No user found, allowing (authGuard will handle)');
                return true;
            }

            const termsAccepted = user.acceptedPrivacyPolicy === true &&
                user.acceptedDataPolicy === true &&
                (user as any).acceptedTos === true;

            const hasSubscribedOnce = (user as any).hasSubscribedOnce === true;
            const stripeRole = (user as any).stripeRole;
            const isAdmin = (user as any).admin === true;
            const hasPaidAccess = AppUserUtilities.hasPaidAccessUser(user, isAdmin);

            this.logger.log('[PaidGuard] Status:', {
                termsAccepted,
                hasSubscribedOnce,
                stripeRole,
                isAdmin,
                hasPaidAccess
            });

            // If they have any level of paid access, they are always allowed
            if (hasPaidAccess) {
                this.logger.log('[PaidGuard] Access GRANTED (Pro/Basic/Grace)');
                return true;
            }

            // If they ARE NOT paid, but they ALSO HAVEN'T finished onboarding (terms OR initial sub),
            // then we should NOT redirect them to /subscriptions yet.
            // OnboardingGuard will catch them and send them to /onboarding.
            if (!termsAccepted || !hasSubscribedOnce) {
                this.logger.log('[PaidGuard] Access DENIED but deferring to OnboardingGuard (Not fully onboarded)');
                // We return false but do NOT navigate to /subscriptions, so OnboardingGuard can win.
                return false;
            }

            // If we are here, it means they HAVE accepted terms and HAVE subscribed once before,
            // but they are currently NOT paid. Land them on /subscriptions.
            this.logger.log('[PaidGuard] Access DENIED. User is a lapsed paid member. Redirecting to /subscriptions');
            return this.router.createUrlTree(['/subscriptions']);
        } catch (error) {
            this.logger.error('[PaidGuard] Error', error);
            return this.router.createUrlTree(['/subscriptions']);
        }
    }
}

export const paidGuard: CanMatchFn = (route, segments) => inject(PermissionsService).canMatch(segments);
export const proGuard: CanMatchFn = (route, segments) => inject(PermissionsService).canMatch(segments);
