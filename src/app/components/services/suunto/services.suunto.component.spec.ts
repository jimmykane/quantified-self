
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
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterTestingModule } from '@angular/router/testing';
import { MatDialog } from '@angular/material/dialog';
import { Analytics } from 'app/firebase/analytics';
import { AppEventService } from '../../../services/app.event.service';
import { AppAuthService } from '../../../authentication/app.auth.service';
import { AppUserService } from '../../../services/app.user.service';
import { AppWindowService } from '../../../services/app.window.service';
import { LoggerService } from '../../../services/logger.service';
import { AppAnalyticsService } from '../../../services/app.analytics.service';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { of } from 'rxjs';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { ACTIVITY_SYNC_ROUTE_IDS } from '@shared/activity-sync-routes';
import { ROUTE_DELIVERY_SYNC_ROUTE_IDS } from '@shared/route-delivery-sync-routes';
import { ServiceConnectionStatusComponent } from '../service-connection-status/service-connection-status.component';

describe('ServicesSuuntoComponent', () => {
    let component: ServicesSuuntoComponent;
    let fixture: ComponentFixture<ServicesSuuntoComponent>;
    let mockUserService: any;
    let mockEventService: any;
    let mockSnackBar: any;
    let mockDialog: any;
    let mockAnalyticsService: any;

    beforeEach(async () => {
        mockUserService = {
            isAdmin: vi.fn(),
            requestAndSetCurrentUserSuuntoAppAccessToken: vi.fn(),
            watchGarminRouteSendContext: vi.fn().mockReturnValue(of({
                connected: false,
                reconnectRequired: false,
                missingPermissions: [],
                providerUserId: null,
                providerStates: [],
                serviceMeta: null,
                permissionPromptSource: null,
            })),
            updateRouteDeliverySyncRouteSettings: vi.fn().mockResolvedValue(undefined),
            backfillRouteDeliverySyncRouteForCurrentUser: vi.fn().mockResolvedValue({
                scanned: 2,
                queued: 1,
                skippedByReason: { already_synced: 1 },
                failedCount: 0,
                failedRoutes: [],
            }),
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
        mockAnalyticsService = {
            logEvent: vi.fn(),
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
                MatSlideToggleModule,
                MatButtonModule,
                RouterTestingModule
            ],
            providers: [
                { provide: Analytics, useValue: {} },
                { provide: AppEventService, useValue: mockEventService },
                { provide: AppAuthService, useValue: { user$: { pipe: () => ({ subscribe: () => { } }) } } },
                { provide: AppUserService, useValue: mockUserService },
                { provide: AppWindowService, useValue: { currentDomain: 'http://localhost', windowRef: { location: { href: '' } } } },
                { provide: LoggerService, useValue: { error: vi.fn(), log: vi.fn() } },
                { provide: AppAnalyticsService, useValue: mockAnalyticsService },
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

    it('renders a direct privacy link to the Suunto policy section', () => {
        const privacyLink = fixture.nativeElement.querySelector('.service-privacy-link a');

        expect(privacyLink).toBeTruthy();
        expect(privacyLink.textContent).toContain('Privacy details for Suunto imports');
        expect(privacyLink.getAttribute('href')).toContain('/policies#suunto-data');
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

    it('does not treat preserved Suunto tokens as connected while disconnect is pending', () => {
        component.hasProAccess = true;
        component.serviceTokens = [{
            accessToken: 'token',
            userName: 'suunto-user',
            dateCreated: new Date('2026-05-03T10:00:00Z'),
        } as any];
        component.serviceMeta = { connectionState: 'disconnect_pending' } as any;
        fixture.detectChanges();

        const content = fixture.nativeElement.textContent;

        expect(component.isDisconnectPending).toBe(true);
        expect(component.isConnectedToService()).toBe(false);
        expect(content).toContain('Disconnect pending');
        expect(fixture.nativeElement.querySelector('.connection-disconnect-button')).toBeFalsy();
    });

    it('shows reconnect action instead of retry copy when pending disconnect needs manual review', () => {
        component.hasProAccess = false;
        component.user = { uid: 'user-1' } as any;
        component.serviceTokens = [{
            accessToken: 'token',
            userName: 'suunto-user',
            dateCreated: new Date('2026-05-03T10:00:00Z'),
        } as any];
        component.serviceMeta = {
            connectionState: 'disconnect_pending',
            disconnectManualReviewRequired: true,
        } as any;
        fixture.detectChanges();

        const content = fixture.nativeElement.textContent;
        const connectButton = fixture.nativeElement.querySelector('.qs-mat-primary');

        expect(component.isDisconnectManualReviewRequired).toBe(true);
        expect(component.shouldShowConnectAction).toBe(true);
        expect(component.canConnectServiceWithCurrentAccess).toBe(true);
        expect(content).toContain('Reconnect Suunto');
        expect(content).toContain('Suunto disconnect retries have stopped');
        expect(content).not.toContain('retrying the partner disconnect');
        expect(connectButton?.textContent).toContain('Reconnect');
        expect(connectButton?.disabled).toBe(false);
    });

    describe('History Import Tab', () => {
        it('should be unlocked/available if user has pro access AND is connected', () => {
            component.hasProAccess = true;
            component.isAdmin = false;
            component.serviceTokens = [{ accessToken: 'token', userName: 'suunto-user' } as any];
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
            component.serviceTokens = [{ accessToken: 'token', userName: 'suunto-user' } as any];
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
            fixture.detectChanges();

            await component.queueRoutesFromSuunto(new MouseEvent('click'));

            expect(mockUserService.addSuuntoRoutesToQueueForCurrentUser).toHaveBeenCalled();
            expect(mockSnackBar.open).toHaveBeenCalledWith('Queued 2 routes. Skipped 1.', undefined, { duration: 3500 });
        });

        it('renders Suunto to Garmin course delivery controls for a regular user', () => {
            component.user = {
                uid: 'user-1',
                settings: {
                    serviceSyncSettings: {
                        routeDeliverySyncRoutes: {
                            [ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI]: { enabled: false },
                        },
                    },
                },
            } as any;
            component.hasProAccess = true;
            component.serviceTokens = [{ accessToken: 'token', userName: 'suunto-user' } as any];
            component.garminRouteSendContext = {
                connected: true,
                reconnectRequired: false,
                missingPermissions: [],
                providerUserId: 'garmin-user',
                providerStates: [],
                serviceMeta: null,
                permissionPromptSource: null,
            };
            component.activeProviderTool = 'routes';
            fixture.detectChanges();

            const content = fixture.nativeElement.textContent;
            expect(component.isSuuntoToGarminRouteAvailableForUser).toBe(true);
            expect(content).toContain('Suunto -> Garmin Course Delivery');
            expect(content).toContain('Queue now');
            expect(content).toContain('only uses routes already saved in Quantified Self');
            expect(component.canEnableSuuntoToGarminRoute).toBe(true);
        });

        it('blocks enabling Suunto to Garmin delivery when Garmin COURSE_IMPORT is missing', async () => {
            component.user = { uid: 'user-1', settings: {} } as any;
            component.hasProAccess = true;
            component.serviceTokens = [{ accessToken: 'token', userName: 'suunto-user' } as any];
            component.garminRouteSendContext = {
                connected: true,
                reconnectRequired: false,
                missingPermissions: ['COURSE_IMPORT'],
                providerUserId: 'garmin-user',
                providerStates: [],
                serviceMeta: null,
                permissionPromptSource: 'source',
            };
            component.activeProviderTool = 'routes';
            fixture.detectChanges();

            await component.onSuuntoToGarminRouteToggle(true);

            expect(mockUserService.updateRouteDeliverySyncRouteSettings).not.toHaveBeenCalled();
            expect(mockSnackBar.open).toHaveBeenCalledWith(
                'Connect Suunto and Garmin with Garmin Course Import permission before enabling route delivery.',
                undefined,
                { duration: 4500 },
            );
        });

        it('blocks enabling Suunto to Garmin delivery while Suunto connection details are still loading', async () => {
            component.user = { uid: 'user-1', settings: {} } as any;
            component.hasProAccess = true;
            component.forceConnected = true;
            component.serviceTokens = undefined;
            component.garminRouteSendContext = {
                connected: true,
                reconnectRequired: false,
                missingPermissions: [],
                providerUserId: 'garmin-user',
                providerStates: [],
                serviceMeta: null,
                permissionPromptSource: null,
            };
            component.activeProviderTool = 'routes';
            fixture.detectChanges();

            expect(component.isConnectedToService()).toBe(true);
            expect(component.hasConnectedSuuntoAccount).toBe(false);
            expect(component.canEnableSuuntoToGarminRoute).toBe(false);

            await component.onSuuntoToGarminRouteToggle(true);

            expect(mockUserService.updateRouteDeliverySyncRouteSettings).not.toHaveBeenCalled();
            expect(mockSnackBar.open).toHaveBeenCalledWith(
                'Connect Suunto and Garmin with Garmin Course Import permission before enabling route delivery.',
                undefined,
                { duration: 4500 },
            );
        });

        it('writes route delivery sync settings when toggled by a ready user', async () => {
            component.user = { uid: 'user-1', settings: {} } as any;
            component.hasProAccess = true;
            component.serviceTokens = [{ accessToken: 'token', userName: 'suunto-user' } as any];
            component.garminRouteSendContext = {
                connected: true,
                reconnectRequired: false,
                missingPermissions: [],
                providerUserId: 'garmin-user',
                providerStates: [],
                serviceMeta: null,
                permissionPromptSource: null,
            };
            fixture.detectChanges();

            await component.onSuuntoToGarminRouteToggle(true);

            expect(mockUserService.updateRouteDeliverySyncRouteSettings).toHaveBeenCalledWith(component.user, {
                [ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI]: true,
            });
            expect(mockSnackBar.open).toHaveBeenCalledWith('Suunto to Garmin route delivery enabled.', undefined, { duration: 3000 });
        });

        it('queues Suunto to Garmin delivery from saved Quantified Self routes', async () => {
            component.user = { uid: 'user-1', settings: {} } as any;
            component.hasProAccess = true;
            component.serviceTokens = [{ accessToken: 'token', userName: 'suunto-user' } as any];
            component.garminRouteSendContext = {
                connected: true,
                reconnectRequired: false,
                missingPermissions: [],
                providerUserId: 'garmin-user',
                providerStates: [],
                serviceMeta: null,
                permissionPromptSource: null,
            };
            fixture.detectChanges();

            await component.queueSuuntoToGarminRouteDelivery(new MouseEvent('click'));

            expect(mockUserService.backfillRouteDeliverySyncRouteForCurrentUser).toHaveBeenCalledWith(
                ServiceNames.SuuntoApp,
                ServiceNames.GarminAPI,
            );
            expect(component.routeDeliveryBackfillSummary).toEqual({
                scanned: 2,
                queued: 1,
                skippedByReason: { already_synced: 1 },
                failedCount: 0,
                failedRoutes: [],
            });
            expect(mockSnackBar.open).toHaveBeenCalledWith('Queued 1 route delivery job(s).', undefined, { duration: 4000 });
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
        component.serviceTokens = [{ accessToken: 'token', userName: 'suunto-user' } as any];
        fixture.detectChanges();

        const warningPill = fixture.nativeElement.querySelector('.active-sync-warning-pill');
        expect(warningPill).toBeTruthy();
        expect((warningPill.textContent || '').trim()).toContain('Used by active auto-sync route');
    });

    it('should show inline warning pill when connected service is used by active route delivery sync', () => {
        component.hasProAccess = true;
        component.user = {
            uid: 'u-1',
            settings: {
                serviceSyncSettings: {
                    routeDeliverySyncRoutes: {
                        [ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI]: { enabled: true }
                    }
                }
            }
        } as any;
        component.serviceTokens = [{ accessToken: 'token', userName: 'suunto-user' } as any];
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
        component.serviceTokens = [{ accessToken: 'token', userName: 'suunto-user' } as any];
        mockDialog.open.mockReturnValueOnce({
            afterClosed: () => of(false),
        });

        await component.deauthorizeService(new MouseEvent('click'));

        expect(mockDialog.open).toHaveBeenCalled();
        expect(mockUserService.deauthorizeService).not.toHaveBeenCalled();
    });

    it('treats malformed Suunto tokens without a provider identity as disconnected', () => {
        component.hasProAccess = true;
        component.serviceTokens = [{ accessToken: 'token', dateCreated: 1711000000000 } as any];
        fixture.detectChanges();

        expect(component.connectionView.connected).toBe(false);
        expect(component.isConnectedToService()).toBe(false);
        expect(component.connectedSuuntoServiceTokens).toEqual([]);
        expect(fixture.nativeElement.querySelector('app-history-import-form')).toBeFalsy();
        expect(fixture.nativeElement.querySelector('app-upload-activity-to-service')).toBeFalsy();
        expect(fixture.nativeElement.querySelector('app-upload-route-to-service')).toBeFalsy();
        expect(fixture.nativeElement.textContent).toContain('before importing history');
        expect(fixture.nativeElement.textContent).toContain('before uploading activities');
        expect(fixture.nativeElement.textContent).toContain('before uploading routes');
    });

    it('shows only valid connected Suunto accounts when malformed tokens are mixed in', () => {
        component.hasProAccess = true;
        component.serviceTokens = [
            { accessToken: 'broken-token', dateCreated: 1710000000000 } as any,
            { accessToken: 'token', userName: 'suunto-user', dateCreated: 1711000000000 } as any,
        ];
        fixture.detectChanges();

        const accountTitles = Array.from(
            fixture.nativeElement.querySelectorAll('.connected-account-title'),
        ).map((element: Element) => element.textContent?.trim());

        expect(component.isConnectedToService()).toBe(true);
        expect(component.connectedSuuntoServiceTokens).toHaveLength(1);
        expect(component.connectedSuuntoAccounts).toHaveLength(1);
        expect(component.connectedSuuntoAccounts[0].userName).toBe('suunto-user');
        expect(accountTitles).toEqual(['suunto-user']);
        expect(fixture.nativeElement.textContent).not.toContain('Syncing connection details...');
    });

    it('renders connected Suunto accounts in a stable sorted order', () => {
        component.hasProAccess = true;
        component.serviceTokens = [
            { accessToken: 'token-b', userName: 'bravo', dateCreated: 1711000000000 } as any,
            { accessToken: 'token-a', userName: 'alpha', dateCreated: 1710000000000 } as any,
        ];
        fixture.detectChanges();

        const accountTitles = Array.from(
            fixture.nativeElement.querySelectorAll('.connected-account-title'),
        ).map((element: Element) => element.textContent?.trim());

        expect(component.connectedSuuntoAccounts.map(account => account.userName)).toEqual(['alpha', 'bravo']);
        expect(accountTitles).toEqual(['alpha', 'bravo']);
        expect(component.connectedSuuntoAccounts[0].trackKey).toBe('alpha:1710000000000');
    });
});
