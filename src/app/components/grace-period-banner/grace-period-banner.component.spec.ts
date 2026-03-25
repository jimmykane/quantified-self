import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GracePeriodBannerComponent } from './grace-period-banner.component';
import { AppUserService } from '../../services/app.user.service';
import { of } from 'rxjs';
import { signal } from '@angular/core';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { RouterTestingModule } from '@angular/router/testing';
import { USAGE_LIMITS } from '@shared/limits';

describe('GracePeriodBannerComponent', () => {
    let component: GracePeriodBannerComponent;
    let fixture: ComponentFixture<GracePeriodBannerComponent>;

    const mockUserService = {
        gracePeriodUntil: signal<Date | null>(null)
    };

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            declarations: [GracePeriodBannerComponent],
            imports: [RouterTestingModule],
            providers: [
                { provide: AppUserService, useValue: mockUserService }
            ],
            schemas: [CUSTOM_ELEMENTS_SCHEMA]
        }).compileComponents();

        // Mock ResizeObserver
        global.ResizeObserver = vi.fn().mockImplementation(() => ({
            observe: vi.fn(),
            unobserve: vi.fn(),
            disconnect: vi.fn(),
        }));

        fixture = TestBed.createComponent(GracePeriodBannerComponent);
        component = fixture.componentInstance;
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should show banner when grace period date is present', async () => {
        const mockDate = new Date();
        mockUserService.gracePeriodUntil.set(mockDate);

        fixture.detectChanges();
        await fixture.whenStable();

        const banner = fixture.nativeElement.querySelector('.grace-period-banner');
        expect(banner).toBeTruthy();
        expect(banner.textContent).toContain('Your Pro plan has ended');
        expect(banner.textContent).toContain(`(${USAGE_LIMITS.free} on Free)`);
        expect(banner.textContent).toContain('existing activities stay in your account');
    });

    it('should hide banner when grace period date is null', () => {
        mockUserService.gracePeriodUntil.set(null);

        fixture.detectChanges();

        const banner = fixture.nativeElement.querySelector('.grace-period-banner');
        expect(banner).toBeFalsy();
    });

    it('should hide banner when dismissed', async () => {
        const mockDate = new Date();
        mockUserService.gracePeriodUntil.set(mockDate);

        fixture.detectChanges();
        await fixture.whenStable();

        // Verify banner is visible
        let banner = fixture.nativeElement.querySelector('.grace-period-banner');
        expect(banner).toBeTruthy();

        // Dismiss the banner
        component.dismiss();
        fixture.detectChanges();

        // Verify banner is hidden
        banner = fixture.nativeElement.querySelector('.grace-period-banner');
        expect(banner).toBeFalsy();
    });

    it('should emit heightChanged with 0 when dismissed', () => {
        const heightChangedSpy = vi.spyOn(component.heightChanged, 'emit');

        component.dismiss();

        expect(heightChangedSpy).toHaveBeenCalledWith(0);
    });
});
