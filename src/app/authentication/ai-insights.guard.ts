import { Injectable, inject } from '@angular/core';
import { CanMatchFn, Router, UrlSegment } from '@angular/router';
import { combineLatest, firstValueFrom } from 'rxjs';
import { filter, startWith, take } from 'rxjs/operators';
import { AppAuthService } from './app.auth.service';
import { AppUserService, isActionableProfileReadState } from '../services/app.user.service';
import { LoggerService } from '../services/logger.service';
import { AppUserUtilities } from '../utils/app.user.utilities';
import { getAiInsightsRequestLimitForRole } from '@shared/limits';

@Injectable({
  providedIn: 'root'
})
class AiInsightsPermissionsService {
  private readonly router = inject(Router);
  private readonly authService = inject(AppAuthService);
  private readonly userService = inject(AppUserService);
  private readonly logger = inject(LoggerService);

  async canMatch(segments: UrlSegment[]): Promise<boolean | import('@angular/router').UrlTree> {
    try {
      this.logger.log('[AiInsightsGuard] Checking access...');
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
        this.logger.log('[AiInsightsGuard] No user found, allowing (authGuard will handle)');
        return true;
      }

      const termsAccepted = user.acceptedPrivacyPolicy === true
        && user.acceptedDataPolicy === true
        && (user as any).acceptedTos === true;
      const hasSubscribedOnce = (user as any).hasSubscribedOnce === true;
      const explicitlyCompleted = (user as any).onboardingCompleted === true;
      const onboardingCompleted = termsAccepted && (hasSubscribedOnce || explicitlyCompleted);
      const isAdmin = (user as any).admin === true;
      const hasPaidAiInsightsAccess = AppUserUtilities.hasPaidAccessUser(user, isAdmin);
      const stripeRole = `${(user as any).stripeRole || 'free'}`;
      let hasConfiguredAiInsightsAccess = false;
      try {
        hasConfiguredAiInsightsAccess = getAiInsightsRequestLimitForRole(stripeRole) > 0;
      } catch (error) {
        this.logger.error('[AiInsightsGuard] Unsupported role while checking AI Insights access', error);
      }

      this.logger.log('[AiInsightsGuard] Status:', {
        stripeRole: (user as any).stripeRole,
        isAdmin,
        hasPaidAiInsightsAccess,
        hasConfiguredAiInsightsAccess,
        termsAccepted,
        hasSubscribedOnce,
        explicitlyCompleted,
        onboardingCompleted,
      });

      if (hasPaidAiInsightsAccess) {
        this.logger.log('[AiInsightsGuard] Access GRANTED (Paid/Admin/Grace)');
        return true;
      }

      if (hasConfiguredAiInsightsAccess && onboardingCompleted) {
        this.logger.log('[AiInsightsGuard] Access GRANTED (Configured quota)');
        return true;
      }

      if (!onboardingCompleted) {
        this.logger.log('[AiInsightsGuard] Access DENIED but deferring to OnboardingGuard (Not fully onboarded)');
        return false;
      }

      this.logger.log('[AiInsightsGuard] Access DENIED. Redirecting to /subscriptions');
      return this.router.createUrlTree(['/subscriptions']);
    } catch (error) {
      this.logger.error('[AiInsightsGuard] Error', error);
      return this.router.createUrlTree(['/subscriptions']);
    }
  }
}

export const aiInsightsGuard: CanMatchFn = (route, segments) => inject(AiInsightsPermissionsService).canMatch(segments);
