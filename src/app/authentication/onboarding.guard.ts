import { inject } from '@angular/core';
import { Router, CanMatchFn } from '@angular/router';
import { map, take, tap } from 'rxjs/operators';
import { AppAuthService } from './app.auth.service';

/**
 * Guard to ensure user has completed onboarding (terms + subscription).
 * Redirects to /onboarding if any step is missing.
 */
export const onboardingGuard: CanMatchFn = (route, segments) => {
    const authService = inject(AppAuthService);
    const router = inject(Router);

    return authService.user$.pipe(
        take(1),
        map(user => {
            if (!user) {
                console.log('[OnboardingGuard] No user found, allowing (authGuard will handle login)');
                return true; // Let authGuard handle unauthenticated users
            }

            const termsAccepted = user.acceptedPrivacyPolicy === true &&
                user.acceptedDataPolicy === true &&
                user.acceptedTrackingPolicy === true &&
                user.acceptedDiagnosticsPolicy === true;

            const hasSubscribedOnce = (user as any).hasSubscribedOnce === true;
            const stripeRole = (user as any).stripeRole;
            const hasPaidAccess = stripeRole === 'premium' || stripeRole === 'basic' || (user as any).isPremium === true;

            // User must have accepted terms AND (be premium OR have subscribed once)
            const onboardingCompleted = termsAccepted && (hasPaidAccess || hasSubscribedOnce);

            console.log('[OnboardingGuard] User Assessment:', {
                uid: user.uid,
                termsAccepted,
                hasSubscribedOnce,
                hasPaidAccess,
                stripeRole: (user as any).stripeRole,
                onboardingCompleted
            });

            return onboardingCompleted;
        }),
        tap(completed => {
            // If onboarding isn't completed and we aren't already going to onboarding or payment
            const path = segments.map(s => s.path).join('/');
            const isOnboarding = path.includes('onboarding');
            const isPayment = path.includes('payment/');
            const isPricing = path.includes('pricing');

            if (!completed && !isOnboarding && !isPayment && !isPricing) {
                console.log(`[OnboardingGuard] Redirecting from /${path} to /onboarding because onboarding is NOT completed.`);
                router.navigate(['/onboarding']);
            } else {
                console.log(`[OnboardingGuard] Allowing access to /${path}. (Completed: ${completed}, IsOnboarding: ${isOnboarding}, IsPayment: ${isPayment}, IsPricing: ${isPricing})`);
            }
        })
    );
};
