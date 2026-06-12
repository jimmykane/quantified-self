
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ServicesSuuntoComponent } from './services.suunto.component';
import { ServiceSyncingStateComponent } from '../../shared/service-syncing-state/service-syncing-state.component';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
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
import { ServiceConnectionStatusComponent } from '../service-connection-status/service-connection-status.component';

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
            addSuuntoRoutesToQueueForCurrentUser: vi.fn().mockResolvedValue({
                queuedCount: 2,
                skippedCount: 1,
                failureCount: 0,
                totalCount: 3,
            }),
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
            declarations: [ServicesSuuntoComponent, ServiceSyncingStateComponent, ServiceConnectionStatusComponent],
            imports: [
                MatCardModule,
                MatChipsModule,
                MatDividerModule,
                MatIconModule,
                HttpClientTestingModule,
                MatProgressBarModule,
                MatSnackBarModule,
                MatTabsModule,
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

        const accountIcon = fixture.nativeElement.querySelector('.connected-account-icon');
        expect(accountIcon).toBeFalsy();
    });

    it('renders connection status outside the provider tool tabs', () => {
        fixture.detectChanges();

        const connectionStatus = fixture.nativeElement.querySelector('.service-connection-status');
        const providerToolTabs = fixture.nativeElement.querySelector('.provider-tools-tabs');
        const providerToolPanel = fixture.nativeElement.querySelector('.provider-tools-panel');
        const providerTabs = fixture.nativeElement.querySelectorAll('a[mat-tab-link]');

        expect(connectionStatus).toBeTruthy();
        expect(connectionStatus.textContent).toContain('Suunto App connection');
        expect(providerToolTabs.tagName.toLowerCase()).toBe('nav');
        expect(fixture.nativeElement.querySelector('mat-tab-group')).toBeFalsy();
        expect(providerToolPanel).toBeTruthy();
        expect(providerTabs.length).toBe(3);
        expect(fixture.nativeElement.querySelector('.provider-tools-panel .service-connection-status')).toBeFalsy();
    });

    it('hides inactive provider tool panels when switching tabs', () => {
        component.hasProAccess = true;
        component.serviceTokens = [{ accessToken: 'token', userName: 'suunto-user' } as any];
        fixture.detectChanges();

        const tabs = fixture.nativeElement.querySelectorAll('a[mat-tab-link]');
        const panels = fixture.nativeElement.querySelectorAll('.provider-tool-panel');

        expect(panels.length).toBe(3);
        expect(panels[0].hidden).toBe(false);
        expect(panels[1].hidden).toBe(true);
        expect(getComputedStyle(panels[1]).display).toBe('none');

        tabs[1].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        fixture.detectChanges();

        expect(component.activeProviderTool).toBe('routes');
        expect(panels[0].hidden).toBe(true);
        expect(getComputedStyle(panels[0]).display).toBe('none');
        expect(panels[1].hidden).toBe(false);
        expect(panels[1].textContent).toContain('Suunto Route Import');

        tabs[2].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        fixture.detectChanges();

        expect(component.activeProviderTool).toBe('uploads');
        expect(panels[1].hidden).toBe(true);
        expect(panels[2].hidden).toBe(false);
        expect(panels[2].textContent).toContain('Upload FIT Activity');
    });

    it('renders disconnect beside the connected account details', () => {
        component.hasProAccess = true;
        component.serviceTokens = [{
            accessToken: 'token',
            userName: 'suunto-user',
            dateCreated: new Date('2026-05-03T10:00:00Z'),
        } as any];
        fixture.detectChanges();

        const accountRow = fixture.nativeElement.querySelector('.connection-account-row');

        expect(accountRow).toBeTruthy();
        expect(accountRow.textContent).toContain('suunto-user');
        expect(accountRow.querySelector('.connected-account-list')).toBeTruthy();
        expect(accountRow.querySelector('.connected-account-title')?.textContent).toContain('suunto-user');
        expect(accountRow.querySelector('.connected-account-line')?.textContent).toContain('Connected:');
        expect(accountRow.querySelector('mat-list')).toBeFalsy();
        expect(accountRow.querySelector('.connection-disconnect-button')?.textContent).toContain('Disconnect');
        expect(fixture.nativeElement.querySelector('.service-connection-status__actions .connection-disconnect-button')).toBeFalsy();
    });

    it('renders reconnect-required state when Suunto must be reconnected', () => {
        component.hasProAccess = true;
        component.serviceTokens = [];
        component.serviceMeta = {
            connectionState: 'reconnect_required',
            lastAuthFailureMessage: 'User no longer active/connected with the partner',
        } as any;
        fixture.detectChanges();

        const content = fixture.nativeElement.textContent;
        const banner = fixture.nativeElement.querySelector('.reconnect-required-banner');

        expect(content).toContain('Reconnect required');
        expect(content).toContain('Suunto needs to be reconnected');
        expect(content).toContain('User no longer active/connected with the partner');
        expect(fixture.nativeElement.querySelector('.service-connection-status--attention')).toBeTruthy();
        expect(banner).toBeTruthy();
        expect(fixture.nativeElement.querySelector('.qs-mat-primary')?.textContent).toContain('Reconnect');
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

        it('should keep history import locked when reconnect is required even if a stale token remains', () => {
            component.hasProAccess = true;
            component.serviceTokens = [{ accessToken: 'stale-token' } as any];
            component.serviceMeta = {
                connectionState: 'reconnect_required',
                lastAuthFailureMessage: 'Reconnect before importing history.',
            } as any;
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

        it('should hide upload actions when reconnect is required even if a stale token remains', () => {
            component.hasProAccess = true;
            component.serviceTokens = [{ accessToken: 'stale-token' } as any];
            component.serviceMeta = {
                connectionState: 'reconnect_required',
                lastAuthFailureMessage: 'Reconnect before uploading.',
            } as any;
            fixture.detectChanges();

            const content = fixture.nativeElement.textContent;

            expect(fixture.nativeElement.querySelector('app-upload-activity-to-service')).toBeFalsy();
            expect(fixture.nativeElement.querySelector('app-upload-route-to-service')).toBeFalsy();
            expect(content).toContain('before uploading activities');
            expect(content).toContain('before uploading routes');
        });
    });

    describe('Route Sync Tab', () => {
        it('should render route sync controls when pro user is connected', () => {
            component.hasProAccess = true;
            component.serviceTokens = [{ accessToken: 'token', userName: 'suunto-user' } as any];
            component.activeProviderTool = 'routes';
            fixture.detectChanges();

            const content = fixture.nativeElement.textContent;
            expect(content).toContain('Suunto Route Import');
            expect(content).toContain('Queue all current routes');
        });

        it('does not show legacy global route catch-up completion when connected accounts lack provider-scoped state', () => {
            component.hasProAccess = true;
            component.serviceTokens = [{ accessToken: 'token', userName: 'suunto-user' } as any];
            component.serviceMeta = {
                didLastRouteImport: 1710000000000,
            } as any;
            component.activeProviderTool = 'routes';
            fixture.detectChanges();

            expect(component.didLastRouteImport).toBeNull();
        });

        it('treats a same-account reconnect as incomplete until the new source key completes', () => {
            component.hasProAccess = true;
            component.serviceTokens = [{
                accessToken: 'token',
                userName: 'suunto-user',
                dateCreated: 1711000000000,
            } as any];
            component.serviceMeta = {
                didLastRouteImport: 1710000000000,
                routeImportStatesByProviderSourceKey: [
                    {
                        sourceKey: 'suunto-user:1710000000000',
                        providerUserId: 'suunto-user',
                        didLastRouteImport: 1710000000000,
                    },
                ],
            } as any;
            component.activeProviderTool = 'routes';
            fixture.detectChanges();

            expect(component.didLastRouteImport).toBeNull();
        });

        it('queues Suunto routes from the services page', async () => {
            component.hasProAccess = true;
            component.serviceTokens = [{ accessToken: 'token', userName: 'suunto-user' } as any];

            await component.queueRoutesFromSuunto(new MouseEvent('click'));

            expect(mockUserService.addSuuntoRoutesToQueueForCurrentUser).toHaveBeenCalled();
            expect(mockSnackBar.open).toHaveBeenCalledWith('Queued 2 routes. Skipped 1.', undefined, { duration: 3500 });
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
