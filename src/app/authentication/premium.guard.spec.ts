import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { premiumGuard } from './premium.guard';
import { AppUserService } from '../services/app.user.service';

describe('premiumGuard', () => {
    let router: Router;
    let userService: jasmine.SpyObj<AppUserService>;

    beforeEach(() => {
        const userServiceSpy = jasmine.createSpyObj('AppUserService', ['isPremium']);
        const routerSpy = jasmine.createSpyObj('Router', ['navigate']);

        TestBed.configureTestingModule({
            providers: [
                { provide: AppUserService, useValue: userServiceSpy },
                { provide: Router, useValue: routerSpy }
            ]
        });

        router = TestBed.inject(Router);
        userService = TestBed.inject(AppUserService) as jasmine.SpyObj<AppUserService>;
    });

    it('should allow access if user is premium', async () => {
        userService.isPremium.and.returnValue(Promise.resolve(true));
        const result = await TestBed.runInInjectionContext(() => premiumGuard(null!, null!));
        expect(result).toBeTrue();
    });

    it('should redirect to pricing if user is not premium', async () => {
        userService.isPremium.and.returnValue(Promise.resolve(false));
        const result = await TestBed.runInInjectionContext(() => premiumGuard(null!, null!));
        expect(result).toBeFalse();
        expect(router.navigate).toHaveBeenCalledWith(['/pricing']);
    });
});
