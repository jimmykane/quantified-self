import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AdminUserManagementComponent } from './admin-user-management.component';
import { AppThemeService } from '../../../services/app.theme.service';
import { of } from 'rxjs';
import { AppThemes } from '@sports-alliance/sports-lib';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

describe('AdminUserManagementComponent', () => {
    let component: AdminUserManagementComponent;
    let fixture: ComponentFixture<AdminUserManagementComponent>;
    let mockThemeService: any;

    beforeEach(async () => {
        mockThemeService = {
            getAppTheme: vi.fn().mockReturnValue(of(AppThemes.Dark))
        };

        await TestBed.configureTestingModule({
            imports: [AdminUserManagementComponent, NoopAnimationsModule],
            providers: [
                { provide: AppThemeService, useValue: mockThemeService }
            ]
        }).compileComponents();

        fixture = TestBed.createComponent(AdminUserManagementComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    describe('getRole', () => {
        it('should return stripeRole if present', () => {
            const user = { customClaims: { stripeRole: 'pro' } } as any;
            expect(component.getRole(user)).toBe('pro');
        });

        it('should return free if no stripeRole', () => {
            const user = { customClaims: {} } as any;
            expect(component.getRole(user)).toBe('free');
        });
    });

    describe('isAdmin', () => {
        it('should return true if admin claim is true', () => {
            const user = { customClaims: { admin: true } } as any;
            expect(component.isAdmin(user)).toBe(true);
        });

        it('should return false if no admin claim', () => {
            const user = { customClaims: {} } as any;
            expect(component.isAdmin(user)).toBe(false);
        });
    });

    describe('getSubscriptionDetails', () => {
        it('should return dash if no subscription', () => {
            const user = {} as any;
            expect(component.getSubscriptionDetails(user)).toBe('-');
        });

        it('should return status uppercase', () => {
            const user = { subscription: { status: 'active' } } as any;
            expect(component.getSubscriptionDetails(user)).toBe('ACTIVE');
        });
    });

    describe('getServiceLogo', () => {
        it('should return correct paths', () => {
            expect(component.getServiceLogo('garmin')).toBe('assets/logos/garmin.svg');
            expect(component.getServiceLogo('Suunto')).toBe('assets/logos/suunto.svg');
            expect(component.getServiceLogo('COROS')).toBe('assets/logos/coros.svg');
        });

        it('should return empty for unknown', () => {
            expect(component.getServiceLogo('unknown')).toBe('');
        });
    });

    describe('Events', () => {
        it('should emit pageChange on onPageChange', () => {
            const spy = vi.spyOn(component.pageChange, 'emit');
            const event = { pageIndex: 1, pageSize: 10, length: 100 };
            component.onPageChange(event);
            expect(spy).toHaveBeenCalledWith(event);
        });

        it('should emit sortChange on onSortChange', () => {
            const spy = vi.spyOn(component.sortChange, 'emit');
            const sort = { active: 'email', direction: 'asc' as const };
            component.onSortChange(sort);
            expect(spy).toHaveBeenCalledWith(sort);
        });

        it('should emit impersonate on onImpersonate', () => {
            const spy = vi.spyOn(component.impersonate, 'emit');
            const user = { uid: '123' } as any;
            component.onImpersonate(user);
            expect(spy).toHaveBeenCalledWith(user);
        });
    });
});
