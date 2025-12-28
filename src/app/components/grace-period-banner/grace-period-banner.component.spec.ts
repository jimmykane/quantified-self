import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GracePeriodBannerComponent } from './grace-period-banner.component';
import { AppUserService } from '../../services/app.user.service';
import { of } from 'rxjs';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { RouterTestingModule } from '@angular/router/testing';

describe('GracePeriodBannerComponent', () => {
    let component: GracePeriodBannerComponent;
    let fixture: ComponentFixture<GracePeriodBannerComponent>;

    const mockUserService = {
        getGracePeriodUntil: vi.fn().mockReturnValue(of(null))
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

        fixture = TestBed.createComponent(GracePeriodBannerComponent);
        component = fixture.componentInstance;
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should show banner when grace period date is present', () => {
        const mockDate = new Date();
        mockUserService.getGracePeriodUntil.mockReturnValue(of(mockDate));

        component.ngOnInit();
        fixture.detectChanges();

        const banner = fixture.nativeElement.querySelector('.grace-period-banner');
        expect(banner).toBeTruthy();
        expect(banner.textContent).toContain('Your Pro plan has ended');
    });

    it('should hide banner when grace period date is null', () => {
        mockUserService.getGracePeriodUntil.mockReturnValue(of(null));

        component.ngOnInit();
        fixture.detectChanges();

        const banner = fixture.nativeElement.querySelector('.grace-period-banner');
        expect(banner).toBeFalsy();
    });

    it('should hide banner when dismissed', () => {
        const mockDate = new Date();
        mockUserService.getGracePeriodUntil.mockReturnValue(of(mockDate));

        component.ngOnInit();
        fixture.detectChanges();

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
