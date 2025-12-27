import { inject } from '@angular/core';
import { ResolveFn, Router, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { AppUserService } from '../services/app.user.service';
import { AppAuthService } from '../authentication/app.auth.service';
import { User } from '@sports-alliance/sports-lib';
import { take, switchMap, map } from 'rxjs/operators';
import { of, EMPTY } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';

export interface UserResolverData {
    user: User | null;
    isPro: boolean;
}

export const userResolver: ResolveFn<UserResolverData> = (
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
) => {
    const authService = inject(AppAuthService);
    const userService = inject(AppUserService);
    const router = inject(Router);
    const snackBar = inject(MatSnackBar);

    return authService.user$.pipe(
        take(1),
        switchMap(async (user) => {
            if (!user) {
                // If this route is guarded, we theoretically shouldn't get here without a user.
                // But if we do, return null/false.
                return { user: null, isPro: false };
            }

            // Check Pro status. This might be async if it refreshes claims etc.
            const isPro = await userService.isPro();
            return { user, isPro };
        }),
        map(result => result as UserResolverData)
    );
};
