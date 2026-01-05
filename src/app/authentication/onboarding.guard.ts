import { inject } from '@angular/core';
import { Router, CanMatchFn } from '@angular/router';
import { map, take, tap } from 'rxjs/operators';
import { AppAuthService } from './app.auth.service';
import { POLICY_CONTENT } from '../shared/policies.content';

import { AppUserService } from '../services/app.user.service';
import { LoggerService } from '../services/logger.service';

/**
 * Guard to ensure user has completed onboarding (terms + subscription).
 * Redirects to /onboarding if any step is missing.
 */
export const onboardingGuard: CanMatchFn = (route, segments) => {
    const authService = inject(AppAuthService);
    const router = inject(Router);
    const logger = inject(LoggerService);

    const mapFormControlNameToUserProperty = (formControlName: string): string => {
        if (!formControlName) return '';
        return formControlName.replace(/^accept/, 'accepted');
    };

    return authService.user$.pipe(
        take(1),
        map(user => {
            if (!user) {
                logger.log('[OnboardingGuard] No user found, allowing (authGuard will handle login)');
                return true; // Let authGuard handle unauthenticated users
            }

            // Dynamically check all policies that require acceptance (exclude optional ones)
            const requiredPolicies = POLICY_CONTENT.filter(p => !!p.checkboxLabel && !p.isOptional);
            const termsAccepted = requiredPolicies.every(policy => {
                const userProperty = mapFormControlNameToUserProperty(policy.formControlName || '');
                return (user as any)[userProperty] === true;
            });

            const hasSubscribedOnce = (user as any).hasSubscribedOnce === true;
            const stripeRole = (user as any).stripeRole;
            const hasPaidAccess = AppUserService.hasPaidAccessUser(user);
            const explicitlyCompleted = (user as any).onboardingCompleted === true;

            // User must have accepted terms AND (be pro OR have subscribed once OR explicitly completed free onboarding)
            const onboardingCompleted = termsAccepted && (hasPaidAccess || hasSubscribedOnce || explicitlyCompleted);

            logger.log('[OnboardingGuard] User Assessment:', {
                uid: user.uid,
                termsAccepted,
                hasSubscribedOnce,
                hasPaidAccess,
                stripeRole: (user as any).stripeRole,
                explicitlyCompleted,
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
                logger.log(`[OnboardingGuard] Redirecting from /${path} to /onboarding because onboarding is NOT completed.`);
                router.navigate(['/onboarding']);
            } else {
                logger.log(`[OnboardingGuard] Allowing access to /${path}. (Completed: ${completed}, IsOnboarding: ${isOnboarding}, IsPayment: ${isPayment}, IsPricing: ${isPricing})`);
            }
        })
    );
};
