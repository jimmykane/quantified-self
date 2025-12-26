
import { Injectable, inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AppUserService } from '../services/app.user.service';
import { LoggerService } from '../services/logger.service';

@Injectable({
    providedIn: 'root'
})
class AdminPermissionsService {
    constructor(
        private router: Router,
        private userService: AppUserService,
        private logger: LoggerService
    ) { }

    async canActivate(): Promise<boolean> {
        try {
            const isAdmin = await this.userService.isAdmin();
            if (isAdmin) {
                return true;
            }
            this.logger.warn('[AdminGuard] Access denied. User is not an admin. Redirecting to /dashboard');
            this.router.navigate(['/dashboard']);
            return false;
        } catch (error) {
            this.logger.error('[AdminGuard] Error checking admin status', error);
            this.router.navigate(['/dashboard']);
            return false;
        }
    }
}

export const adminGuard: CanActivateFn = (route, state) => {
    return inject(AdminPermissionsService).canActivate();
};
