import { Injectable, inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AppUserService } from '../services/app.user.service';
import { AppAuthService } from './app.auth.service';
import { firstValueFrom } from 'rxjs';
import { take } from 'rxjs/operators';

@Injectable({
    providedIn: 'root'
})
class PermissionsService {
    constructor(
        private router: Router,
        private userService: AppUserService,
        private authService: AppAuthService
    ) { }

    async canActivate(): Promise<boolean> {
        try {
            console.log('[PremiumGuard] Checking access...');
            const user = await firstValueFrom(this.authService.user$.pipe(take(1)));

            if (!user) {
                console.log('[PremiumGuard] No user found, allowing (authGuard will handle)');
                return true;
            }

            const termsAccepted = user.acceptedPrivacyPolicy === true &&
                user.acceptedDataPolicy === true &&
                user.acceptedTrackingPolicy === true &&
                user.acceptedDiagnosticsPolicy === true;

            const hasSubscribedOnce = (user as any).hasSubscribedOnce === true;
            const stripeRole = (user as any).stripeRole;
            const hasPaidAccess = stripeRole === 'premium' || stripeRole === 'basic' || (user as any).isPremium === true;

            console.log('[PremiumGuard] Status:', { termsAccepted, hasSubscribedOnce, stripeRole, hasPaidAccess });

            // If they have any level of premium access, they are always allowed
            if (hasPaidAccess) {
                console.log('[PremiumGuard] Access GRANTED (Premium)');
                return true;
            }

            // If they ARE NOT premium, but they ALSO HAVEN'T finished onboarding (terms OR initial sub),
            // then we should NOT redirect them to /pricing yet.
            // OnboardingGuard will catch them and send them to /onboarding.
            if (!termsAccepted || !hasSubscribedOnce) {
                console.log('[PremiumGuard] Access DENIED but deferring to OnboardingGuard (Not fully onboarded)');
                // We return false but do NOT navigate to /pricing, so OnboardingGuard can win.
                return false;
            }

            // If we are here, it means they HAVE accepted terms and HAVE subscribed once before,
            // but they are currently NOT premium. Land them on /pricing.
            console.log('[PremiumGuard] Access DENIED. User is a lapsed premium member. Redirecting to /pricing');
            this.router.navigate(['/pricing']);
            return false;
        } catch (error) {
            console.error('[PremiumGuard] Error', error);
            this.router.navigate(['/pricing']);
            return false;
        }
    }
}

export const premiumGuard: CanActivateFn = (route, state) => {
    return inject(PermissionsService).canActivate();
};
