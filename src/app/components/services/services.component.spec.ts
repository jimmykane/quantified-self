
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
import { AppFileService } from '../../services/app.file.service';
import { AppEventService } from '../../services/app.event.service';
import { AppWindowService } from '../../services/app.window.service';
import { of } from 'rxjs';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { MaterialModule } from '../../modules/material.module';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatIconRegistry } from '@angular/material/icon';

describe('ServicesComponent', () => {
    let component: ServicesComponent;
    let fixture: ComponentFixture<ServicesComponent>;
    let mockUserService: any;
    let mockAuthService: any;
    let mockRouter: any;
    let mockActivatedRoute: any;
    let mockIconRegistry: any;

    beforeEach(async () => {
        mockUserService = {
            isPro: vi.fn(),
            isAdmin: vi.fn()
        };

        mockAuthService = {
            user$: of(null)
        };

        mockRouter = {
            navigate: vi.fn()
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
            getNamedSvgIcon: vi.fn(() => {
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                return of(svg);
            }),
        };

        await TestBed.configureTestingModule({
            declarations: [ServicesComponent],
            imports: [HttpClientTestingModule, MatSnackBarModule, MaterialModule, NoopAnimationsModule],
            providers: [
                { provide: AppUserService, useValue: mockUserService },
                { provide: AppAuthService, useValue: mockAuthService },
                { provide: Router, useValue: mockRouter },
                { provide: ActivatedRoute, useValue: mockActivatedRoute },
                { provide: AppFileService, useValue: {} },
                { provide: AppEventService, useValue: {} },
                { provide: AppWindowService, useValue: {} },
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
            'suunto',
            'garmin',
            'coros',
        ]);
    });

    it('renders the service selector as Material tab navigation', () => {
        fixture.detectChanges();

        const tabNav = fixture.nativeElement.querySelector('nav[mat-tab-nav-bar]');
        const tabLabels = Array.from(tabNav.querySelectorAll('.mat-mdc-tab-link'))
            .map((link: Element) => link.querySelector('.section-tab-label > span:last-child')?.textContent?.trim());

        expect(tabNav).toBeTruthy();
        expect(tabLabels).toEqual(['Suunto', 'Garmin', 'COROS']);
    });

    it('renders the desktop service selector as vertical Material list navigation', () => {
        fixture.detectChanges();

        const desktopNav = fixture.nativeElement.querySelector('.desktop-section-nav');
        const navLabels = Array.from(desktopNav.querySelectorAll('.desktop-section-nav-label'))
            .map((label: Element) => label.textContent?.trim());
        const navDescriptions = Array.from(desktopNav.querySelectorAll('.desktop-section-nav-description'))
            .map((description: Element) => description.textContent?.trim());

        expect(desktopNav).toBeTruthy();
        expect(desktopNav.querySelector('mat-nav-list')).toBeTruthy();
        expect(navLabels).toEqual(['Suunto', 'Garmin', 'COROS']);
        expect(navDescriptions).toEqual(['Suunto App', 'Garmin Connect', 'COROS']);
    });

    it('keeps service panels mounted and hides inactive panels during tab switches', () => {
        fixture.detectChanges();

        const servicePanels = fixture.nativeElement.querySelectorAll('.service-detail');

        expect(servicePanels.length).toBe(3);
        expect(fixture.nativeElement.querySelector('#service-suunto-title').closest('.service-detail').hidden).toBe(false);
        expect(fixture.nativeElement.querySelector('#service-garmin-title').closest('.service-detail').hidden).toBe(true);
        expect(fixture.nativeElement.querySelector('#service-coros-title').closest('.service-detail').hidden).toBe(true);

        component.activeSection = 'coros';
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('#service-suunto-title').closest('.service-detail').hidden).toBe(true);
        expect(fixture.nativeElement.querySelector('#service-coros-title').closest('.service-detail').hidden).toBe(false);
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

        expect(styles.match(/\.connected-account-title\s*\{[^}]*\}/)?.[0]).toContain('overflow-wrap: anywhere');
    });
});
