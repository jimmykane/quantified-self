
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ServicesComponent } from './services.component';
import { AppUserService } from '../../services/app.user.service';
import { AppAuthService } from '../../authentication/app.auth.service';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { AppFileService } from '../../services/app.file.service';
import { AppEventService } from '../../services/app.event.service';
import { AppWindowService } from '../../services/app.window.service';
import { of, Subject } from 'rxjs';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ServiceNames, User } from '@sports-alliance/sports-lib';
import { MaterialModule } from '../../modules/material.module';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatIconRegistry } from '@angular/material/icon';
import { SharedModule } from '../../modules/shared.module';
import { ACTIVITY_SYNC_ROUTE_IDS } from '@shared/activity-sync-routes';
import { ROUTE_DELIVERY_SYNC_ROUTE_IDS } from '@shared/route-delivery-sync-routes';

describe('ServicesComponent', () => {
    let component: ServicesComponent;
    let fixture: ComponentFixture<ServicesComponent>;
    let mockUserService: any;
    let mockAuthService: any;
    let mockRouter: any;
    let mockActivatedRoute: any;
    let mockIconRegistry: any;
    let mockDialog: any;
    let dialogClosed$: Subject<void>;

    beforeEach(async () => {
        mockUserService = {
            isPro: vi.fn(),
            isAdmin: vi.fn()
        };

        mockAuthService = {
            user$: of(null)
        };

        mockRouter = {
            navigate: vi.fn(),
            createUrlTree: vi.fn(() => ({})),
            serializeUrl: vi.fn(() => '/policies'),
            events: of(),
        };

        mockActivatedRoute = {
            snapshot: {
                data: {},
                queryParamMap: {
                    get: vi.fn()
                }
            },
            queryParamMap: of({
                get: vi.fn()
            })
        };
        mockIconRegistry = {
            getDefaultFontSetClass: vi.fn(() => ['material-icons']),
            getNamedSvgIcon: vi.fn(() => {
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                return of(svg);
            }),
        };
        dialogClosed$ = new Subject<void>();
        mockDialog = {
            open: vi.fn(() => ({
                afterClosed: () => dialogClosed$,
                close: vi.fn(),
            })),
        };

        await TestBed.configureTestingModule({
            declarations: [ServicesComponent],
            imports: [HttpClientTestingModule, MatSnackBarModule, MaterialModule, SharedModule, NoopAnimationsModule],
            providers: [
                { provide: AppUserService, useValue: mockUserService },
                { provide: AppAuthService, useValue: mockAuthService },
                { provide: Router, useValue: mockRouter },
                { provide: ActivatedRoute, useValue: mockActivatedRoute },
                { provide: AppFileService, useValue: {} },
                { provide: AppEventService, useValue: {} },
                { provide: AppWindowService, useValue: {} },
                { provide: MatDialog, useValue: mockDialog },
                { provide: MatIconRegistry, useValue: mockIconRegistry }
            ],
            schemas: [CUSTOM_ELEMENTS_SCHEMA]
        }).compileComponents();
    });

    beforeEach(() => {
        fixture = TestBed.createComponent(ServicesComponent);
        component = fixture.componentInstance;
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should set isAdmin to true when userService returns true', async () => {
        mockUserService.isAdmin.mockReturnValue(Promise.resolve(true));
        mockActivatedRoute.snapshot.data['userData'] = { user: { uid: '123' }, isPro: true };

        // Trigger ngOnInit
        await component.ngOnInit();

        // Wait for async operations
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(component.isAdmin).toBe(true);
    });

    it('should set isAdmin to false when userService returns false', async () => {
        mockUserService.isAdmin.mockReturnValue(Promise.resolve(false));
        mockActivatedRoute.snapshot.data['userData'] = { user: { uid: '123' }, isPro: true };

        await component.ngOnInit();
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(component.isAdmin).toBe(false);
    });

    it('should navigate with correct query params when selectService is called', async () => {
        await component.selectService('garmin');
        expect(component.activeSection).toBe('garmin');
        expect(mockRouter.navigate).toHaveBeenCalledWith([], {
            relativeTo: mockActivatedRoute,
            queryParams: { serviceName: ServiceNames.GarminAPI },
            queryParamsHandling: 'merge',
        });
    });

    it('should expose service navigation sections in display order', () => {
        expect(component.serviceSectionOptions.map(section => section.id)).toEqual([
            'garmin',
            'suunto',
            'coros',
            'wahoo',
        ]);
    });

    it('shows the Wahoo connection section to every user', () => {
        component.processUser({ uid: 'another-user' } as User, true);

        expect(component.serviceSectionOptions.map(section => section.id)).toEqual([
            'garmin',
            'suunto',
            'coros',
            'wahoo',
        ]);

        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.service-detail[aria-label="Wahoo"]')).toBeTruthy();
    });

    it('keeps Wahoo available when a user signs out', () => {
        component.processUser({ uid: 'another-user' } as User, true);
        component.activeSection = 'wahoo';
        component.processUser(null, false);

        expect(component.activeSection).toBe('wahoo');
        expect(component.serviceSectionOptions.map(section => section.id)).toEqual([
            'garmin',
            'suunto',
            'coros',
            'wahoo',
        ]);
    });

    it('allows direct Wahoo service selection for every user', async () => {
        component.processUser({ uid: 'another-user' } as User, true);

        await component.selectService('wahoo');

        expect(component.activeSection).toBe('wahoo');
        expect(mockRouter.navigate).toHaveBeenCalledWith([], {
            relativeTo: mockActivatedRoute,
            queryParams: { serviceName: ServiceNames.WahooAPI },
            queryParamsHandling: 'merge',
        });
    });

    it('maps the Suunto query parameter to the Suunto panel', () => {
        expect((component as any).getSectionFromServiceName(ServiceNames.SuuntoApp)).toBe('suunto');
    });

    it('renders the mobile provider selector as Material tab navigation', () => {
        fixture.detectChanges();

        const tabNav = fixture.nativeElement.querySelector('.provider-selector--mobile');
        const tabLabels = Array.from(tabNav.querySelectorAll('.mat-mdc-tab-link'))
            .map((link: Element) => link.textContent?.trim());

        expect(tabNav).toBeTruthy();
        expect(tabLabels).toEqual(['Garmin', 'Suunto', 'COROS', 'Wahoo']);
        const mobileProviderIcons = tabNav.querySelectorAll('app-service-source-icon');
        expect(mobileProviderIcons).toHaveLength(4);
        expect(component.serviceSectionOptions.some(section => section.serviceName === ServiceNames.WahooAPI)).toBe(true);
    });

    it('renders the desktop provider selector as a Material button toggle group', () => {
        fixture.detectChanges();

        const providerSelector = fixture.nativeElement.querySelector('.provider-selector--desktop');
        const providerLabels = Array.from(providerSelector.querySelectorAll('.provider-selector__option > span'))
            .map((label: Element) => label.textContent?.trim());

        expect(providerSelector.tagName.toLowerCase()).toBe('mat-button-toggle-group');
        expect(providerLabels).toEqual(['Garmin', 'Suunto', 'COROS', 'Wahoo']);
        const desktopProviderIcons = providerSelector.querySelectorAll('app-service-source-icon');
        expect(desktopProviderIcons).toHaveLength(4);
        expect(component.serviceSectionOptions.some(section => section.serviceName === ServiceNames.WahooAPI)).toBe(true);
    });

    it('renders connections without a workspace rail', () => {
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('.desktop-section-nav')).toBeNull();
        expect(fixture.nativeElement.querySelector('app-workspace-section-navigation')).toBeNull();
        expect(fixture.nativeElement.querySelector('.provider-selector--desktop')).toBeTruthy();
    });

    it('shows a connect-first data-flow state when no services are connected', () => {
        fixture.detectChanges();

        const dataFlow = fixture.nativeElement.querySelector('.service-data-flow');

        expect(dataFlow.textContent).toContain('Your data flow');
        expect(dataFlow.textContent).toContain('No services connected');
        expect(dataFlow.textContent).toContain('Connect a service below');
        expect(dataFlow.querySelector('.service-data-flow__matrix')).toBeNull();
    });

    it('starts the data-flow panel collapsed and lets the user expand it', () => {
        fixture.detectChanges();

        const dataFlowHeader = fixture.nativeElement.querySelector(
            '.service-data-flow mat-expansion-panel-header',
        ) as HTMLElement;

        expect(dataFlowHeader.getAttribute('aria-expanded')).toBe('false');

        dataFlowHeader.click();
        fixture.detectChanges();

        expect(component.isDataFlowExpanded).toBe(true);
        expect(dataFlowHeader.getAttribute('aria-expanded')).toBe('true');
    });

    it('shows a single-service import state before the matrix becomes useful', () => {
        component.processUser({ uid: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2' } as User, true);
        component.setServiceConnectionState('garmin', true);
        fixture.detectChanges();

        const dataFlow = fixture.nativeElement.querySelector('.service-data-flow');

        expect(dataFlow.textContent).toContain('Activities are importing into Quantified Self');
        expect(dataFlow.textContent).toContain('Connect another compatible service');
        expect(dataFlow.querySelector('.service-data-flow__matrix')).toBeNull();
    });

    it('shows connected imports and flags an enabled delivery when a provider needs connection', () => {
        component.processUser({
            uid: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
            settings: {
                serviceSyncSettings: {
                    activitySyncRoutes: {
                        [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: { enabled: true },
                    },
                },
            },
        } as User, true);
        component.setServiceConnectionState('garmin', true);
        component.setServiceConnectionState('wahoo', true);
        fixture.detectChanges();

        const dataFlow = fixture.nativeElement.querySelector('.service-data-flow');
        const matrix = dataFlow.querySelector('.service-data-flow__matrix');

        expect(dataFlow.textContent).toContain('Connected services import new activities into Quantified Self');
        expect(matrix.textContent).toContain('Garmin');
        expect(matrix.textContent).toContain('Suunto');
        expect(matrix.textContent).toContain('Needs connection');
        expect(matrix.querySelectorAll('.service-data-flow__matrix-route--attention')).toHaveLength(1);
    });

    it('shows supported matrix routes and marks enabled delivery as active', () => {
        component.processUser({
            uid: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
            settings: {
                serviceSyncSettings: {
                    routeDeliverySyncRoutes: {
                        [ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI]: { enabled: true },
                    },
                },
            },
        } as User, true);
        component.setServiceConnectionState('suunto', true);
        component.setServiceConnectionState('garmin', true);
        fixture.detectChanges();

        const matrix = fixture.nativeElement.querySelector('.service-data-flow__matrix');

        expect(matrix.textContent).toContain('Activity');
        expect(matrix.textContent).toContain('Route');
        expect(matrix.textContent).toContain('Available');
        expect(matrix.textContent).toContain('On');
        expect(matrix.querySelectorAll('.service-data-flow__matrix-route--active')).toHaveLength(1);
    });

    it('shows a green connected status beside connected providers in the data-flow matrix', () => {
        component.processUser({ uid: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2' } as User, true);
        component.setServiceConnectionState('garmin', true);
        component.setServiceConnectionState('suunto', true);
        fixture.detectChanges();

        const matrix = fixture.nativeElement.querySelector('.service-data-flow__matrix');
        const columnStatuses = matrix.querySelectorAll('thead .service-data-flow__provider-status');
        const rowStatuses = matrix.querySelectorAll('tbody .service-data-flow__provider-status');
        const mobileSourceStatuses = fixture.nativeElement.querySelectorAll(
            '.service-data-flow__mobile-matrix-group > h2 .service-data-flow__provider-status',
        );

        expect(columnStatuses).toHaveLength(2);
        expect(rowStatuses).toHaveLength(2);
        expect(mobileSourceStatuses).toHaveLength(2);
        expect(columnStatuses[0].getAttribute('aria-label')).toBe('Connected');
    });

    it('opens the matching source settings dialog from activity and route data-flow paths', () => {
        component.processUser({
            uid: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
            settings: {
                serviceSyncSettings: {
                    activitySyncRoutes: {
                        [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: { enabled: true },
                    },
                    routeDeliverySyncRoutes: {
                        [ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI]: { enabled: true },
                    },
                },
            },
        } as User, true);
        component.setServiceConnectionState('garmin', true);
        component.setServiceConnectionState('suunto', true);
        fixture.detectChanges();

        const activityRoute = fixture.nativeElement.querySelector(
            '.service-data-flow__matrix-route--activity',
        ) as HTMLButtonElement;
        const routeDelivery = fixture.nativeElement.querySelector(
            '.service-data-flow__matrix-route--route',
        ) as HTMLButtonElement;

        expect(activityRoute.getAttribute('aria-label')).toBe('Manage activity delivery from Garmin to Suunto App');
        activityRoute.click();
        expect(component.managedService).toBe('garmin');
        expect(component.managedTool).toBe('auto-sync');
        expect(component.managedToolTitle).toBe('Send activities to Suunto App');
        expect(component.managedActivitySyncDestination).toBe('suunto');
        expect(mockDialog.open).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
            ariaLabel: 'Garmin Send activities to Suunto App tools',
        }));

        dialogClosed$.next();
        routeDelivery.click();
        expect(component.managedService).toBe('suunto');
        expect(component.managedTool).toBe('routes');
        expect(component.managedToolTitle).toBe('Send routes to Garmin Connect');
        expect(component.managedActivitySyncDestination).toBeNull();
        expect(mockDialog.open).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
            ariaLabel: 'Suunto Send routes to Garmin Connect tools',
        }));
    });

    it('renders a compact stacked matrix for mobile layouts', () => {
        component.processUser({ uid: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2' } as User, true);
        component.setServiceConnectionState('garmin', true);
        component.setServiceConnectionState('suunto', true);
        fixture.detectChanges();

        const mobileMatrix = fixture.nativeElement.querySelector('.service-data-flow__mobile-matrix');
        const styles = readFileSync(
            resolve(process.cwd(), 'src/app/components/services/services.component.scss'),
            'utf8'
        );

        expect(mobileMatrix.textContent).toContain('From Garmin');
        expect(mobileMatrix.textContent).toContain('To Suunto');
        expect(mobileMatrix.textContent).toContain('Activity');
        expect(styles).toContain('.service-data-flow__matrix-scroll {\n        display: none;');
        expect(styles).toContain('.service-data-flow__mobile-matrix {\n        display: grid;');
    });

    it('keeps service panels mounted and hides inactive panels during tab switches', () => {
        fixture.detectChanges();

        const servicePanels = fixture.nativeElement.querySelectorAll('.service-detail');
        const garminOverview = servicePanels[0].querySelector('.service-overview');
        const corosOverview = servicePanels[2].querySelector('.service-overview');

        expect(servicePanels.length).toBe(4);
        expect(garminOverview).toBeTruthy();
        expect(corosOverview).toBeTruthy();
        expect(fixture.nativeElement.querySelector('[aria-label="garmin connect" i]').hidden).toBe(false);
        expect(fixture.nativeElement.querySelector('[aria-label="suunto app" i]').hidden).toBe(true);
        expect(fixture.nativeElement.querySelector('[aria-label="coros" i]').hidden).toBe(true);
        expect(fixture.nativeElement.querySelector('[aria-label="wahoo" i]').hidden).toBe(true);

        component.activeSection = 'coros';
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('[aria-label="garmin connect" i]').hidden).toBe(true);
        expect(fixture.nativeElement.querySelector('[aria-label="coros" i]').hidden).toBe(false);
        expect(servicePanels[0].querySelector('.service-overview')).toBe(garminOverview);
        expect(servicePanels[2].querySelector('.service-overview')).toBe(corosOverview);
    });

    it('opens each overview card at its matching tool', () => {
        fixture.detectChanges();

        const activePanel = fixture.nativeElement.querySelector('[aria-label="Garmin Connect"]');
        expect(activePanel.querySelectorAll('.service-overview-card')).toHaveLength(4);
        expect(activePanel.textContent).toContain('Activity sync');
        expect(activePanel.textContent).toContain('Sleep history');

        const manageButtons = activePanel.querySelectorAll('.service-overview-card button') as NodeListOf<HTMLButtonElement>;

        expect(manageButtons[0].textContent).toContain('Manage');
        expect(manageButtons[0].getAttribute('aria-label')).toBe('Backfill activities for Garmin');
        expect(manageButtons[1].textContent).toContain('Manage');
        expect(manageButtons[1].getAttribute('aria-label')).toBe('Import sleep history for Garmin');
        expect(manageButtons[2].textContent).toContain('Manage');
        expect(manageButtons[2].getAttribute('aria-label')).toBe('Send route file for Garmin');
        expect(manageButtons[3].textContent).toContain('Manage');
        expect(manageButtons[3].getAttribute('aria-label')).toBe('Activity sync settings for Garmin');

        manageButtons[0].click();
        fixture.detectChanges();

        expect(component.managedService).toBe('garmin');
        expect(component.managedTool).toBe('history');
        expect(component.managedToolTitle).toBe('Activity sync');
        expect(fixture.nativeElement.querySelector('.service-overview')).toBeTruthy();
        expect(mockDialog.open.mock.calls[0][1]).toEqual(expect.objectContaining({
            ariaLabel: 'Garmin Activity sync tools',
            autoFocus: 'dialog',
            maxHeight: 'calc(100dvh - 32px)',
            maxWidth: 'calc(100vw - 32px)',
            restoreFocus: true,
            width: 'min(56rem, calc(100vw - 32px))',
        }));

        dialogClosed$.next();
        expect(component.managedService).toBeNull();
        expect(component.managedTool).toBe('history');
        expect(component.managedToolTitle).toBeNull();

        manageButtons[1].click();
        fixture.detectChanges();

        expect(component.managedService).toBe('garmin');
        expect(component.managedTool).toBe('history');
        expect(component.managedToolTitle).toBe('Sleep history');
        expect(mockDialog.open.mock.calls[1][1]).toEqual(expect.objectContaining({
            ariaLabel: 'Garmin Sleep history tools',
        }));

        dialogClosed$.next();
        manageButtons[2].click();
        fixture.detectChanges();

        expect(component.managedService).toBe('garmin');
        expect(component.managedTool).toBe('uploads');
        expect(component.managedToolTitle).toBe('Send route files to Garmin');
        expect(mockDialog.open.mock.calls[2][1]).toEqual(expect.objectContaining({
            ariaLabel: 'Garmin Send route files to Garmin tools',
        }));

        dialogClosed$.next();
        manageButtons[3].click();
        fixture.detectChanges();

        expect(component.managedService).toBe('garmin');
        expect(component.managedTool).toBe('auto-sync');
        expect(component.managedToolTitle).toBe('Send activities to connected services');
        expect(mockDialog.open.mock.calls[3][1]).toEqual(expect.objectContaining({
            ariaLabel: 'Garmin Send activities to connected services tools',
        }));
    });

    it('maps provider overview cards to distinct tools', () => {
        expect(component.serviceOverviewCardsBySection.garmin.map(card => card.tool)).toEqual(['history', 'history', 'uploads', 'auto-sync']);
        expect(component.serviceOverviewCardsBySection.suunto.map(card => card.tool)).toEqual(['history', 'history', 'routes', 'uploads', 'activity-sync']);
        expect(component.serviceOverviewCardsBySection.suunto[3].description)
            .toBe('Send FIT activity files or GPX/FIT route files to the Suunto app.');
        expect(component.serviceOverviewCardsBySection.coros.map(card => card.tool)).toEqual(['history', 'auto-sync']);
        expect(component.serviceOverviewCardsBySection.wahoo.map(card => card.tool)).toEqual(['history', 'uploads', 'auto-sync']);
    });

    it('does not repeat the Pro plan in provider feature details', () => {
        const featureDetails = Object.values(component.serviceOverviewCardsBySection)
            .flatMap(cards => cards.map(card => card.detail));

        expect(featureDetails).not.toContain(expect.stringMatching(/\bpro\b/i));
    });

    it('summarizes enabled activity and route delivery for every affected provider', () => {
        component.processUser({
            uid: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
            settings: {
                serviceSyncSettings: {
                    activitySyncRoutes: {
                        [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: { enabled: true },
                        [ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_WahooAPI]: { enabled: true },
                    },
                    routeDeliverySyncRoutes: {
                        [ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI]: { enabled: true },
                        [ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_WahooAPI]: { enabled: true },
                    },
                },
            },
        } as User, true);

        expect(component.automaticSyncSummaryBySection.garmin).toEqual({
            activities: [{
                id: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
                label: 'Garmin → Suunto App',
            }],
            routes: [{
                id: ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI,
                label: 'Suunto → Garmin Connect',
            }],
        });
        expect(component.automaticSyncSummaryBySection.suunto).toEqual({
            activities: [{
                id: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
                label: 'Garmin → Suunto App',
            }],
            routes: [
                {
                    id: ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI,
                    label: 'Suunto → Garmin Connect',
                },
                {
                    id: ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_WahooAPI,
                    label: 'Suunto → Wahoo',
                },
            ],
        });
        expect(component.automaticSyncSummaryBySection.coros.activities).toEqual([{
            id: ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_WahooAPI,
            label: 'COROS → Wahoo',
        }]);
        expect(component.automaticSyncSummaryBySection.wahoo).toEqual({
            activities: [{
                id: ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_WahooAPI,
                label: 'COROS → Wahoo',
            }],
            routes: [{
                id: ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_WahooAPI,
                label: 'Suunto → Wahoo',
            }],
        });
    });

    it('renders enabled activity and route delivery without opening a tools dialog', () => {
        component.processUser({
            uid: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
            settings: {
                serviceSyncSettings: {
                    activitySyncRoutes: {
                        [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: { enabled: true },
                    },
                    routeDeliverySyncRoutes: {
                        [ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI]: { enabled: true },
                    },
                },
            },
        } as User, true);
        fixture.detectChanges();

        const garminPanel = fixture.nativeElement.querySelector('[aria-label="Garmin Connect"]');
        const summary = garminPanel.querySelector('.service-sync-summary');

        expect(summary.classList.contains('qs-card-plain')).toBe(true);
        expect(summary.textContent).toContain('Enabled automatic sync');
        expect(summary.textContent).toContain('Activity sending');
        expect(summary.textContent).toContain('Garmin → Suunto App');
        expect(summary.textContent).toContain('Route sending');
        expect(summary.textContent).toContain('Suunto → Garmin Connect');
        expect(mockDialog.open).not.toHaveBeenCalled();
    });

    it('refreshes the summary when sync settings change for the signed-in user', async () => {
        const userUpdates$ = new Subject<User>();
        mockAuthService.user$ = userUpdates$;
        component.processUser({ uid: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2' } as User, true);

        await component.ngOnInit();
        userUpdates$.next({
            uid: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
            settings: {
                serviceSyncSettings: {
                    routeDeliverySyncRoutes: {
                        [ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_WahooAPI]: { enabled: true },
                    },
                },
            },
        } as User);

        expect(component.automaticSyncSummaryBySection.wahoo.routes).toEqual([{
            id: ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_WahooAPI,
            label: 'Suunto → Wahoo',
        }]);
    });

    it('opens the Suunto route and upload cards at their matching tools', () => {
        component.activeSection = 'suunto';
        fixture.detectChanges();

        const activePanel = fixture.nativeElement.querySelector('[aria-label="Suunto App"]');
        const manageButtons = activePanel.querySelectorAll('.service-overview-card button') as NodeListOf<HTMLButtonElement>;

        expect(manageButtons).toHaveLength(5);
        expect(manageButtons[1].getAttribute('aria-label')).toBe('Import sleep history for Suunto');
        expect(manageButtons[2].getAttribute('aria-label')).toBe('Route sync settings for Suunto');
        expect(manageButtons[3].getAttribute('aria-label')).toBe('Upload files for Suunto');
        expect(manageButtons[4].getAttribute('aria-label')).toBe('Activity sync settings for Suunto');

        manageButtons[1].click();
        expect(component.managedService).toBe('suunto');
        expect(component.managedTool).toBe('history');
        expect(component.managedToolTitle).toBe('Sleep history');

        dialogClosed$.next();
        manageButtons[2].click();
        expect(component.managedService).toBe('suunto');
        expect(component.managedTool).toBe('routes');
        expect(component.managedToolTitle).toBe('Route sync');

        dialogClosed$.next();
        manageButtons[3].click();

        expect(component.managedService).toBe('suunto');
        expect(component.managedTool).toBe('uploads');
        expect(component.managedToolTitle).toBe('Upload activities and routes');

        dialogClosed$.next();
        manageButtons[4].click();

        expect(component.managedService).toBe('suunto');
        expect(component.managedTool).toBe('activity-sync');
        expect(component.managedToolTitle).toBe('Send activities to Wahoo');
    });

    it('gives the service tools dialog an accessible close action', () => {
        const template = readFileSync(
            resolve(process.cwd(), 'src/app/components/services/services.component.html'),
            'utf8'
        );

        expect(template).toContain('aria-label="Close tools dialog"');
    });

    it('uses one compact, consistent manage action for all connection feature dialogs', () => {
        const template = readFileSync(
            resolve(process.cwd(), 'src/app/components/services/services.component.html'),
            'utf8'
        );
        const styles = readFileSync(
            resolve(process.cwd(), 'src/app/components/services/services.component.scss'),
            'utf8'
        );
        const actionRule = styles.match(/\.service-overview-card__action\s*\{[^}]*\}/)?.[0] ?? '';

        expect(template).toContain('class="service-overview-card__action"');
        expect(template).toContain('<span>Manage</span>');
        expect(template).toContain('<mat-icon>arrow_forward</mat-icon>');
        expect(actionRule).toContain('min-width: 104px');
        expect(styles).toContain('border-bottom: 1px solid var(--mat-sys-outline-variant)');
    });

    it('keeps the tools dialog focused on tool content', () => {
        const template = readFileSync(
            resolve(process.cwd(), 'src/app/components/services/services.component.html'),
            'utf8'
        );
        const toolsOnlyBindings = template.match(/\[showConnectionSummary\]="false"/g) ?? [];
        const initialToolBindings = template.match(/\[activeProviderTool\]="managedTool"/g) ?? [];
        const focusedToolBindings = template.match(/\[showOnlyActiveProviderTool\]="true"/g) ?? [];
        const styles = readFileSync(
            resolve(process.cwd(), 'src/app/components/services/services-abstract-component.directive.scss'),
            'utf8'
        );
        const toolsOnlyRule = styles.match(/\.service-container--tools-only\s*\{[^}]*\}/)?.[0] ?? '';
        const historyFormStyles = readFileSync(
            resolve(process.cwd(), 'src/app/components/history-import-form/history-import.form.component.css'),
            'utf8'
        );
        const historyFormRule = historyFormStyles.match(/\.history-import-form\s*\{[^}]*\}/)?.[0] ?? '';

        expect(toolsOnlyBindings).toHaveLength(4);
        expect(initialToolBindings).toHaveLength(4);
        expect(focusedToolBindings).toHaveLength(4);
        expect(template).not.toContain('service-tools-dialog__description');
        expect(toolsOnlyRule).toContain('width: 100%');
        expect(toolsOnlyRule).toContain('max-width: none');
        expect(historyFormRule).toContain('width: 100%');
        expect(historyFormRule).toContain('max-width: none');
    });

    it('shows live connection state in the desktop provider selector', () => {
        component.setServiceConnectionState('garmin', true);
        fixture.detectChanges();

        const connectionStates = fixture.nativeElement.querySelectorAll('.provider-selector__connection-state');
        expect(connectionStates).toHaveLength(1);
        expect(connectionStates[0].textContent).toContain('Connected');

        const styles = readFileSync(
            resolve(process.cwd(), 'src/app/components/services/services.component.scss'),
            'utf8'
        );
        const connectionStateRule = styles.match(/\.provider-selector__connection-state\s*\{[^}]*\}/)?.[0] ?? '';
        expect(connectionStateRule).toContain('color: var(--qs-theme-success)');
    });

    it('lets the services route grow with content instead of forcing viewport height', () => {
        const styles = readFileSync(
            resolve(process.cwd(), 'src/app/components/services/services.component.scss'),
            'utf8'
        );
        const settingsContainerRule = styles.match(/\.settings-container\s*\{[^}]*\}/)?.[0] ?? '';

        expect(settingsContainerRule).not.toContain('min-height');
        expect(styles).not.toMatch(/@supports\s*\(height:\s*100dvh\)\s*\{\s*\.settings-container/);
    });

    it('centers the connections content in its 760px page column', () => {
        const styles = readFileSync(
            resolve(process.cwd(), 'src/app/components/services/services.component.scss'),
            'utf8'
        );
        const contentRule = styles.match(/\.settings-content\s*\{[^}]*\}/)?.[0] ?? '';

        expect(contentRule).toContain('max-width: 760px');
        expect(contentRule).toContain('margin: 0 auto');
        expect(contentRule).not.toContain('1180px');
    });

    it('clips provider paints and explicitly removes inactive panels from layout', () => {
        const styles = readFileSync(
            resolve(process.cwd(), 'src/app/components/services/services.component.scss'),
            'utf8'
        );
        const workspaceRule = styles.match(/\.services-workspace-main\s*\{[^}]*\}/)?.[0] ?? '';
        const hiddenPanelRule = styles.match(/\.service-detail\[hidden\]\s*\{[^}]*\}/)?.[0] ?? '';

        expect(workspaceRule).toContain('overflow: clip');
        expect(workspaceRule).toContain('contain: paint');
        expect(hiddenPanelRule).toContain('display: none');
    });

    it('keeps service content wrappers from becoming nested scroll containers', () => {
        const styles = readFileSync(
            resolve(process.cwd(), 'src/app/components/services/services-abstract-component.directive.scss'),
            'utf8'
        );
        const wrappers = [
            '.service-container',
            '.connection-details',
            '.connection-account-info',
            '.connected-account-list',
            '.connected-account-copy',
        ];

        for (const wrapper of wrappers) {
            const escapedWrapper = wrapper.replace('.', '\\.');
            const rule = styles.match(new RegExp(`${escapedWrapper}\\s*\\{[^}]*\\}`))?.[0] ?? '';

            expect(rule).not.toContain('overflow-x');
            expect(rule).not.toContain('overflow-y');
            expect(rule).not.toContain('overflow: auto');
        }

        const connectedAccountTitleRule = styles.match(/\.connected-account-title\s*\{[^}]*\}/)?.[0] ?? '';
        expect(connectedAccountTitleRule).toContain('overflow: hidden');
        expect(connectedAccountTitleRule).toContain('text-overflow: ellipsis');
    });
});
