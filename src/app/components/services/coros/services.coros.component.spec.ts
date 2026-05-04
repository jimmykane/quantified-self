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
import { LoggerService } from '../../../services/logger.service';
import { AppAnalyticsService } from '../../../services/app.analytics.service';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { of } from 'rxjs';
import { ACTIVITY_SYNC_ROUTE_IDS } from '@shared/activity-sync-routes';
import { ServiceConnectionStatusComponent } from '../service-connection-status/service-connection-status.component';

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
            getCurrentUserServiceTokenAndRedirectURI: vi.fn(),
            getServiceToken: vi.fn().mockReturnValue(of([])),
            getUserMetaForService: vi.fn().mockReturnValue(of(undefined)),
            updateUserProperties: vi.fn().mockResolvedValue(undefined),
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
                MatListModule,
                MatDividerModule,
                MatProgressBarModule,
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
        const providerTabs = fixture.nativeElement.querySelectorAll('mat-tab');

        expect(connectionStatus).toBeTruthy();
        expect(connectionStatus.textContent).toContain('COROS connection');
        expect(providerToolTabs.hasAttribute('ng-reflect-dynamic-height')).toBe(false);
        expect(providerTabs.length).toBe(1);
        expect(fixture.nativeElement.querySelector('mat-tab .service-connection-status')).toBeFalsy();
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
        expect(accountRow.querySelector('.connection-disconnect-button')?.textContent).toContain('Disconnect');
        expect(fixture.nativeElement.querySelector('.service-connection-status__actions .connection-disconnect-button')).toBeFalsy();
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
            component.serviceTokens = [];
            fixture.detectChanges();

            const historyForm = fixture.nativeElement.querySelector('app-history-import-form');
            const content = fixture.nativeElement.textContent;

            expect(historyForm).toBeFalsy();
            expect(content).toContain('before importing history');
        });
    });

    describe('FIT Upload Card', () => {
        it('should hide upload card by default', () => {
            component.hasProAccess = true;
            component.serviceTokens = [{ accessToken: 'coros-token' } as any];
            fixture.detectChanges();

            const uploadComponent = fixture.nativeElement.querySelector('app-upload-activity-to-service');
            const content = fixture.nativeElement.textContent;
            expect(uploadComponent).toBeFalsy();
            expect(content).not.toContain('Upload FIT Activity');
        });
    });

    describe('Activity Sync Card', () => {
        it('should show route toggle when COROS and Suunto are connected', () => {
            component.hasProAccess = true;
            component.user = { uid: 'user-1', settings: {} } as any;
            component.serviceTokens = [{ accessToken: 'coros-token' }] as any;
            (component as any).suuntoTokens = [{ accessToken: 'suunto-token' }];
            fixture.detectChanges();

            const routeToggle = fixture.nativeElement.querySelector('mat-slide-toggle');
            expect(routeToggle).toBeTruthy();
        });

        it('should persist COROS->Suunto route toggle to settings', async () => {
            component.hasProAccess = true;
            component.user = { uid: 'user-1', settings: {} } as any;
            component.serviceTokens = [{ accessToken: 'coros-token' }] as any;
            (component as any).suuntoTokens = [{ accessToken: 'suunto-token' }];

            await component.onCorosToSuuntoRouteToggle(true);

            expect(mockUserService.updateUserProperties).toHaveBeenCalledWith(component.user, {
                settings: {
                    serviceSyncSettings: {
                        activitySyncRoutes: {
                            [ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_SuuntoApp]: {
                                enabled: true
                            }
                        }
                    }
                }
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
            (component as any).suuntoTokens = [{ accessToken: 'suunto-token' }];

            await component.onCorosToSuuntoRouteToggle(true);

            expect(mockUserService.updateUserProperties).not.toHaveBeenCalled();
            expect(snackBarSpy).toHaveBeenCalledWith(
                'Connect both COROS and Suunto accounts before enabling sync.',
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
            (component as any).suuntoTokens = [] as any;

            await component.onCorosToSuuntoRouteToggle(false);

            expect(mockUserService.updateUserProperties).toHaveBeenCalledWith(component.user, {
                settings: {
                    serviceSyncSettings: {
                        activitySyncRoutes: {
                            [ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_SuuntoApp]: {
                                enabled: false
                            }
                        }
                    }
                }
            });
            expect(mockAnalyticsService.logActivitySyncRouteToggle).toHaveBeenCalledWith(
                ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_SuuntoApp,
                false
            );
        });

        it('should allow manual catch-up when auto-sync toggle is disabled', () => {
            component.hasProAccess = true;
            component.user = { uid: 'user-1', settings: {} } as any;
            component.serviceTokens = [{ accessToken: 'coros-token' }] as any;
            (component as any).suuntoTokens = [{ accessToken: 'suunto-token' }];
            component.isBackfillingSync = false;
            component.backfillStartDate = new Date('2026-01-01T00:00:00.000Z');
            component.backfillEndDate = new Date('2026-01-31T00:00:00.000Z');

            fixture.detectChanges();

            const queueButton = Array.from(fixture.nativeElement.querySelectorAll('button'))
                .find((button: HTMLButtonElement) => (button.textContent || '').includes('Queue now')) as HTMLButtonElement | undefined;

            expect(component.isCorosToSuuntoRouteEnabled).toBe(false);
            expect(queueButton).toBeTruthy();
            expect(queueButton?.disabled).toBe(false);
        });

        it('should show activity sync card for users outside the old rollout UID list', () => {
            component.hasProAccess = true;
            component.user = { uid: 'non-allowlisted-user', settings: {} } as any;
            fixture.detectChanges();

            expect(fixture.nativeElement.textContent).toContain('COROS -> Suunto Sync');
        });

        it('should render failed backfill events in the summary', () => {
            component.hasProAccess = true;
            component.user = { uid: 'user-1', settings: {} } as any;
            component.serviceTokens = [{ accessToken: 'coros-token' }] as any;
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
            component.user = { uid: 'user-1', settings: {} } as any;
            component.serviceTokens = [{ accessToken: 'coros-token' }] as any;
            (component as any).suuntoTokens = [{ accessToken: 'suunto-token' }];

            fixture.detectChanges();

            const infoBlock = fixture.nativeElement.querySelector('app-status-info[title="Manual Catch-up Scope"]');
            const content = fixture.nativeElement.textContent;
            expect(infoBlock).toBeTruthy();
            expect(content).toContain('Use this anytime to queue COROS -> Suunto sync jobs');
            expect(content).toContain('activities already imported into Quantified Self');
            expect(content).toContain('uses stored original files');
            expect(content).toContain('can run even when automatic sync is turned off');
        });

        it('should log route backfill analytics when catch-up succeeds', async () => {
            component.hasProAccess = true;
            component.user = { uid: 'user-1', settings: {} } as any;
            component.serviceTokens = [{ accessToken: 'coros-token' }] as any;
            (component as any).suuntoTokens = [{ accessToken: 'suunto-token' }];
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
        component.serviceTokens = [{ accessToken: 'coros-token' }] as any;
        (component as any).suuntoTokens = [{ accessToken: 'suunto-token' }];
        fixture.detectChanges();

        const warningPill = fixture.nativeElement.querySelector('.active-sync-warning-pill');
        expect(warningPill).toBeTruthy();
        expect((warningPill.textContent || '').trim()).toContain('Used by active auto-sync route');
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
        component.serviceTokens = [{ accessToken: 'coros-token' }] as any;
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
});
