
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
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatButtonModule } from '@angular/material/button';
import { MatListModule } from '@angular/material/list';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressBarModule } from '@angular/material/progress-bar';
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
            navigate: vi.fn().mockResolvedValue(true)
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
            getUserMetaForService: vi.fn().mockReturnValue(of(undefined)),
            updateUserProperties: vi.fn().mockResolvedValue(undefined),
            backfillActivitySyncRouteForCurrentUser: vi.fn().mockResolvedValue({ scanned: 0, queued: 0, skippedByReason: {}, failedCount: 0, failedEvents: [] }),
            deauthorizeService: vi.fn().mockResolvedValue(undefined),
        };

        await TestBed.configureTestingModule({
            declarations: [ServicesGarminComponent, ServiceSyncingStateComponent],
            imports: [
                MatCardModule,
                MatIconModule,
                HttpClientTestingModule,
                MatSnackBarModule,
                RouterTestingModule,
                FormsModule,
                MatDatepickerModule,
                MatNativeDateModule,
                MatInputModule,
                MatFormFieldModule,
                MatSlideToggleModule,
                MatButtonModule,
                MatListModule,
                MatDividerModule,
                MatProgressBarModule,
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

        it('should be unlocked/available if user has pro access AND is connected', () => {
            component.hasProAccess = true;
            component.isAdmin = false;
            // Mock connected state
            component.serviceTokens = [{ accessToken: 'token', permissions: [] } as any];
            fixture.detectChanges();

            const card = fixture.nativeElement.querySelectorAll('.feature-card')[1];
            const lockOverlay = card.querySelector('.lock-overlay');
            const historyForm = card.querySelector('app-history-import-form');

            expect(card.classList).not.toContain('locked');
            expect(lockOverlay).toBeFalsy();
            expect(historyForm).toBeTruthy();
        });

        it('should show connect message if user has pro access but is NOT connected', () => {
            component.hasProAccess = true;
            component.serviceTokens = []; // Not connected
            fixture.detectChanges();

            const card = fixture.nativeElement.querySelectorAll('.feature-card')[1];
            const historyForm = card.querySelector('app-history-import-form');
            // We look for the text content since we don't have a specific class on the new div
            const cardContent = card.textContent;

            expect(historyForm).toBeFalsy();
            expect(cardContent).toContain('Connect Account First');
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
                `Successfully connected to ${component.serviceName}`,
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
                'Garmin is temporarily unavailable. Please try again later.',
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
            mockUserService.getServiceToken
                .mockReturnValueOnce(of([{ accessToken: 'garmin-token', permissions: [] }]))
                .mockReturnValueOnce(of([{ accessToken: 'suunto-token' }]));

            await component.ngOnChanges();
            fixture.detectChanges();

            const routeToggle = fixture.nativeElement.querySelector('mat-slide-toggle');
            expect(routeToggle).toBeTruthy();
        });

        it('should persist Garmin->Suunto route toggle to settings', async () => {
            component.hasProAccess = true;
            component.user = { uid: ACTIVITY_SYNC_ALLOWLISTED_UID, settings: {} } as any;
            component.serviceTokens = [{ accessToken: 'garmin-token', permissions: [] }] as any;
            (component as any).suuntoTokens = [{ accessToken: 'suunto-token' }];

            await component.onGarminToSuuntoRouteToggle(true);

            expect(mockUserService.updateUserProperties).toHaveBeenCalledWith(component.user, {
                settings: {
                    serviceSyncSettings: {
                        activitySyncRoutes: {
                            [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: {
                                enabled: true
                            }
                        }
                    }
                }
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
            (component as any).suuntoTokens = [{ accessToken: 'suunto-token' }];

            await component.onGarminToSuuntoRouteToggle(true);

            expect(mockUserService.updateUserProperties).not.toHaveBeenCalled();
            expect(snackBarSpy).toHaveBeenCalledWith(
                'Connect both Garmin and Suunto accounts before enabling sync.',
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
            (component as any).suuntoTokens = [] as any;

            await component.onGarminToSuuntoRouteToggle(false);

            expect(mockUserService.updateUserProperties).toHaveBeenCalledWith(component.user, {
                settings: {
                    serviceSyncSettings: {
                        activitySyncRoutes: {
                            [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: {
                                enabled: false
                            }
                        }
                    }
                }
            });
            expect(mockAnalyticsService.logActivitySyncRouteToggle).toHaveBeenCalledWith(
                ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
                false
            );
        });

        it('should allow manual catch-up when auto-sync toggle is disabled', () => {
            component.hasProAccess = true;
            component.user = { uid: ACTIVITY_SYNC_ALLOWLISTED_UID, settings: {} } as any;
            component.serviceTokens = [{ accessToken: 'garmin-token', permissions: [] }] as any;
            (component as any).suuntoTokens = [{ accessToken: 'suunto-token' }];
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

        it('should show activity sync card for users outside the old rollout UID list', () => {
            component.hasProAccess = true;
            component.user = { uid: 'non-allowlisted-user', settings: {} } as any;
            fixture.detectChanges();

            expect(fixture.nativeElement.textContent).toContain('Garmin -> Suunto Sync');
        });

        it('should render failed backfill events in the summary', () => {
            component.hasProAccess = true;
            component.user = { uid: ACTIVITY_SYNC_ALLOWLISTED_UID, settings: {} } as any;
            component.serviceTokens = [{ accessToken: 'garmin-token', permissions: [] }] as any;
            (component as any).suuntoTokens = [{ accessToken: 'suunto-token' }];
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
            component.serviceTokens = [{ accessToken: 'garmin-token', permissions: [] }] as any;
            (component as any).suuntoTokens = [{ accessToken: 'suunto-token' }];

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
            component.serviceTokens = [{ accessToken: 'garmin-token', permissions: [] }] as any;
            (component as any).suuntoTokens = [{ accessToken: 'suunto-token' }];
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
            component.serviceTokens = [{ accessToken: 'garmin-token', permissions: [] }] as any;
            (component as any).suuntoTokens = [{ accessToken: 'suunto-token' }];

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
            component.serviceTokens = [{ accessToken: 'garmin-token', permissions: [] }] as any;
            (component as any).suuntoTokens = [{ accessToken: 'suunto-token' }];
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
            component.serviceTokens = [{ accessToken: 'garmin-token', permissions: [] }] as any;
            (component as any).suuntoTokens = [{ accessToken: 'suunto-token' }];

            await component.deauthorizeService(new MouseEvent('click'));

            expect(mockDialog.open).not.toHaveBeenCalled();
            expect(mockUserService.deauthorizeService).toHaveBeenCalledWith(component.serviceName);
        });
    });
});
