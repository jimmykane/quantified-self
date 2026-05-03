
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ServicesSuuntoComponent } from './services.suunto.component';
import { ServiceSyncingStateComponent } from '../../shared/service-syncing-state/service-syncing-state.component';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterTestingModule } from '@angular/router/testing';
import { MatDialog } from '@angular/material/dialog';
import { Analytics } from 'app/firebase/analytics';
import { AppEventService } from '../../../services/app.event.service';
import { AppAuthService } from '../../../authentication/app.auth.service';
import { AppUserService } from '../../../services/app.user.service';
import { AppWindowService } from '../../../services/app.window.service';
import { LoggerService } from '../../../services/logger.service';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { of } from 'rxjs';
import { ACTIVITY_SYNC_ROUTE_IDS } from '@shared/activity-sync-routes';

describe('ServicesSuuntoComponent', () => {
    let component: ServicesSuuntoComponent;
    let fixture: ComponentFixture<ServicesSuuntoComponent>;
    let mockUserService: any;
    let mockEventService: any;
    let mockSnackBar: any;
    let mockDialog: any;

    beforeEach(async () => {
        mockUserService = {
            isAdmin: vi.fn(),
            requestAndSetCurrentUserSuuntoAppAccessToken: vi.fn(),
            getCurrentUserServiceTokenAndRedirectURI: vi.fn(),
            deauthorizeService: vi.fn().mockResolvedValue(undefined),
        };
        mockEventService = {
        };
        mockSnackBar = {
            open: vi.fn(),
        };
        mockDialog = {
            open: vi.fn(() => ({
                afterClosed: () => of(true),
            })),
        };

        await TestBed.configureTestingModule({
            declarations: [ServicesSuuntoComponent, ServiceSyncingStateComponent],
            imports: [
                MatCardModule,
                MatIconModule,
                HttpClientTestingModule,
                MatSnackBarModule,
                RouterTestingModule
            ],
            providers: [
                { provide: Analytics, useValue: {} },
                { provide: AppEventService, useValue: mockEventService },
                { provide: AppAuthService, useValue: { user$: { pipe: () => ({ subscribe: () => { } }) } } },
                { provide: AppUserService, useValue: mockUserService },
                { provide: AppWindowService, useValue: { currentDomain: 'http://localhost', windowRef: { location: { href: '' } } } },
                { provide: LoggerService, useValue: { error: vi.fn(), log: vi.fn() } },
                { provide: MatSnackBar, useValue: mockSnackBar },
                { provide: MatDialog, useValue: mockDialog },
            ],
            schemas: [CUSTOM_ELEMENTS_SCHEMA]
        }).compileComponents();
    });

    beforeEach(() => {
        fixture = TestBed.createComponent(ServicesSuuntoComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should show syncing state when forceConnected is true but tokens are not yet loaded', () => {
        component.forceConnected = true;
        component.serviceTokens = undefined;
        component.hasProAccess = true;
        fixture.detectChanges();

        const syncingText = fixture.nativeElement.textContent;
        expect(syncingText).toContain('Syncing connection details...');

        const accountIcon = fixture.nativeElement.querySelector('mat-icon[matListItemIcon]');
        expect(accountIcon).toBeFalsy();
    });

    it('renders connection status outside the provider tool tabs', () => {
        fixture.detectChanges();

        const connectionStatus = fixture.nativeElement.querySelector('.connection-status-panel');
        const providerTabs = fixture.nativeElement.querySelectorAll('mat-tab');

        expect(connectionStatus).toBeTruthy();
        expect(connectionStatus.textContent).toContain('Manage your Suunto connection');
        expect(providerTabs.length).toBe(2);
        expect(fixture.nativeElement.querySelector('mat-tab .connection-status-panel')).toBeFalsy();
    });

    describe('History Import Tab', () => {
        it('should be unlocked/available if user has pro access AND is connected', () => {
            component.hasProAccess = true;
            component.isAdmin = false;
            component.serviceTokens = [{ accessToken: 'token' } as any];
            fixture.detectChanges();

            const historyForm = fixture.nativeElement.querySelector('app-history-import-form');

            expect(historyForm).toBeTruthy();
        });

        it('should show connect message if user has pro access but is NOT connected', () => {
            component.hasProAccess = true;
            component.serviceTokens = []; // Not connected
            fixture.detectChanges();

            const historyForm = fixture.nativeElement.querySelector('app-history-import-form');
            const content = fixture.nativeElement.textContent;

            expect(historyForm).toBeFalsy();
            expect(content).toContain('before importing history');
        });
    });

    describe('Uploads Tab', () => {
        it('should hide upload actions and show connect-first messaging when pro user is not connected', () => {
            component.hasProAccess = true;
            component.serviceTokens = [];
            fixture.detectChanges();

            const content = fixture.nativeElement.textContent;

            expect(fixture.nativeElement.querySelector('app-upload-activity-to-service')).toBeFalsy();
            expect(fixture.nativeElement.querySelector('app-upload-route-to-service')).toBeFalsy();
            expect(content).toContain('before uploading activities');
            expect(content).toContain('before uploading routes');
        });

        it('should render upload actions when pro user is connected', () => {
            component.hasProAccess = true;
            component.serviceTokens = [{ accessToken: 'token' } as any];
            fixture.detectChanges();

            expect(fixture.nativeElement.querySelector('app-upload-activity-to-service')).toBeTruthy();
            expect(fixture.nativeElement.querySelector('app-upload-route-to-service')).toBeTruthy();
        });
    });

    it('should show inline warning pill when connected service is used by active route', () => {
        component.hasProAccess = true;
        component.user = {
            uid: 'u-1',
            settings: {
                serviceSyncSettings: {
                    activitySyncRoutes: {
                        [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: { enabled: true }
                    }
                }
            }
        } as any;
        component.serviceTokens = [{ accessToken: 'token' } as any];
        fixture.detectChanges();

        const warningPill = fixture.nativeElement.querySelector('.active-sync-warning-pill');
        expect(warningPill).toBeTruthy();
        expect((warningPill.textContent || '').trim()).toContain('Used by active auto-sync route');
    });

    it('should ask for confirmation before disconnect when active route depends on Suunto', async () => {
        component.hasProAccess = true;
        component.user = {
            uid: 'u-1',
            settings: {
                serviceSyncSettings: {
                    activitySyncRoutes: {
                        [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: { enabled: true }
                    }
                }
            }
        } as any;
        component.serviceTokens = [{ accessToken: 'token' } as any];
        mockDialog.open.mockReturnValueOnce({
            afterClosed: () => of(false),
        });

        await component.deauthorizeService(new MouseEvent('click'));

        expect(mockDialog.open).toHaveBeenCalled();
        expect(mockUserService.deauthorizeService).not.toHaveBeenCalled();
    });
});
