
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ServicesGarminComponent } from './services.garmin.component';
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
import { of } from 'rxjs';
import { ACTIVITY_SYNC_ROUTE_IDS } from '@shared/activity-sync-routes';
import { ServiceConnectionStatusComponent } from '../service-connection-status/service-connection-status.component';
import { buildSuuntoServiceConnectionViewModel } from '../../../helpers/suunto-service-connection.helper';

const ACTIVITY_SYNC_ALLOWLISTED_UID = 'xcsAolLDDTWTgtRN9eYF3lW2YKL2';

describe('ServicesGarminComponent', () => {
    let component: ServicesGarminComponent;
    let fixture: ComponentFixture<ServicesGarminComponent>;
    let mockUserService: any;
    let mockAnalyticsService: any;
    let mockRouter: any;
    let mockDialog: any;
    let queryParams: Record<string, string | null>;
    let mockActivatedRoute: any;

    beforeEach(async () => {
        queryParams = {};
        mockActivatedRoute = {
            snapshot: {
                queryParamMap: {
                    get: vi.fn((key: string) => queryParams[key] ?? null)
                }
            }
        };
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
            declarations: [ServicesGarminComponent, ServiceSyncingStateComponent, ServiceConnectionStatusComponent],
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
                { provide: AppEventService, useValue: {} },
                { provide: AppAuthService, useValue: { user$: { pipe: () => ({ subscribe: () => { } }) } } },
                { provide: AppUserService, useValue: mockUserService },
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

    it('renders a direct privacy link to the Garmin policy section', () => {
        const privacyLink = fixture.nativeElement.querySelector('.service-privacy-link a');

        expect(privacyLink).toBeTruthy();
        expect(privacyLink.textContent).toContain('Privacy details for Garmin data');
        expect(privacyLink.getAttribute('href')).toContain('/policies#garmin-data');
    });

    it('renders connection status outside the provider tool tabs', () => {
        fixture.detectChanges();

        const connectionStatus = fixture.nativeElement.querySelector('.service-connection-status');
        const providerToolTabs = fixture.nativeElement.querySelector('.provider-tools-tabs');
        const providerToolPanel = fixture.nativeElement.querySelector('.provider-tools-panel');
        const providerTabs = fixture.nativeElement.querySelectorAll('a[mat-tab-link]');

        expect(connectionStatus).toBeTruthy();
        expect(connectionStatus.textContent).toContain('Garmin Connect connection');
        expect(providerToolTabs.tagName.toLowerCase()).toBe('nav');
        expect(fixture.nativeElement.querySelector('mat-tab-group')).toBeFalsy();
        expect(providerToolPanel).toBeTruthy();
        expect(providerTabs.length).toBe(1);
        expect(fixture.nativeElement.querySelector('.provider-tools-panel .service-connection-status')).toBeFalsy();
    });

    it('hides the auto-sync panel until the auto-sync tab is selected', () => {
        component.user = { uid: ACTIVITY_SYNC_ALLOWLISTED_UID, settings: {} } as any;
        component.hasProAccess = true;
        component.serviceTokens = [{ accessToken: 'token', userID: 'garmin-user', permissions: [] } as any];
        fixture.detectChanges();

        const tabs = fixture.nativeElement.querySelectorAll('a[mat-tab-link]');
        const panels = fixture.nativeElement.querySelectorAll('.provider-tool-panel');

        expect(tabs.length).toBe(2);
        expect(panels.length).toBe(2);
        expect(panels[0].hidden).toBe(false);
        expect(panels[1].hidden).toBe(true);
        expect(getComputedStyle(panels[1]).display).toBe('none');
        expect(panels[1].textContent).toContain('Garmin -> Suunto Sync');

        tabs[1].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        fixture.detectChanges();

        expect(component.activeProviderTool).toBe('auto-sync');
        expect(panels[0].hidden).toBe(true);
        expect(getComputedStyle(panels[0]).display).toBe('none');
        expect(panels[1].hidden).toBe(false);
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
            expect(component.permissionsLastChangedAt).toBe(200);
            expect(component.isHistoryImportLoading).toBe(false);
        });

        it('keeps history import loading while Garmin token permissions are not loaded', () => {
            component.isLoading = false;
            component.serviceTokens = [{
                accessToken: 'garmin-token',
                userID: 'garmin-user',
            }] as any;

            expect(component.isConnectedToService()).toBe(true);
            expect(component.hasPermissionsLoaded).toBe(false);
            expect(component.missingPermissions).toEqual([]);
            expect(component.isHistoryImportLoading).toBe(true);
        });

        it('keeps saved-route delivery in a loading state while Garmin token permissions are not loaded', () => {
            component.hasProAccess = true;
            component.isLoading = false;
            component.serviceTokens = [{
                accessToken: 'garmin-token',
                userID: 'garmin-user',
            }] as any;

            expect(component.isConnectedToService()).toBe(true);
            expect(component.hasPermissionsLoaded).toBe(false);
            expect(component.isRouteSendPermissionStateLoading).toBe(true);
            expect(component.canSendSavedRoutesToGarmin).toBe(false);
            expect(component.routeSendMissingPermissions).toEqual([]);
            expect(component.routeSendStatusType).toBe('info');
            expect(component.routeSendStatusTitle).toBe('Checking Garmin route delivery');
            expect(component.routeSendStatusMessage).toContain('Checking Garmin permissions');
        });

        it('ignores permission arrays on Garmin tokens without a provider identity', () => {
            component.hasProAccess = true;
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
            expect(component.isRouteSendPermissionStateLoading).toBe(true);
            expect(component.canSendSavedRoutesToGarmin).toBe(false);
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

        it('reports saved-route delivery as ready when COURSE_IMPORT is available', () => {
            component.hasProAccess = true;
            component.isLoading = false;
            component.serviceTokens = [{
                accessToken: 'token',
                userID: 'garmin-user',
                permissions: ['HISTORICAL_DATA_EXPORT', 'ACTIVITY_EXPORT', 'HEALTH_EXPORT', 'COURSE_IMPORT'],
                dateCreated: new Date('2026-05-03T10:00:00.000Z'),
            }] as any;

            expect(component.canSendSavedRoutesToGarmin).toBe(true);
            expect(component.routeSendStatusTitle).toBe('Saved route delivery ready');
            expect(component.routeSendStatusMessage).toContain('Garmin Connect');
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
            expect(component.canSendSavedRoutesToGarmin).toBe(true);
            expect(component.routeSendStatusMessage).toContain('route-garmin-user');

            const content = fixture.nativeElement.textContent;
            expect(content).toContain('Route Delivery Account');
            expect(content).toContain('route-garmin-user');
        });

        it('reports saved-route delivery permission gaps when COURSE_IMPORT is missing', () => {
            component.hasProAccess = true;
            component.isLoading = false;
            component.serviceTokens = [{
                accessToken: 'token',
                userID: 'garmin-user',
                permissions: ['HISTORICAL_DATA_EXPORT', 'ACTIVITY_EXPORT', 'HEALTH_EXPORT'],
                dateCreated: new Date('2026-05-03T10:00:00.000Z'),
            }] as any;

            expect(component.canSendSavedRoutesToGarmin).toBe(false);
            expect(component.routeSendMissingPermissions).toEqual(['COURSE_IMPORT']);
            expect(component.routeSendStatusTitle).toBe('Garmin route delivery needs permission');
            expect(component.routeSendStatusMessage).toContain('COURSE_IMPORT');
            expect(component.routeSendStatusMessage).toContain('Garmin Connect');
        });

        it('renders Garmin Connect permission guidance for saved-route delivery when COURSE_IMPORT is missing', () => {
            component.hasProAccess = true;
            component.isLoading = false;
            component.serviceTokens = [{
                accessToken: 'token',
                userID: 'garmin-user',
                permissions: ['HISTORICAL_DATA_EXPORT', 'ACTIVITY_EXPORT', 'HEALTH_EXPORT'],
                dateCreated: new Date('2026-05-03T10:00:00.000Z'),
            }] as any;

            fixture.detectChanges();

            const content = fixture.nativeElement.textContent;
            expect(content).toContain('Open Garmin Connect');
            expect(content).toContain('Connected Apps');
            expect(content).toContain('After updating permissions, reconnect to refresh.');
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

            // Verify connected account row is NOT shown
            const accountIcon = fixture.nativeElement.querySelector('.connected-account-icon');
            expect(accountIcon).toBeFalsy();
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
            mockUserService.requestAndSetCurrentUserGarminAPIAccessToken.mockResolvedValueOnce(undefined);

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

        it('ngOnChanges should map 502 during auto-connect to partner unavailable message', async () => {
            const snackBar = TestBed.inject(MatSnackBar);
            const snackBarSpy = vi.spyOn(snackBar, 'open');
            const user = { uid: 'u1' } as any;
            const error502 = { status: 502, message: 'Bad Gateway' };
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
            const error403 = { status: 403, error: 'Pro subscription required', message: 'Forbidden' };
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
                'Connect both Garmin and Suunto accounts before enabling sync.',
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
                'Reconnect Suunto before enabling sync.',
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
                .find((button: HTMLButtonElement) => (button.textContent || '').includes('Queue now')) as HTMLButtonElement | undefined;

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

            expect(fixture.nativeElement.textContent).toContain('Suunto needs to be reconnected before Garmin -> Suunto sync can run.');
            expect(fixture.nativeElement.querySelector('mat-slide-toggle')).toBeFalsy();
        });

        it('should show activity sync card for users outside the old rollout UID list', () => {
            component.hasProAccess = true;
            component.user = { uid: 'non-allowlisted-user', settings: {} } as any;
            fixture.detectChanges();

            expect(fixture.nativeElement.textContent).toContain('Garmin -> Suunto Sync');
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
            expect(content).toContain('Failed: 1');
            expect(content).toContain('event-123');
            expect(content).toContain('queue enqueue failed');
        });

        it('should explain that manual catch-up only uses already imported Quantified Self events', () => {
            component.hasProAccess = true;
            component.user = { uid: ACTIVITY_SYNC_ALLOWLISTED_UID, settings: {} } as any;
            component.serviceTokens = [{ accessToken: 'garmin-token', userID: 'garmin-user', permissions: [] }] as any;
            component.suuntoConnectionView = buildSuuntoServiceConnectionViewModel({ hasToken: true, serviceMeta: null });

            fixture.detectChanges();

            const infoBlock = fixture.nativeElement.querySelector('app-status-info[title="Manual Catch-up Scope"]');
            const content = fixture.nativeElement.textContent;
            expect(infoBlock).toBeTruthy();
            expect(content).toContain('Use this anytime to queue Garmin -> Suunto sync jobs');
            expect(content).toContain('activities already imported into Quantified Self');
            expect(content).toContain('uses stored original files');
            expect(content).toContain('can run even when automatic sync is turned off');
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
            expect((warningPill.textContent || '').trim()).toContain('Used by active auto-sync route');
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
            expect(mockUserService.deauthorizeService).toHaveBeenCalledWith(component.serviceName);
        });
    });
});
