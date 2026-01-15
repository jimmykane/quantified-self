
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ServicesGarminComponent } from './services.garmin.component';
import { ServiceSyncingStateComponent } from '../../shared/service-syncing-state/service-syncing-state.component';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { MatSnackBarModule, MatSnackBar } from '@angular/material/snack-bar';
import { RouterTestingModule } from '@angular/router/testing';
import { AppFileService } from '../../../services/app.file.service';
import { Analytics } from '@angular/fire/analytics';
import { AppEventService } from '../../../services/app.event.service';
import { AppAuthService } from '../../../authentication/app.auth.service';
import { AppUserService } from '../../../services/app.user.service';
import { AppWindowService } from '../../../services/app.window.service';
import { AppDeepLinkService } from '../../../services/app.deeplink.service';
import { LoggerService } from '../../../services/logger.service';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';

describe('ServicesGarminComponent', () => {
    let component: ServicesGarminComponent;
    let fixture: ComponentFixture<ServicesGarminComponent>;
    let mockUserService: any;

    beforeEach(async () => {
        mockUserService = {
            isAdmin: vi.fn(),
            requestAndSetCurrentUserGarminAccessToken: vi.fn(),
            getCurrentUserServiceTokenAndRedirectURI: vi.fn(),
        };

        await TestBed.configureTestingModule({
            declarations: [ServicesGarminComponent, ServiceSyncingStateComponent],
            imports: [
                MatCardModule,
                MatIconModule,
                HttpClientTestingModule,
                MatSnackBarModule,
                RouterTestingModule
            ],
            providers: [
                { provide: AppFileService, useValue: {} },
                { provide: Analytics, useValue: {} },
                { provide: AppEventService, useValue: {} },
                { provide: AppEventService, useValue: {} },
                { provide: AppAuthService, useValue: { user$: { pipe: () => ({ subscribe: () => { } }) } } },
                { provide: AppUserService, useValue: mockUserService },
                { provide: AppWindowService, useValue: { currentDomain: 'http://localhost', windowRef: { location: { href: '' } } } },
                { provide: AppDeepLinkService, useValue: { openGarminConnectApp: vi.fn() } },
                { provide: LoggerService, useValue: { error: vi.fn(), log: vi.fn() } }
            ],
            schemas: [CUSTOM_ELEMENTS_SCHEMA]
        }).compileComponents();
    });

    beforeEach(() => {
        fixture = TestBed.createComponent(ServicesGarminComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    describe('History Import Card', () => {
        it('should be locked via PRO badge if user has no pro access', () => {
            component.hasProAccess = false;
            component.isAdmin = false;
            fixture.detectChanges();

            const card = fixture.nativeElement.querySelectorAll('.feature-card')[1]; // Second card is History Import
            const lockOverlay = card.querySelector('.lock-overlay');
            const badge = card.querySelector('.pro-badge');

            expect(card.classList).toContain('locked');
            expect(lockOverlay).toBeTruthy();
            expect(badge.textContent.trim()).toBe('PRO');
            expect(card.classList).not.toContain('coming-soon');
        });

        it('should be locked via COMING SOON badge if user has pro access but is not admin', () => {
            component.hasProAccess = true;
            component.isAdmin = false;
            fixture.detectChanges();

            const card = fixture.nativeElement.querySelectorAll('.feature-card')[1];
            const lockOverlay = card.querySelector('.lock-overlay');
            const badge = card.querySelector('.pro-badge');

            expect(card.classList).toContain('locked');
            expect(lockOverlay).toBeTruthy();
            expect(badge.textContent.trim()).toBe('COMING SOON');
            expect(card.classList).toContain('coming-soon');
        });

        it('should be unlocked if user has pro access and is admin', () => {
            component.hasProAccess = true;
            component.isAdmin = true;
            fixture.detectChanges();

            const card = fixture.nativeElement.querySelectorAll('.feature-card')[1];
            const lockOverlay = card.querySelector('.lock-overlay');

            expect(card.classList).toContain('unlocked');
            expect(lockOverlay).toBeFalsy();
        });
    });

    describe('Connection Logic', () => {
        it('should display partner-specific message on 502 error', async () => {
            const snackBar = TestBed.inject(MatSnackBar);
            const snackBarSpy = vi.spyOn(snackBar, 'open');

            // Mock 502 error
            const error502 = { status: 502, message: 'Bad Gateway' };
            mockUserService.getCurrentUserServiceTokenAndRedirectURI.mockRejectedValue(error502);

            component.hasProAccess = true; // Ensure connection logic proceeds
            fixture.detectChanges();

            // Execute the connection logic (inherited from abstract directive)
            await component.connectWithService(new MouseEvent('click'));

            expect(snackBarSpy).toHaveBeenCalledWith(
                'Garmin is temporarily unavailable. Please try again later.',
                undefined,
                expect.objectContaining({ duration: 5000 })
            );
        });

        it('should show syncing state when forceConnected is true but tokens are not yet loaded', () => {
            component.forceConnected = true;
            component.serviceTokens = undefined;
            component.hasProAccess = true;
            fixture.detectChanges();

            const syncingText = fixture.nativeElement.textContent;
            expect(syncingText).toContain('Syncing connection details...');

            // Should NOT show the account circle icon (part of the connected list)
            const accountIcon = fixture.nativeElement.querySelector('mat-icon[matListItemIcon]');
            expect(accountIcon).toBeFalsy();
        });

        it('should show syncing state when tokens are loaded but permissions are missing from the token', () => {
            // Mock token without permissions array
            component.serviceTokens = [{
                accessToken: 'test-token',
                userID: 'test-user-123',
                // permissions property missing
            } as any];
            component.hasProAccess = true;
            fixture.detectChanges();

            // Verify syncing state
            const syncingText = fixture.nativeElement.textContent;
            expect(syncingText).toContain('Syncing connection details...');

            // Verify connected list is NOT shown
            const accountIcon = fixture.nativeElement.querySelector('mat-icon[matListItemIcon]');
            expect(accountIcon).toBeFalsy();
        });
    });
});
