import { ComponentFixture, TestBed } from '@angular/core/testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DashboardComponent } from './dashboard.component';
import { AppAuthService } from '../../authentication/app.auth.service';
import { AppEventService } from '../../services/app.event.service';
import { AppUserService } from '../../services/app.user.service';
import { Router, ActivatedRoute } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of, Subject } from 'rxjs';
import {
    ActivityTypes,
    DateRanges,
    DistanceUnits,
    PaceUnits,
    SpeedUnits,
    SwimPaceUnits,
    ServiceNames,
    User,
    VerticalSpeedUnits
} from '@sports-alliance/sports-lib';
import { AppUserInterface } from '../../models/app-user.interface';
import { Analytics } from 'app/firebase/analytics';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { LoggerService } from '../../services/logger.service';
import { ACTIVITY_SYNC_ROUTE_IDS } from '@shared/activity-sync-routes';
import { AppWindowService } from '../../services/app.window.service';
import { buildSuuntoServiceConnectionViewModel } from '../../helpers/suunto-service-connection.helper';
import { AppSleepService } from '../../services/app.sleep.service';
import { SLEEP_PROVIDERS } from '@shared/sleep';
import { MaterialModule } from '../../modules/material.module';

describe('DashboardComponent', () => {
    let component: DashboardComponent;
    let fixture: ComponentFixture<DashboardComponent>;

    let mockAuthService: any;
    let mockEventService: any;
    let mockUserService: any;
    let mockRouter: any;
    let mockActivatedRoute: any;
    let mockDialog: any;
    let mockSnackBar: any;
    let mockLogger: any;
    let mockSleepService: any;

    const mockUser = new User('testUser') as AppUserInterface;

    afterEach(() => {
        vi.useRealTimers();
    });

    beforeEach(async () => {
        mockUser.settings = {
            appSettings: {},
            dashboardSettings: {
                dateRange: 0,
                startDate: null,
                endDate: null,
                activityTypes: [],
                tableSettings: {}
            },
            unitSettings: { startOfTheWeek: 1 },
            chartSettings: {}
        } as any;
        mockUser.stripeRole = null;
        mockUser.admin = false;

        mockAuthService = {
            user$: of(mockUser),

        };

        mockEventService = {
            getEventsBy: vi.fn().mockReturnValue(of([{ id: 'event1' }])),
            getEventCount: vi.fn().mockResolvedValue(1),
            hasAnyActivity: vi.fn().mockResolvedValue(true)
        };

        mockUserService = {
            getUserByID: vi.fn().mockReturnValue(of(new User('targetUser'))),
            shouldShowPromo: vi.fn().mockReturnValue(false),
            updateUserProperties: vi.fn().mockReturnValue(Promise.resolve()),
            updateActivitySyncRouteSettings: vi.fn().mockReturnValue(Promise.resolve()),
            backfillGarminSleepForCurrentUser: vi.fn().mockResolvedValue({
                queued: 43,
                startDate: '2016-01-01T00:00:00.000Z',
                endDate: '2026-04-30T12:00:00.000Z',
                nextAllowedAtMs: 1_780_231_200_000,
            }),
            getCurrentUserServiceTokenAndRedirectURI: vi.fn().mockResolvedValue({ redirect_uri: 'https://suunto.example/connect' }),
            getUserMetaForService: vi.fn().mockReturnValue(of(undefined)),
            getServiceToken: vi.fn().mockReturnValue(of([{
                permissions: ['HISTORICAL_DATA_EXPORT', 'HEALTH_EXPORT'],
            }])),
            watchSuuntoServiceConnectionView: vi.fn().mockReturnValue(of(buildSuuntoServiceConnectionViewModel({
                hasToken: false,
                serviceMeta: null,
            }))),
            watchHasAnyActivityServiceConnection: vi.fn().mockReturnValue(of(false)),
            watchActivityServiceConnectionState: vi.fn().mockReturnValue(of({
                [ServiceNames.GarminAPI]: false,
                [ServiceNames.SuuntoApp]: false,
                [ServiceNames.COROSAPI]: false,
            }))
        };
        mockSleepService = {
            watchSyncState: vi.fn().mockReturnValue(of(null)),
        };

        mockRouter = { navigate: vi.fn().mockResolvedValue(true) };

        mockActivatedRoute = {
            snapshot: {
                paramMap: {
                    get: (_key: string) => null
                },
                data: {
                    dashboardData: {
                        events: [{ id: 'event1' }]
                    }
                }
            }
        };

        mockDialog = { open: vi.fn() };
        mockSnackBar = { open: vi.fn() };
        mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() };

        await TestBed.configureTestingModule({
            imports: [MaterialModule, NoopAnimationsModule],
            declarations: [DashboardComponent],
            providers: [
                { provide: AppAuthService, useValue: mockAuthService },
                { provide: AppEventService, useValue: mockEventService },
                { provide: AppUserService, useValue: mockUserService },
                { provide: Router, useValue: mockRouter },
                { provide: ActivatedRoute, useValue: mockActivatedRoute },
                { provide: MatDialog, useValue: mockDialog },
                { provide: MatSnackBar, useValue: mockSnackBar },
                { provide: Analytics, useValue: null },
                { provide: LoggerService, useValue: mockLogger },
                { provide: AppWindowService, useValue: { windowRef: { location: { href: '' } } } },
                { provide: AppSleepService, useValue: mockSleepService },
            ],
            schemas: [NO_ERRORS_SCHEMA]
        })
            .compileComponents();
    });

    beforeEach(() => {
        fixture = TestBed.createComponent(DashboardComponent);
        component = fixture.componentInstance;
    });

    it('should create', () => {
        fixture.detectChanges();
        expect(component).toBeTruthy();
    });

    it('should place event search filters inside the event table toolbar slot', () => {
        mockActivatedRoute.snapshot.data.dashboardData.user = mockUser;

        fixture.detectChanges();

        const projectedSearch = fixture.nativeElement.querySelector(
            'app-event-table app-event-search[event-table-filters].table-toolbar-layout.compact-filter-layout'
        ) as HTMLElement;

        expect(projectedSearch).toBeTruthy();
    });

    it('renders dashboard summaries eagerly before the event table to avoid layout shifts', () => {
        mockActivatedRoute.snapshot.data.dashboardData.user = mockUser;

        fixture.detectChanges();

        const summaries = fixture.nativeElement.querySelector('app-summaries') as HTMLElement;
        const eventTable = fixture.nativeElement.querySelector('app-event-table') as HTMLElement;
        const template = readFileSync(resolve(process.cwd(), 'src/app/components/dashboard/dashboard.component.html'), 'utf8');

        expect(summaries).toBeTruthy();
        expect(eventTable).toBeTruthy();
        expect(summaries.compareDocumentPosition(eventTable) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(template).not.toContain('@defer');
    });

    it('should use resolved events on init', async () => {
        fixture.detectChanges(); // Trigger ngOnInit
        await fixture.whenStable(); // Wait for async operations to complete

        expect(mockEventService.getEventsBy).toHaveBeenCalled();
        expect(component.events.length).toBe(1);
        expect(component.isLoading).toBe(false);
    });

    it('redirects signed-out dashboard visitors to login without opening a snackbar', async () => {
        mockAuthService.user$ = of(null);

        fixture.detectChanges();
        await fixture.whenStable();

        expect(mockRouter.navigate).toHaveBeenCalledWith(['login']);
        expect(mockSnackBar.open).not.toHaveBeenCalled();
    });

    it('shows unit setup prompt for owner dashboard when setup is explicitly incomplete', async () => {
        (mockUser.settings.appSettings as any).unitSetupCompleted = false;

        fixture.detectChanges();
        await fixture.whenStable();

        expect(component.showUnitSetupPrompt).toBe(true);
    });

    it('does not show unit setup prompt on another user dashboard', async () => {
        (mockUser.settings.appSettings as any).unitSetupCompleted = false;
        mockActivatedRoute.snapshot.data.dashboardData.user = mockUser;
        mockActivatedRoute.snapshot.data.dashboardData.targetUser = { uid: 'other-user' };

        fixture.detectChanges();
        await fixture.whenStable();

        expect(component.showUnitSetupPrompt).toBe(false);
    });

    it('does not show unit setup prompt for legacy users missing the marker', async () => {
        delete (mockUser.settings.appSettings as any).unitSetupCompleted;

        fixture.detectChanges();
        await fixture.whenStable();

        expect(component.showUnitSetupPrompt).toBe(false);
    });

    it('shows first activity upload prompt for free owner dashboards with no uploaded activities', async () => {
        mockUser.stripeRole = 'free';
        mockEventService.getEventCount.mockResolvedValue(0);

        fixture.detectChanges();
        await fixture.whenStable();

        expect(mockEventService.getEventCount).toHaveBeenCalledWith(mockUser);
        expect(component.dashboardActionPrompts.some(prompt => prompt.id === 'firstActivityUpload')).toBe(true);
    });

    it('shows first activity upload prompt for basic owner dashboards with no uploaded activities', async () => {
        mockUser.stripeRole = 'basic';
        mockEventService.getEventCount.mockResolvedValue(0);

        fixture.detectChanges();
        await fixture.whenStable();

        expect(mockEventService.getEventCount).toHaveBeenCalledWith(mockUser);
        expect(component.dashboardActionPrompts.some(prompt => prompt.id === 'firstActivityUpload')).toBe(true);
    });

    it('shows first activity upload prompt for admin owner dashboards with no uploaded activities', async () => {
        mockUser.admin = true;
        mockUser.stripeRole = 'free';
        mockEventService.getEventCount.mockResolvedValue(0);

        fixture.detectChanges();
        await fixture.whenStable();

        expect(mockEventService.getEventCount).toHaveBeenCalledWith(mockUser);
        expect(component.dashboardActionPrompts.some(prompt => prompt.id === 'firstActivityUpload')).toBe(true);
    });

    it('does not show first activity upload prompt when the user already has activities', async () => {
        mockUser.stripeRole = 'free';
        mockEventService.getEventCount.mockResolvedValue(3);

        fixture.detectChanges();
        await fixture.whenStable();

        expect(component.dashboardActionPrompts.some(prompt => prompt.id === 'firstActivityUpload')).toBe(false);
    });

    it('does not show first activity upload prompt when dismissed', async () => {
        mockUser.stripeRole = 'free';
        mockUser.settings.appSettings = {
            dashboardActionPrompts: {
                firstActivityUpload: {
                    state: 'dismissed',
                    dismissedAt: 1,
                },
            },
        } as any;
        mockEventService.getEventCount.mockResolvedValue(0);

        fixture.detectChanges();
        await fixture.whenStable();

        expect(component.dashboardActionPrompts.some(prompt => prompt.id === 'firstActivityUpload')).toBe(false);
        expect(mockEventService.getEventCount).not.toHaveBeenCalled();
    });

    it('does not count activities for pro users when evaluating first activity upload prompt', async () => {
        mockUser.stripeRole = 'pro';

        fixture.detectChanges();
        await fixture.whenStable();

        expect(mockEventService.getEventCount).not.toHaveBeenCalled();
        expect(component.dashboardActionPrompts.some(prompt => prompt.id === 'firstActivityUpload')).toBe(false);
    });

    it('shows the no-activity dashboard state for owner dashboards without activities', async () => {
        mockActivatedRoute.snapshot.data.dashboardData.events = [];
        mockEventService.getEventsBy.mockReturnValue(of([]));
        mockEventService.hasAnyActivity.mockResolvedValue(false);
        mockUser.stripeRole = 'pro';
        mockUser.settings.appSettings = {};
        mockUserService.watchActivityServiceConnectionState.mockReturnValue(of({
            [ServiceNames.GarminAPI]: false,
            [ServiceNames.SuuntoApp]: false,
            [ServiceNames.COROSAPI]: false,
        }));

        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        const text = fixture.nativeElement.textContent;
        const template = readFileSync(resolve(process.cwd(), 'src/app/components/dashboard/dashboard.component.html'), 'utf8');
        expect(mockEventService.hasAnyActivity).toHaveBeenCalledWith(mockUser);
        expect(component.showNoActivityDashboardState).toBe(true);
        expect(text).toContain('No activities yet');
        expect(text).toContain('Upload an activity file or connect Garmin, Suunto, or COROS.');
        expect(template).toContain('[fullWidth]="true"');
        expect(template).toContain('uploadLabel="Upload activity"');
        expect(component.dashboardActionPrompts.some(prompt => prompt.id === 'connectActivityService')).toBe(false);
    });

    it('does not show the no-activity dashboard state on another user dashboard', async () => {
        mockActivatedRoute.snapshot.data.dashboardData.user = mockUser;
        mockActivatedRoute.snapshot.data.dashboardData.targetUser = { uid: 'other-user' };
        mockEventService.hasAnyActivity.mockResolvedValue(false);

        fixture.detectChanges();
        await fixture.whenStable();

        expect(mockEventService.hasAnyActivity).not.toHaveBeenCalled();
        expect(component.showNoActivityDashboardState).toBe(false);
    });

    it('uses the shared overlay surface for the no-activity dashboard state', () => {
        const styles = readFileSync(resolve(process.cwd(), 'src/app/components/dashboard/dashboard.component.scss'), 'utf8');

        expect(styles).toContain('.dashboard-no-activity {');
        expect(styles).toContain('--mdc-outlined-card-container-color: var(--qs-overlay-surface);');
        expect(styles).toContain('--mdc-outlined-card-outline-color: var(--qs-overlay-surface-border);');
        expect(styles).toContain('background: var(--qs-overlay-surface);');
    });

    it('dismisses first activity upload prompt and persists action prompt state', async () => {
        mockUser.stripeRole = 'free';
        mockUser.settings.appSettings = {};
        component.user = mockUser;
        (component as any).uploadedActivityCount = 0;
        (component as any).syncDashboardActionPromptState();

        await component.dismissFirstActivityUploadPrompt();

        expect(mockUserService.updateUserProperties).toHaveBeenCalledWith(
            mockUser,
            {
                settings: {
                    appSettings: {
                        dashboardActionPrompts: {
                            firstActivityUpload: expect.objectContaining({
                                state: 'dismissed',
                                source: 'first-activity-upload',
                            }),
                        },
                    },
                },
            },
        );
        expect(component.dashboardActionPrompts.some(prompt => prompt.id === 'firstActivityUpload')).toBe(false);
    });

    it('shows service connection prompt for pro owner dashboard with no connected activity service', async () => {
        mockUser.stripeRole = 'pro';
        mockUser.settings.appSettings = {};
        mockUserService.watchActivityServiceConnectionState.mockReturnValue(of({
            [ServiceNames.GarminAPI]: false,
            [ServiceNames.SuuntoApp]: false,
            [ServiceNames.COROSAPI]: false,
        }));

        fixture.detectChanges();
        await fixture.whenStable();

        expect(component.dashboardActionPrompts.some(prompt => prompt.id === 'connectActivityService')).toBe(true);
    });

    it('does not show service connection prompt when an activity service is connected', async () => {
        mockUser.stripeRole = 'pro';
        mockUser.settings.appSettings = {};
        mockUserService.watchActivityServiceConnectionState.mockReturnValue(of({
            [ServiceNames.GarminAPI]: true,
            [ServiceNames.SuuntoApp]: false,
            [ServiceNames.COROSAPI]: false,
        }));

        fixture.detectChanges();
        await fixture.whenStable();

        expect(component.dashboardActionPrompts.some(prompt => prompt.id === 'connectActivityService')).toBe(false);
    });

    it('does not show service connection prompt when dismissed', async () => {
        mockUser.stripeRole = 'pro';
        mockUser.settings.appSettings = {
            dashboardActionPrompts: {
                connectActivityService: {
                    state: 'dismissed',
                    dismissedAt: 1,
                },
            },
        } as any;

        fixture.detectChanges();
        await fixture.whenStable();

        expect(component.dashboardActionPrompts.some(prompt => prompt.id === 'connectActivityService')).toBe(false);
    });

    it('does not show service connection prompt on another user dashboard', async () => {
        mockUser.stripeRole = 'pro';
        mockActivatedRoute.snapshot.data.dashboardData.user = mockUser;
        mockActivatedRoute.snapshot.data.dashboardData.targetUser = { uid: 'other-user' };

        fixture.detectChanges();
        await fixture.whenStable();

        expect(component.dashboardActionPrompts.some(prompt => prompt.id === 'connectActivityService')).toBe(false);
        expect(mockUserService.watchActivityServiceConnectionState).not.toHaveBeenCalled();
    });

    it('shows activity auto-sync prompt for pro owner dashboards with Suunto and a disabled connected source route', async () => {
        mockUser.stripeRole = 'pro';
        mockUser.settings.appSettings = {};
        mockUser.settings.serviceSyncSettings = {
            activitySyncRoutes: {
                [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: { enabled: false },
            },
        };
        mockUserService.watchActivityServiceConnectionState.mockReturnValue(of({
            [ServiceNames.GarminAPI]: true,
            [ServiceNames.SuuntoApp]: true,
            [ServiceNames.COROSAPI]: false,
        }));

        fixture.detectChanges();
        await fixture.whenStable();

        expect(component.dashboardActionPrompts.some(prompt => prompt.id === 'enableActivityAutoSync')).toBe(true);
        expect(component.dashboardActionPrompts.find(prompt => prompt.id === 'enableActivityAutoSync')?.description)
            .toContain('Automatically send new Garmin activities to Suunto');
    });

    it('does not show activity auto-sync prompt when Suunto requires reconnect despite a remaining token', async () => {
        mockUser.stripeRole = 'pro';
        mockUser.settings.appSettings = {};
        mockUser.settings.serviceSyncSettings = {
            activitySyncRoutes: {
                [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: { enabled: false },
            },
        };
        mockUserService.watchActivityServiceConnectionState.mockReturnValue(of({
            [ServiceNames.GarminAPI]: true,
            [ServiceNames.SuuntoApp]: true,
            [ServiceNames.COROSAPI]: false,
        }));
        mockUserService.watchSuuntoServiceConnectionView.mockReturnValue(of(buildSuuntoServiceConnectionViewModel({
            hasToken: true,
            serviceMeta: {
                connectionState: 'reconnect_required',
                lastAuthFailureMessage: 'invalid_grant',
            } as any,
        })));

        fixture.detectChanges();
        await fixture.whenStable();

        expect(component.dashboardActionPrompts.some(prompt => prompt.id === 'enableActivityAutoSync')).toBe(false);
        expect(component.dashboardActionPrompts.some(prompt => prompt.id === 'reconnectSuuntoService')).toBe(true);
    });

    it('shows activity auto-sync prompt for only the missing disabled route', async () => {
        mockUser.stripeRole = 'pro';
        mockUser.settings.appSettings = {};
        mockUser.settings.serviceSyncSettings = {
            activitySyncRoutes: {
                [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: { enabled: true },
                [ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_SuuntoApp]: { enabled: false },
            },
        };
        mockUserService.watchActivityServiceConnectionState.mockReturnValue(of({
            [ServiceNames.GarminAPI]: true,
            [ServiceNames.SuuntoApp]: true,
            [ServiceNames.COROSAPI]: true,
        }));

        fixture.detectChanges();
        await fixture.whenStable();

        const prompt = component.dashboardActionPrompts.find(prompt => prompt.id === 'enableActivityAutoSync');
        expect(prompt?.description).toContain('Automatically send new COROS activities to Suunto');
        expect(prompt?.description).not.toContain('Garmin and COROS');
    });

    it('does not show activity auto-sync prompt when dismissed', async () => {
        mockUser.stripeRole = 'pro';
        mockUser.settings.appSettings = {
            dashboardActionPrompts: {
                enableActivityAutoSync: {
                    state: 'dismissed',
                    dismissedAt: 1,
                },
            },
        } as any;
        mockUserService.watchActivityServiceConnectionState.mockReturnValue(of({
            [ServiceNames.GarminAPI]: true,
            [ServiceNames.SuuntoApp]: true,
            [ServiceNames.COROSAPI]: false,
        }));

        fixture.detectChanges();
        await fixture.whenStable();

        expect(component.dashboardActionPrompts.some(prompt => prompt.id === 'enableActivityAutoSync')).toBe(false);
    });

    it('does not show activity auto-sync prompt for non-pro users', async () => {
        mockUser.stripeRole = 'free';
        mockUser.settings.appSettings = {};
        mockUser.settings.serviceSyncSettings = {
            activitySyncRoutes: {
                [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: { enabled: false },
            },
        };

        fixture.detectChanges();
        await fixture.whenStable();

        expect(component.dashboardActionPrompts.some(prompt => prompt.id === 'enableActivityAutoSync')).toBe(false);
        expect(mockUserService.watchActivityServiceConnectionState).not.toHaveBeenCalled();
    });

    it('does not show activity auto-sync prompt without a Suunto connection', async () => {
        mockUser.stripeRole = 'pro';
        mockUser.settings.appSettings = {};
        mockUser.settings.serviceSyncSettings = {
            activitySyncRoutes: {
                [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: { enabled: false },
            },
        };
        mockUserService.watchActivityServiceConnectionState.mockReturnValue(of({
            [ServiceNames.GarminAPI]: true,
            [ServiceNames.SuuntoApp]: false,
            [ServiceNames.COROSAPI]: false,
        }));

        fixture.detectChanges();
        await fixture.whenStable();

        expect(component.dashboardActionPrompts.some(prompt => prompt.id === 'enableActivityAutoSync')).toBe(false);
    });

    it('does not show activity auto-sync prompt when all eligible routes are enabled', async () => {
        mockUser.stripeRole = 'pro';
        mockUser.settings.appSettings = {};
        mockUser.settings.serviceSyncSettings = {
            activitySyncRoutes: {
                [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: { enabled: true },
                [ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_SuuntoApp]: { enabled: true },
            },
        };
        mockUserService.watchActivityServiceConnectionState.mockReturnValue(of({
            [ServiceNames.GarminAPI]: true,
            [ServiceNames.SuuntoApp]: true,
            [ServiceNames.COROSAPI]: true,
        }));

        fixture.detectChanges();
        await fixture.whenStable();

        expect(component.dashboardActionPrompts.some(prompt => prompt.id === 'enableActivityAutoSync')).toBe(false);
    });

    it('does not show activity auto-sync prompt on another user dashboard', async () => {
        mockUser.stripeRole = 'pro';
        mockActivatedRoute.snapshot.data.dashboardData.user = mockUser;
        mockActivatedRoute.snapshot.data.dashboardData.targetUser = { uid: 'other-user' };
        mockUser.settings.appSettings = {};
        mockUser.settings.serviceSyncSettings = {
            activitySyncRoutes: {
                [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: { enabled: false },
            },
        };

        fixture.detectChanges();
        await fixture.whenStable();

        expect(component.dashboardActionPrompts.some(prompt => prompt.id === 'enableActivityAutoSync')).toBe(false);
        expect(mockUserService.watchActivityServiceConnectionState).not.toHaveBeenCalled();
    });

    it('enables missing activity auto-sync routes directly and keeps unrelated settings', async () => {
        mockUser.stripeRole = 'pro';
        mockUser.settings.appSettings = { theme: 'dark' } as any;
        mockUser.settings.dashboardSettings = {
            ...(mockUser.settings.dashboardSettings || {}),
            tiles: [{ name: 'Existing' }],
        } as any;
        mockUser.settings.serviceSyncSettings = {
            activitySyncRoutes: {
                [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: { enabled: false },
                [ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_SuuntoApp]: { enabled: false },
            },
        };
        (component as any).user = mockUser;
        (component as any).activityServiceConnectionState = {
            [ServiceNames.GarminAPI]: true,
            [ServiceNames.SuuntoApp]: true,
            [ServiceNames.COROSAPI]: true,
        };
        mockUserService.updateActivitySyncRouteSettings.mockImplementation(async (user: AppUserInterface, routeSettings: Record<string, boolean>) => {
            user.settings = user.settings || {} as any;
            user.settings.serviceSyncSettings = user.settings.serviceSyncSettings || {};
            user.settings.serviceSyncSettings.activitySyncRoutes = {
                ...(user.settings.serviceSyncSettings.activitySyncRoutes || {}),
            };
            Object.entries(routeSettings).forEach(([routeID, enabled]) => {
                user.settings!.serviceSyncSettings!.activitySyncRoutes![routeID as any] = { enabled };
            });
        });

        (component as any).syncDashboardActionPromptState();
        expect(component.dashboardActionPrompts.some(prompt => prompt.id === 'enableActivityAutoSync')).toBe(true);

        await component.enableActivityAutoSyncPrompt();

        expect(mockUserService.updateActivitySyncRouteSettings).toHaveBeenCalledWith(mockUser, {
            [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: true,
            [ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_SuuntoApp]: true,
        });
        expect(mockUser.settings.appSettings?.theme).toBe('dark');
        expect(mockUser.settings.dashboardSettings?.tiles).toEqual([{ name: 'Existing' }]);
        expect(mockSnackBar.open).toHaveBeenCalledWith(
            'New activities from Garmin and COROS will be sent to Suunto automatically.',
            undefined,
            { duration: 3000 },
        );
        expect(component.dashboardActionPrompts.some(prompt => prompt.id === 'enableActivityAutoSync')).toBe(false);
    });

    it('dismisses activity auto-sync prompt and persists action prompt state', async () => {
        mockUser.stripeRole = 'pro';
        mockUser.settings.appSettings = {};
        component.user = mockUser;
        (component as any).activityServiceConnectionState = {
            [ServiceNames.GarminAPI]: true,
            [ServiceNames.SuuntoApp]: true,
            [ServiceNames.COROSAPI]: false,
        };
        (component as any).syncDashboardActionPromptState();

        await component.dismissActivityAutoSyncPrompt();

        expect(mockUserService.updateUserProperties).toHaveBeenCalledWith(
            mockUser,
            {
                settings: {
                    appSettings: {
                        dashboardActionPrompts: {
                            enableActivityAutoSync: expect.objectContaining({
                                state: 'dismissed',
                                source: 'activity-auto-sync',
                            }),
                        },
                    },
                },
            },
        );
        expect(component.dashboardActionPrompts.some(prompt => prompt.id === 'enableActivityAutoSync')).toBe(false);
    });

    it('shows Garmin sleep backfill prompt for eligible connected Pro owner dashboards', async () => {
        mockUser.stripeRole = 'pro';
        mockUser.settings.appSettings = {};
        mockUserService.watchActivityServiceConnectionState.mockReturnValue(of({
            [ServiceNames.GarminAPI]: true,
            [ServiceNames.SuuntoApp]: false,
            [ServiceNames.COROSAPI]: false,
        }));
        mockSleepService.watchSyncState.mockReturnValue(of(null));

        fixture.detectChanges();
        await fixture.whenStable();

        expect(mockSleepService.watchSyncState).toHaveBeenCalledWith(mockUser.uid, SLEEP_PROVIDERS.GarminAPI);
        const prompt = component.dashboardActionPrompts.find(item => item.id === 'backfillGarminSleep');
        expect(prompt).toBeTruthy();
        expect(prompt?.title).toBe('Import Garmin sleep history');
        expect(prompt?.primaryAction?.id).toBe('backfillGarminSleep');
    });

    it('does not show Garmin sleep backfill prompt when required Garmin health permissions are missing', async () => {
        mockUser.stripeRole = 'pro';
        mockUser.settings.appSettings = {};
        mockUserService.watchActivityServiceConnectionState.mockReturnValue(of({
            [ServiceNames.GarminAPI]: true,
            [ServiceNames.SuuntoApp]: false,
            [ServiceNames.COROSAPI]: false,
        }));
        mockUserService.getServiceToken.mockReturnValue(of([{
            permissions: ['HISTORICAL_DATA_EXPORT'],
        }]));
        mockSleepService.watchSyncState.mockReturnValue(of(null));

        fixture.detectChanges();
        await fixture.whenStable();

        expect(mockUserService.getServiceToken).toHaveBeenCalledWith(mockUser, ServiceNames.GarminAPI);
        expect(component.dashboardActionPrompts.some(prompt => prompt.id === 'backfillGarminSleep')).toBe(false);
    });

    it('does not show Garmin sleep backfill prompt after a previous backfill request', async () => {
        mockUser.stripeRole = 'pro';
        mockUser.settings.appSettings = {};
        mockUserService.watchActivityServiceConnectionState.mockReturnValue(of({
            [ServiceNames.GarminAPI]: true,
            [ServiceNames.SuuntoApp]: false,
            [ServiceNames.COROSAPI]: false,
        }));
        mockSleepService.watchSyncState.mockReturnValue(of({
            provider: SLEEP_PROVIDERS.GarminAPI,
            status: 'ready',
            lastBackfillQueuedAtMs: 100,
            updatedAtMs: 100,
        }));

        fixture.detectChanges();
        await fixture.whenStable();

        expect(component.dashboardActionPrompts.some(prompt => prompt.id === 'backfillGarminSleep')).toBe(false);
    });

    it('requests Garmin sleep backfill from the dashboard prompt and hides it after success', async () => {
        mockUser.stripeRole = 'pro';
        mockUser.settings.appSettings = {};
        component.user = mockUser;
        (component as any).activityServiceConnectionState = {
            [ServiceNames.GarminAPI]: true,
            [ServiceNames.SuuntoApp]: false,
            [ServiceNames.COROSAPI]: false,
        };
        (component as any).garminSleepSyncStateLoaded = true;
        (component as any).garminSleepBackfillPermissionsLoaded = true;
        (component as any).hasGarminSleepBackfillPermissions = true;
        (component as any).analyticsService.logEvent = vi.fn();
        (component as any).syncDashboardActionPromptState();

        expect(component.dashboardActionPrompts.some(prompt => prompt.id === 'backfillGarminSleep')).toBe(true);

        await component.backfillGarminSleepPrompt();

        expect(mockUserService.backfillGarminSleepForCurrentUser).toHaveBeenCalled();
        expect((component as any).analyticsService.logEvent).toHaveBeenCalledWith('backfilled_sleep_history', {
            method: ServiceNames.GarminAPI,
            source: 'dashboard_prompt',
        });
        expect(mockSnackBar.open).toHaveBeenCalledWith(
            'Garmin sleep history import started for 43 date ranges.',
            undefined,
            { duration: 3000 },
        );
        expect(component.dashboardActionPrompts.some(prompt => prompt.id === 'backfillGarminSleep')).toBe(false);
    });

    it('dismisses Garmin sleep backfill prompt and persists action prompt state', async () => {
        mockUser.stripeRole = 'pro';
        mockUser.settings.appSettings = {};
        component.user = mockUser;
        (component as any).activityServiceConnectionState = {
            [ServiceNames.GarminAPI]: true,
            [ServiceNames.SuuntoApp]: false,
            [ServiceNames.COROSAPI]: false,
        };
        (component as any).garminSleepSyncStateLoaded = true;
        (component as any).garminSleepBackfillPermissionsLoaded = true;
        (component as any).hasGarminSleepBackfillPermissions = true;
        (component as any).syncDashboardActionPromptState();

        await component.dismissGarminSleepBackfillPrompt();

        expect(mockUserService.updateUserProperties).toHaveBeenCalledWith(
            mockUser,
            {
                settings: {
                    appSettings: {
                        dashboardActionPrompts: {
                            backfillGarminSleep: expect.objectContaining({
                                state: 'dismissed',
                                source: 'garmin-sleep-backfill',
                            }),
                        },
                    },
                },
            },
        );
        expect(component.dashboardActionPrompts.some(prompt => prompt.id === 'backfillGarminSleep')).toBe(false);
    });

    it('applies the miles unit setup preset and completes setup', async () => {
        (mockUser.settings.appSettings as any).unitSetupCompleted = false;
        (mockUser.settings.appSettings as any).otherAppSetting = 'stale-local-value';
        component.user = mockUser;
        component.selectedUnitSetupPreset = 'miles';

        await component.applyUnitSetupPreset();

        expect(mockUserService.updateUserProperties).toHaveBeenCalledWith(
            mockUser,
            {
                settings: {
                    appSettings: {
                        unitSetupCompleted: true
                    },
                    unitSettings: expect.objectContaining({
                        distanceUnits: DistanceUnits.Miles,
                        speedUnits: [SpeedUnits.MilesPerHour],
                        paceUnits: [PaceUnits.MinutesPerMile],
                        swimPaceUnits: [SwimPaceUnits.MinutesPer100Yard],
                        verticalSpeedUnits: [VerticalSpeedUnits.FeetPerSecond]
                    })
                }
            }
        );
        expect(Object.keys(mockUserService.updateUserProperties.mock.calls[0][1].settings).sort()).toEqual([
            'appSettings',
            'unitSettings'
        ]);
        expect(component.showUnitSetupPrompt).toBe(false);
    });

    it('dismisses unit setup prompt without rewriting unit settings', async () => {
        (mockUser.settings.appSettings as any).unitSetupCompleted = false;
        (mockUser.settings.appSettings as any).otherAppSetting = 'stale-local-value';
        mockUser.settings.unitSettings = {
            distanceUnits: DistanceUnits.Kilometers,
            speedUnits: [SpeedUnits.KilometersPerHour],
            paceUnits: [PaceUnits.MinutesPerKilometer],
            startOfTheWeek: 1
        } as any;
        component.user = mockUser;

        await component.dismissUnitSetupPrompt();

        expect(mockUserService.updateUserProperties).toHaveBeenCalledWith(
            mockUser,
            {
                settings: {
                    appSettings: {
                        unitSetupCompleted: true
                    }
                }
            }
        );
        expect(mockUserService.updateUserProperties.mock.calls[0][1].settings.unitSettings).toBeUndefined();
        expect(component.showUnitSetupPrompt).toBe(false);
    });

    it('navigates to settings units from the unit prompt menu action', async () => {
        component.onDashboardActionPromptMenuAction({
            promptId: 'unitSetup',
            action: {
                id: 'openUnitSettings',
                label: 'Advanced settings',
            },
        });

        await fixture.whenStable();

        expect(mockRouter.navigate).toHaveBeenCalledWith(['/settings'], {
            queryParams: { section: 'units' },
        });
    });

    it('navigates to the selected services provider from the service prompt menu action', async () => {
        component.onDashboardActionPromptMenuAction({
            promptId: 'connectActivityService',
            action: {
                id: 'connectServiceProvider',
                label: 'Garmin',
                value: ServiceNames.GarminAPI,
            },
        });

        await fixture.whenStable();

        expect(mockRouter.navigate).toHaveBeenCalledWith(['/services'], {
            queryParams: { serviceName: ServiceNames.GarminAPI },
        });
    });

    it('navigates to the selected services provider from the no-activity state', async () => {
        await component.onNoActivityConnectService(ServiceNames.COROSAPI);

        expect(mockRouter.navigate).toHaveBeenCalledWith(['/services'], {
            queryParams: { serviceName: ServiceNames.COROSAPI },
        });
    });

    it('navigates to subscriptions from the first activity upgrade action', async () => {
        component.onDashboardActionPromptPrimary({
            promptId: 'firstActivityUpload',
            action: {
                id: 'upgradeToPro',
                label: 'Upgrade to Pro',
            },
        });

        await fixture.whenStable();

        expect(mockRouter.navigate).toHaveBeenCalledWith(['/subscriptions']);
    });

    it('hides first activity upload prompt after a successful upload completes', async () => {
        mockUser.stripeRole = 'free';
        component.user = mockUser;
        (component as any).uploadedActivityCount = 0;
        (component as any).syncDashboardActionPromptState();

        expect(component.dashboardActionPrompts.some(prompt => prompt.id === 'firstActivityUpload')).toBe(true);

        component.onDashboardActionPromptControlChange({
            promptId: 'firstActivityUpload',
            value: 'activityUploaded',
        });

        expect(component.dashboardActionPrompts.some(prompt => prompt.id === 'firstActivityUpload')).toBe(false);
    });

    it('hides the no-activity dashboard state after a successful upload completes', () => {
        component.user = mockUser;
        component.isInitialized = true;
        (component as any).hasAnyActivity = false;
        (component as any).syncDashboardActionPromptState();

        expect(component.showNoActivityDashboardState).toBe(true);

        component.onNoActivityUploadComplete();

        expect(component.showNoActivityDashboardState).toBe(false);
    });

    it('does not restore the no-activity dashboard state when auth refreshes after upload', async () => {
        const authUserSubject = new BehaviorSubject<AppUserInterface | null>(mockUser);
        mockAuthService.user$ = authUserSubject.asObservable();
        mockActivatedRoute.snapshot.data.dashboardData.user = mockUser;
        mockActivatedRoute.snapshot.data.dashboardData.events = [];
        mockEventService.getEventsBy.mockReturnValue(of([]));
        mockEventService.hasAnyActivity.mockResolvedValue(false);
        mockUser.stripeRole = 'pro';

        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        expect(component.showNoActivityDashboardState).toBe(true);

        component.onNoActivityUploadComplete();
        authUserSubject.next(mockUser);
        await fixture.whenStable();
        fixture.detectChanges();

        expect(component.showNoActivityDashboardState).toBe(false);
        expect(mockEventService.hasAnyActivity).toHaveBeenCalledTimes(1);
    });

    it('dismisses service connection prompt and persists action prompt state', async () => {
        mockUser.stripeRole = 'pro';
        mockUser.settings.appSettings = {};
        component.user = mockUser;
        (component as any).hasActivityServiceConnection = false;
        (component as any).syncDashboardActionPromptState();

        await component.dismissConnectActivityServicePrompt();

        expect(mockUserService.updateUserProperties).toHaveBeenCalledWith(
            mockUser,
            {
                settings: {
                    appSettings: {
                        dashboardActionPrompts: {
                            connectActivityService: expect.objectContaining({
                                state: 'dismissed',
                                source: 'activity-service-connection',
                            }),
                        },
                    },
                },
            },
        );
        expect(component.dashboardActionPrompts.some(prompt => prompt.id === 'connectActivityService')).toBe(false);
    });

    it('shows the Suunto reconnect prompt when service meta requires reconnect', async () => {
        mockUser.stripeRole = 'pro';
        mockUser.settings.appSettings = {};
        mockUserService.watchSuuntoServiceConnectionView.mockReturnValue(of(buildSuuntoServiceConnectionViewModel({
            hasToken: false,
            serviceMeta: {
                connectionState: 'reconnect_required',
                lastAuthFailureMessage: 'invalid_grant',
            } as any,
        })));

        fixture.detectChanges();
        await fixture.whenStable();

        const prompt = component.dashboardActionPrompts.find(item => item.id === 'reconnectSuuntoService');
        expect(prompt).toBeTruthy();
        expect(prompt?.title).toContain('Reconnect Suunto');
        expect(prompt?.primaryAction?.id).toBe('reconnectSuuntoService');
    });

    it('dismisses Suunto reconnect prompt and persists action prompt state', async () => {
        mockUser.stripeRole = 'pro';
        mockUser.settings.appSettings = {};
        component.user = mockUser;
        (component as any).suuntoConnectionView = buildSuuntoServiceConnectionViewModel({
            hasToken: false,
            serviceMeta: { connectionState: 'reconnect_required' } as any,
        });
        (component as any).syncDashboardActionPromptState();

        await component.dismissReconnectSuuntoServicePrompt();

        expect(mockUserService.updateUserProperties).toHaveBeenCalledWith(
            mockUser,
            {
                settings: {
                    appSettings: {
                        dashboardActionPrompts: {
                            reconnectSuuntoService: expect.objectContaining({
                                state: 'dismissed',
                                source: 'suunto-reconnect-required:unknown',
                            }),
                        },
                    },
                },
            },
        );
        expect(component.dashboardActionPrompts.some(prompt => prompt.id === 'reconnectSuuntoService')).toBe(false);
    });

    it('shows the Suunto reconnect prompt again when a later disconnect incident has a new source timestamp', async () => {
        mockUser.stripeRole = 'pro';
        mockUser.settings.appSettings = {
            dashboardActionPrompts: {
                reconnectSuuntoService: {
                    state: 'dismissed',
                    source: 'suunto-reconnect-required:100',
                },
            },
        } as any;
        mockUserService.watchSuuntoServiceConnectionView.mockReturnValue(of(buildSuuntoServiceConnectionViewModel({
            hasToken: false,
            serviceMeta: {
                connectionState: 'reconnect_required',
                lastDisconnectedAt: 200,
                lastAuthFailureMessage: 'invalid_grant',
            } as any,
        })));

        fixture.detectChanges();
        await fixture.whenStable();

        expect(component.dashboardActionPrompts.some(prompt => prompt.id === 'reconnectSuuntoService')).toBe(true);
    });

    it('starts the Suunto reconnect flow from the dashboard prompt', async () => {
        mockUser.stripeRole = 'pro';
        component.user = mockUser;
        const windowService = TestBed.inject(AppWindowService) as any;

        await component.reconnectSuuntoServicePrompt();

        expect(mockUserService.getCurrentUserServiceTokenAndRedirectURI).toHaveBeenCalledWith(ServiceNames.SuuntoApp);
        expect(windowService.windowRef.location.href).toBe('https://suunto.example/connect');
    });

    it('should attach initial live query when resolver already returned user data', async () => {
        mockActivatedRoute.snapshot.data.dashboardData.user = mockUser;
        mockActivatedRoute.snapshot.data.dashboardData.events = [{ id: 'event1' }];

        fixture.detectChanges();
        await fixture.whenStable();

        expect(mockEventService.getEventsBy).toHaveBeenCalled();
        expect(component.events.length).toBe(1);
    });

    it('should keep loading until live events arrive when resolver skipped event prefetch', async () => {
        mockActivatedRoute.snapshot.data.dashboardData.user = mockUser;
        mockActivatedRoute.snapshot.data.dashboardData.events = [];
        mockActivatedRoute.snapshot.data.dashboardData.eventsPrefetchSkipped = true;

        const eventsSubject = new Subject<any[]>();
        mockEventService.getEventsBy.mockReturnValue(eventsSubject.asObservable());

        fixture.detectChanges();
        await fixture.whenStable();

        expect(component.isInitialized).toBe(true);
        expect(component.isLoading).toBe(true);
        expect(component.events).toEqual([]);

        eventsSubject.next([{ id: 'event1' }]);
        fixture.detectChanges();
        await fixture.whenStable();

        expect(component.isLoading).toBe(false);
        expect(component.events.length).toBe(1);
    });

    it('should skip only the first identical live emission and then update on subsequent changes', async () => {
        const resolvedEvents = [{ id: 'event1' }] as any;
        mockActivatedRoute.snapshot.data.dashboardData.user = mockUser;
        mockActivatedRoute.snapshot.data.dashboardData.events = resolvedEvents;

        const eventsSubject = new BehaviorSubject([{ id: 'event1' }] as any);
        mockEventService.getEventsBy.mockReturnValue(eventsSubject.asObservable());

        fixture.detectChanges();
        await fixture.whenStable();

        expect(component.events).toBe(resolvedEvents);

        const updatedEvents = [{ id: 'event1' }, { id: 'event2' }] as any;
        eventsSubject.next(updatedEvents);
        fixture.detectChanges();
        await fixture.whenStable();

        expect(component.events).toEqual(updatedEvents);
        expect(component.events).not.toBe(resolvedEvents);
    });

    it('should stay live-reactive after cache-backed resolver data', async () => {
        mockActivatedRoute.snapshot.data.dashboardData.user = mockUser;
        mockActivatedRoute.snapshot.data.dashboardData.events = [{ id: 'event1' }];
        mockActivatedRoute.snapshot.data.dashboardData.eventsSource = 'cache';

        const eventsSubject = new BehaviorSubject([{ id: 'event1' }] as any);
        mockEventService.getEventsBy.mockReturnValue(eventsSubject.asObservable());

        fixture.detectChanges();
        await fixture.whenStable();

        eventsSubject.next([{ id: 'event1' }, { id: 'event2' }] as any);
        fixture.detectChanges();
        await fixture.whenStable();

        expect(component.events.length).toBe(2);
        expect((component.events[1] as any).id).toBe('event2');
    });

    it('should update events when service emits new data', async () => {
        const eventsSubject = new BehaviorSubject([{ id: 'event1' }]);
        mockEventService.getEventsBy.mockReturnValue(eventsSubject.asObservable());

        fixture.detectChanges();
        await fixture.whenStable();

        // Initial state
        expect(component.events.length).toBe(1);
        expect((component.events[0] as any).id).toBe('event1');

        // Emit new data
        eventsSubject.next([{ id: 'event1' }, { id: 'event2' }]);
        fixture.detectChanges();
        await fixture.whenStable();

        // Should update
        expect(component.events.length).toBe(2);
        expect((component.events[1] as any).id).toBe('event2');
    });

    it('should measure events listener emit timing from emission handling, not listener setup', () => {
        const performanceNowSpy = vi.spyOn(performance, 'now')
            .mockReturnValueOnce(100)
            .mockReturnValueOnce(105);

        (component as any).trackEventsListenerEmission([{ id: 'event1', isMerge: true }] as any);

        expect(component.hasMergedEvents).toBe(true);
        expect(mockLogger.info).toHaveBeenCalledWith(
            '[perf] dashboard_events_listener_emit',
            expect.objectContaining({
                durationMs: 5,
                incomingEvents: 1,
            }),
        );

        performanceNowSpy.mockRestore();
    });

    it('should not re-query events when only table settings change', async () => {
        const initialUser = {
            ...mockUser,
            settings: {
                ...mockUser.settings,
                dashboardSettings: {
                    ...mockUser.settings.dashboardSettings,
                    tableSettings: {
                        ...(mockUser.settings.dashboardSettings.tableSettings || {}),
                        active: 'Start Date',
                        direction: 'desc',
                        eventsPerPage: 10
                    }
                }
            }
        } as AppUserInterface;
        const userSubject = new BehaviorSubject(initialUser);
        mockAuthService.user$ = userSubject.asObservable();

        fixture.detectChanges();
        await fixture.whenStable();

        expect(mockEventService.getEventsBy).toHaveBeenCalledTimes(1);

        userSubject.next({
            ...initialUser,
            settings: {
                ...initialUser.settings,
                dashboardSettings: {
                    ...initialUser.settings.dashboardSettings,
                    tableSettings: {
                        ...initialUser.settings.dashboardSettings.tableSettings,
                        active: 'Name',
                        direction: 'asc'
                    }
                }
            }
        } as AppUserInterface);

        await fixture.whenStable();

        expect(mockEventService.getEventsBy).toHaveBeenCalledTimes(1);
    });

    it('should not have throttle delay on data loading', async () => {
        // This test ensures that data is available immediately (in same tick or microtask) 
        // without needing to advance time by a large amount (e.g. 2000ms).
        fixture.detectChanges();
        await fixture.whenStable();

        expect(component.events).toBeDefined();
        expect(component.events.length).toBeGreaterThan(0);
    });

    it('should handle circular references in events safely during comparison', async () => {
        const event1: any = {
            getID: () => 'event1',
            name: 'Event 1',
            startDate: new Date(1000),
            toJSON: () => ({ id: 'event1' })
        };
        // Create a circular reference
        event1.self = event1;

        const eventsSubject = new BehaviorSubject([event1]);
        mockEventService.getEventsBy.mockReturnValue(eventsSubject.asObservable());

        fixture.detectChanges();
        await fixture.whenStable();

        expect(component.events.length).toBe(1);

        // This should not throw 'Converting circular structure to JSON'
        expect(() => {
            eventsSubject.next([event1]);
            fixture.detectChanges();
        }).not.toThrow();
    });

    it('should update when an event is renamed or its date changes', async () => {
        class MockEvent {
            constructor(public id: string, public name: string, public startDate: Date) { }
            getID() { return this.id; }
            getActivityTypesAsArray() { return []; }
            toJSON() { return {}; }
        }

        const date1 = new Date(2024, 1, 1);
        const event1 = new MockEvent('e1', 'Original Name', date1) as any;

        const eventsSubject = new BehaviorSubject([event1]);
        mockEventService.getEventsBy.mockReturnValue(eventsSubject.asObservable());

        fixture.detectChanges();
        await fixture.whenStable();

        expect(component.events[0].name).toBe('Original Name');

        // 1. Update with same data (should not trigger change if we were strictly checking, 
        // but here we check if it updates the property if we were to just re-assign)
        const event1Same = new MockEvent('e1', 'Original Name', date1) as any;
        eventsSubject.next([event1Same]);
        fixture.detectChanges();
        // Since they are "equal" by our logic, component.events shouldn't change reference 
        // if we were being super strict, but actually distinctUntilChanged prevents the 
        // subscribe block from running.

        // 2. Update name
        const event1Renamed = new MockEvent('e1', 'New Name', date1) as any;
        eventsSubject.next([event1Renamed]);
        fixture.detectChanges();
        expect(component.events[0].name).toBe('New Name');

        // 3. Update date
        const date2 = new Date(2024, 1, 2);
        const event1NewDate = new MockEvent('e1', 'New Name', date2) as any;
        eventsSubject.next([event1NewDate]);
        fixture.detectChanges();
        expect(component.events[0].startDate.getTime()).toBe(date2.getTime());
    });

    it('treats tag-only event changes as distinct dashboard updates', () => {
        const previous = {
            getID: () => 'event-1', name: 'Run', startDate: new Date(1000), tags: ['Race'],
        } as any;
        const current = {
            getID: () => 'event-1', name: 'Run', startDate: new Date(1000), tags: ['Recovery'],
        } as any;

        expect((component as any).areEventsEquivalentByIdentity([previous], [current])).toBe(false);
    });

    it('should restore previous state when persisting dashboard search fails', async () => {
        const previousStartDate = new Date('2025-01-01T00:00:00.000Z');
        const previousEndDate = new Date('2025-01-31T23:59:59.000Z');
        const previousActivityTypes = ['running'] as any;
        const userForSearch = {
            ...mockUser,
            settings: {
                ...mockUser.settings,
                dashboardSettings: {
                    ...mockUser.settings.dashboardSettings,
                    includeMergedEvents: true,
                    dateRange: DateRanges.thisMonth,
                    startDate: previousStartDate.getTime(),
                    endDate: previousEndDate.getTime(),
                    activityTypes: previousActivityTypes
                }
            }
        } as any;

        component.user = userForSearch;
        component.searchTerm = 'previous term';
        component.searchStartDate = previousStartDate;
        component.searchEndDate = previousEndDate;

        mockUserService.updateUserProperties.mockRejectedValueOnce(new Error('write failed'));

        await component.search({
            searchTerm: 'new term',
            startDate: new Date('2025-02-01T00:00:00.000Z'),
            endDate: new Date('2025-02-10T23:59:59.000Z'),
            dateRange: DateRanges.lastThirtyDays,
            activityTypes: ['cycling'] as any,
            includeMergedEvents: false
        });

        expect(component.isLoading).toBe(false);
        expect((component as any).shouldSearch).toBe(false);
        expect(component.searchTerm).toBe('previous term');
        expect(component.searchStartDate).toEqual(previousStartDate);
        expect(component.searchEndDate).toEqual(previousEndDate);
        expect(component.user.settings.dashboardSettings.includeMergedEvents).toBe(true);
        expect(component.user.settings.dashboardSettings.dateRange).toBe(DateRanges.thisMonth);
        expect(component.user.settings.dashboardSettings.startDate).toBe(previousStartDate.getTime());
        expect(component.user.settings.dashboardSettings.endDate).toBe(previousEndDate.getTime());
        expect(component.user.settings.dashboardSettings.activityTypes).toEqual(previousActivityTypes);
        expect(mockSnackBar.open).toHaveBeenCalledWith('Could not update event table filters');
    });

    it('should persist event search changes only to event table filters', async () => {
        const userForSearch = {
            ...mockUser,
            settings: {
                ...mockUser.settings,
                dashboardSettings: {
                    ...mockUser.settings.dashboardSettings,
                    includeMergedEvents: true,
                    dateRange: DateRanges.all,
                    startDate: null,
                    endDate: null,
                    activityTypes: []
                }
            }
        } as any;
        const startDate = new Date('2025-02-01T00:00:00.000Z');
        const endDate = new Date('2025-02-10T23:59:59.000Z');
        component.user = userForSearch;

        await component.search({
            searchTerm: 'tempo',
            startDate,
            endDate,
            dateRange: DateRanges.lastThirtyDays,
            activityTypes: ['cycling'] as any,
            includeMergedEvents: false
        });

        expect(component.user.settings.dashboardSettings.eventTableFilters).toEqual({
            searchTerm: 'tempo',
            includeMergedEvents: false,
            dateRange: DateRanges.lastThirtyDays,
            startDate: startDate.getTime(),
            endDate: endDate.getTime(),
            activityTypes: ['cycling']
        });
        expect(component.user.settings.dashboardSettings.includeMergedEvents).toBe(true);
        expect(component.user.settings.dashboardSettings.dateRange).toBe(DateRanges.all);
        expect(component.user.settings.dashboardSettings.startDate).toBeNull();
        expect(component.user.settings.dashboardSettings.endDate).toBeNull();
        expect(component.user.settings.dashboardSettings.activityTypes).toEqual([]);
        expect(mockUserService.updateUserProperties).toHaveBeenCalledWith(component.user, {
            settings: {
                dashboardSettings: {
                    eventTableFilters: component.user.settings.dashboardSettings.eventTableFilters,
                },
            },
        });
        expect(mockUserService.updateUserProperties.mock.calls[0][1].settings.appSettings).toBeUndefined();
    });

    it('should re-run manual search when submitting identical filters twice', async () => {
        const eventsSubject = new BehaviorSubject([{ id: 'event1' }] as any);
        mockActivatedRoute.snapshot.data.dashboardData.user = mockUser;
        mockActivatedRoute.snapshot.data.dashboardData.events = [{ id: 'event1' }];
        mockEventService.getEventsBy.mockReturnValue(eventsSubject.asObservable());

        fixture.detectChanges();
        await fixture.whenStable();

        component.user = {
            ...mockUser,
            settings: {
                ...mockUser.settings,
                dashboardSettings: {
                    ...mockUser.settings.dashboardSettings,
                    includeMergedEvents: true,
                    dateRange: DateRanges.thisMonth,
                    startDate: null,
                    endDate: null,
                    activityTypes: []
                }
            }
        } as AppUserInterface;

        const search = {
            searchTerm: '',
            startDate: null,
            endDate: null,
            dateRange: DateRanges.thisMonth,
            activityTypes: [] as any,
            includeMergedEvents: true
        };

        const baselineCalls = mockEventService.getEventsBy.mock.calls.length;

        await component.search(search);
        await fixture.whenStable();

        expect(component.isLoading).toBe(false);
        expect(mockEventService.getEventsBy.mock.calls.length).toBeGreaterThan(baselineCalls);

        const callsAfterFirstSearch = mockEventService.getEventsBy.mock.calls.length;

        await component.search(search);
        await fixture.whenStable();

        expect(component.isLoading).toBe(false);
        expect(mockEventService.getEventsBy.mock.calls.length).toBeGreaterThan(callsAfterFirstSearch);
    });

    it('should default bounded event table ranges to Monday when unit start of week is missing', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-04-30T12:00:00.000Z'));

        (component as any).applyEventTableFilterDates({
            searchTerm: null,
            dateRange: DateRanges.thisWeek,
            startDate: null,
            endDate: null,
            activityTypes: [],
            includeMergedEvents: true,
        }, {
            settings: {
                unitSettings: {},
                dashboardSettings: {},
            },
        });

        expect(component.searchStartDate).toEqual(new Date('2026-04-27T00:00:00.000'));
        expect(component.searchEndDate).toEqual(new Date('2026-05-03T23:59:59.999'));
    });

    it('returns a stable event table filter object for equivalent dashboard settings', () => {
        mockUser.settings.dashboardSettings.eventTableFilters = {
            searchTerm: null,
            dateRange: DateRanges.thisWeek,
            startDate: null,
            endDate: null,
            activityTypes: [],
            includeMergedEvents: true,
        };
        component.user = mockUser;

        const firstFilters = component.eventTableFilters;
        const secondFilters = component.eventTableFilters;

        expect(secondFilters).toBe(firstFilters);
    });

    it('refreshes the stable event table filter object when dashboard settings change', () => {
        mockUser.settings.dashboardSettings.eventTableFilters = {
            searchTerm: null,
            dateRange: DateRanges.thisWeek,
            startDate: null,
            endDate: null,
            activityTypes: [],
            includeMergedEvents: true,
        };
        component.user = mockUser;

        const firstFilters = component.eventTableFilters;
        mockUser.settings.dashboardSettings.eventTableFilters = {
            ...mockUser.settings.dashboardSettings.eventTableFilters,
            activityTypes: [ActivityTypes.Running],
        };
        const secondFilters = component.eventTableFilters;

        expect(secondFilters).not.toBe(firstFilters);
        expect(secondFilters.activityTypes).toEqual([ActivityTypes.Running]);
    });
});
