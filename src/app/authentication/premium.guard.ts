import { Injectable, inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AppUserService } from '../services/app.user.service';

@Injectable({
    providedIn: 'root'
})
class PermissionsService {
    constructor(private router: Router, private userService: AppUserService) { }

    async canActivate(): Promise<boolean> {
        try {
            const isPremium = await this.userService.isPremium();
            if (isPremium) {
                return true;
            } else {
                this.router.navigate(['/pricing']);
                return false;
            }
        } catch (error) {
            console.error('Error checking premium status', error);
            this.router.navigate(['/pricing']);
            return false;
        }
    }
}

export const premiumGuard: CanActivateFn = (route, state) => {
    return inject(PermissionsService).canActivate();
};
