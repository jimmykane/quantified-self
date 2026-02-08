import { inject } from '@angular/core';
import { Router, CanMatchFn } from '@angular/router';
import { map, take, tap } from 'rxjs/operators';
import { AppAuthService } from './app.auth.service';

/**
 * Guard to prevent authenticated users from matching certain routes (e.g., landing page).
 * Redirects to /dashboard if a user is found.
 */
export const loggedInGuard: CanMatchFn = (route, segments) => {
    const authService = inject(AppAuthService);
    const router = inject(Router);

    return authService.user$.pipe(
        take(1),
        map(user => {
            if (user) {
                // User is logged in, redirect to dashboard
                // Return a UrlTree to cancel current navigation and redirect
                return router.createUrlTree(['/dashboard']);
            }
            // User is not logged in, allow access to the route
            return true;
        })
    );
};
