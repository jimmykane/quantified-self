import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ServicesCorosComponent } from './services.coros.component';
import { ServiceSyncingStateComponent } from '../../shared/service-syncing-state/service-syncing-state.component';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { MatSnackBarModule, MatSnackBar } from '@angular/material/snack-bar';
import { RouterTestingModule } from '@angular/router/testing';
import { FormsModule } from '@angular/forms';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatChipsModule } from '@angular/material/chips';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatDialog } from '@angular/material/dialog';
import { AppFileService } from '../../../services/app.file.service';
import { Analytics } from 'app/firebase/analytics';
import { AppEventService } from '../../../services/app.event.service';
import { AppAuthService } from '../../../authentication/app.auth.service';
import { AppUserService } from '../../../services/app.user.service';
import { AppWindowService } from '../../../services/app.window.service';
import { LoggerService } from '../../../services/logger.service';
import { AppAnalyticsService } from '../../../services/app.analytics.service';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { of } from 'rxjs';
import { ACTIVITY_SYNC_ROUTE_IDS } from '@shared/activity-sync-routes';
import { ServiceConnectionStatusComponent } from '../service-connection-status/service-connection-status.component';
import { buildSuuntoServiceConnectionViewModel } from '../../../helpers/suunto-service-connection.helper';

describe('ServicesCorosComponent', () => {
    let component: ServicesCorosComponent;
    let fixture: ComponentFixture<ServicesCorosComponent>;
    let mockUserService: any;
    let mockAnalyticsService: any;
    let mockDialog: any;

    beforeEach(async () => {
        mockDialog = {
            open: vi.fn(() => ({
                afterClosed: () => of(true),
            })),
        };
        mockAnalyticsService = {
            logEvent: vi.fn(),
            logActivitySyncRouteToggle: vi.fn(),
            logActivitySyncRouteBackfill: vi.fn(),
        };
        mockUserService = {
            isAdmin: vi.fn(),
            requestAndSetCurrentUserCOROSAPIAccessToken: vi.fn(),
            checkCurrentUserCOROSBindingState: vi.fn().mockResolvedValue({ status: 'bound', bound: true }),
            getCurrentUserServiceTokenAndRedirectURI: vi.fn(),
            getServiceToken: vi.fn().mockReturnValue(of([])),
            watchSuuntoServiceConnectionView: vi.fn().mockReturnValue(of(buildSuuntoServiceConnectionViewModel({
                hasToken: false,
                serviceMeta: null,
            }))),
            getUserMetaForService: vi.fn().mockReturnValue(of(undefined)),
            updateUserProperties: vi.fn().mockResolvedValue(undefined),
            updateActivitySyncRouteSettings: vi.fn().mockResolvedValue(undefined),
            backfillActivitySyncRouteForCurrentUser: vi.fn().mockResolvedValue({ scanned: 0, queued: 0, skippedByReason: {}, failedCount: 0, failedEvents: [] }),
            deauthorizeService: vi.fn().mockResolvedValue(undefined),
        };

        await TestBed.configureTestingModule({
            declarations: [ServicesCorosComponent, ServiceSyncingStateComponent, ServiceConnectionStatusComponent],
            imports: [
                MatCardModule,
                MatIconModule,
                HttpClientTestingModule,
                MatSnackBarModule,
                RouterTestingModule,
                FormsModule,
                MatDatepickerModule,
                MatNativeDateModule,
                MatChipsModule,
                MatInputModule,
                MatFormFieldModule,
                MatSlideToggleModule,
                MatButtonModule,
                MatDividerModule,
                MatProgressBarModule,
                MatTabsModule,
            ],
            providers: [
                { provide: AppFileService, useValue: {} },
                { provide: Analytics, useValue: {} },
                { provide: AppEventService, useValue: {} },
                { provide: AppAuthService, useValue: { user$: { pipe: () => ({ subscribe: () => { } }) } } },
                { provide: AppUserService, useValue: mockUserService },
                { provide: AppWindowService, useValue: { currentDomain: 'http://localhost', windowRef: { location: { href: '' } } } },
                { provide: LoggerService, useValue: { error: vi.fn(), log: vi.fn() } },
                { provide: AppAnalyticsService, useValue: mockAnalyticsService },
                { provide: MatDialog, useValue: mockDialog },
            ],
            schemas: [CUSTOM_ELEMENTS_SCHEMA]
        }).compileComponents();
    });

    beforeEach(() => {
        fixture = TestBed.createComponent(ServicesCorosComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('renders connection status outside the provider tool tabs', () => {
        fixture.detectChanges();

        const connectionStatus = fixture.nativeElement.querySelector('.service-connection-status');
        const providerToolTabs = fixture.nativeElement.querySelector('.provider-tools-tabs');
        const providerToolPanel = fixture.nativeElement.querySelector('.provider-tools-panel');
        const providerTabs = fixture.nativeElement.querySelectorAll('a[mat-tab-link]');

        expect(connectionStatus).toBeTruthy();
        expect(connectionStatus.textContent).toContain('COROS');
        expect(providerToolTabs.tagName.toLowerCase()).toBe('nav');
        expect(fixture.nativeElement.querySelector('mat-tab-group')).toBeFalsy();
        expect(providerToolPanel).toBeTruthy();
        expect(providerTabs.length).toBe(2);
        expect(fixture.nativeElement.querySelector('.provider-tools-panel .service-connection-status')).toBeFalsy();
    });

    it('renders tools without repeating the connection summary when requested', () => {
        component.showConnectionSummary = false;
        fixture.detectChanges();

        const serviceContainer = fixture.nativeElement.querySelector('.service-container');

        expect(serviceContainer.classList).toContain('service-container--tools-only');
        expect(fixture.nativeElement.querySelector('.service-connection-status')).toBeFalsy();
        expect(fixture.nativeElement.querySelector('.connection-tools-divider')).toBeFalsy();
        expect(fixture.nativeElement.querySelector('.provider-tools-tabs')).toBeTruthy();
    });

    it('renders the selected tool directly without tab chrome in focused mode', () => {
        component.user = { uid: 'user-1', settings: {} } as any;
        component.activeProviderTool = 'auto-sync';
        component.showOnlyActiveProviderTool = true;
        fixture.detectChanges();

        const toolPanels = fixture.nativeElement.querySelectorAll('.provider-tool-panel');

        expect(fixture.nativeElement.querySelector('.provider-tools-tabs')).toBeNull();
        expect(fixture.nativeElement.querySelector('.provider-tools-panel')).toBeNull();
        expect(toolPanels).toHaveLength(1);
        expect(toolPanels[0].hidden).toBe(false);
        expect(toolPanels[0].classList).toContain('provider-tool-panel--focused');
        expect(toolPanels[0].querySelector('.activity-sync-destination-selector')).toBeTruthy();
        expect(toolPanels[0].textContent).toContain('To Wahoo');
        expect(toolPanels[0].querySelector('.tool-subsection-title')?.textContent)
            .toContain('Send COROS activities to Suunto');
        expect(toolPanels[0].textContent).toContain('Sending COROS activities to Suunto is a Pro feature.');
    });

    it('renders disconnect beside the connected account details', () => {
        component.hasProAccess = true;
        component.serviceTokens = [{
            accessToken: 'token',
            openId: 'coros-user',
            dateCreated: new Date('2026-05-03T10:00:00Z'),
        } as any];
        fixture.detectChanges();

        const accountRow = fixture.nativeElement.querySelector('.connection-account-row');

        expect(accountRow).toBeTruthy();
        expect(accountRow.textContent).toContain('coros-user');
        expect(accountRow.querySelector('.connected-account-list')).toBeTruthy();
        expect(accountRow.querySelector('.connected-account-title')?.textContent).toContain('coros-user');
        expect(accountRow.querySelector('.connected-account-line')?.textContent).toContain('Connected:');
        expect(accountRow.querySelector('.connected-account-line')?.textContent).toContain('Active account');
        expect(accountRow.querySelector('mat-list')).toBeFalsy();
        expect(accountRow.querySelector('.connection-disconnect-button')?.textContent).toContain('Disconnect');
        expect(fixture.nativeElement.querySelector('.service-connection-status__actions .connection-disconnect-button')).toBeFalsy();
    });

    it('checks the active COROS binding once when the connection summary is shown', async () => {
        component.user = { uid: 'user-1', settings: {} } as any;
        component.serviceTokens = [{ accessToken: 'token', openId: 'coros-user' }] as any;

        (component as any).onServiceDataChanged();
        (component as any).onServiceDataChanged();
        await Promise.resolve();

        expect(mockUserService.checkCurrentUserCOROSBindingState).toHaveBeenCalledTimes(1);
        expect(mockUserService.checkCurrentUserCOROSBindingState).toHaveBeenCalledWith('user-1', 'coros-user');
        expect(component.isCheckingCOROSBindingState).toBe(false);
        expect(component.corosBindingStateCheckError).toBe(false);
    });

    it('does not check binding state in the tools-only dialog or while reconnect is required', async () => {
        component.user = { uid: 'user-1', settings: {} } as any;
        component.serviceTokens = [{ accessToken: 'token', openId: 'coros-user' }] as any;
        component.showConnectionSummary = false;

        (component as any).onServiceDataChanged();
        await Promise.resolve();
        expect(mockUserService.checkCurrentUserCOROSBindingState).not.toHaveBeenCalled();

        component.showConnectionSummary = true;
        component.serviceMeta = { connectionState: 'reconnect_required' } as any;
        (component as any).onServiceDataChanged();
        await Promise.resolve();
        expect(mockUserService.checkCurrentUserCOROSBindingState).not.toHaveBeenCalled();
    });

    it('checks again after the same COROS account reconnects', async () => {
        component.user = { uid: 'user-1', settings: {} } as any;
        component.serviceTokens = [{ accessToken: 'token', openId: 'coros-user' }] as any;
        component.serviceMeta = { connectionState: 'connected', providerUserId: 'coros-user' } as any;

        (component as any).onServiceDataChanged();
        await Promise.resolve();
        component.serviceMeta = { connectionState: 'reconnect_required', providerUserId: 'coros-user' } as any;
        (component as any).onServiceDataChanged();
        component.serviceMeta = { connectionState: 'connected', providerUserId: 'coros-user' } as any;
        (component as any).onServiceDataChanged();
        await Promise.resolve();

        expect(mockUserService.checkCurrentUserCOROSBindingState).toHaveBeenCalledTimes(2);
    });

    it('shows a retry action when the binding check is temporarily unavailable', async () => {
        mockUserService.checkCurrentUserCOROSBindingState
            .mockRejectedValueOnce(new Error('temporarily unavailable'))
            .mockResolvedValueOnce({ status: 'bound', bound: true });
        component.user = { uid: 'user-1', settings: {} } as any;
        component.serviceTokens = [{ accessToken: 'token', openId: 'coros-user' }] as any;

        (component as any).onServiceDataChanged();
        await Promise.resolve();
        fixture.detectChanges();

        expect(component.corosBindingStateCheckError).toBe(true);
        expect(fixture.nativeElement.querySelector('.coros-binding-check--error')?.textContent)
            .toContain('Could not verify the COROS connection.');

        component.retryCOROSBindingStateCheck();
        await Promise.resolve();
        fixture.detectChanges();

        expect(mockUserService.checkCurrentUserCOROSBindingState).toHaveBeenCalledTimes(2);
        expect(component.corosBindingStateCheckError).toBe(false);
    });

    it('renders only the pinned active COROS account when legacy tokens remain', () => {
        component.hasProAccess = true;
        component.serviceMeta = { providerUserId: 'coros-active' } as any;
        component.serviceTokens = [
            {
                accessToken: 'old-token',
                openId: 'coros-old',
                dateCreated: 10,
                dateRefreshed: 10,
            },
            {
                accessToken: 'active-token',
                openId: 'coros-active',
                dateCreated: 20,
                dateRefreshed: 20,
            },
        ] as any;
        fixture.detectChanges();

        const accountItems = fixture.nativeElement.querySelectorAll('.connected-account-item');
        expect(accountItems).toHaveLength(1);
        expect(accountItems[0].textContent).toContain('coros-active');
        expect(accountItems[0].textContent).not.toContain('coros-old');
    });

    it('fails closed when the pinned COROS token is missing', () => {
        component.serviceMeta = { providerUserId: 'coros-missing' } as any;
        component.serviceTokens = [{ accessToken: 'token', openId: 'coros-other' }] as any;

        expect(component.activeCorosServiceToken).toBeUndefined();
        expect(component.isConnectedToService()).toBe(false);
    });

    it('does not treat preserved COROS tokens as connected while disconnect is pending', () => {
        component.serviceMeta = { connectionState: 'disconnect_pending' } as any;
        component.serviceTokens = [{
            accessToken: 'token',
            openId: 'coros-user',
        } as any];

        expect(component.isDisconnectPending).toBe(true);
        expect(component.isConnectedToService()).toBe(false);
        expect(component.connectionDescription).toContain('Disconnect is pending');
    });

    it('offers reconnect and blocks COROS tools when the preserved token requires reconnect', () => {
        component.hasProAccess = true;
        component.user = { uid: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2', settings: {} } as any;
        component.serviceMeta = { connectionState: 'reconnect_required' } as any;
        component.serviceTokens = [{
            accessToken: 'token',
            openId: 'coros-user',
        } as any];
        fixture.detectChanges();

        const content = fixture.nativeElement.textContent;
        const connectButton = fixture.nativeElement.querySelector('.qs-mat-primary');

        expect(component.isReconnectRequired).toBe(true);
        expect(component.isConnectedToService()).toBe(true);
        expect(component.shouldShowConnectAction).toBe(true);
        expect(component.connectButtonLabel).toBe('Reconnect');
        expect(component.connectionDescription).toContain('Reconnect COROS');
        expect(content).toContain('Reconnect required');
        expect(content).toContain('Reconnect COROS before importing history.');
        expect(content).toContain('Reconnect COROS before uploading activities.');
        expect(content).toContain('Reconnect COROS before uploading routes.');
        expect(connectButton?.textContent).toContain('Reconnect');
        expect(fixture.nativeElement.querySelector('app-history-import-form')).toBeFalsy();
        expect(fixture.nativeElement.querySelector('app-upload-activity-to-service')).toBeFalsy();
        expect(fixture.nativeElement.querySelector('app-upload-route-to-service')).toBeFalsy();
    });

    it('shows reconnect action instead of retry copy when pending disconnect needs manual review', () => {
        component.hasProAccess = false;
        component.user = { uid: 'user-1' } as any;
        component.serviceMeta = {
            connectionState: 'disconnect_pending',
            disconnectManualReviewRequired: true,
        } as any;
        component.serviceTokens = [{
            accessToken: 'token',
            openId: 'coros-user',
        } as any];
        fixture.detectChanges();

        const content = fixture.nativeElement.textContent;
        const connectButton = fixture.nativeElement.querySelector('.qs-mat-primary');

        expect(component.isDisconnectManualReviewRequired).toBe(true);
        expect(component.shouldShowConnectAction).toBe(true);
        expect(component.canConnectServiceWithCurrentAccess).toBe(true);
        expect(content).toContain('Reconnect COROS');
        expect(content).toContain('COROS disconnect retries have stopped');
        expect(content).not.toContain('retrying the COROS disconnect');
        expect(connectButton?.textContent).toContain('Reconnect');
        expect(connectButton?.disabled).toBe(false);
    });

    it('shows an enabled Pro plans action while keeping disconnect available without Pro', () => {
        component.hasProAccess = false;
        component.user = { uid: 'user-1' } as any;
        component.serviceTokens = [] as any;
        component.serviceMeta = null as any;
        fixture.detectChanges();

        const connectButton = fixture.nativeElement.querySelector('.qs-mat-primary');

        expect(component.canConnectServiceWithCurrentAccess).toBe(false);
        expect((component as any).canDisconnectWithoutProAccess).toBe(true);
        expect(connectButton?.textContent).toContain('View Pro plans');
        expect(connectButton?.disabled).toBe(false);
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

    describe('History Import Tab', () => {
        it('should be unlocked/available if user has pro access AND is connected', () => {
            component.hasProAccess = true;
            component.isAdmin = false;
            component.serviceTokens = [{ accessToken: 'token', openId: 'coros-user' } as any];
            fixture.detectChanges();

            const historyForm = fixture.nativeElement.querySelector('app-history-import-form');

            expect(historyForm).toBeTruthy();
        });

        it('should show connect message if user has pro access but is NOT connected', () => {
            component.hasProAccess = true;
            component.serviceTokens = [];
            fixture.detectChanges();

            const historyForm = fixture.nativeElement.querySelector('app-history-import-form');
            const content = fixture.nativeElement.textContent;

            expect(historyForm).toBeFalsy();
            expect(content).toContain('before importing history');
        });
    });

    describe('Upload Card', () => {
        it('shows direct activity and route uploads when COROS is connected', () => {
            component.hasProAccess = true;
            component.user = { uid: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2', settings: {} } as any;
            component.serviceTokens = [{ accessToken: 'coros-token', openId: 'coros-user' } as any];
            fixture.detectChanges();

            const uploadComponent = fixture.nativeElement.querySelector('app-upload-activity-to-service');
            const routeUploadComponent = fixture.nativeElement.querySelector('app-upload-route-to-service');
            const content = fixture.nativeElement.textContent;
            expect(uploadComponent).toBeTruthy();
            expect(routeUploadComponent).toBeTruthy();
            expect(content).toContain('Upload FIT Activity');
            expect(content).toContain('Upload GPX or FIT Route');
        });

        it('keeps activity upload visible while hiding route upload outside the COROS route pilot', () => {
            component.hasProAccess = true;
            component.user = { uid: 'not-in-coros-route-pilot', settings: {} } as any;
            component.serviceTokens = [{ accessToken: 'coros-token', openId: 'coros-user' } as any];
            fixture.detectChanges();

            expect(fixture.nativeElement.querySelector('app-upload-activity-to-service')).toBeTruthy();
            expect(fixture.nativeElement.querySelector('app-upload-route-to-service')).toBeFalsy();
            expect(fixture.nativeElement.textContent).not.toContain('Upload GPX or FIT Route');
        });
    });

    describe('Activity Sync Card', () => {
        it('should show route toggle when COROS and Suunto are connected', () => {
            component.hasProAccess = true;
            component.user = { uid: 'user-1', settings: {} } as any;
            component.serviceTokens = [{ accessToken: 'coros-token', openId: 'coros-user' }] as any;
            component.suuntoConnectionView = buildSuuntoServiceConnectionViewModel({ hasToken: true, serviceMeta: null });
            fixture.detectChanges();

            const routeToggle = fixture.nativeElement.querySelector('mat-slide-toggle');
            expect(routeToggle).toBeTruthy();
        });

        it('should persist COROS->Suunto route toggle to settings', async () => {
            component.hasProAccess = true;
            component.user = { uid: 'user-1', settings: {} } as any;
            component.serviceTokens = [{ accessToken: 'coros-token', openId: 'coros-user' }] as any;
            component.suuntoConnectionView = buildSuuntoServiceConnectionViewModel({ hasToken: true, serviceMeta: null });

            await component.onCorosToSuuntoRouteToggle(true);

            expect(mockUserService.updateActivitySyncRouteSettings).toHaveBeenCalledWith(component.user, {
                [ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_SuuntoApp]: true
            });
            expect(mockAnalyticsService.logActivitySyncRouteToggle).toHaveBeenCalledWith(
                ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_SuuntoApp,
                true
            );
        });

        it('should require both connections when enabling COROS->Suunto route', async () => {
            const snackBar = TestBed.inject(MatSnackBar);
            const snackBarSpy = vi.spyOn(snackBar, 'open');
            component.hasProAccess = true;
            component.user = { uid: 'user-1', settings: {} } as any;
            component.serviceTokens = [] as any;
            component.suuntoConnectionView = buildSuuntoServiceConnectionViewModel({ hasToken: true, serviceMeta: null });

            await component.onCorosToSuuntoRouteToggle(true);

            expect(mockUserService.updateActivitySyncRouteSettings).not.toHaveBeenCalled();
            expect(snackBarSpy).toHaveBeenCalledWith(
                'Connect COROS and Suunto before turning on automatic activity sync.',
                undefined,
                { duration: 4000 }
            );
        });

        it('should block enabling COROS->Suunto route when Suunto requires reconnect despite a token', async () => {
            const snackBar = TestBed.inject(MatSnackBar);
            const snackBarSpy = vi.spyOn(snackBar, 'open');
            component.hasProAccess = true;
            component.user = { uid: 'user-1', settings: {} } as any;
            component.serviceTokens = [{ accessToken: 'coros-token', openId: 'coros-user' }] as any;
            component.suuntoConnectionView = buildSuuntoServiceConnectionViewModel({
                hasToken: true,
                serviceMeta: { connectionState: 'reconnect_required' } as any,
            });

            await component.onCorosToSuuntoRouteToggle(true);

            expect(mockUserService.updateActivitySyncRouteSettings).not.toHaveBeenCalled();
            expect(snackBarSpy).toHaveBeenCalledWith(
                'Reconnect Suunto before turning on automatic activity sync.',
                undefined,
                { duration: 4000 }
            );
        });

        it('should block enabling COROS->Suunto route when COROS requires reconnect despite a token', async () => {
            const snackBar = TestBed.inject(MatSnackBar);
            const snackBarSpy = vi.spyOn(snackBar, 'open');
            component.hasProAccess = true;
            component.user = { uid: 'user-1', settings: {} } as any;
            component.serviceMeta = { connectionState: 'reconnect_required' } as any;
            component.serviceTokens = [{ accessToken: 'coros-token', openId: 'coros-user' }] as any;
            component.suuntoConnectionView = buildSuuntoServiceConnectionViewModel({ hasToken: true, serviceMeta: null });

            await component.onCorosToSuuntoRouteToggle(true);

            expect(mockUserService.updateActivitySyncRouteSettings).not.toHaveBeenCalled();
            expect(snackBarSpy).toHaveBeenCalledWith(
                'Reconnect COROS before turning on automatic activity sync.',
                undefined,
                { duration: 4000 }
            );
        });

        it('should allow disabling COROS->Suunto route when a service is disconnected', async () => {
            component.hasProAccess = true;
            component.user = {
                uid: 'user-1',
                settings: {
                    serviceSyncSettings: {
                        activitySyncRoutes: {
                            [ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_SuuntoApp]: { enabled: true }
                        }
                    }
                }
            } as any;
            component.serviceTokens = [] as any;
            component.suuntoConnectionView = buildSuuntoServiceConnectionViewModel({ hasToken: false, serviceMeta: null });

            await component.onCorosToSuuntoRouteToggle(false);

            expect(mockUserService.updateActivitySyncRouteSettings).toHaveBeenCalledWith(component.user, {
                [ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_SuuntoApp]: false
            });
            expect(mockAnalyticsService.logActivitySyncRouteToggle).toHaveBeenCalledWith(
                ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_SuuntoApp,
                false
            );
        });

        it('should allow manual catch-up when auto-sync toggle is disabled', () => {
            component.hasProAccess = true;
            component.user = { uid: 'user-1', settings: {} } as any;
            component.serviceTokens = [{ accessToken: 'coros-token', openId: 'coros-user' }] as any;
            component.suuntoConnectionView = buildSuuntoServiceConnectionViewModel({ hasToken: true, serviceMeta: null });
            component.isBackfillingSync = false;
            component.backfillStartDate = new Date('2026-01-01T00:00:00.000Z');
            component.backfillEndDate = new Date('2026-01-31T00:00:00.000Z');

            fixture.detectChanges();

            const queueButton = Array.from(fixture.nativeElement.querySelectorAll('button'))
                .find((button: HTMLButtonElement) => (button.textContent || '').includes('Schedule activities')) as HTMLButtonElement | undefined;

            expect(component.isCorosToSuuntoRouteEnabled).toBe(false);
            expect(queueButton).toBeTruthy();
            expect(queueButton?.disabled).toBe(false);
        });

        it('should show reconnect-required copy instead of route controls when Suunto requires reconnect', () => {
            component.hasProAccess = true;
            component.user = { uid: 'user-1', settings: {} } as any;
            component.serviceTokens = [{ accessToken: 'coros-token', openId: 'coros-user' }] as any;
            component.suuntoConnectionView = buildSuuntoServiceConnectionViewModel({
                hasToken: true,
                serviceMeta: { connectionState: 'reconnect_required' } as any,
            });

            fixture.detectChanges();

            expect(fixture.nativeElement.textContent).toContain('Reconnect Suunto before syncing COROS activities.');
            expect(fixture.nativeElement.querySelector('mat-slide-toggle')).toBeFalsy();
        });

        it('should show activity sync card for users outside the old rollout UID list', () => {
            component.hasProAccess = true;
            component.user = { uid: 'non-allowlisted-user', settings: {} } as any;
            fixture.detectChanges();

            expect(fixture.nativeElement.textContent).toContain('Send COROS activities to Suunto');
        });

        it('should render failed backfill events in the summary', () => {
            component.hasProAccess = true;
            component.user = { uid: 'user-1', settings: {} } as any;
            component.serviceTokens = [{ accessToken: 'coros-token', openId: 'coros-user' }] as any;
            component.suuntoConnectionView = buildSuuntoServiceConnectionViewModel({ hasToken: true, serviceMeta: null });
            component.backfillSummary = {
                scanned: 10,
                queued: 8,
                skippedByReason: {},
                failedCount: 1,
                failedEvents: [
                    {
                        eventID: 'event-123',
                        reason: 'event_processing_failed',
                        message: 'queue enqueue failed',
                    },
                ],
            };

            fixture.detectChanges();

            const content = fixture.nativeElement.textContent;
            expect(content).toContain('Could not schedule: 1');
            expect(content).toContain('event-123');
            expect(content).toContain('queue enqueue failed');
        });

        it('should explain that manual catch-up only uses already imported Quantified Self events', () => {
            component.hasProAccess = true;
            component.user = { uid: 'user-1', settings: {} } as any;
            component.serviceTokens = [{ accessToken: 'coros-token', openId: 'coros-user' }] as any;
            component.suuntoConnectionView = buildSuuntoServiceConnectionViewModel({ hasToken: true, serviceMeta: null });

            fixture.detectChanges();

            const infoBlock = fixture.nativeElement.querySelector('app-status-info[title="Choose which activities to send"]');
            const content = fixture.nativeElement.textContent;
            expect(infoBlock).toBeTruthy();
            expect(content).toContain('Choose a date range to send COROS activities already in Quantified Self to Suunto');
            expect(content).toContain('even when automatic activity sync is off');
        });

        it('should log route backfill analytics when catch-up succeeds', async () => {
            component.hasProAccess = true;
            component.user = { uid: 'user-1', settings: {} } as any;
            component.serviceTokens = [{ accessToken: 'coros-token', openId: 'coros-user' }] as any;
            component.suuntoConnectionView = buildSuuntoServiceConnectionViewModel({ hasToken: true, serviceMeta: null });
            mockUserService.backfillActivitySyncRouteForCurrentUser.mockResolvedValueOnce({
                scanned: 20,
                queued: 17,
                skippedByReason: {},
                failedCount: 1,
                failedEvents: [{ eventID: 'evt-1', reason: 'x', message: 'failed' }]
            });

            await component.runCorosToSuuntoBackfill(new Event('submit'));

            expect(mockAnalyticsService.logActivitySyncRouteBackfill).toHaveBeenCalledWith(
                ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_SuuntoApp,
                {
                    scanned: 20,
                    queued: 17,
                    failedCount: 1,
                }
            );
        });
    });

    it('should show inline warning pill when connected service is used by active route', () => {
        component.hasProAccess = true;
        component.user = {
            uid: 'u-1',
            settings: {
                serviceSyncSettings: {
                    activitySyncRoutes: {
                        [ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_SuuntoApp]: { enabled: true }
                    }
                }
            }
        } as any;
        component.serviceTokens = [{ accessToken: 'coros-token', openId: 'coros-user' }] as any;
        component.suuntoConnectionView = buildSuuntoServiceConnectionViewModel({ hasToken: true, serviceMeta: null });
        fixture.detectChanges();

        const warningPill = fixture.nativeElement.querySelector('.active-sync-warning-pill');
        expect(warningPill).toBeTruthy();
        expect((warningPill.textContent || '').trim()).toContain('Used by automatic sync');
    });

    it('should require confirmation before disconnect when active sync route would be disabled', async () => {
        component.hasProAccess = true;
        component.user = {
            uid: 'u-1',
            settings: {
                serviceSyncSettings: {
                    activitySyncRoutes: {
                        [ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_SuuntoApp]: { enabled: true }
                    }
                }
            }
        } as any;
        component.serviceTokens = [{ accessToken: 'coros-token', openId: 'coros-user' }] as any;
        component.suuntoConnectionView = buildSuuntoServiceConnectionViewModel({ hasToken: true, serviceMeta: null });
        mockDialog.open.mockReturnValueOnce({
            afterClosed: () => of(false),
        });

        await component.deauthorizeService(new MouseEvent('click'));

        expect(mockDialog.open).toHaveBeenCalled();
        expect(mockDialog.open).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                data: expect.objectContaining({
                    confirmLabel: 'Disconnect and disable sync',
                    cancelLabel: 'Keep connected',
                }),
            })
        );
        expect(mockUserService.deauthorizeService).not.toHaveBeenCalled();
    });
});
