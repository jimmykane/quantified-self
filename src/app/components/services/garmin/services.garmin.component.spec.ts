
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ServicesGarminComponent } from './services.garmin.component';
import { GarminPermissionsComponent } from './garmin-permissions.component';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { HapticTapDirective } from '../../../directives/haptic-tap.directive';
import { MatIconTestingModule } from '@angular/material/icon/testing';
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
import { AppDeepLinkService } from '../../../services/app.deeplink.service';
import { LoggerService } from '../../../services/logger.service';
import { AppAnalyticsService } from '../../../services/app.analytics.service';
import { ActivatedRoute, Router } from '@angular/router';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { of, Subject } from 'rxjs';
import { ACTIVITY_SYNC_ROUTE_IDS } from '@shared/activity-sync-routes';
import { ServiceConnectionStatusComponent } from '../service-connection-status/service-connection-status.component';
import { buildSuuntoServiceConnectionViewModel } from '../../../helpers/suunto-service-connection.helper';

const ACTIVITY_SYNC_ALLOWLISTED_UID = 'test-user-uid';

describe('ServicesGarminComponent', () => {
    let component: ServicesGarminComponent;
    let fixture: ComponentFixture<ServicesGarminComponent>;
    let mockUserService: any;
    let mockAnalyticsService: any;
    let mockRouter: any;
    let mockDialog: any;
    let queryParams: Record<string, string | null>;
    let mockActivatedRoute: any;
    let haptics: { selection: ReturnType<typeof vi.fn>; success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
        haptics = { selection: vi.fn(), success: vi.fn(), error: vi.fn() };
        queryParams = {};
        mockActivatedRoute = {
            snapshot: {
                queryParamMap: {
                    get: vi.fn((key: string) => queryParams[key] ?? null)
                }
            }
        };
        mockActivatedRoute.queryParamMap = of(mockActivatedRoute.snapshot.queryParamMap);
        mockRouter = {
            navigate: vi.fn().mockResolvedValue(true),
            events: of({}),
            createUrlTree: vi.fn((commands: unknown[], extras?: { fragment?: string }) => ({
                commands,
                fragment: extras?.fragment ?? null,
            })),
            serializeUrl: vi.fn((urlTree: { commands?: unknown[]; fragment?: string | null }) => {
                const segments = (urlTree.commands ?? []).map(segment => `${segment}`.replace(/^\/+/, ''));
                const path = `/${segments.join('/')}`.replace(/\/+/g, '/');
                return urlTree.fragment ? `${path}#${urlTree.fragment}` : path;
            }),
        };
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
            user: vi.fn(() => ({ uid: 'test-user-uid' })),
            isAdmin: vi.fn(),
            requestAndSetCurrentUserGarminAPIAccessToken: vi.fn(),
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
            declarations: [ServicesGarminComponent, ServiceSyncingStateComponent, ServiceConnectionStatusComponent, HapticTapDirective],
            imports: [
                GarminPermissionsComponent,
                MatIconTestingModule,
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
                { provide: AppEventService, useValue: {} },
                { provide: AppAuthService, useValue: { user$: { pipe: () => ({ subscribe: () => { } }) } } },
                { provide: AppUserService, useValue: mockUserService },
                { provide: AppHapticsService, useValue: haptics },
                { provide: AppWindowService, useValue: { currentDomain: 'http://localhost', windowRef: { location: { href: '' } } } },
                { provide: AppDeepLinkService, useValue: { openGarminConnectApp: vi.fn() } },
                { provide: LoggerService, useValue: { error: vi.fn(), log: vi.fn() } },
                { provide: AppAnalyticsService, useValue: mockAnalyticsService },
                { provide: ActivatedRoute, useValue: mockActivatedRoute },
                { provide: Router, useValue: mockRouter },
                { provide: MatDialog, useValue: mockDialog }
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

    it('explains Training permission without promising public availability or automatic delivery', () => {
        expect(component.permissionExplanations['WORKOUT_IMPORT']).toBe(
            'Send planned workouts when available for your account. Requires explicit opt-in.');
    });

    describe('Permission management', () => {
        beforeEach(() => {
            fixture.componentRef.setInput('user', { uid: 'owner', settings: {} });
            fixture.componentRef.setInput('hasProAccess', true);
            fixture.detectChanges();
            component.serviceMeta = { connectionState: 'connected' } as typeof component.serviceMeta;
            component.serviceTokens = [{ providerUserId: 'garmin-account', permissions: ['ACTIVITY_EXPORT'] }];
            fixture.detectChanges();
        });

        it('shows permissions and management without Reconnect for a healthy connection', () => {
            expect(fixture.nativeElement.querySelectorAll('app-compact-row')).toHaveLength(5);
            expect(fixture.nativeElement.querySelector('.qs-mat-primary')).toBeNull();
            expect(fixture.nativeElement.textContent).not.toContain('Reconnect');
            expect(fixture.nativeElement.textContent).toContain('Manage in Garmin');
            expect(component.isConnectedToService()).toBe(true);
            expect(component.isReconnectRequired).toBe(false);
            expect(haptics.selection).not.toHaveBeenCalled();
            expect(mockUserService.getCurrentUserServiceTokenAndRedirectURI).not.toHaveBeenCalled();
            expect(mockUserService.deauthorizeService).not.toHaveBeenCalled();
        });

        it('opens Garmin permission management with one haptic and no local grant write', () => {
            const button = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
                .find(item => item.textContent?.includes('Manage in Garmin'))!;
            button.click();
            expect(TestBed.inject(AppDeepLinkService).openGarminConnectApp).toHaveBeenCalledOnce();
            expect(haptics.selection).toHaveBeenCalledOnce();
            expect(haptics.success).not.toHaveBeenCalled();
            expect(mockUserService.updateUserProperties).not.toHaveBeenCalled();
            expect(mockUserService.deauthorizeService).not.toHaveBeenCalled();
        });

        it('reuses OAuth without disconnecting and suppresses duplicate Reconnect clicks while pending', async () => {
            component.serviceMeta = { connectionState: 'reconnect_required' } as typeof component.serviceMeta;
            fixture.detectChanges();
            let resolve!: (value: { redirect_uri: string }) => void;
            mockUserService.getCurrentUserServiceTokenAndRedirectURI.mockReturnValue(new Promise(value => { resolve = value; }));
            const button = fixture.nativeElement.querySelector('.qs-mat-primary') as HTMLButtonElement;
            button.click(); fixture.detectChanges(); button.click();
            expect(button.disabled).toBe(true);
            expect(fixture.nativeElement.querySelector('.connection-disconnect-button')?.disabled).toBe(true);
            expect(button.textContent).toContain('Connecting');
            expect(mockUserService.getCurrentUserServiceTokenAndRedirectURI).toHaveBeenCalledOnce();
            resolve({ redirect_uri: 'https://example.test/garmin-authorize' }); await fixture.whenStable();
            expect(TestBed.inject(AppWindowService).windowRef.location.href).toBe('https://example.test/garmin-authorize');
            expect(haptics.selection).toHaveBeenCalledOnce();
            expect(haptics.success).not.toHaveBeenCalled();
            expect(mockUserService.deauthorizeService).not.toHaveBeenCalled();
            expect(mockUserService.updateActivitySyncRouteSettings).not.toHaveBeenCalled();
        });

        it('keeps management readable without Pro while gating reauthorization', async () => {
            component.hasProAccess = false; fixture.detectChanges();
            expect(fixture.nativeElement.querySelectorAll('app-compact-row')).toHaveLength(5);
            const manage = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
                .find(item => item.textContent?.includes('Manage in Garmin'))!;
            expect(manage.disabled).toBe(false);
            expect(fixture.nativeElement.querySelector('.qs-mat-primary')).toBeNull();
            component.serviceMeta = { connectionState: 'reconnect_required' } as typeof component.serviceMeta;
            fixture.detectChanges();
            expect(fixture.nativeElement.querySelector('.qs-mat-primary')?.textContent).toContain('View Pro plans');
            await component.connectWithService(new Event('click'));
            expect(mockUserService.getCurrentUserServiceTokenAndRedirectURI).not.toHaveBeenCalled();
        });

        it('shows a retryable OAuth failure with one error haptic and leaves grants unchanged', async () => {
            component.serviceMeta = { connectionState: 'reconnect_required' } as typeof component.serviceMeta;
            mockUserService.getCurrentUserServiceTokenAndRedirectURI.mockRejectedValue(new Error('Unavailable'));
            const before = component.serviceTokens;
            await component.connectWithService(new Event('click')); fixture.detectChanges();
            expect(component.isConnecting).toBe(false);
            expect(fixture.nativeElement.querySelector('.qs-mat-primary')?.textContent).toContain('Reconnect');
            expect(component.serviceTokens).toEqual(before);
            expect(haptics.selection).toHaveBeenCalledOnce(); expect(haptics.error).toHaveBeenCalledOnce();
            expect(haptics.success).not.toHaveBeenCalled();
        });

        it('does not turn missing or unknown permissions into a reconnect action', () => {
            component.user = { uid: ACTIVITY_SYNC_ALLOWLISTED_UID, settings: {} } as typeof component.user;
            for (const permissions of [[], undefined]) {
                component.serviceTokens = [{ providerUserId: 'garmin-account', ...(permissions ? { permissions } : {}) }];
                fixture.detectChanges();
                expect(component.shouldShowConnectAction).toBe(false);
                expect(fixture.nativeElement.querySelector('.qs-mat-primary')).toBeNull();
                expect(fixture.nativeElement.textContent).not.toContain('Reconnect');
            }
        });

        it('keeps Connect available after disconnection', () => {
            component.serviceTokens = [];
            component.serviceMeta = undefined;
            fixture.detectChanges();
            expect(component.shouldShowConnectAction).toBe(true);
            expect(component.connectButtonLabel).toBe('Connect');
            expect(fixture.nativeElement.querySelector('.qs-mat-primary')?.textContent).toContain('Connect');
        });

        it('does not overlap a pending disconnect with permission management or ordinary reconnect', () => {
            component.serviceMeta = { connectionState: 'disconnect_pending' } as typeof component.serviceMeta;
            fixture.detectChanges();
            expect(component.shouldShowConnectAction).toBe(false);
            const manage = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
                .find(item => item.textContent?.includes('Manage in Garmin'))!;
            expect(manage.disabled).toBe(true); component.openGarminConnectApp();
            expect(haptics.selection).not.toHaveBeenCalled();
            expect(TestBed.inject(AppDeepLinkService).openGarminConnectApp).not.toHaveBeenCalled();
        });
    });

    describe('Connection view lifecycle', () => {
        beforeEach(() => {
            fixture.componentRef.setInput('user', { uid: 'original-owner', settings: {} });
            fixture.componentRef.setInput('hasProAccess', true);
            fixture.detectChanges();
        });

        it('does not restart secondary listeners after teardown during initialization', async () => {
            mockUserService.watchSuuntoServiceConnectionView.mockClear();
            const pending = component.ngOnChanges();
            fixture.destroy();
            await pending;
            expect(mockUserService.watchSuuntoServiceConnectionView).not.toHaveBeenCalled();
        });

        it('clears account details and pending UI state immediately on sign-out', () => {
            component.serviceTokens = [{ providerUserId: 'private-account', permissions: ['WORKOUT_IMPORT'] }];
            component.serviceMeta = { connectionState: 'connected' } as typeof component.serviceMeta;
            component.forceConnected = true;
            component.isConnecting = true;
            fixture.detectChanges();
            fixture.componentRef.setInput('user', undefined);
            fixture.detectChanges();
            expect(component.serviceTokens).toBeUndefined();
            expect(component.serviceMeta).toBeUndefined();
            expect(component.forceConnected).toBe(false);
            expect(component.isConnecting).toBe(false);
            expect(fixture.nativeElement.textContent).not.toContain('private-account');
        });

        it.each(['account switch', 'destroy'])('discards a pending OAuth redirect after %s', async change => {
            let resolve!: (value: { redirect_uri: string }) => void;
            mockUserService.getCurrentUserServiceTokenAndRedirectURI.mockReturnValue(new Promise(value => { resolve = value; }));
            const pending = component.connectWithService(new Event('click'));
            if (change === 'destroy') fixture.destroy();
            else {
                fixture.componentRef.setInput('user', { uid: 'next-owner', settings: {} });
                fixture.detectChanges();
            }
            resolve({ redirect_uri: 'https://example.test/stale-authorization' });
            await pending;
            expect(TestBed.inject(AppWindowService).windowRef.location.href).toBe('');
            expect(haptics.success).not.toHaveBeenCalled();
            expect(haptics.error).not.toHaveBeenCalled();
        });

        it('does not let a stale OAuth failure clear a newer account request', async () => {
            let reject!: (reason: Error) => void;
            mockUserService.getCurrentUserServiceTokenAndRedirectURI.mockReturnValue(new Promise((_resolve, fail) => { reject = fail; }));
            const pending = component.connectWithService(new Event('click'));
            fixture.componentRef.setInput('user', { uid: 'next-owner', settings: {} }); fixture.detectChanges();
            component.isConnecting = true;
            reject(new Error('old account failure')); await pending;
            expect(component.isConnecting).toBe(true);
            expect(haptics.error).not.toHaveBeenCalled();
        });

        it('drops OAuth callback feedback and navigation after the view is destroyed', async () => {
            let resolve!: (value: { connected: true; outcome: 'connected' }) => void;
            mockUserService.requestAndSetCurrentUserGarminAPIAccessToken.mockReturnValue(new Promise(value => { resolve = value; }));
            queryParams = { serviceName: component.serviceName, state: 'test-state', code: 'test-code' };
            await component.ngOnChanges();
            fixture.destroy();
            resolve({ connected: true, outcome: 'connected' });
            await Promise.resolve(); await Promise.resolve();
            expect(component.forceConnected).toBe(false);
            expect(mockRouter.navigate).not.toHaveBeenCalled();
            expect(haptics.success).not.toHaveBeenCalled();
        });

        it('locks disconnect confirmation and cancels it when the account changes', async () => {
            component.user.settings.serviceSyncSettings = { activitySyncRoutes: {
                [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: { enabled: true },
            } } as typeof component.user.settings.serviceSyncSettings;
            const closed = new Subject<boolean>();
            const close = vi.fn((result: boolean) => { closed.next(result); closed.complete(); });
            mockDialog.open.mockReturnValue({ afterClosed: () => closed, close });
            const pending = component.deauthorizeService(new Event('click'));
            await component.deauthorizeService(new Event('click'));
            await component.connectWithService(new Event('click'));
            expect(component.isDisconnecting).toBe(true);
            expect(mockDialog.open).toHaveBeenCalledOnce();
            expect(mockUserService.getCurrentUserServiceTokenAndRedirectURI).not.toHaveBeenCalled();
            fixture.componentRef.setInput('user', { uid: 'next-owner', settings: {} }); fixture.detectChanges();
            await pending;
            expect(close).toHaveBeenCalledExactlyOnceWith(false);
            expect(mockUserService.deauthorizeService).not.toHaveBeenCalled();
            expect(component.isDisconnecting).toBe(false);
            expect(haptics.selection).toHaveBeenCalledOnce();
        });

        it('ignores late disconnect feedback after switching accounts', async () => {
            let resolve!: () => void;
            mockUserService.deauthorizeService.mockReturnValue(new Promise<void>(value => { resolve = value; }));
            const pending = component.deauthorizeService(new Event('click'));
            await Promise.resolve();
            fixture.componentRef.setInput('user', { uid: 'next-owner', settings: {} }); fixture.detectChanges();
            component.forceConnected = true;
            resolve(); await pending;
            expect(component.forceConnected).toBe(true);
            expect(haptics.success).not.toHaveBeenCalled();
        });
    });

    it('renders connection status outside the provider tool tabs', () => {
        fixture.detectChanges();

        const connectionStatus = fixture.nativeElement.querySelector('.service-connection-status');
        const providerToolTabs = fixture.nativeElement.querySelector('.provider-tools-tabs');
        const providerToolPanel = fixture.nativeElement.querySelector('.provider-tools-panel');
        const providerTabs = fixture.nativeElement.querySelectorAll('a[mat-tab-link]');

        expect(connectionStatus).toBeTruthy();
        expect(connectionStatus.textContent).toContain('Garmin Connect');
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
        component.user = { uid: ACTIVITY_SYNC_ALLOWLISTED_UID, settings: {} } as any;
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
            .toContain('Send Garmin activities to Suunto');
        expect(toolPanels[0].textContent).toContain('Sending Garmin activities to Suunto is a Pro feature.');
    });

    it('hides the auto-sync panel until the auto-sync tab is selected', () => {
        component.user = { uid: ACTIVITY_SYNC_ALLOWLISTED_UID, settings: {} } as any;
        component.hasProAccess = true;
        component.serviceTokens = [{ accessToken: 'token', userID: 'garmin-user', permissions: [] } as any];
        fixture.detectChanges();

        const tabs = fixture.nativeElement.querySelectorAll('a[mat-tab-link]');
        const panels = fixture.nativeElement.querySelectorAll('.provider-tool-panel');

        expect(tabs.length).toBe(3);
        expect(panels.length).toBe(3);
        expect(panels[0].hidden).toBe(false);
        expect(panels[1].hidden).toBe(true);
        expect(getComputedStyle(panels[1]).display).toBe('none');
        expect(panels[2].textContent).toContain('Send Garmin activities to Suunto');

        tabs[2].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        fixture.detectChanges();

        expect(component.activeProviderTool).toBe('auto-sync');
        expect(panels[0].hidden).toBe(true);
        expect(getComputedStyle(panels[0]).display).toBe('none');
        expect(panels[2].hidden).toBe(false);
    });

    it('shows the direct Garmin route uploader when Course Import is granted', () => {
        component.activeProviderTool = 'uploads';
        component.showOnlyActiveProviderTool = true;
        component.hasProAccess = true;
        component.serviceTokens = [{
            accessToken: 'token',
            userID: 'garmin-user',
            permissions: ['COURSE_IMPORT'],
        } as any];
        fixture.detectChanges();

        expect(component.hasGarminCourseImportPermission).toBe(true);
        expect(fixture.nativeElement.querySelector('app-upload-route-to-service')).toBeTruthy();
        expect(fixture.nativeElement.textContent).toContain('Send GPX or FIT Route to Garmin');
    });

    it('asks the user to allow Course Import before showing the Garmin route uploader', () => {
        component.activeProviderTool = 'uploads';
        component.showOnlyActiveProviderTool = true;
        component.hasProAccess = true;
        component.serviceTokens = [{
            accessToken: 'token',
            userID: 'garmin-user',
            permissions: ['ACTIVITY_EXPORT'],
        } as any];
        fixture.detectChanges();

        expect(component.hasGarminCourseImportPermission).toBe(false);
        expect(fixture.nativeElement.querySelector('app-upload-route-to-service')).toBeFalsy();
        expect(fixture.nativeElement.textContent).toContain('Allow Course Import in Garmin Connect before sending routes.');
    });

    it('renders disconnect beside the connected account details', () => {
        component.hasProAccess = true;
        component.serviceTokens = [{
            accessToken: 'token',
            userID: 'garmin-user',
            permissions: [],
            dateCreated: new Date('2026-05-03T10:00:00Z'),
        } as any];
        fixture.detectChanges();

        const accountRow = fixture.nativeElement.querySelector('.connection-account-row');

        expect(accountRow).toBeTruthy();
        expect(accountRow.textContent).toContain('garmin-user');
        expect(accountRow.querySelector('.connected-account-list')).toBeTruthy();
        expect(accountRow.querySelector('.connected-account-title')?.textContent).toContain('garmin-user');
        expect(accountRow.querySelector('.connected-account-line')?.textContent).toContain('Connected:');
        expect(accountRow.querySelector('mat-list')).toBeFalsy();
        expect(accountRow.querySelector('.connection-disconnect-button')?.textContent).toContain('Disconnect');
        expect(fixture.nativeElement.querySelector('.service-connection-status__actions .connection-disconnect-button')).toBeFalsy();
    });

    describe('History Import Tab', () => {
        it('should show Pro requirement if user has no pro access', () => {
            component.hasProAccess = false;
            component.isAdmin = false;
            fixture.detectChanges();

            const content = fixture.nativeElement.textContent;

            expect(content).toContain('History import is a Pro feature');
            expect(fixture.nativeElement.querySelector('.pro-required-inline')).toBeTruthy();
        });

        it('should be unlocked/available if user has pro access AND is connected', () => {
            component.hasProAccess = true;
            component.isAdmin = false;
            component.serviceTokens = [{ accessToken: 'token', userID: 'garmin-user', permissions: [] } as any];
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

        it('should require reconnect before showing the Garmin history import form', () => {
            component.hasProAccess = true;
            component.serviceMeta = { connectionState: 'reconnect_required' } as any;
            component.serviceTokens = [{ accessToken: 'token', userID: 'garmin-user', permissions: ['HISTORICAL_DATA_EXPORT', 'ACTIVITY_EXPORT'] } as any];
            fixture.detectChanges();

            const historyForm = fixture.nativeElement.querySelector('app-history-import-form');
            const content = fixture.nativeElement.textContent;

            expect(historyForm).toBeFalsy();
            expect(content).toContain('Reconnect Garmin before importing history.');
        });
    });

    describe('Permission State', () => {
        it('uses the best Garmin token for permission checks instead of only the first token', () => {
            const freshConnectedAt = new Date('2026-05-03T10:00:00.000Z');
            component.isLoading = false;
            component.serviceTokens = [{
                accessToken: 'stale-token',
                userID: 'stale-garmin-user',
                permissions: ['HISTORICAL_DATA_EXPORT', 'ACTIVITY_EXPORT'],
                permissionsLastChangedAt: 100,
                dateCreated: new Date('2026-04-01T10:00:00.000Z'),
            }, {
                accessToken: 'fresh-token',
                userID: 'fresh-garmin-user',
                permissions: ['HISTORICAL_DATA_EXPORT', 'ACTIVITY_EXPORT', 'HEALTH_EXPORT'],
                permissionsLastChangedAt: 200,
                dateCreated: freshConnectedAt,
            }] as any;

            expect(component.isConnectedToService()).toBe(true);
            expect(component.hasPermissionsLoaded).toBe(true);
            expect(component.missingPermissions).toEqual([]);
            expect(component.garminUserID).toBe('fresh-garmin-user');
            expect(component.connectedAt).toBe(freshConnectedAt);
            expect(component.permissionsLastChangedAt).toBe(200_000);
            expect(component.isHistoryImportLoading).toBe(false);
        });

        it('does not treat preserved Garmin tokens as connected while disconnect is pending', () => {
            component.serviceMeta = { connectionState: 'disconnect_pending' } as any;
            component.serviceTokens = [{
                accessToken: 'garmin-token',
                userID: 'garmin-user',
                permissions: ['HISTORICAL_DATA_EXPORT', 'ACTIVITY_EXPORT', 'HEALTH_EXPORT'],
            }] as any;

            expect(component.isDisconnectPending).toBe(true);
            expect(component.isConnectedToService()).toBe(false);
            expect(component.connectionDescription).toContain('Disconnect is pending');
        });

        it('shows reconnect action instead of retry copy when pending disconnect needs manual review', () => {
            component.hasProAccess = false;
            component.user = { uid: 'user-1' } as any;
            component.serviceMeta = {
                connectionState: 'disconnect_pending',
                disconnectManualReviewRequired: true,
            } as any;
            component.serviceTokens = [{
                accessToken: 'garmin-token',
                userID: 'garmin-user',
                permissions: ['HISTORICAL_DATA_EXPORT', 'ACTIVITY_EXPORT', 'HEALTH_EXPORT'],
            }] as any;
            fixture.detectChanges();

            const content = fixture.nativeElement.textContent;
            const connectButton = fixture.nativeElement.querySelector('.qs-mat-primary');

            expect(component.isDisconnectManualReviewRequired).toBe(true);
            expect(component.shouldShowConnectAction).toBe(true);
            expect(component.canConnectServiceWithCurrentAccess).toBe(true);
            expect(content).toContain('Reconnect Garmin');
            expect(content).toContain('Garmin disconnect retries have stopped');
            expect(content).not.toContain('retrying the Garmin disconnect');
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

        it('does not confuse an unreported permission snapshot with active loading', () => {
            component.isLoading = false;
            component.serviceTokens = [{
                accessToken: 'garmin-token',
                userID: 'garmin-user',
            }] as any;

            expect(component.isConnectedToService()).toBe(true);
            expect(component.hasPermissionsLoaded).toBe(false);
            expect(component.missingPermissions).toEqual([]);
            expect(component.isHistoryImportLoading).toBe(false);
        });

        it('normalizes grants consistently with the overview and rejects malformed snapshots', () => {
            component.serviceTokens = [{ providerUserId: 'garmin-user', permissions: [' COURSE_IMPORT '] }];
            expect(component.hasGarminCourseImportPermission).toBe(true);
            component.serviceTokens = [{ providerUserId: 'garmin-user', permissions: ['COURSE_IMPORT', ''] }];
            expect(component.hasPermissionsLoaded).toBe(false);
            expect(component.hasGarminCourseImportPermission).toBe(false);
        });

        it.each(['history', 'uploads'])('shows actionable unknown permission guidance in the %s tool', tool => {
            component.hasProAccess = true;
            component.showConnectionSummary = false;
            component.showOnlyActiveProviderTool = true;
            component.activeProviderTool = tool;
            component.serviceTokens = [{ providerUserId: 'legacy-account' }];
            fixture.detectChanges();
            expect(fixture.nativeElement.textContent).toContain('Close this tool and use Manage in Garmin');
            expect(fixture.nativeElement.textContent).not.toContain('choose Reconnect');
            expect(fixture.nativeElement.querySelector('app-service-syncing-state')).toBeNull();
            expect(fixture.nativeElement.querySelector('app-history-import-form, app-upload-route-to-service')).toBeNull();
            component.isLoading = true;
            fixture.detectChanges();
            expect(fixture.nativeElement.querySelector('app-service-syncing-state')).toBeTruthy();
        });

        it.each(['history', 'uploads', 'auto-sync'])('uses a focusable Pro action without a clickable panel in %s', tool => {
            component.user = { uid: ACTIVITY_SYNC_ALLOWLISTED_UID } as typeof component.user;
            component.hasProAccess = false;
            component.showConnectionSummary = false;
            component.showOnlyActiveProviderTool = true;
            component.activeProviderTool = tool;
            fixture.detectChanges();
            const panel = fixture.nativeElement.querySelector('.provider-tool-panel') as HTMLElement;
            panel.click();
            expect(mockRouter.navigate).not.toHaveBeenCalled();
            const action = panel.querySelector('button.pro-required-inline') as HTMLButtonElement;
            expect(action.type).toBe('button');
            expect(action.disabled).toBe(false);
            action.click();
            expect(mockRouter.navigate).toHaveBeenCalledExactlyOnceWith(['/subscriptions']);
            expect(haptics.selection).toHaveBeenCalledOnce();
        });

        it('ignores permission arrays on Garmin tokens without a provider identity', () => {
            component.isLoading = false;
            component.serviceTokens = [{
                accessToken: 'invalid-token',
                permissions: ['COURSE_IMPORT'],
            }, {
                accessToken: 'valid-token',
                userID: 'garmin-user',
            }] as any;

            expect(component.isConnectedToService()).toBe(true);
            expect(component.hasPermissionsLoaded).toBe(false);
        });

        it('does not report sleep permissions missing when a later Garmin token can backfill sleep', () => {
            component.serviceTokens = [{
                accessToken: 'activity-token',
                userID: 'activity-garmin-user',
                permissions: ['HISTORICAL_DATA_EXPORT', 'ACTIVITY_EXPORT'],
            }, {
                accessToken: 'sleep-token',
                userID: 'sleep-garmin-user',
                permissions: ['HISTORICAL_DATA_EXPORT', 'HEALTH_EXPORT'],
            }] as any;

            expect(component.hasPermissionsLoaded).toBe(true);
            expect(component.missingPermissions).toEqual([]);
        });

        it('reports only health missing when Garmin activity history permissions are present without sleep permissions', () => {
            component.serviceTokens = [{
                accessToken: 'activity-token',
                userID: 'activity-garmin-user',
                permissions: ['HISTORICAL_DATA_EXPORT', 'ACTIVITY_EXPORT'],
            }] as any;

            expect(component.missingPermissions).toEqual(['HEALTH_EXPORT']);
        });

        it('shows the Garmin account used for saved-route delivery when it differs from the primary connected account', () => {
            component.hasProAccess = true;
            component.isLoading = false;
            component.serviceTokens = [{
                accessToken: 'history-token',
                userID: 'history-garmin-user',
                permissions: ['HISTORICAL_DATA_EXPORT', 'ACTIVITY_EXPORT', 'HEALTH_EXPORT'],
                permissionsLastChangedAt: 200,
                dateCreated: new Date('2026-05-03T10:00:00.000Z'),
            }, {
                accessToken: 'route-token',
                userID: 'route-garmin-user',
                permissions: ['COURSE_IMPORT'],
                permissionsLastChangedAt: 250,
                dateCreated: new Date('2026-05-04T10:00:00.000Z'),
            }] as any;

            fixture.detectChanges();

            expect(component.garminUserID).toBe('history-garmin-user');
            expect(component.routeSendGarminUserID).toBe('route-garmin-user');
            expect(component.isRouteSendAccountDifferentFromConnectedAccount).toBe(true);

            const content = fixture.nativeElement.textContent;
            expect(content).toContain('Routes use this Garmin account');
            expect(content).toContain('route-garmin-user');
        });

        it('does not append route permission guidance to the Garmin service content', () => {
            component.hasProAccess = true;
            component.isLoading = false;
            component.showOnlyActiveProviderTool = true;
            component.activeProviderTool = 'auto-sync';
            component.serviceTokens = [{
                accessToken: 'token',
                userID: 'garmin-user',
                permissions: ['HISTORICAL_DATA_EXPORT', 'ACTIVITY_EXPORT', 'HEALTH_EXPORT'],
                dateCreated: new Date('2026-05-03T10:00:00.000Z'),
            }] as any;

            fixture.detectChanges();

            const content = fixture.nativeElement.textContent;
            expect(content).not.toContain('Allow Course Import');
            expect(content).not.toContain('Routes are ready to send');
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
                'Garmin Connect is temporarily unavailable. Please try again later.',
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

            // Should NOT show the account circle icon (part of the connected account row)
            const accountIcon = fixture.nativeElement.querySelector('.connected-account-icon');
            expect(accountIcon).toBeFalsy();
        });

        it('shows the known account and an honest unknown state when its permission snapshot is missing', () => {
            fixture.componentRef.setInput('user', { uid: 'owner', settings: {} }); fixture.detectChanges();
            component.serviceTokens = [{ providerUserId: 'test-user-123' }];
            component.hasProAccess = true;
            fixture.detectChanges();

            expect(fixture.nativeElement.textContent).toContain('test-user-123');
            expect(fixture.nativeElement.textContent).toContain('Not reported');
            expect(fixture.nativeElement.querySelector('.connection-details')?.textContent).not.toContain('Syncing connection details...');
            expect(fixture.nativeElement.querySelector('.connected-account-icon')).toBeTruthy();
        });

        it('ngOnChanges should auto-connect from query params and finalize success state', async () => {
            const snackBar = TestBed.inject(MatSnackBar);
            const snackBarSpy = vi.spyOn(snackBar, 'open');
            const user = { uid: 'u1' } as any;
            component.user = user;
            queryParams = {
                serviceName: component.serviceName,
                connect: '1',
                state: 'state-token',
                code: 'auth-code'
            };
            mockUserService.getServiceToken.mockReturnValueOnce(of([{ accessToken: 'token-1' }]));
            mockUserService.getUserMetaForService.mockReturnValueOnce(of({ didLastHistoryImport: 0 }));
            mockUserService.requestAndSetCurrentUserGarminAPIAccessToken.mockResolvedValueOnce({
                connected: true,
                outcome: 'connected',
            });

            await component.ngOnChanges();
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(mockUserService.getServiceToken).toHaveBeenCalledWith(user, component.serviceName);
            expect(mockUserService.getUserMetaForService).toHaveBeenCalledWith(user, component.serviceName);
            expect(mockUserService.requestAndSetCurrentUserGarminAPIAccessToken).toHaveBeenCalledWith('state-token', 'auth-code');
            expect(mockAnalyticsService.logEvent).toHaveBeenCalledWith('connected_to_service', { serviceName: component.serviceName });
            expect(snackBarSpy).toHaveBeenCalledWith(
                'Successfully connected to Garmin Connect',
                undefined,
                { duration: 10000 }
            );
            expect(mockRouter.navigate).toHaveBeenCalledWith(
                ['services'],
                {
                    queryParams: { serviceName: component.serviceName },
                    queryParamsHandling: ''
                }
            );
            expect(component.forceConnected).toBe(true);
            expect(component.isLoading).toBe(false);
            expect(component.isConnecting).toBe(false);
        });

        it('ngOnChanges should reject a legacy empty completion response instead of showing success', async () => {
            const snackBar = TestBed.inject(MatSnackBar);
            const snackBarSpy = vi.spyOn(snackBar, 'open');
            component.user = { uid: 'u1' } as any;
            queryParams = {
                serviceName: component.serviceName,
                connect: '1',
                state: 'state-token',
                code: 'auth-code'
            };
            mockUserService.getServiceToken.mockReturnValueOnce(of([]));
            mockUserService.getUserMetaForService.mockReturnValueOnce(of({ didLastHistoryImport: 0 }));
            mockUserService.requestAndSetCurrentUserGarminAPIAccessToken.mockResolvedValueOnce(undefined as any);

            await component.ngOnChanges();
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(snackBarSpy).toHaveBeenCalledWith(
                'Could not connect due to Garmin Connect did not confirm that the connection was saved.',
                undefined,
                { duration: 10000 }
            );
            expect(mockAnalyticsService.logEvent).not.toHaveBeenCalledWith('connected_to_service', expect.anything());
            expect(component.forceConnected).toBe(false);
        });

        it('ngOnChanges should auto-connect from an OAuth callback without the legacy connect parameter', async () => {
            const user = { uid: 'u1' } as any;
            component.user = user;
            queryParams = {
                serviceName: component.serviceName,
                state: 'state-token',
                code: 'auth-code'
            };
            mockUserService.getServiceToken.mockReturnValueOnce(of([{ accessToken: 'token-1' }]));
            mockUserService.getUserMetaForService.mockReturnValueOnce(of({ didLastHistoryImport: 0 }));
            mockUserService.requestAndSetCurrentUserGarminAPIAccessToken.mockResolvedValueOnce({
                connected: true,
                outcome: 'connected',
            });

            await component.ngOnChanges();
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(mockUserService.requestAndSetCurrentUserGarminAPIAccessToken).toHaveBeenCalledWith('state-token', 'auth-code');
            expect(mockRouter.navigate).toHaveBeenCalledWith(
                ['services'],
                {
                    queryParams: { serviceName: component.serviceName },
                    queryParamsHandling: ''
                }
            );
            expect(component.forceConnected).toBe(true);
        });

        it('ngOnChanges should expose a missing OAuth callback parameter', async () => {
            const snackBar = TestBed.inject(MatSnackBar);
            const snackBarSpy = vi.spyOn(snackBar, 'open');
            component.user = { uid: 'u1' } as any;
            queryParams = {
                serviceName: component.serviceName,
                connect: '1',
                state: 'state-token'
            };
            mockUserService.getServiceToken.mockReturnValueOnce(of([]));
            mockUserService.getUserMetaForService.mockReturnValueOnce(of({ didLastHistoryImport: 0 }));

            await component.ngOnChanges();
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(mockUserService.requestAndSetCurrentUserGarminAPIAccessToken).not.toHaveBeenCalled();
            expect(snackBarSpy).toHaveBeenCalledWith(
                'Could not connect due to Garmin Connect authorization callback is missing state or code.',
                undefined,
                { duration: 10000 }
            );
            expect(mockAnalyticsService.logEvent).not.toHaveBeenCalledWith('connected_to_service', expect.anything());
            expect(component.forceConnected).toBe(false);
        });

        it('ngOnChanges should report disconnect recovery without claiming a connection', async () => {
            const snackBar = TestBed.inject(MatSnackBar);
            const snackBarSpy = vi.spyOn(snackBar, 'open');
            component.user = { uid: 'u1' } as any;
            queryParams = {
                serviceName: component.serviceName,
                connect: '1',
                state: 'state-token',
                code: 'auth-code'
            };
            const connectionStateEmitSpy = vi.spyOn(component.connectionStateChanged, 'emit');
            mockUserService.getServiceToken.mockReturnValueOnce(of([{ accessToken: 'stale-token' }]));
            mockUserService.getUserMetaForService.mockReturnValueOnce(of({ didLastHistoryImport: 0 }));
            mockUserService.requestAndSetCurrentUserGarminAPIAccessToken.mockResolvedValueOnce({
                connected: false,
                outcome: 'disconnect_recovery_completed',
            });

            await component.ngOnChanges();
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(snackBarSpy).toHaveBeenCalledWith(
                'The previous Garmin Connect connection was removed. A Pro subscription is required to connect again.',
                undefined,
                { duration: 10000 }
            );
            expect(mockAnalyticsService.logEvent).not.toHaveBeenCalledWith('connected_to_service', expect.anything());
            expect(component.forceConnected).toBe(false);
            expect(connectionStateEmitSpy).toHaveBeenLastCalledWith(false);
        });

        it('ngOnChanges should expose a pending disconnect recovery as an error', async () => {
            const snackBar = TestBed.inject(MatSnackBar);
            const snackBarSpy = vi.spyOn(snackBar, 'open');
            component.user = { uid: 'u1' } as any;
            queryParams = {
                serviceName: component.serviceName,
                connect: '1',
                state: 'state-token',
                code: 'auth-code'
            };
            mockUserService.getServiceToken.mockReturnValueOnce(of([]));
            mockUserService.getUserMetaForService.mockReturnValueOnce(of({ didLastHistoryImport: 0 }));
            mockUserService.requestAndSetCurrentUserGarminAPIAccessToken.mockResolvedValueOnce({
                connected: false,
                outcome: 'disconnect_recovery_pending',
            });

            await component.ngOnChanges();
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(snackBarSpy).toHaveBeenCalledWith(
                'The previous Garmin Connect connection could not be fully removed yet. Please try again later.',
                undefined,
                { duration: 10000 }
            );
            expect(mockAnalyticsService.logEvent).not.toHaveBeenCalledWith('connected_to_service', expect.anything());
            expect(component.forceConnected).toBe(false);
        });

        it('ngOnChanges should map 502 during auto-connect to partner unavailable message', async () => {
            const snackBar = TestBed.inject(MatSnackBar);
            const snackBarSpy = vi.spyOn(snackBar, 'open');
            const user = { uid: 'u1' } as any;
            const error502 = { code: 'functions/unavailable', message: 'Bad Gateway' };
            component.user = user;
            queryParams = {
                serviceName: component.serviceName,
                connect: '1',
                state: 'state-token',
                code: 'auth-code'
            };
            mockUserService.getServiceToken.mockReturnValueOnce(of([{ accessToken: 'token-1' }]));
            mockUserService.getUserMetaForService.mockReturnValueOnce(of({ didLastHistoryImport: 0 }));
            mockUserService.requestAndSetCurrentUserGarminAPIAccessToken.mockRejectedValueOnce(error502);

            await component.ngOnChanges();
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(snackBarSpy).toHaveBeenCalledWith(
                'Garmin Connect is temporarily unavailable. Please try again later.',
                undefined,
                { duration: 10000 }
            );
            expect(mockAnalyticsService.logEvent).not.toHaveBeenCalledWith('connected_to_service', expect.anything());
            expect(mockRouter.navigate).toHaveBeenCalledWith(
                ['services'],
                {
                    queryParams: { serviceName: component.serviceName },
                    queryParamsHandling: ''
                }
            );
            expect(component.forceConnected).toBe(false);
            expect(component.isLoading).toBe(false);
            expect(component.isConnecting).toBe(false);
        });

        it('ngOnChanges should map 403 Pro auto-connect errors to upgrade-required message', async () => {
            const snackBar = TestBed.inject(MatSnackBar);
            const snackBarSpy = vi.spyOn(snackBar, 'open');
            const user = { uid: 'u1' } as any;
            const error403 = { code: 'functions/permission-denied', message: 'Pro subscription required' };
            component.user = user;
            queryParams = {
                serviceName: component.serviceName,
                connect: '1',
                state: 'state-token',
                code: 'auth-code'
            };
            mockUserService.getServiceToken.mockReturnValueOnce(of([{ accessToken: 'token-1' }]));
            mockUserService.getUserMetaForService.mockReturnValueOnce(of({ didLastHistoryImport: 0 }));
            mockUserService.requestAndSetCurrentUserGarminAPIAccessToken.mockRejectedValueOnce(error403);

            await component.ngOnChanges();
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(snackBarSpy).toHaveBeenCalledWith(
                'This feature requires a Pro subscription.',
                undefined,
                { duration: 10000 }
            );
            expect(mockAnalyticsService.logEvent).not.toHaveBeenCalledWith('connected_to_service', expect.anything());
            expect(mockRouter.navigate).toHaveBeenCalledWith(
                ['services'],
                {
                    queryParams: { serviceName: component.serviceName },
                    queryParamsHandling: ''
                }
            );
            expect(component.forceConnected).toBe(false);
            expect(component.isLoading).toBe(false);
            expect(component.isConnecting).toBe(false);
        });
    });

    describe('Activity Sync Card', () => {
        it('should show route toggle when Garmin and Suunto are connected', async () => {
            component.hasProAccess = true;
            component.user = { uid: ACTIVITY_SYNC_ALLOWLISTED_UID, settings: {} } as any;
            mockUserService.getServiceToken.mockReturnValueOnce(of([{ accessToken: 'garmin-token', userID: 'garmin-user', permissions: [] }]));
            mockUserService.watchSuuntoServiceConnectionView.mockReturnValueOnce(of(buildSuuntoServiceConnectionViewModel({
                hasToken: true,
                serviceMeta: null,
            })));

            await component.ngOnChanges();
            fixture.detectChanges();

            const routeToggle = fixture.nativeElement.querySelector('mat-slide-toggle');
            expect(routeToggle).toBeTruthy();
        });

        it('should persist Garmin->Suunto route toggle to settings', async () => {
            component.hasProAccess = true;
            component.user = { uid: ACTIVITY_SYNC_ALLOWLISTED_UID, settings: {} } as any;
            component.serviceTokens = [{ accessToken: 'garmin-token', userID: 'garmin-user', permissions: [] }] as any;
            component.suuntoConnectionView = buildSuuntoServiceConnectionViewModel({ hasToken: true, serviceMeta: null });

            await component.onGarminToSuuntoRouteToggle(true);

            expect(mockUserService.updateActivitySyncRouteSettings).toHaveBeenCalledWith(component.user, {
                [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: true
            });
            expect(mockAnalyticsService.logActivitySyncRouteToggle).toHaveBeenCalledWith(
                ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
                true
            );
        });

        it('should require both connections when enabling Garmin->Suunto route', async () => {
            const snackBar = TestBed.inject(MatSnackBar);
            const snackBarSpy = vi.spyOn(snackBar, 'open');
            component.hasProAccess = true;
            component.user = { uid: ACTIVITY_SYNC_ALLOWLISTED_UID, settings: {} } as any;
            component.serviceTokens = [] as any;
            component.suuntoConnectionView = buildSuuntoServiceConnectionViewModel({ hasToken: true, serviceMeta: null });

            await component.onGarminToSuuntoRouteToggle(true);

            expect(mockUserService.updateActivitySyncRouteSettings).not.toHaveBeenCalled();
            expect(snackBarSpy).toHaveBeenCalledWith(
                'Connect Garmin and Suunto before turning on automatic activity sync.',
                undefined,
                { duration: 4000 }
            );
        });

        it('should block enabling Garmin->Suunto route when Suunto requires reconnect despite a token', async () => {
            const snackBar = TestBed.inject(MatSnackBar);
            const snackBarSpy = vi.spyOn(snackBar, 'open');
            component.hasProAccess = true;
            component.user = { uid: ACTIVITY_SYNC_ALLOWLISTED_UID, settings: {} } as any;
            component.serviceTokens = [{ accessToken: 'garmin-token', userID: 'garmin-user', permissions: [] }] as any;
            component.suuntoConnectionView = buildSuuntoServiceConnectionViewModel({
                hasToken: true,
                serviceMeta: { connectionState: 'reconnect_required' } as any,
            });

            await component.onGarminToSuuntoRouteToggle(true);

            expect(mockUserService.updateActivitySyncRouteSettings).not.toHaveBeenCalled();
            expect(snackBarSpy).toHaveBeenCalledWith(
                'Reconnect Suunto before turning on automatic activity sync.',
                undefined,
                { duration: 4000 }
            );
        });

        it('should allow disabling Garmin->Suunto route when a service is disconnected', async () => {
            component.hasProAccess = true;
            component.user = {
                uid: ACTIVITY_SYNC_ALLOWLISTED_UID,
                settings: {
                    serviceSyncSettings: {
                        activitySyncRoutes: {
                            [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: { enabled: true }
                        }
                    }
                }
            } as any;
            component.serviceTokens = [] as any;
            component.suuntoConnectionView = buildSuuntoServiceConnectionViewModel({ hasToken: false, serviceMeta: null });

            await component.onGarminToSuuntoRouteToggle(false);

            expect(mockUserService.updateActivitySyncRouteSettings).toHaveBeenCalledWith(component.user, {
                [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: false
            });
            expect(mockAnalyticsService.logActivitySyncRouteToggle).toHaveBeenCalledWith(
                ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
                false
            );
        });

        it('should allow manual catch-up when auto-sync toggle is disabled', () => {
            component.hasProAccess = true;
            component.user = { uid: ACTIVITY_SYNC_ALLOWLISTED_UID, settings: {} } as any;
            component.serviceTokens = [{ accessToken: 'garmin-token', userID: 'garmin-user', permissions: [] }] as any;
            component.suuntoConnectionView = buildSuuntoServiceConnectionViewModel({ hasToken: true, serviceMeta: null });
            component.isBackfillingSync = false;
            component.backfillStartDate = new Date('2026-01-01T00:00:00.000Z');
            component.backfillEndDate = new Date('2026-01-31T00:00:00.000Z');

            fixture.detectChanges();

            const queueButton = Array.from(fixture.nativeElement.querySelectorAll('button'))
                .find((button: HTMLButtonElement) => (button.textContent || '').includes('Schedule activities')) as HTMLButtonElement | undefined;

            expect(component.isGarminToSuuntoRouteEnabled).toBe(false);
            expect(queueButton).toBeTruthy();
            expect(queueButton?.disabled).toBe(false);
        });

        it('should show reconnect-required copy instead of route controls when Suunto requires reconnect', () => {
            component.hasProAccess = true;
            component.user = { uid: ACTIVITY_SYNC_ALLOWLISTED_UID, settings: {} } as any;
            component.serviceTokens = [{ accessToken: 'garmin-token', userID: 'garmin-user', permissions: [] }] as any;
            component.suuntoConnectionView = buildSuuntoServiceConnectionViewModel({
                hasToken: true,
                serviceMeta: { connectionState: 'reconnect_required' } as any,
            });

            fixture.detectChanges();

            expect(fixture.nativeElement.textContent).toContain('Reconnect Suunto before syncing Garmin activities.');
            expect(fixture.nativeElement.querySelector('mat-slide-toggle')).toBeFalsy();
        });

        it('should show activity sync card for users outside the old rollout UID list', () => {
            component.hasProAccess = true;
            component.user = { uid: 'non-allowlisted-user', settings: {} } as any;
            fixture.detectChanges();

            expect(fixture.nativeElement.textContent).toContain('Send Garmin activities to Suunto');
        });

        it('should render failed backfill events in the summary', () => {
            component.hasProAccess = true;
            component.user = { uid: ACTIVITY_SYNC_ALLOWLISTED_UID, settings: {} } as any;
            component.serviceTokens = [{ accessToken: 'garmin-token', userID: 'garmin-user', permissions: [] }] as any;
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
            component.user = { uid: ACTIVITY_SYNC_ALLOWLISTED_UID, settings: {} } as any;
            component.serviceTokens = [{ accessToken: 'garmin-token', userID: 'garmin-user', permissions: [] }] as any;
            component.suuntoConnectionView = buildSuuntoServiceConnectionViewModel({ hasToken: true, serviceMeta: null });

            fixture.detectChanges();

            const infoBlock = fixture.nativeElement.querySelector('app-status-info[title="Choose which activities to send"]');
            const content = fixture.nativeElement.textContent;
            expect(infoBlock).toBeTruthy();
            expect(content).toContain('Choose a date range to send Garmin activities already in Quantified Self to Suunto');
            expect(content).toContain('even when automatic activity sync is off');
        });

        it('should log route backfill analytics when catch-up succeeds', async () => {
            component.hasProAccess = true;
            component.user = { uid: ACTIVITY_SYNC_ALLOWLISTED_UID, settings: {} } as any;
            component.serviceTokens = [{ accessToken: 'garmin-token', userID: 'garmin-user', permissions: [] }] as any;
            component.suuntoConnectionView = buildSuuntoServiceConnectionViewModel({ hasToken: true, serviceMeta: null });
            mockUserService.backfillActivitySyncRouteForCurrentUser.mockResolvedValueOnce({
                scanned: 20,
                queued: 17,
                skippedByReason: {},
                failedCount: 1,
                failedEvents: [{ eventID: 'evt-1', reason: 'x', message: 'failed' }]
            });

            await component.runGarminToSuuntoBackfill(new Event('submit'));

            expect(mockAnalyticsService.logActivitySyncRouteBackfill).toHaveBeenCalledWith(
                ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
                {
                    scanned: 20,
                    queued: 17,
                    failedCount: 1,
                }
            );
        });

        it('should show inline warning pill when connected service is used by active route', () => {
            component.hasProAccess = true;
            component.user = {
                uid: ACTIVITY_SYNC_ALLOWLISTED_UID,
                settings: {
                    serviceSyncSettings: {
                        activitySyncRoutes: {
                            [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: { enabled: true }
                        }
                    }
                }
            } as any;
            component.serviceTokens = [{ accessToken: 'garmin-token', userID: 'garmin-user', permissions: [] }] as any;
            component.suuntoConnectionView = buildSuuntoServiceConnectionViewModel({ hasToken: true, serviceMeta: null });

            fixture.detectChanges();

            const warningPill = fixture.nativeElement.querySelector('.active-sync-warning-pill');
            expect(warningPill).toBeTruthy();
            expect((warningPill.textContent || '').trim()).toContain('Used by automatic sync');
        });

        it('should require confirmation before disconnect when active sync route would be disabled', async () => {
            component.hasProAccess = true;
            component.user = {
                uid: ACTIVITY_SYNC_ALLOWLISTED_UID,
                settings: {
                    serviceSyncSettings: {
                        activitySyncRoutes: {
                            [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: { enabled: true }
                        }
                    }
                }
            } as any;
            component.serviceTokens = [{ accessToken: 'garmin-token', userID: 'garmin-user', permissions: [] }] as any;
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

        it('should disconnect without confirmation when no active route depends on Garmin', async () => {
            component.hasProAccess = true;
            component.user = {
                uid: ACTIVITY_SYNC_ALLOWLISTED_UID,
                settings: {
                    serviceSyncSettings: {
                        activitySyncRoutes: {
                            [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: { enabled: false }
                        }
                    }
                }
            } as any;
            component.serviceTokens = [{ accessToken: 'garmin-token', userID: 'garmin-user', permissions: [] }] as any;
            component.suuntoConnectionView = buildSuuntoServiceConnectionViewModel({ hasToken: true, serviceMeta: null });

            await component.deauthorizeService(new MouseEvent('click'));

            expect(mockDialog.open).not.toHaveBeenCalled();
            expect(mockUserService.deauthorizeService).toHaveBeenCalledWith(component.serviceName, expect.any(Function));
        });
    });
});
