
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ServicesComponent } from './services.component';
import { AppUserService } from '../../services/app.user.service';
import { AppAuthService } from '../../authentication/app.auth.service';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { AppFileService } from '../../services/app.file.service';
import { AppEventService } from '../../services/app.event.service';
import { AppWindowService } from '../../services/app.window.service';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { CUSTOM_ELEMENTS_SCHEMA, getDebugNode, signal, type DebugElement } from '@angular/core';
import { ServiceNames, User } from '@sports-alliance/sports-lib';
import { MaterialModule } from '../../modules/material.module';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatIconRegistry } from '@angular/material/icon';
import { SharedModule } from '../../modules/shared.module';
import { ACTIVITY_SYNC_ROUTE_IDS } from '@shared/activity-sync-routes';
import { ROUTE_DELIVERY_SYNC_ROUTE_IDS } from '@shared/route-delivery-sync-routes';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { ProviderDataFlowMatrixComponent } from '../shared/provider-data-flow-matrix/provider-data-flow-matrix.component';
import { AppPaymentService, StripeProduct } from '../../services/app.payment.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { HistoryImportProgressService } from '../../services/history-import-progress.service';
import { buildHistoryImportItems, type HistoryImportProgressItem } from '../../helpers/history-import-progress.helper';

describe('ServicesComponent', () => {
    let component: ServicesComponent;
    let fixture: ComponentFixture<ServicesComponent>;
    let mockUserService: any;
    let mockAuthService: any;
    let mockRouter: any;
    let mockActivatedRoute: any;
    let mockIconRegistry: any;
    let mockDialog: any;
    let mockAnalyticsService: any;
    let dialogClosed$: Subject<void>;
    let mockPaymentService: { getProducts: ReturnType<typeof vi.fn>; hasPaidSubscriptionHistory: ReturnType<typeof vi.fn>; appendCheckoutSession: ReturnType<typeof vi.fn> };
    let mockHapticsService: { selection: ReturnType<typeof vi.fn> };
    const importOwner = signal<{ uid: string } | null>(null);
    const importItems = signal<HistoryImportProgressItem[]>([]);

    beforeEach(async () => {
        importOwner.set(null); importItems.set([]);
        mockUserService = {
            isPro: vi.fn(async () => false),
            isAdmin: vi.fn(async () => false)
        };

        mockAuthService = {
            user$: new Subject<User | null>()
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
        mockAnalyticsService = {
            logEvent: vi.fn(),
        };
        mockPaymentService = { getProducts: vi.fn(() => of([])), hasPaidSubscriptionHistory: vi.fn(async () => false), appendCheckoutSession: vi.fn() };
        mockHapticsService = { selection: vi.fn() };

        await TestBed.configureTestingModule({
            declarations: [ServicesComponent],
            imports: [
                HttpClientTestingModule,
                MatSnackBarModule,
                MaterialModule,
                SharedModule,
                NoopAnimationsModule,
                ProviderDataFlowMatrixComponent,
            ],
            providers: [
                { provide: AppUserService, useValue: mockUserService },
                { provide: AppAuthService, useValue: mockAuthService },
                { provide: Router, useValue: mockRouter },
                { provide: ActivatedRoute, useValue: mockActivatedRoute },
                { provide: AppFileService, useValue: {} },
                { provide: AppEventService, useValue: {} },
                { provide: AppWindowService, useValue: {} },
                { provide: MatDialog, useValue: mockDialog },
                { provide: AppAnalyticsService, useValue: mockAnalyticsService },
                { provide: AppPaymentService, useValue: mockPaymentService },
                { provide: AppHapticsService, useValue: mockHapticsService },
                { provide: HistoryImportProgressService, useValue: { owner: importOwner, latestImports: importItems } },
                { provide: MatIconRegistry, useValue: mockIconRegistry }
            ],
            schemas: [CUSTOM_ELEMENTS_SCHEMA]
        }).compileComponents();
    });

    beforeEach(() => {
        fixture = TestBed.createComponent(ServicesComponent);
        component = fixture.componentInstance;
        component.hasProAccess = true;
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it.each([
        ['garmin', ServiceNames.GarminAPI], ['suunto', ServiceNames.SuuntoApp],
        ['coros', ServiceNames.COROSAPI], ['wahoo', ServiceNames.WahooAPI],
    ])('opens %s history details directly from its notification link without an import action', async (section, service) => {
        const params = convertToParamMap({serviceName: service, tool: 'history'});
        mockActivatedRoute.snapshot.queryParamMap = params; mockActivatedRoute.queryParamMap = of(params);
        mockActivatedRoute.snapshot.data = {userData: {user: {uid: 'owner', stripeRole: 'pro'}, isPro: true}};
        fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
        expect(mockDialog.open).toHaveBeenCalledTimes(1);
        expect(component.managedService).toBe(section); expect(component.managedTool).toBe('history');
        expect(mockRouter.navigate).toHaveBeenCalledWith([], expect.objectContaining({queryParams: {tool: null}, replaceUrl: true}));
        expect(mockHapticsService.selection).not.toHaveBeenCalled();
        fixture.detectChanges(); expect(mockDialog.open).toHaveBeenCalledTimes(1);
    });

    it('waits for the verified profile and allows closing and following the same history link again', async () => {
        const params = convertToParamMap({serviceName: ServiceNames.SuuntoApp, tool: 'history'});
        const routes = new BehaviorSubject(params);
        mockActivatedRoute.snapshot.queryParamMap = params; mockActivatedRoute.queryParamMap = routes;
        fixture.detectChanges(); expect(mockDialog.open).not.toHaveBeenCalled();
        mockAuthService.user$.next({uid: 'owner', stripeRole: 'pro'});
        fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
        expect(mockDialog.open).toHaveBeenCalledTimes(1);
        dialogClosed$.next(); fixture.detectChanges(); expect(component.managedService).toBeNull();
        routes.next(params); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
        expect(mockDialog.open).toHaveBeenCalledTimes(2);
    });

    it.each([null, 'mcp', 'unknown'])('does not open history tools for invalid provider %s', async serviceName => {
        const params = convertToParamMap({serviceName, tool: 'history'});
        mockActivatedRoute.snapshot.queryParamMap = params; mockActivatedRoute.queryParamMap = of(params);
        mockActivatedRoute.snapshot.data = {userData: {user: {uid: 'owner', stripeRole: 'pro'}, isPro: true}};
        fixture.detectChanges(); await fixture.whenStable();
        expect(mockDialog.open).not.toHaveBeenCalled();
    });

    it.each([{connect: '1'}, {code: 'synthetic-code'}, {state: 'synthetic-state'}, {error: 'access_denied'},
        {reconnect: '1'}, {code: ''}])('leaves auth and reconnect navigation %j untouched by a history link', async auth => {
        const params = convertToParamMap({serviceName: ServiceNames.GarminAPI, tool: 'history', ...auth});
        mockActivatedRoute.snapshot.queryParamMap = params; mockActivatedRoute.queryParamMap = of(params);
        mockActivatedRoute.snapshot.data = {userData: {user: {uid: 'owner', stripeRole: 'pro'}, isPro: true}};
        fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
        expect(mockDialog.open).not.toHaveBeenCalled(); expect(mockRouter.navigate).not.toHaveBeenCalled();
    });

    it('cancels a pending history open when an OAuth callback arrives before the next render', async () => {
        const routes = new BehaviorSubject(convertToParamMap({serviceName: ServiceNames.GarminAPI, tool: 'history'}));
        mockActivatedRoute.queryParamMap = routes;
        mockActivatedRoute.snapshot.data = {userData: {user: {uid: 'owner', stripeRole: 'pro'}, isPro: true}};
        fixture.detectChanges();
        routes.next(convertToParamMap({serviceName: ServiceNames.GarminAPI, tool: 'history', code: 'synthetic-code', state: 'synthetic-state'}));
        await fixture.whenStable(); fixture.detectChanges();
        expect(mockDialog.open).not.toHaveBeenCalled(); expect(mockRouter.navigate).not.toHaveBeenCalled();
    });

    it('keeps the details link passive without Pro and closes an open dialog on account change', async () => {
        const params = convertToParamMap({serviceName: ServiceNames.WahooAPI, tool: 'history'});
        mockActivatedRoute.snapshot.queryParamMap = params; mockActivatedRoute.queryParamMap = of(params);
        mockActivatedRoute.snapshot.data = {userData: {user: {uid: 'owner', stripeRole: 'free'}, isPro: false}};
        fixture.detectChanges(); await fixture.whenStable(); expect(mockDialog.open).not.toHaveBeenCalled();
        mockAuthService.user$.next({uid: 'owner', stripeRole: 'pro'});
        fixture.detectChanges(); await fixture.whenStable();
        // Access-only updates must still allow the user's pending navigation to finish.
        expect(mockDialog.open).toHaveBeenCalledTimes(1);
        component.setServiceConnectionState('wahoo', true);
        component.processUser({uid: 'different-owner'} as User, true);
        expect(mockDialog.open.mock.results[0].value.close).toHaveBeenCalledTimes(1);
        expect(Object.values(component.serviceConnectionState)).toEqual([false, false, false, false]);
    });

    it.each(['garmin', 'suunto', 'coros', 'wahoo'] as const)('keeps the main %s connection badge authoritative while its dialog initializes', section => {
        component.processUser({uid: 'owner'} as User, true); fixture.detectChanges();
        component.managedService = section; component.setServiceConnectionState(section, true);
        const template = (component as unknown as {serviceToolsDialog: import('@angular/core').TemplateRef<unknown>}).serviceToolsDialog;
        const view = template.createEmbeddedView({}); view.detectChanges();
        const child = view.rootNodes.flatMap((node: Node) => node instanceof Element
            ? [...node.querySelectorAll(`app-services-${section}`)] : [])[0];
        expect(child).toBeTruthy();
        (getDebugNode(child) as DebugElement).triggerEventHandler('connectionStateChanged', false);
        expect(component.serviceConnectionState[section]).toBe(true);
        view.destroy();
    });

    it.each([{reconnect: '1'}, {connect: '1'}, {code: 'synthetic-code', state: 'synthetic-state'},
        {error: 'access_denied', state: 'synthetic-state'}, {state: 'synthetic-state'}])('closes history details for auth navigation %j without reopening or rewriting it', async auth => {
        const routes = new BehaviorSubject(convertToParamMap({serviceName: ServiceNames.GarminAPI, tool: 'history'}));
        mockActivatedRoute.queryParamMap = routes;
        mockActivatedRoute.snapshot.data = {userData: {user: {uid: 'owner', stripeRole: 'pro'}, isPro: true}};
        fixture.detectChanges(); await fixture.whenStable();
        mockRouter.navigate.mockClear();
        routes.next(convertToParamMap({serviceName: ServiceNames.GarminAPI, tool: 'history', ...auth}));
        expect(mockDialog.open.mock.results[0].value.close).toHaveBeenCalledTimes(1);
        dialogClosed$.next(); fixture.detectChanges(); await fixture.whenStable();
        expect(mockDialog.open).toHaveBeenCalledTimes(1); expect(mockRouter.navigate).not.toHaveBeenCalled();
    });

    function setStarterCatalog() {
        const product: StripeProduct = { id: 'pro', name: 'Pro', active: true, role: 'pro', metadata: { role: 'pro' }, description: null, images: [], prices: [{
            id: 'price_pro_month', active: true, type: 'recurring', recurring: { interval: 'month' }, interval: 'month', interval_count: 1,
            unit_amount: 299, currency: 'eur', description: null, trial_period_days: null, metadata: { trial_days: '30' },
        }] };
        mockPaymentService.getProducts.mockReturnValue(of([product]));
        component.processUser({ uid: 'starter', stripeRole: 'free' } as User, false);
    }

    it('does not read billing on the free MCP tab and loads once across provider changes', async () => {
        setStarterCatalog();
        expect(mockPaymentService.getProducts).not.toHaveBeenCalled();
        expect(mockPaymentService.hasPaidSubscriptionHistory).not.toHaveBeenCalled();
        await component.selectService('garmin');
        await vi.waitFor(() => expect(component.proOffer()).toEqual({ priceId: 'price_pro_month', trialDays: 30 }));
        await component.selectService('suunto');
        expect(mockPaymentService.getProducts).toHaveBeenCalledTimes(1);
        expect(mockPaymentService.hasPaidSubscriptionHistory).toHaveBeenCalledTimes(1);
        expect(mockPaymentService.appendCheckoutSession).not.toHaveBeenCalled();
    });

    it.each([true, null])('uses a paid offer when prior history is %s', async history => {
        setStarterCatalog();
        mockPaymentService.hasPaidSubscriptionHistory.mockResolvedValue(history);
        await component.selectService('garmin');
        await vi.waitFor(() => expect(component.proOffer()).toEqual({ priceId: 'price_pro_month', trialDays: null }));
    });

    it('keeps plan review available when the catalog fails', async () => {
        setStarterCatalog();
        mockPaymentService.getProducts.mockReturnValue(throwError(() => new Error('offline')));
        await component.selectService('garmin');
        expect(component.proOffer()).toEqual({ priceId: null, trialDays: null });
    });

    it('discards an in-flight offer when access changes and on teardown', async () => {
        setStarterCatalog();
        let finishHistory: (value: boolean) => void;
        mockPaymentService.hasPaidSubscriptionHistory.mockReturnValue(new Promise<boolean>(resolve => { finishHistory = resolve; }));
        await component.selectService('garmin');
        component.processUser({ uid: 'starter', stripeRole: 'pro' } as User, true);
        finishHistory(false);
        await Promise.resolve();
        expect(component.proOffer()).toBeNull();
        component.ngOnDestroy();
        expect(mockPaymentService.appendCheckoutSession).not.toHaveBeenCalled();
    });

    it('discards the previous account billing result after an account change', async () => {
        setStarterCatalog();
        let finishHistory: (value: boolean) => void;
        mockPaymentService.hasPaidSubscriptionHistory.mockReturnValueOnce(new Promise<boolean>(resolve => { finishHistory = resolve; }));
        await component.selectService('garmin');
        component.processUser({ uid: 'other', stripeRole: 'basic' } as User, false);
        await component.selectService('suunto');
        await vi.waitFor(() => expect(component.proOffer()).toEqual({ priceId: 'price_pro_month', trialDays: null }));
        finishHistory(false);
        await Promise.resolve();
        expect(component.proOffer()?.trialDays).toBeNull();
    });

    it('gives one selection haptic for changed tabs and disclosures, and stays silent on no-ops', async () => {
        expect(mockHapticsService.selection).not.toHaveBeenCalled();
        await component.selectService('garmin');
        expect(mockHapticsService.selection).not.toHaveBeenCalled();
        await component.selectService('mcp');
        expect(mockHapticsService.selection).toHaveBeenCalledTimes(1);
        component.onDataFlowToggle(true);
        component.onDataFlowToggle(true);
        component.onDataFlowToggle(false);
        expect(mockHapticsService.selection).toHaveBeenCalledTimes(3);
    });

    it.each([{ctrlKey:true}, {metaKey:true}, {shiftKey:true}, {altKey:true}, {button:1}])('preserves native modified provider links: %j', options => {
        const event = new MouseEvent('click', {cancelable:true, ...options});
        component.onProviderTabClick(event, 'mcp');
        expect(event.defaultPrevented).toBe(false);
        expect(mockRouter.navigate).not.toHaveBeenCalled();
        expect(mockHapticsService.selection).not.toHaveBeenCalled();
    });

    it('selects a provider from an ordinary tab activation', () => {
        const event = new MouseEvent('click', {cancelable:true});
        component.onProviderTabClick(event, 'mcp');
        expect(event.defaultPrevented).toBe(true);
        expect(component.activeSection).toBe('mcp');
        expect(mockHapticsService.selection).toHaveBeenCalledTimes(1);
    });

    it.each([true, false])('uses the verified admin claim from resolver data: %s', async admin => {
        mockAuthService.user$ = new Subject();
        mockActivatedRoute.snapshot.data['userData'] = { user: { uid: '123', admin }, isPro: admin };
        await component.ngOnInit();
        expect(component.isAdmin).toBe(admin);
    });

    it('uses the latest verified account without waiting for a second access lookup', async () => {
        const userUpdates$ = new Subject<User>();
        mockAuthService.user$ = userUpdates$;
        mockUserService.isPro.mockReturnValue(new Promise(() => {}));
        await component.ngOnInit();

        userUpdates$.next({ uid: 'basic-owner', stripeRole: 'basic' } as User);
        userUpdates$.next({ uid: 'pro-owner', stripeRole: 'pro' } as User);
        expect(component.user?.uid).toBe('pro-owner');
        expect(component.hasProAccess).toBe(true);
        expect(component.proOffer()).toBeNull();

        userUpdates$.next({ uid: 'admin-owner', stripeRole: 'free', admin: true } as unknown as User);
        expect(component.isAdmin).toBe(true);
        expect(component.hasProAccess).toBe(true);
        userUpdates$.next({ uid: 'admin-owner', stripeRole: 'free', admin: false } as unknown as User);
        expect(component.isAdmin).toBe(false);
        expect(component.hasProAccess).toBe(false);
    });

    it('clears trial messaging and access immediately when the verified profile signs out', async () => {
        setStarterCatalog();
        await component.selectService('garmin');
        await vi.waitFor(() => expect(component.proOffer()?.trialDays).toBe(30));
        const userUpdates$ = new Subject<User | null>();
        mockAuthService.user$ = userUpdates$;
        await component.ngOnInit();

        userUpdates$.next(null);
        expect(component.user).toBeNull();
        expect(component.proOffer()).toBeNull();
        expect(component.hasProAccess).toBe(false);
        expect(component.isAdmin).toBe(false);
    });

    it('does not start another billing read after teardown while an access check was pending', async () => {
        const userUpdates$ = new Subject<User>();
        mockAuthService.user$ = userUpdates$;
        mockActivatedRoute.snapshot.queryParamMap.get.mockReturnValue(ServiceNames.GarminAPI);
        let finishAccess: (value: boolean) => void;
        mockUserService.isPro.mockReturnValue(new Promise<boolean>(resolve => { finishAccess = resolve; }));
        mockUserService.isAdmin.mockResolvedValue(false);
        await component.ngOnInit();
        userUpdates$.next({ uid: 'starter', stripeRole: 'free' } as User);
        const readsBeforeDestroy = mockPaymentService.getProducts.mock.calls.length;
        component.ngOnDestroy();
        finishAccess(false);
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(mockPaymentService.getProducts).toHaveBeenCalledTimes(readsBeforeDestroy);
    });

    it('should navigate with correct query params when selectService is called', async () => {
        component.activeSection = 'mcp';
        await component.selectService('garmin');
        expect(component.activeSection).toBe('garmin');
        expect(mockRouter.navigate).toHaveBeenCalledWith([], {
            relativeTo: mockActivatedRoute,
            queryParams: { serviceName: ServiceNames.GarminAPI },
            queryParamsHandling: 'merge',
        });
        expect(mockAnalyticsService.logEvent).toHaveBeenCalledWith('service_section_selected', {
            section: 'garmin',
            service_name: ServiceNames.GarminAPI,
            access: 'pro',
        });
    });

    it('defaults non-Pro users to MCP and Pro users to Garmin without overriding explicit provider links', () => {
        component.hasProAccess = false;
        expect((component as any).getSectionFromServiceName(null)).toBe('mcp');
        expect((component as any).getSectionFromServiceName('unknown')).toBe('mcp');
        expect((component as any).getSectionFromServiceName(ServiceNames.GarminAPI)).toBe('garmin');
        expect((component as any).getSectionFromServiceName(ServiceNames.SuuntoApp)).toBe('suunto');
        expect((component as any).getSectionFromServiceName(ServiceNames.COROSAPI)).toBe('coros');
        expect((component as any).getSectionFromServiceName(ServiceNames.WahooAPI)).toBe('wahoo');

        component.hasProAccess = true;
        expect((component as any).getSectionFromServiceName(null)).toBe('garmin');
    });

    it('should expose service navigation sections in display order', () => {
        expect(component.serviceSectionOptions.map(section => section.id)).toEqual([
            'garmin',
            'suunto',
            'coros',
            'wahoo',
            'mcp',
        ]);
    });

    it('shows the Wahoo connection section to every user', () => {
        component.processUser({ uid: 'another-user' } as User, true);

        expect(component.serviceSectionOptions.map(section => section.id)).toEqual([
            'garmin',
            'suunto',
            'coros',
            'wahoo',
            'mcp',
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
            'mcp',
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

    it('selects MCP through a stable query parameter', async () => {
        await component.selectService('mcp');

        expect(component.activeSection).toBe('mcp');
        expect(mockRouter.navigate).toHaveBeenCalledWith([], {
            relativeTo: mockActivatedRoute,
            queryParams: { serviceName: 'mcp' },
            queryParamsHandling: 'merge',
        });
        expect((component as any).getSectionFromServiceName('mcp')).toBe('mcp');
    });

    it('keeps full provider labels in the shared Material tab selector', () => {
        fixture.detectChanges();

        const providerSelector = fixture.nativeElement.querySelector('.provider-selector');
        const providerLabels = Array.from(providerSelector.querySelectorAll('.provider-selector__name'))
            .map((label: Element) => label.textContent?.trim());

        expect(providerSelector.tagName.toLowerCase()).toBe('nav');
        expect(providerLabels).toEqual(['Garmin', 'Suunto', 'COROS', 'Wahoo', 'MCP']);
        expect(providerSelector.querySelectorAll('app-service-source-icon')).toHaveLength(0);
        expect(component.serviceSectionOptions.some(section => section.serviceName === ServiceNames.WahooAPI)).toBe(true);
    });

    it('marks provider tabs as Pro and MCP as Free for non-Pro users', () => {
        component.hasProAccess = false;
        fixture.detectChanges();

        const selector = fixture.nativeElement.querySelector('.provider-selector');
        const entitlementLabels = Array.from(selector.querySelectorAll('.provider-selector__entitlement mat-chip'))
            .map((chip: Element) => chip.textContent?.trim());
        const ariaLabels = Array.from(selector.querySelectorAll('a[mat-tab-link]'))
            .map((button: Element) => button.getAttribute('aria-label'));

        expect(entitlementLabels).toEqual(['PRO', 'PRO', 'PRO', 'PRO', 'FREE']);
        expect(ariaLabels).toEqual([
            'Garmin, Pro feature',
            'Suunto, Pro feature',
            'COROS, Pro feature',
            'Wahoo, Pro feature',
            'MCP, Free',
        ]);
    });

    it('hides entitlement labels for Pro users', () => {
        component.hasProAccess = true;
        fixture.detectChanges();

        const selector = fixture.nativeElement.querySelector('.provider-selector');

        expect(selector.querySelectorAll('.provider-selector__entitlement')).toHaveLength(0);
    });

    it('refreshes Pro access when the current user entitlement changes', async () => {
        const userUpdates$ = new Subject<User>();
        mockAuthService.user$ = userUpdates$;
        component.processUser({
            uid: 'user-1',
            stripeRole: 'basic',
        } as User, false);

        await component.ngOnInit();

        userUpdates$.next({
            uid: 'user-1',
            stripeRole: 'pro',
        } as User);
        expect(component.hasProAccess).toBe(true);

        userUpdates$.next({
            uid: 'user-1',
            stripeRole: 'basic',
        } as User);
        expect(component.hasProAccess).toBe(false);
    });

    it('renders one paginated Material tab selector with MCP after Wahoo', () => {
        fixture.detectChanges();

        const providerSelector = fixture.nativeElement.querySelector('.provider-selector');
        const providerLabels = Array.from(providerSelector.querySelectorAll('.provider-selector__name'))
            .map((label: Element) => label.textContent?.trim());

        expect(providerSelector.tagName.toLowerCase()).toBe('nav');
        expect(providerSelector.hasAttribute('mat-tab-nav-bar')).toBe(true);
        expect(fixture.nativeElement.querySelectorAll('.provider-selector')).toHaveLength(1);
        expect(providerLabels).toEqual(['Garmin', 'Suunto', 'COROS', 'Wahoo', 'MCP']);
        const desktopProviderIcons = providerSelector.querySelectorAll('app-service-source-icon');
        expect(desktopProviderIcons).toHaveLength(0);
        expect(providerSelector.textContent).toContain('MCP');
        expect(component.serviceSectionOptions.some(section => section.serviceName === ServiceNames.WahooAPI)).toBe(true);
    });

    it('renders connections without a workspace rail', () => {
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('.desktop-section-nav')).toBeNull();
        expect(fixture.nativeElement.querySelector('app-workspace-section-navigation')).toBeNull();
        expect(fixture.nativeElement.querySelector('.provider-selector')).toBeTruthy();
    });

    it('shows a connect-first data-flow state when no services are connected', () => {
        fixture.detectChanges();

        const dataFlow = fixture.nativeElement.querySelector('.service-data-flow');

        expect(dataFlow.textContent).toContain('Your data flow');
        expect(dataFlow.textContent).toContain('No services connected');
        expect(dataFlow.textContent).toContain('Connect a service below');
        expect(dataFlow.querySelector('.provider-data-flow-matrix__table')).toBeNull();
    });

    it('shows a direct Pro data-flow action instead of a connection prompt to non-Pro users', () => {
        component.hasProAccess = false;
        fixture.detectChanges();
        component.activeSection = 'garmin';
        fixture.detectChanges();

        const dataFlow = fixture.nativeElement.querySelector('.service-data-flow');
        const upgradeButton = dataFlow.querySelector('.service-data-flow__upgrade') as HTMLButtonElement;

        expect(dataFlow.textContent).toContain('Unlock provider data flow with Pro');
        expect(dataFlow.textContent).not.toContain('Connect a service below');
        expect(upgradeButton).toBeTruthy();

        component.openActiveProviderDataFlowPlans();
        expect(mockAnalyticsService.logEvent).toHaveBeenCalledWith('upsell_triggered', {
            service_name: ServiceNames.GarminAPI,
            source: 'data_flow',
            feature: 'provider_data_flow',
        });
        expect(mockRouter.navigate).toHaveBeenCalledWith(['/subscriptions']);
    });

    it('sends non-Pro capability actions to subscriptions without opening a tool dialog', () => {
        component.hasProAccess = false;
        (component as any).serviceToolsDialog = {};

        component.openServiceTools('garmin', {
            title: 'Sleep history',
            tool: 'history',
        });

        expect(mockDialog.open).not.toHaveBeenCalled();
        expect(mockAnalyticsService.logEvent).toHaveBeenCalledWith('upsell_triggered', {
            service_name: ServiceNames.GarminAPI,
            source: 'capability_card',
            feature: 'history',
        });
        expect(mockRouter.navigate).toHaveBeenCalledWith(['/subscriptions']);
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

    it('removes Material elevation from the data-flow panel', () => {
        const styles = readFileSync(
            resolve(process.cwd(), 'src/app/components/services/services.component.scss'),
            'utf8',
        );
        const dataFlowRule = styles.match(/\.service-data-flow\s*\{[^}]*\}/)?.[0] ?? '';

        expect(dataFlowRule).toContain('--mat-expansion-container-elevation-shadow: none');
    });

    it('uses one subtle outline tone for Connectivity surfaces', () => {
        const styles = readFileSync(
            resolve(process.cwd(), 'src/app/components/services/services.component.scss'),
            'utf8',
        );
        const dataFlowRule = styles.match(/\.service-data-flow\s*\{[^}]*\}/)?.[0] ?? '';
        const syncSummaryRule = styles.match(/\.service-sync-summary\s*\{[^}]*\}/)?.[0] ?? '';
        const overviewCardRule = styles.match(/\.service-overview-card\s*\{[^}]*\}/)?.[0] ?? '';

        expect(styles).toContain(
            '--services-surface-border: color-mix(in srgb, var(--mat-sys-outline-variant) 55%, transparent)',
        );
        expect(dataFlowRule).toContain('border: 1px solid var(--services-surface-border)');
        expect(syncSummaryRule).toContain('--mat-card-outlined-outline-color: var(--services-surface-border)');
        expect(overviewCardRule).toContain('border: 1px solid var(--services-surface-border)');
    });

    it('shows a single-service import state before the matrix becomes useful', () => {
        component.processUser({ uid: 'test-user-uid' } as User, true);
        component.setServiceConnectionState('garmin', true);
        fixture.detectChanges();

        const dataFlow = fixture.nativeElement.querySelector('.service-data-flow');

        expect(dataFlow.textContent).toContain('Activities are importing into Quantified Self');
        expect(dataFlow.textContent).toContain('Connect another compatible service');
        expect(dataFlow.querySelector('.provider-data-flow-matrix__table')).toBeNull();
    });

    it('shows connected imports and flags an enabled delivery when a provider needs connection', () => {
        component.processUser({
            uid: 'test-user-uid',
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
        const matrix = dataFlow.querySelector('.provider-data-flow-matrix__table');

        expect(dataFlow.textContent).toContain('Choose how activities and routes in Quantified Self are sent to your other services');
        expect(matrix.textContent).toContain('Garmin');
        expect(matrix.textContent).toContain('Suunto');
        expect(matrix.textContent).toContain('Needs connection');
        expect(matrix.querySelectorAll('.provider-data-flow-matrix__route--attention')).toHaveLength(1);
    });

    it('shows supported matrix routes and marks enabled delivery as active', () => {
        component.processUser({
            uid: 'test-user-uid',
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

        const matrix = fixture.nativeElement.querySelector('.provider-data-flow-matrix__table');

        expect(matrix.textContent).toContain('Activity');
        expect(matrix.textContent).toContain('Route');
        expect(matrix.textContent).toContain('Available');
        expect(matrix.textContent).toContain('On');
        expect(matrix.querySelectorAll('.provider-data-flow-matrix__route--active')).toHaveLength(1);
    });

    it('keeps each matrix route label and state in an app-owned vertical layout wrapper', () => {
        const template = readFileSync(
            resolve(process.cwd(), 'src/app/components/shared/provider-data-flow-matrix/provider-data-flow-matrix.component.html'),
            'utf8',
        );
        const styles = readFileSync(
            resolve(process.cwd(), 'src/app/components/shared/provider-data-flow-matrix/provider-data-flow-matrix.component.scss'),
            'utf8',
        );
        const routeContentRule = styles.match(/\.provider-data-flow-matrix__route-content\s*\{[^}]*\}/)?.[0] ?? '';

        expect(template).toContain('class="provider-data-flow-matrix__route-content"');
        expect(template).toContain('class="provider-data-flow-matrix__route-label"');
        expect(routeContentRule).toContain('display: grid');
        expect(routeContentRule).toContain('gap: 3px');
    });

    it('shows a green connected status beside connected providers in the data-flow matrix', () => {
        component.processUser({ uid: 'test-user-uid' } as User, true);
        component.setServiceConnectionState('garmin', true);
        component.setServiceConnectionState('suunto', true);
        fixture.detectChanges();

        const matrix = fixture.nativeElement.querySelector('.provider-data-flow-matrix__table');
        const columnStatuses = matrix.querySelectorAll('thead .provider-data-flow-matrix__provider-status');
        const rowStatuses = matrix.querySelectorAll('tbody .provider-data-flow-matrix__provider-status');
        const mobileSourceStatuses = fixture.nativeElement.querySelectorAll(
            '.provider-data-flow-matrix__mobile-group > h2 .provider-data-flow-matrix__provider-status',
        );

        expect(columnStatuses).toHaveLength(2);
        expect(rowStatuses).toHaveLength(2);
        expect(mobileSourceStatuses).toHaveLength(2);
        expect(columnStatuses[0].getAttribute('aria-label')).toBe('Connected');
    });

    it('opens the matching source settings dialog from activity and route data-flow paths', () => {
        component.processUser({
            uid: 'test-user-uid',
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
            '.provider-data-flow-matrix__route--activity',
        ) as HTMLButtonElement;
        const routeDelivery = fixture.nativeElement.querySelector(
            '.provider-data-flow-matrix__route--route',
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
        component.processUser({ uid: 'test-user-uid' } as User, true);
        component.setServiceConnectionState('garmin', true);
        component.setServiceConnectionState('suunto', true);
        fixture.detectChanges();

        const mobileMatrix = fixture.nativeElement.querySelector('.provider-data-flow-matrix__mobile');
        const styles = readFileSync(
            resolve(process.cwd(), 'src/app/components/shared/provider-data-flow-matrix/provider-data-flow-matrix.component.scss'),
            'utf8'
        );

        expect(mobileMatrix.textContent).toContain('From Garmin');
        expect(mobileMatrix.textContent).toContain('To Suunto');
        expect(mobileMatrix.textContent).toContain('Activity');
        expect(styles).toContain('.provider-data-flow-matrix__scroll {\n    display: none;');
        expect(styles).toContain('.provider-data-flow-matrix__mobile {\n    display: grid;');
    });

    it('keeps service panels mounted and hides inactive panels during tab switches', () => {
        fixture.detectChanges();

        const servicePanels = fixture.nativeElement.querySelectorAll('.service-detail');
        const garminOverview = servicePanels[0].querySelector('.service-overview');
        const corosOverview = servicePanels[2].querySelector('.service-overview');

        expect(servicePanels.length).toBe(5);
        expect(garminOverview).toBeTruthy();
        expect(corosOverview).toBeTruthy();
        expect(fixture.nativeElement.querySelector('.service-detail[aria-label="garmin connect" i]').hidden).toBe(false);
        expect(fixture.nativeElement.querySelector('.service-detail[aria-label="suunto app" i]').hidden).toBe(true);
        expect(fixture.nativeElement.querySelector('.service-detail[aria-label="coros" i]').hidden).toBe(true);
        expect(fixture.nativeElement.querySelector('.service-detail[aria-label="wahoo" i]').hidden).toBe(true);
        expect(fixture.nativeElement.querySelector('.service-detail[aria-label="mcp" i]').hidden).toBe(true);
        expect(fixture.nativeElement.querySelector('app-mcp-connections')).toBeNull();

        component.activeSection = 'coros';
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('.service-detail[aria-label="garmin connect" i]').hidden).toBe(true);
        expect(fixture.nativeElement.querySelector('.service-detail[aria-label="coros" i]').hidden).toBe(false);
        expect(servicePanels[0].querySelector('.service-overview')).toBe(garminOverview);
        expect(servicePanels[2].querySelector('.service-overview')).toBe(corosOverview);
    });

    it('mounts MCP status only in the MCP tab and hides provider-only data flow', () => {
        fixture.detectChanges();

        component.activeSection = 'mcp';
        fixture.detectChanges();

        const mcpPanel = fixture.nativeElement.querySelector('.service-detail[aria-label="MCP"]');
        const dataFlow = fixture.nativeElement.querySelector('.service-data-flow');
        const workspace = fixture.nativeElement.querySelector('.services-workspace-main');
        const styles = readFileSync(
            resolve(process.cwd(), 'src/app/components/services/services.component.scss'),
            'utf8',
        );

        expect(mcpPanel.hidden).toBe(false);
        expect(mcpPanel.querySelector('app-mcp-connections')).toBeTruthy();
        expect(fixture.nativeElement.querySelector('app-services-garmin')).toBeNull();
        expect(fixture.nativeElement.querySelector('app-services-suunto')).toBeNull();
        expect(fixture.nativeElement.querySelector('app-services-coros')).toBeNull();
        expect(fixture.nativeElement.querySelector('app-services-wahoo')).toBeNull();
        expect(dataFlow.hidden).toBe(true);
        expect(styles).toMatch(/\.service-data-flow\[hidden\]\s*\{[^}]*display:\s*none;/);
        expect(
            fixture.nativeElement.querySelector('.service-detail[aria-label="Wahoo"]'),
        ).toBeNull();
        expect(workspace.classList.contains('services-workspace-main--mcp')).toBe(true);
    });

    it('opens the three Garmin actions at their matching tools with specific labels', () => {
        fixture.detectChanges();
        const panel = fixture.nativeElement.querySelector('[aria-label="Garmin Connect"]');
        const buttons = panel.querySelectorAll('.service-overview-card button') as NodeListOf<HTMLButtonElement>;
        expect(buttons).toHaveLength(3);
        expect(panel.textContent).not.toContain('Sleep & Health history');
        const expected = [
            { label: 'Choose dates & data', tool: 'history', title: 'Import history' },
            { label: 'Send route file', tool: 'uploads', title: 'Send route files to Garmin' },
            { label: 'Set up automatic sending', tool: 'auto-sync', title: 'Send activities to connected services' },
        ];
        expected.forEach((action, index) => {
            expect(buttons[index].textContent).toContain(action.label);
            expect(buttons[index].getAttribute('aria-label')).toBe(action.label + ' for Garmin');
            buttons[index].click(); fixture.detectChanges();
            expect(component.managedService).toBe('garmin');
            expect(component.managedTool).toBe(action.tool);
            expect(component.managedToolTitle).toBe(action.title);
            expect(mockDialog.open.mock.calls[index][1]).toEqual(expect.objectContaining({
                ariaLabel: 'Garmin ' + action.title + ' tools', autoFocus: 'dialog',
                maxHeight: 'calc(100dvh - 32px)', maxWidth: 'calc(100vw - 32px)', restoreFocus: true,
                width: 'min(56rem, calc(100vw - 32px))',
            }));
            dialogClosed$.next();
            expect(component.managedService).toBeNull();
            expect(component.managedTool).toBe('history');
            expect(component.managedToolTitle).toBeNull();
        });
    });

    it('shows only the current owner and provider history status below the unified action', () => {
        component.user = { uid: 'owner' } as User;
        importOwner.set({ uid: 'owner' });
        const now = Date.now();
        importItems.set(buildHistoryImportItems([
            { serviceName: ServiceNames.GarminAPI, projection: { runId: 'garmin-run', active: true, updatedAtMs: now,
                steps: [{ id: 'activities', resources: ['activities'], status: 'queued', count: 0 }] } },
            { serviceName: ServiceNames.COROSAPI, unavailable: true },
        ]));
        fixture.detectChanges();
        const panel = fixture.nativeElement.querySelector('[aria-label="Garmin Connect"]');
        expect(panel.querySelectorAll('.service-overview-card__status')).toHaveLength(1);
        expect(panel.querySelector('.service-overview-card__status').textContent).toContain('Requesting history');
        expect(panel.querySelector('.service-overview-card__status').textContent).toContain('Updated');
        expect(panel.querySelector('.service-overview-card__status').textContent).not.toContain('unavailable');
        importOwner.set({ uid: 'another-owner' }); fixture.detectChanges();
        expect(panel.querySelector('.service-overview-card__status')).toBeNull();
    });

    it('maps provider overview cards to distinct tools', () => {
        expect(component.serviceOverviewCardsBySection.garmin.map(card => card.tool)).toEqual(['history', 'uploads', 'auto-sync']);
        expect(component.serviceOverviewCardsBySection.suunto.map(card => card.tool)).toEqual(['history', 'routes', 'send-activities', 'historical-send', 'activity-sync', 'uploads']);
        expect(component.serviceOverviewCardsBySection.suunto[2].description)
            .toBe('Review local FIT files or saved activities and send them to Suunto in the background.');
        expect(component.serviceOverviewCardsBySection.coros.map(card => card.tool)).toEqual(['history', 'send-activities', 'historical-send', 'auto-sync', 'uploads']);
        expect(component.serviceOverviewCardsBySection.coros[1].description)
            .toBe('Send a FIT activity directly to COROS without adding it to your Quantified Self archive.');
        expect(component.serviceOverviewCardsBySection.wahoo.map(card => card.tool)).toEqual(['history', 'send-activities', 'historical-send', 'auto-sync', 'uploads']);
    });

    it.each(['garmin', 'suunto', 'coros', 'wahoo'] as const)('keeps %s feature cards focused on their description and action', section => {
        fixture.detectChanges();
        component.activeSection = section;
        fixture.detectChanges();
        const overview = fixture.nativeElement.querySelector('.service-detail:not([hidden]) .service-overview') as HTMLElement;
        expect(overview.querySelectorAll('.service-overview-card')).toHaveLength(component.serviceOverviewCardsBySection[section].length);
        expect(overview.querySelector('.service-overview-card__detail')).toBeNull();
        expect(overview.textContent).not.toContain('cooldown');
        expect(overview.textContent).not.toContain('check_circle');
        for (const card of component.serviceOverviewCardsBySection[section]) {
            expect(overview.textContent).toContain(card.title);
            expect(overview.textContent).toContain(card.description);
        }
    });

    it('summarizes enabled activity and route delivery for every affected provider', () => {
        component.processUser({
            uid: 'test-user-uid',
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
            uid: 'test-user-uid',
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

    it('summarizes enabled COROS route settings for any eligible user', () => {
        component.processUser({
            uid: 'general-availability-user',
            settings: {
                serviceSyncSettings: {
                    routeDeliverySyncRoutes: {
                        [ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_COROSAPI]: { enabled: true },
                    },
                },
            },
        } as User, true);

        const expectedRoute = {
            id: ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_COROSAPI,
            label: 'Suunto → COROS',
        };
        expect(component.automaticSyncSummaryBySection.suunto.routes).toEqual([expectedRoute]);
        expect(component.automaticSyncSummaryBySection.coros.routes).toEqual([expectedRoute]);
    });

    it('describes non-Pro automatic sync without implying an unconfigured route exists', () => {
        fixture.detectChanges();
        component.processUser({ uid: 'test-user-uid' } as User, false);
        component.activeSection = 'garmin';
        fixture.detectChanges();

        const garminPanel = fixture.nativeElement.querySelector('[aria-label="Garmin Connect"]');
        const summary = garminPanel.querySelector('.service-sync-summary');

        expect(summary.textContent).toContain('Automatic sync');
        expect(summary.textContent).toContain('Provider delivery is available with Pro');
        expect(summary.textContent).not.toContain('Configured provider delivery is paused');
    });

    it('marks configured provider delivery as paused after Pro access ends', () => {
        fixture.detectChanges();
        component.processUser({
            uid: 'test-user-uid',
            settings: {
                serviceSyncSettings: {
                    activitySyncRoutes: {
                        [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: { enabled: true },
                    },
                },
            },
        } as User, false);
        component.activeSection = 'garmin';
        fixture.detectChanges();

        const garminPanel = fixture.nativeElement.querySelector('[aria-label="Garmin Connect"]');
        const summary = garminPanel.querySelector('.service-sync-summary');

        expect(summary.textContent).toContain('Configured provider delivery is paused without Pro access');
        expect(summary.textContent).toContain('Garmin → Suunto App');
    });

    it('refreshes the summary when sync settings change for the signed-in user', async () => {
        const userUpdates$ = new Subject<User>();
        mockAuthService.user$ = userUpdates$;
        component.processUser({ uid: 'test-user-uid' } as User, true);

        await component.ngOnInit();
        userUpdates$.next({
            uid: 'test-user-uid',
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

        expect(manageButtons).toHaveLength(6);
        expect(activePanel.textContent).toContain('Import history');
        expect(activePanel.textContent).toContain('Import past activities, sleep and available 24/7 Health data.');
        expect(activePanel.querySelector('.service-overview').textContent).not.toContain('cooldown');
        expect(manageButtons[0].getAttribute('aria-label')).toBe('Choose dates & data for Suunto');
        expect(manageButtons[1].getAttribute('aria-label')).toBe('Set up route sync for Suunto');
        expect(manageButtons[2].getAttribute('aria-label')).toBe('Send activities for Suunto');
        expect(manageButtons[3].getAttribute('aria-label')).toBe('Send past activities for Suunto');
        expect(manageButtons[4].getAttribute('aria-label')).toBe('Set up automatic sending for Suunto');

        manageButtons[0].click();
        expect(component.managedService).toBe('suunto');
        expect(component.managedTool).toBe('history');
        expect(component.managedToolTitle).toBe('Import history');

        dialogClosed$.next();
        manageButtons[1].click();
        expect(component.managedService).toBe('suunto');
        expect(component.managedTool).toBe('routes');
        expect(component.managedToolTitle).toBe('Route sync');

        dialogClosed$.next();
        manageButtons[2].click();

        expect(component.managedService).toBeNull();
        expect(component.managedTool).toBe('history');
        expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(['/send-activities', 'suunto'], { queryParams: { source: 'files' } });

        dialogClosed$.next();
        manageButtons[3].click();

        expect(component.managedService).toBeNull();
        expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(['/send-activities', 'suunto'], { queryParams: { source: 'saved' } });

        dialogClosed$.next();
        manageButtons[4].click();

        expect(component.managedService).toBe('suunto');
        expect(component.managedTool).toBe('activity-sync');
        expect(component.managedToolTitle).toBe('Send activities to connected services');
    });

    it('opens the unified COROS history action including Sleep and daily Health data', () => {
        component.activeSection = 'coros';
        fixture.detectChanges();

        const activePanel = fixture.nativeElement.querySelector('.service-detail[aria-label="COROS"]');
        const manageButtons = activePanel.querySelectorAll('.service-overview-card button') as NodeListOf<HTMLButtonElement>;

        expect(manageButtons).toHaveLength(5);
        expect(activePanel.textContent).toContain('Import history');
        expect(activePanel.textContent).toContain('Import past activities, sleep and available daily Health data.');
        expect(activePanel.querySelector('.service-overview').textContent).not.toContain('cooldown');
        expect(manageButtons[0].getAttribute('aria-label')).toBe('Choose dates & data for COROS');

        manageButtons[0].click();

        expect(component.managedService).toBe('coros');
        expect(component.managedTool).toBe('history');
        expect(component.managedToolTitle).toBe('Import history');
    });

    it('gives the service tools dialog an accessible close action', () => {
        const template = readFileSync(
            resolve(process.cwd(), 'src/app/components/services/services.component.html'),
            'utf8'
        );

        expect(template).toContain('aria-label="Close tools dialog"');
    });

    it('uses specific, consistently styled actions for connection features', () => {
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
        expect(template).toContain("hasProAccess ? card.actionLabel : 'Unlock with Pro'");
        expect(template).toContain("hasProAccess ? 'arrow_forward' : 'workspace_premium'");
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
        const mcpWorkspaceRule = styles.match(/\.services-workspace-main--mcp\s*\{[^}]*\}/)?.[0] ?? '';
        const hiddenPanelRule = styles.match(/\.service-detail\[hidden\]\s*\{[^}]*\}/)?.[0] ?? '';

        expect(workspaceRule).toContain('overflow: clip');
        expect(workspaceRule).toContain('contain: paint');
        expect(mcpWorkspaceRule).toContain('overflow: visible');
        expect(mcpWorkspaceRule).toContain('contain: none');
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
