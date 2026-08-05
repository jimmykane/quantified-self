import { inject } from '@angular/core';
import { Router, CanMatchFn } from '@angular/router';
import { combineLatest } from 'rxjs';
import { filter, map, startWith, take } from 'rxjs/operators';
import { AppAuthService } from './app.auth.service';
import { REQUIRED_POLICY_CONSENT_FORM_CONTROL_NAMES } from '../shared/policy-consent-fields';

import { AppUserService, isActionableProfileReadState } from '../services/app.user.service';
import { LoggerService } from '../services/logger.service';

/**
 * Guard to ensure user has completed onboarding (terms + subscription).
 * Redirects to /onboarding if any step is missing.
 */
export const onboardingGuard: CanMatchFn = (route, segments) => {
    const authService = inject(AppAuthService);
    const userService = inject(AppUserService);
    const router = inject(Router);
    const logger = inject(LoggerService);

    const mapFormControlNameToUserProperty = (formControlName: string): string => {
        if (!formControlName) return '';
        return formControlName.replace(/^accept/, 'accepted');
    };

    const url = '/' + segments.map(segment => segment.path).join('/');

    return combineLatest([
        authService.authState$,
        authService.user$.pipe(startWith(null)),
        userService.profileReadState$,
    ]).pipe(
        filter(([firebaseUser, user, profileReadState]) => {
            if (!firebaseUser) {
                return true;
            }

            const hasActionableProfileFailure = 'uid' in profileReadState
                && profileReadState.uid === firebaseUser.uid
                && isActionableProfileReadState(profileReadState);
            if (hasActionableProfileFailure) {
                return true;
            }

            if (!user || user.uid !== firebaseUser.uid) {
                return false;
            }

            const profileReadsIncomplete = userService.hasIncompleteProfileReads(firebaseUser.uid);
            if (profileReadsIncomplete) {
                logger.warn('[OnboardingGuard] Waiting for the recovered user emission before evaluating onboarding.', {
                    uid: user.uid,
                });
            }
            return !profileReadsIncomplete;
        }),
        take(1),
        map(([firebaseUser, user, profileReadState]) => {
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
                logger.log('[OnboardingGuard] No user found, allowing (authGuard will handle login)');
                return true; // Let authGuard handle unauthenticated users
            }

            const termsAccepted = REQUIRED_POLICY_CONSENT_FORM_CONTROL_NAMES.every(formControlName => {
                const userProperty = mapFormControlNameToUserProperty(formControlName);
                return (user as any)[userProperty] === true;
            });

            const hasSubscribedOnce = (user as any).hasSubscribedOnce === true;
            const stripeRole = (user as any).stripeRole;
            const hasPaidAccess = userService.hasPaidAccessSignal();
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

            // If onboarding isn't completed and we aren't already going to onboarding or payment
            const path = segments.map(s => s.path).join('/');
            const isOnboarding = path.includes('onboarding');
            const isPaymentSuccess = path.includes('payment/success');
            const isPricing = path.includes('pricing');
            const isSubscriptions = path.includes('subscriptions');

            if (!onboardingCompleted && !isOnboarding && !isPaymentSuccess && !isPricing && !isSubscriptions) {
                logger.log(`[OnboardingGuard] Redirecting from /${path} to /onboarding because onboarding is NOT completed.`);
                return router.createUrlTree(['/onboarding']);
            } else {
                logger.log(`[OnboardingGuard] Allowing access to /${path}. (Completed: ${onboardingCompleted}, IsOnboarding: ${isOnboarding}, IsPaymentSuccess: ${isPaymentSuccess}, IsPricing: ${isPricing}, IsSubscriptions: ${isSubscriptions})`);
                return true;
            }
        })
    );
};
