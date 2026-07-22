
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
        ]);
    });

    it('shows the Wahoo connection section only to the rollout user', () => {
        component.processUser({ uid: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2' } as User, true);

        expect(component.serviceSectionOptions.map(section => section.id)).toEqual([
            'garmin',
            'suunto',
            'coros',
            'wahoo',
        ]);

        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.service-detail[aria-label="Wahoo"]')).toBeTruthy();
    });

    it('removes the Wahoo connection section when the rollout user signs out', () => {
        component.processUser({ uid: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2' } as User, true);
        component.activeSection = 'wahoo';
        component.processUser(null, false);

        expect(component.isWahooConnectionRolloutEnabled).toBe(false);
        expect(component.activeSection).toBe('garmin');
        expect(component.serviceSectionOptions.map(section => section.id)).toEqual([
            'garmin',
            'suunto',
            'coros',
        ]);
    });

    it('keeps Wahoo inaccessible through direct service selection for other users', async () => {
        component.processUser({ uid: 'another-user' } as User, true);

        await component.selectService('wahoo');

        expect(component.activeSection).toBe('garmin');
        expect(mockRouter.navigate).toHaveBeenCalledWith([], {
            relativeTo: mockActivatedRoute,
            queryParams: { serviceName: ServiceNames.GarminAPI },
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
        expect(tabLabels).toEqual(['Garmin', 'Suunto', 'COROS']);
        const mobileProviderIcons = tabNav.querySelectorAll('app-service-source-icon');
        expect(mobileProviderIcons).toHaveLength(3);
        expect(component.serviceSectionOptions.some(section => section.serviceName === ServiceNames.WahooAPI)).toBe(false);
    });

    it('renders the desktop provider selector as a Material button toggle group', () => {
        fixture.detectChanges();

        const providerSelector = fixture.nativeElement.querySelector('.provider-selector--desktop');
        const providerLabels = Array.from(providerSelector.querySelectorAll('.provider-selector__option > span'))
            .map((label: Element) => label.textContent?.trim());

        expect(providerSelector.tagName.toLowerCase()).toBe('mat-button-toggle-group');
        expect(providerLabels).toEqual(['Garmin', 'Suunto', 'COROS']);
        const desktopProviderIcons = providerSelector.querySelectorAll('app-service-source-icon');
        expect(desktopProviderIcons).toHaveLength(3);
        expect(component.serviceSectionOptions.some(section => section.serviceName === ServiceNames.WahooAPI)).toBe(false);
    });

    it('renders connections without a workspace rail', () => {
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('.desktop-section-nav')).toBeNull();
        expect(fixture.nativeElement.querySelector('app-workspace-section-navigation')).toBeNull();
        expect(fixture.nativeElement.querySelector('.provider-selector--desktop')).toBeTruthy();
    });

    it('keeps service panels mounted and hides inactive panels during tab switches', () => {
        fixture.detectChanges();

        const servicePanels = fixture.nativeElement.querySelectorAll('.service-detail');
        const garminOverview = servicePanels[0].querySelector('.service-overview');
        const corosOverview = servicePanels[2].querySelector('.service-overview');

        expect(servicePanels.length).toBe(3);
        expect(garminOverview).toBeTruthy();
        expect(corosOverview).toBeTruthy();
        expect(fixture.nativeElement.querySelector('[aria-label="garmin connect" i]').hidden).toBe(false);
        expect(fixture.nativeElement.querySelector('[aria-label="suunto app" i]').hidden).toBe(true);
        expect(fixture.nativeElement.querySelector('[aria-label="coros" i]').hidden).toBe(true);
        expect(fixture.nativeElement.querySelector('[aria-label="wahoo" i]')).toBeNull();

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
        expect(activePanel.querySelectorAll('.service-overview-card')).toHaveLength(3);
        expect(activePanel.textContent).toContain('Activity sync');
        expect(activePanel.textContent).toContain('Sleep history');

        const manageButtons = activePanel.querySelectorAll('.service-overview-card button') as NodeListOf<HTMLButtonElement>;

        expect(manageButtons[0].textContent?.trim()).toBe('Backfill activities');
        expect(manageButtons[0].getAttribute('aria-label')).toBe('Backfill activities for Garmin');
        expect(manageButtons[1].textContent?.trim()).toBe('Import sleep history');
        expect(manageButtons[1].getAttribute('aria-label')).toBe('Import sleep history for Garmin');
        expect(manageButtons[2].textContent?.trim()).toBe('Activity sync settings');
        expect(manageButtons[2].getAttribute('aria-label')).toBe('Activity sync settings for Garmin');

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
        expect(component.managedTool).toBe('auto-sync');
        expect(component.managedToolTitle).toBe('Send activities to connected services');
        expect(mockDialog.open.mock.calls[2][1]).toEqual(expect.objectContaining({
            ariaLabel: 'Garmin Send activities to connected services tools',
        }));
    });

    it('maps provider overview cards to distinct tools', () => {
        expect(component.serviceOverviewCardsBySection.garmin.map(card => card.tool)).toEqual(['history', 'history', 'auto-sync']);
        expect(component.serviceOverviewCardsBySection.suunto.map(card => card.tool)).toEqual(['history', 'history', 'routes', 'uploads', 'activity-sync']);
        expect(component.serviceOverviewCardsBySection.suunto[3].description)
            .toBe('Send FIT activity files or GPX route files to the Suunto app.');
        expect(component.serviceOverviewCardsBySection.coros.map(card => card.tool)).toEqual(['history', 'auto-sync']);
        expect(component.serviceOverviewCardsBySection.wahoo.map(card => card.tool)).toEqual(['history', 'uploads', 'auto-sync']);
    });

    it('opens the Suunto route and upload cards at their matching tools', () => {
        component.activeSection = 'suunto';
        fixture.detectChanges();

        const activePanel = fixture.nativeElement.querySelector('[aria-label="Suunto App"]');
        const manageButtons = activePanel.querySelectorAll('.service-overview-card button') as NodeListOf<HTMLButtonElement>;

        expect(manageButtons).toHaveLength(5);
        expect(manageButtons[1].textContent?.trim()).toBe('Import sleep history');
        expect(manageButtons[2].textContent?.trim()).toBe('Route sync settings');
        expect(manageButtons[3].textContent?.trim()).toBe('Upload files');
        expect(manageButtons[4].textContent?.trim()).toBe('Activity sync settings');

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
