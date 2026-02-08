import { Injectable, inject } from '@angular/core';
import { Router, CanMatchFn } from '@angular/router';
import { AppAuthService } from './app.auth.service';
import { LoggerService } from '../services/logger.service';
import { firstValueFrom } from 'rxjs';
import { take } from 'rxjs/operators';
import { AppUserUtilities } from '../utils/app.user.utilities';

@Injectable({
    providedIn: 'root'
})
class PermissionsService {
    constructor(
        private router: Router,
        private authService: AppAuthService,
        private logger: LoggerService
    ) { }

    async canMatch(): Promise<boolean> {
        try {
            this.logger.log('[PaidGuard] Checking access...');
            const user = await firstValueFrom(this.authService.user$.pipe(take(1)));

            if (!user) {
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
            this.router.navigate(['/subscriptions']);
            return false;
        } catch (error) {
            this.logger.error('[PaidGuard] Error', error);
            this.router.navigate(['/subscriptions']);
            return false;
        }
    }
}

export const paidGuard: CanMatchFn = () => inject(PermissionsService).canMatch();
export const proGuard: CanMatchFn = () => inject(PermissionsService).canMatch();
