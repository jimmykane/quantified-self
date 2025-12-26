import { Injectable, inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AppUserService } from '../services/app.user.service';
import { AppAuthService } from './app.auth.service';
import { LoggerService } from '../services/logger.service';
import { firstValueFrom } from 'rxjs';
import { take } from 'rxjs/operators';

@Injectable({
    providedIn: 'root'
})
class PermissionsService {
    constructor(
        private router: Router,
        private userService: AppUserService,
        private authService: AppAuthService,
        private logger: LoggerService
    ) { }

    async canActivate(): Promise<boolean> {
        try {
            this.logger.log('[PremiumGuard] Checking access...');
            const user = await firstValueFrom(this.authService.user$.pipe(take(1)));

            if (!user) {
                this.logger.log('[PremiumGuard] No user found, allowing (authGuard will handle)');
                return true;
            }

            const termsAccepted = user.acceptedPrivacyPolicy === true &&
                user.acceptedDataPolicy === true &&
                user.acceptedTrackingPolicy === true &&
                user.acceptedDiagnosticsPolicy === true;

            const hasSubscribedOnce = (user as any).hasSubscribedOnce === true;
            const stripeRole = (user as any).stripeRole;
            const hasPaidAccess = stripeRole === 'pro' || stripeRole === 'basic' || (user as any).isPro === true;

            this.logger.log('[ProGuard] Status:', { termsAccepted, hasSubscribedOnce, stripeRole, hasPaidAccess });

            // If they have any level of paid access, they are always allowed
            if (hasPaidAccess) {
                this.logger.log('[ProGuard] Access GRANTED (Pro/Basic)');
                return true;
            }

            // If they ARE NOT paid, but they ALSO HAVEN'T finished onboarding (terms OR initial sub),
            // then we should NOT redirect them to /pricing yet.
            // OnboardingGuard will catch them and send them to /onboarding.
            if (!termsAccepted || !hasSubscribedOnce) {
                this.logger.log('[ProGuard] Access DENIED but deferring to OnboardingGuard (Not fully onboarded)');
                // We return false but do NOT navigate to /pricing, so OnboardingGuard can win.
                return false;
            }

            // If we are here, it means they HAVE accepted terms and HAVE subscribed once before,
            // but they are currently NOT paid. Land them on /pricing.
            this.logger.log('[ProGuard] Access DENIED. User is a lapsed pro member. Redirecting to /pricing');
            this.router.navigate(['/pricing']);
            return false;
        } catch (error) {
            this.logger.error('[ProGuard] Error', error);
            this.router.navigate(['/pricing']);
            return false;
        }
    }
}

export const proGuard: CanActivateFn = (route, state) => {
    return inject(PermissionsService).canActivate();
};
