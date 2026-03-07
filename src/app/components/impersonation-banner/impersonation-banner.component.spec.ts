import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppImpersonationService, ImpersonationSessionViewModel } from '../../services/app.impersonation.service';
import { ImpersonationBannerComponent } from './impersonation-banner.component';

describe('ImpersonationBannerComponent', () => {
    let fixture: ComponentFixture<ImpersonationBannerComponent>;
    const sessionSignal = signal<ImpersonationSessionViewModel | null>(null);
    const isReturningSignal = signal(false);
    const impersonationServiceMock = {
        session: sessionSignal,
        isImpersonating: signal(false),
        isReturning: isReturningSignal,
        returnToAdmin: vi.fn().mockResolvedValue(undefined)
    };

    beforeEach(async () => {
        vi.clearAllMocks();
        sessionSignal.set(null);
        isReturningSignal.set(false);
        impersonationServiceMock.isImpersonating.set(false);

        await TestBed.configureTestingModule({
            imports: [ImpersonationBannerComponent, NoopAnimationsModule],
            providers: [
                { provide: AppImpersonationService, useValue: impersonationServiceMock }
            ]
        }).compileComponents();

        fixture = TestBed.createComponent(ImpersonationBannerComponent);
        fixture.detectChanges();
    });

    it('should hide the banner when there is no impersonation session', () => {
        expect(fixture.nativeElement.querySelector('.impersonation-banner')).toBeNull();
    });

    it('should show the impersonated account label when a session is active', () => {
        sessionSignal.set({
            impersonatedBy: 'admin-uid',
            label: 'user@example.com'
        });
        fixture.detectChanges();

        const banner = fixture.nativeElement.querySelector('.impersonation-banner') as HTMLElement | null;
        expect(banner?.textContent).toContain('Impersonating user@example.com.');
    });

    it('should disable the return action while the restore flow is pending', () => {
        sessionSignal.set({
            impersonatedBy: 'admin-uid',
            label: 'user@example.com'
        });
        isReturningSignal.set(true);
        fixture.detectChanges();

        const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement | null;
        expect(button?.disabled).toBe(true);
        expect(button?.textContent).toContain('Returning...');
    });

    it('should delegate the return action to the impersonation service', () => {
        sessionSignal.set({
            impersonatedBy: 'admin-uid',
            label: 'user@example.com'
        });
        fixture.detectChanges();

        const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement | null;
        button?.click();

        expect(impersonationServiceMock.returnToAdmin).toHaveBeenCalled();
    });
});
