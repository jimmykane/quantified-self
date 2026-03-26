import { inject } from '@angular/core';
import { CanMatchFn, Router } from '@angular/router';
import { take, map } from 'rxjs/operators';
import { AppAuthService } from './app.auth.service';

/**
 * Guard to redirect authenticated users away from the public pricing route.
 * - Logged-in users go to /subscriptions
 */
export const pricingRedirectGuard: CanMatchFn = () => {
    const authService = inject(AppAuthService);
    const router = inject(Router);

    return authService.authState$.pipe(
        take(1),
        map(authUser => {
            if (authUser) {
                return router.parseUrl('/subscriptions');
            }
            return true;
        })
    );
};
