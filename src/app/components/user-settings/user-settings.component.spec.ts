import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UserSettingsComponent } from './user-settings.component';
import { AppAuthService } from '../../authentication/app.auth.service';
import { AppUserService } from '../../services/app.user.service';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppWindowService } from '../../services/app.window.service';
import { MatDialog } from '@angular/material/dialog';
import { LoggerService } from '../../services/logger.service';
import { Analytics } from 'app/firebase/analytics';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { By } from '@angular/platform-browser';
import { ReactiveFormsModule } from '@angular/forms';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MaterialModule } from '../../modules/material.module';
import { MatFormField } from '@angular/material/form-field';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { BehaviorSubject, of } from 'rxjs';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { SharedModule } from '../../modules/shared.module';
import {
    ACTIVITIES_EXCLUDED_FROM_ASCENT,
    ACTIVITIES_EXCLUDED_FROM_DESCENT,
    DistanceUnits,
    PaceUnits,
    DataPotentialStamina,
    SpeedUnits,
    DataStamina,
    SwimPaceUnits,
    User,
    VerticalSpeedUnits
} from '@sports-alliance/sports-lib';



describe('UserSettingsComponent', () => {
    let component: UserSettingsComponent;
    let fixture: ComponentFixture<UserSettingsComponent>;
    let mockActivatedRoute: any;
    let mockRouter: any;
    let queryParamMapSubject: BehaviorSubject<any>;

    const mockUser: Partial<User> = {
        uid: 'test-uid',
        displayName: 'Test User',
        settings: {
            chartSettings: {
                dataTypeSettings: {
                    'altitude': { enabled: true }
                },
                theme: 'material',
                downSamplingLevel: 4,
                strokeWidth: 2,
                gainAndLossThreshold: 1,
                strokeOpacity: 1,
                extraMaxForPower: 0,
                extraMaxForPace: 0,
                fillOpacity: 1,
                lapTypes: [],
                showLaps: true,
                showSwimLengths: true,
                showGrid: true,
                stackYAxes: true,
                xAxisType: 'time',
                useAnimations: true,
                hideAllSeriesOnInit: false,
                showAllData: true,
                disableGrouping: false,
                chartCursorBehaviour: 'zoomX'
            } as any,
            appSettings: { theme: 'normal' } as any,
            unitSettings: {
                speedUnits: ['kph'],
                paceUnits: ['min/km'],
                swimPaceUnits: ['min/100m'],
                verticalSpeedUnits: ['m/h'],
                distanceUnits: DistanceUnits.Kilometers,
                startOfTheWeek: 1
            } as any,
            mapSettings: {
                theme: 'normal',
                mapType: 'roadmap',
                strokeWidth: 4,
                showLaps: true,

                showArrows: true,
                lapTypes: []
            } as any,
            dashboardSettings: {
                tableSettings: {
                    eventsPerPage: 10
                }
            } as any,
            summariesSettings: {
                removeAscentForEventTypes: []
            } as any
        } as any
    };

    beforeEach(async () => {
        queryParamMapSubject = new BehaviorSubject(convertToParamMap({}));
        mockRouter = {
            navigate: vi.fn().mockImplementation(async (_commands, extras) => {
                queryParamMapSubject.next(convertToParamMap(extras?.queryParams || {}));
                return true;
            }),
            createUrlTree: vi.fn(() => ({})),
            serializeUrl: vi.fn(() => '/subscriptions'),
            events: of(),
        };
        mockActivatedRoute = {
            snapshot: {
                data: {},
                queryParams: {},
                queryParamMap: convertToParamMap({})
            },
            queryParamMap: queryParamMapSubject.asObservable()
        };

        await TestBed.configureTestingModule({
            declarations: [UserSettingsComponent],
            imports: [ReactiveFormsModule, MaterialModule, SharedModule, NoopAnimationsModule],
            providers: [
                { provide: AppAuthService, useValue: { user$: of(null) } },
                { provide: ActivatedRoute, useValue: mockActivatedRoute },
                { provide: AppUserService, useValue: { isBranded: vi.fn().mockResolvedValue(false), updateUserProperties: vi.fn(), isAdmin: vi.fn().mockResolvedValue(false) } },
                { provide: Router, useValue: mockRouter },
                { provide: MatSnackBar, useValue: { open: vi.fn() } },
                { provide: AppWindowService, useValue: {} },
                {
                    provide: MatDialog,
                    useValue: {
                        open: vi.fn(() => ({
                            afterClosed: () => of(false)
                        }))
                    }
                },
                { provide: LoggerService, useValue: { error: vi.fn(), warn: vi.fn() } },
                { provide: AppAnalyticsService, useValue: { logEvent: vi.fn() } },
                { provide: Analytics, useValue: null },
            ],
            schemas: [NO_ERRORS_SCHEMA]
        }).compileComponents();

        fixture = TestBed.createComponent(UserSettingsComponent);
        component = fixture.componentInstance;
        component.user = mockUser as User;
        component.ngOnChanges(); // Initialize form before detectChanges
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('labels expanded chart availability as recorded metrics', () => {
        const template = readFileSync(resolve(process.cwd(), 'src/app/components/user-settings/user-settings.component.html'), 'utf8');

        expect(template).toContain('Include all recorded metrics');
        expect(template).not.toContain('Show All Data Points');
    });

    it('shows email in the profile header when available', () => {
        component.activeSection = 'profile';
        component.user = { ...(component.user as any), email: 'runner@example.com' } as any;
        component.ngOnChanges();
        fixture.detectChanges();

        const emailLine = fixture.nativeElement.querySelector('.user-email') as HTMLElement | null;
        expect(emailLine).toBeTruthy();
        expect(emailLine?.textContent).toContain('runner@example.com');
    });

    it('hides the profile header email when unavailable', () => {
        component.activeSection = 'profile';
        component.user = { ...(component.user as any), email: null } as any;
        component.ngOnChanges();
        fixture.detectChanges();

        const emailLine = fixture.nativeElement.querySelector('.user-email');
        expect(emailLine).toBeNull();
    });

    it('shows the profile identity strip only while the profile section is active', () => {
        component.activeSection = 'profile';
        fixture.detectChanges();

        const profilePanel = fixture.nativeElement.querySelector('[aria-labelledby="settings-profile-title"]');
        expect(profilePanel.querySelector('.settings-panel-body .user-profile-header')).toBeTruthy();
        expect(profilePanel.hidden).toBe(false);

        component.activeSection = 'units';
        fixture.detectChanges();

        expect(profilePanel.hidden).toBe(true);
    });

    it('does not expose the About You profile description in user settings', () => {
        component.user = { ...(component.user as any), description: 'Legacy profile bio' } as any;
        component.ngOnChanges();
        fixture.detectChanges();

        expect(fixture.nativeElement.textContent).not.toContain('About You');
        expect(fixture.nativeElement.textContent).not.toContain('Legacy profile bio');
        expect(fixture.nativeElement.querySelector('[formControlName="description"]')).toBeNull();
        expect(fixture.nativeElement.querySelector('.user-bio')).toBeNull();
        expect(component.userSettingsFormGroup.get('description')).toBeNull();
    });

    it('does not expose account public or private privacy state in user settings', () => {
        component.user = { ...(component.user as any), privacy: 'public' } as any;
        component.ngOnChanges();
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('app-privacy-icon')).toBeNull();
        expect(fixture.nativeElement.querySelector('[formControlName="privacy"]')).toBeNull();
        expect(component.userSettingsFormGroup.get('privacy')).toBeNull();
    });

    it('should expose settings navigation sections in display order', () => {
        expect(component.settingsSectionOptions.map(section => section.id)).toEqual([
            'profile',
            'app',
            'dashboard',
            'map',
            'charts',
            'units',
            'delete-account',
        ]);
    });

    it('renders the mobile settings selector as Material button navigation', () => {
        const tabNav = fixture.nativeElement.querySelector('nav[role="tablist"]');
        const tabLabels = Array.from(tabNav.querySelectorAll('.workspace-navigation__mobile-tab'))
            .map((link: Element) => link.querySelector('.settings-tab-label > span:last-child')?.textContent?.trim());

        expect(tabNav).toBeTruthy();
        expect(tabNav.querySelectorAll('.mat-mdc-button')).toHaveLength(7);
        expect(tabLabels).toEqual([
            'Profile',
            'Appearance',
            'Dashboard',
            'Maps',
            'Charts',
            'Units',
            'Delete Account',
        ]);
    });

    it('uses the horizontal settings selector without a workspace rail', () => {
        const tabNav = fixture.nativeElement.querySelector('nav[role="tablist"]');
        const tabPanel = fixture.nativeElement.querySelector('.settings-tab-panel');

        expect(fixture.nativeElement.querySelector('.desktop-section-nav')).toBeNull();
        expect(tabPanel).toBeTruthy();
        expect(tabNav.querySelectorAll('.mat-mdc-button')).toHaveLength(7);
    });

    it('uses dynamic Material subscript sizing for settings form fields', () => {
        const sectionsWithFormFields = ['profile', 'app', 'dashboard', 'map', 'charts', 'units'] as const;

        for (const section of sectionsWithFormFields) {
            component.activeSection = section;
            fixture.detectChanges();

            const formFields = fixture.debugElement
                .queryAll(By.directive(MatFormField))
                .map(field => field.componentInstance as MatFormField);

            expect(formFields.length).toBeGreaterThan(0);
            expect(formFields.every(field => field.subscriptSizing === 'dynamic')).toBe(true);
        }
    });

    it('shows delete account as its own final settings section', () => {
        const sectionIds = component.settingsSectionOptions.map(section => section.id);

        expect(sectionIds[sectionIds.length - 2]).toBe('units');
        expect(sectionIds[sectionIds.length - 1]).toBe('delete-account');
    });

    it('should update section query param when a settings section is selected', async () => {
        component.activeSection = 'profile';
        const selection = component.selectSettingsSection('map');

        expect(component.activeSection).toBe('map');
        await selection;

        expect(mockRouter.navigate).toHaveBeenCalledWith([], {
            relativeTo: mockActivatedRoute,
            queryParams: { section: 'map' },
            queryParamsHandling: 'merge',
        });
        expect(component.activeSection).toBe('map');
    });

    it('keeps settings panels mounted while switching the visible section', () => {
        component.activeSection = 'profile';
        fixture.detectChanges();

        const panels = fixture.nativeElement.querySelectorAll('.settings-panel-section');
        const profilePanel = fixture.nativeElement.querySelector('[aria-labelledby="settings-profile-title"]');
        const mapPanel = fixture.nativeElement.querySelector('[aria-labelledby="settings-map-title"]');

        expect(panels).toHaveLength(7);
        expect(profilePanel.hidden).toBe(false);
        expect(mapPanel.hidden).toBe(true);

        component.activeSection = 'map';
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('[aria-labelledby="settings-profile-title"]')).toBe(profilePanel);
        expect(fixture.nativeElement.querySelector('[aria-labelledby="settings-map-title"]')).toBe(mapPanel);
        expect(profilePanel.hidden).toBe(true);
        expect(mapPanel.hidden).toBe(false);
    });

    it('should update the active section from section query param changes', () => {
        component.activeSection = 'profile';

        queryParamMapSubject.next(convertToParamMap({ section: 'delete-account' }));

        expect(component.activeSection).toBe('delete-account');
    });

    it('should restore the appearance section when the section query param is missing', () => {
        component.activeSection = 'units';

        queryParamMapSubject.next(convertToParamMap({}));

        expect(component.activeSection).toBe('app');
    });

    it('shows delete account only while the delete account section is active', () => {
        component.activeSection = 'profile';
        fixture.detectChanges();

        const deletePanel = fixture.nativeElement.querySelector('[aria-labelledby="settings-delete-account-title"]');
        expect(deletePanel.querySelector('.danger-card')).toBeTruthy();
        expect(deletePanel.hidden).toBe(true);

        component.activeSection = 'delete-account';
        fixture.detectChanges();

        expect(deletePanel.hidden).toBe(false);
        expect(fixture.nativeElement.querySelector('.qs-form-actions-floating')).toBeNull();
        expect(fixture.nativeElement.querySelector('.mobile-save-bar')).toBeNull();
    });

    it('should initialize acceptedTrackingPolicy from user data', () => {
        component.user.acceptedTrackingPolicy = true;
        component.ngOnChanges();
        expect(component.userSettingsFormGroup.get('acceptedTrackingPolicy').value).toBe(true);

        component.user.acceptedTrackingPolicy = false;
        component.ngOnChanges();
        expect(component.userSettingsFormGroup.get('acceptedTrackingPolicy').value).toBe(false);
    });

    it('should initialize acceptedMarketingPolicy from user data', () => {
        component.user.acceptedMarketingPolicy = true;
        component.ngOnChanges();
        expect(component.userSettingsFormGroup.get('acceptedMarketingPolicy').value).toBe(true);

        component.user.acceptedMarketingPolicy = false;
        component.ngOnChanges();
        expect(component.userSettingsFormGroup.get('acceptedMarketingPolicy').value).toBe(false);
    });

    it('should initialize missing optional legal preferences as false', () => {
        delete (component.user as any).acceptedTrackingPolicy;
        delete (component.user as any).acceptedMarketingPolicy;

        component.ngOnChanges();

        expect(component.userSettingsFormGroup.get('acceptedTrackingPolicy').value).toBe(false);
        expect(component.userSettingsFormGroup.get('acceptedMarketingPolicy').value).toBe(false);
    });

    it('should initialize brandText from user data', () => {
        (component.user as any).stripeRole = 'basic';
        (component.user as any).brandText = 'My Team';
        component.ngOnChanges();

        expect(component.userSettingsFormGroup.get('brandText').value).toBe('My Team');
    });

    it('should initialize brandText as empty string when user has no value', () => {
        (component.user as any).stripeRole = 'basic';
        delete (component.user as any).brandText;
        component.ngOnChanges();

        expect(component.userSettingsFormGroup.get('brandText').value).toBe('');
    });

    it('should allow brandText editing for basic and pro users and disable for free users', () => {
        (component.user as any).stripeRole = 'basic';
        component.ngOnChanges();
        expect(component.canEditBrandText).toBe(true);
        expect(component.userSettingsFormGroup.get('brandText').disabled).toBe(false);

        (component.user as any).stripeRole = 'pro';
        component.ngOnChanges();
        expect(component.canEditBrandText).toBe(true);
        expect(component.userSettingsFormGroup.get('brandText').disabled).toBe(false);

        (component.user as any).stripeRole = 'free';
        component.ngOnChanges();
        expect(component.canEditBrandText).toBe(false);
        expect(component.userSettingsFormGroup.get('brandText').disabled).toBe(true);
    });

    it('should allow brandText editing during active grace period', () => {
        (component.user as any).stripeRole = 'free';
        (component.user as any).gracePeriodUntil = Date.now() + 60_000;
        component.ngOnChanges();

        expect(component.canEditBrandText).toBe(true);
        expect(component.userSettingsFormGroup.get('brandText').disabled).toBe(false);
    });

    it('should save acceptedTrackingPolicy when form is submitted', async () => {
        const userService = TestBed.inject(AppUserService);
        const updateUserPropertiesSpy = vi.spyOn(userService, 'updateUserProperties').mockResolvedValue(true as any);
        const analyticsService = TestBed.inject(AppAnalyticsService) as any;
        vi.spyOn(analyticsService, 'logEvent');

        component.user.acceptedTrackingPolicy = false;
        component.ngOnChanges();

        // Change the value
        component.userSettingsFormGroup.get('acceptedTrackingPolicy').setValue(true);
        component.userSettingsFormGroup.get('acceptedTrackingPolicy').markAsDirty();

        // Submit the form
        await component.onSubmit(new Event('submit'));

        expect(updateUserPropertiesSpy).toHaveBeenCalledWith(
            expect.objectContaining({ uid: 'test-uid' }),
            expect.objectContaining({
                acceptedTrackingPolicy: true
            })
        );
    });

    it('should save acceptedMarketingPolicy when form is submitted', async () => {
        const userService = TestBed.inject(AppUserService);
        const updateUserPropertiesSpy = vi.spyOn(userService, 'updateUserProperties').mockResolvedValue(true as any);

        component.user.acceptedMarketingPolicy = false;
        component.ngOnChanges();

        // Change the value
        component.userSettingsFormGroup.get('acceptedMarketingPolicy').setValue(true);
        component.userSettingsFormGroup.get('acceptedMarketingPolicy').markAsDirty();

        // Submit the form
        await component.onSubmit(new Event('submit'));

        expect(updateUserPropertiesSpy).toHaveBeenCalledWith(
            expect.objectContaining({ uid: 'test-uid' }),
            expect.objectContaining({
                acceptedMarketingPolicy: true
            })
        );
    });

    it('should not save missing optional legal preferences when consent controls are unchanged', async () => {
        const userService = TestBed.inject(AppUserService);
        const updateUserPropertiesSpy = vi.spyOn(userService, 'updateUserProperties').mockResolvedValue(true as any);
        delete (component.user as any).acceptedTrackingPolicy;
        delete (component.user as any).acceptedMarketingPolicy;
        component.ngOnChanges();

        await component.onSubmit(new Event('submit'));

        const payload = updateUserPropertiesSpy.mock.calls[0][1];
        expect(payload.acceptedTrackingPolicy).toBeUndefined();
        expect(payload.acceptedMarketingPolicy).toBeUndefined();
    });

    it('should save dirty missing optional legal preferences as strict false booleans', async () => {
        const userService = TestBed.inject(AppUserService);
        const updateUserPropertiesSpy = vi.spyOn(userService, 'updateUserProperties').mockResolvedValue(true as any);
        delete (component.user as any).acceptedTrackingPolicy;
        delete (component.user as any).acceptedMarketingPolicy;
        component.ngOnChanges();
        component.userSettingsFormGroup.get('acceptedTrackingPolicy').markAsDirty();
        component.userSettingsFormGroup.get('acceptedMarketingPolicy').markAsDirty();

        await component.onSubmit(new Event('submit'));

        expect(updateUserPropertiesSpy).toHaveBeenCalledWith(
            expect.objectContaining({ uid: 'test-uid' }),
            expect.objectContaining({
                acceptedTrackingPolicy: false,
                acceptedMarketingPolicy: false
            })
        );
    });

    it('should not include profile description when settings are saved', async () => {
        const userService = TestBed.inject(AppUserService);
        const updateUserPropertiesSpy = vi.spyOn(userService, 'updateUserProperties').mockResolvedValue(true as any);

        component.user = { ...(component.user as any), description: 'Legacy profile bio' } as any;
        component.ngOnChanges();
        component.userSettingsFormGroup.get('acceptedMarketingPolicy').setValue(true);

        await component.onSubmit(new Event('submit'));

        const payload = updateUserPropertiesSpy.mock.calls[0][1];
        expect(payload.description).toBeUndefined();
    });

    it('should initialize and save distance unit preference when form is submitted', async () => {
        const userService = TestBed.inject(AppUserService);
        const updateUserPropertiesSpy = vi.spyOn(userService, 'updateUserProperties').mockResolvedValue(true as any);

        component.ngOnChanges();

        expect(component.userSettingsFormGroup.get('distanceUnitsToUse').value).toBe(DistanceUnits.Kilometers);

        component.userSettingsFormGroup.get('distanceUnitsToUse').setValue(DistanceUnits.Miles);

        await component.onSubmit(new Event('submit'));

        expect(updateUserPropertiesSpy).toHaveBeenCalledWith(
            expect.objectContaining({ uid: 'test-uid' }),
            expect.objectContaining({
                settings: expect.objectContaining({
                    unitSettings: expect.objectContaining({
                        distanceUnits: DistanceUnits.Miles
                    })
                })
            })
        );
    });

    it('should complete unit setup when saving a changed unit preference', async () => {
        const userService = TestBed.inject(AppUserService);
        const updateUserPropertiesSpy = vi.spyOn(userService, 'updateUserProperties').mockResolvedValue(true as any);

        (component.user.settings.appSettings as any).unitSetupCompleted = false;
        component.ngOnChanges();
        component.userSettingsFormGroup.get('distanceUnitsToUse').setValue(DistanceUnits.Miles);

        await component.onSubmit(new Event('submit'));

        expect(updateUserPropertiesSpy).toHaveBeenCalledWith(
            expect.objectContaining({ uid: 'test-uid' }),
            expect.objectContaining({
                settings: expect.objectContaining({
                    appSettings: expect.objectContaining({
                        unitSetupCompleted: true
                    }),
                    unitSettings: expect.objectContaining({
                        distanceUnits: DistanceUnits.Miles
                    })
                })
            })
        );
    });

    it('should not complete unit setup when saving without unit changes', async () => {
        const userService = TestBed.inject(AppUserService);
        const updateUserPropertiesSpy = vi.spyOn(userService, 'updateUserProperties').mockResolvedValue(true as any);

        (component.user.settings.appSettings as any).unitSetupCompleted = false;
        component.ngOnChanges();
        component.userSettingsFormGroup.get('displayName').setValue('Same Units');

        await component.onSubmit(new Event('submit'));

        const payload = updateUserPropertiesSpy.mock.calls[0][1];
        expect(payload.settings.appSettings.unitSetupCompleted).toBeUndefined();
    });

    it('should expose kilometers and miles labels for distance unit choices', () => {
        expect(component.distanceUnitOptions).toEqual([
            { label: 'Kilometers', value: DistanceUnits.Kilometers },
            { label: 'Miles', value: DistanceUnits.Miles },
        ]);
    });

    it('should apply a simple miles unit preset to advanced controls', () => {
        component.ngOnChanges();

        component.onUnitPresetChange('miles');

        expect(component.selectedUnitPreset).toBe('miles');
        expect(component.userSettingsFormGroup.get('distanceUnitsToUse').value).toBe(DistanceUnits.Miles);
        expect(component.userSettingsFormGroup.get('speedUnitsToUse').value).toEqual([SpeedUnits.MilesPerHour]);
        expect(component.userSettingsFormGroup.get('paceUnitsToUse').value).toEqual([PaceUnits.MinutesPerMile]);
        expect(component.userSettingsFormGroup.get('swimPaceUnitsToUse').value).toEqual([SwimPaceUnits.MinutesPer100Yard]);
        expect(component.userSettingsFormGroup.get('verticalSpeedUnitsToUse').value).toEqual([VerticalSpeedUnits.FeetPerSecond]);
        expect(component.userSettingsFormGroup.dirty).toBe(true);
    });

    it('renders unit presets and fine-tune unit controls without an expander', () => {
        component.activeSection = 'units';
        fixture.detectChanges();

        const presetGroup = fixture.nativeElement.querySelector('mat-button-toggle-group');
        const unitsFieldList = fixture.nativeElement.querySelector('.settings-field-list--units');
        const formFields = fixture.nativeElement.querySelectorAll('mat-form-field');

        expect(presetGroup).toBeTruthy();
        expect(unitsFieldList).toBeTruthy();
        expect(presetGroup.hasAttribute('hideSingleSelectionIndicator')).toBe(true);
        expect(fixture.nativeElement.querySelector('mat-expansion-panel')).toBeFalsy();
        expect(fixture.nativeElement.textContent).toContain('Fine-tune units');
        expect(formFields.length).toBeGreaterThanOrEqual(5);
        expect(fixture.nativeElement.querySelector('.unit-simple-settings')).toBeFalsy();
        expect(fixture.nativeElement.querySelector('.unit-advanced-settings')).toBeFalsy();
    });

    it('should save trimmed brandText for paid users', async () => {
        const userService = TestBed.inject(AppUserService);
        const updateUserPropertiesSpy = vi.spyOn(userService, 'updateUserProperties').mockResolvedValue(true as any);

        (component.user as any).stripeRole = 'basic';
        component.ngOnChanges();
        component.userSettingsFormGroup.get('brandText').setValue('  My Brand  ');

        await component.onSubmit(new Event('submit'));

        const payload = updateUserPropertiesSpy.mock.calls[0][1];
        expect(payload.brandText).toBe('My Brand');
    });

    it('should save null brandText when paid user submits only whitespace', async () => {
        const userService = TestBed.inject(AppUserService);
        const updateUserPropertiesSpy = vi.spyOn(userService, 'updateUserProperties').mockResolvedValue(true as any);

        (component.user as any).stripeRole = 'pro';
        component.ngOnChanges();
        component.userSettingsFormGroup.get('brandText').setValue('   ');

        await component.onSubmit(new Event('submit'));

        const payload = updateUserPropertiesSpy.mock.calls[0][1];
        expect(payload.brandText).toBeNull();
    });

    it('should not include brandText in payload for free users', async () => {
        const userService = TestBed.inject(AppUserService);
        const updateUserPropertiesSpy = vi.spyOn(userService, 'updateUserProperties').mockResolvedValue(true as any);

        (component.user as any).stripeRole = 'free';
        delete (component.user as any).gracePeriodUntil;
        component.ngOnChanges();
        component.userSettingsFormGroup.get('brandText').setValue('Should Not Save');

        await component.onSubmit(new Event('submit'));

        const payload = updateUserPropertiesSpy.mock.calls[0][1];
        expect(payload.brandText).toBeUndefined();
    });

    it('should save trimmed brandText during active grace period', async () => {
        const userService = TestBed.inject(AppUserService);
        const updateUserPropertiesSpy = vi.spyOn(userService, 'updateUserProperties').mockResolvedValue(true as any);

        (component.user as any).stripeRole = 'free';
        (component.user as any).gracePeriodUntil = Date.now() + 60_000;
        component.ngOnChanges();
        component.userSettingsFormGroup.get('brandText').setValue('  Grace Brand  ');

        await component.onSubmit(new Event('submit'));

        const payload = updateUserPropertiesSpy.mock.calls[0][1];
        expect(payload.brandText).toBe('Grace Brand');
    });

    it('should not include legacy showPoints in saved map settings', async () => {
        const userService = TestBed.inject(AppUserService);
        const updateUserPropertiesSpy = vi.spyOn(userService, 'updateUserProperties').mockResolvedValue(true as any);

        component.ngOnChanges();
        await component.onSubmit(new Event('submit'));

        const payload = updateUserPropertiesSpy.mock.calls[0][1];
        expect(payload.settings.mapSettings.showPoints).toBeUndefined();
    });

    it('does not rewrite dashboard-specific settings when saving general settings', async () => {
        const userService = TestBed.inject(AppUserService);
        const updateUserPropertiesSpy = vi.spyOn(userService, 'updateUserProperties').mockResolvedValue(true as any);
        const dashboardActionPrompts = {
            unitSetup: { state: 'dismissed', dismissedAt: 123 },
        };
        component.user = {
            ...(component.user as any),
            settings: {
                ...(component.user as any).settings,
                appSettings: {
                    ...(component.user as any).settings.appSettings,
                    dashboardActionPrompts,
                },
                dashboardSettings: {
                    ...(component.user as any).settings.dashboardSettings,
                    eventTableFilters: {
                        searchTerm: 'tempo',
                        dateRange: 1,
                        startDate: 1000,
                        endDate: 2000,
                        activityTypes: ['Running'],
                        includeMergedEvents: false,
                    },
                    sleepTrend: { range: '30d' },
                    autoTiles: {
                        sleepTrend: { state: 'added', addedAt: 456 },
                    },
                    tableSettings: {
                        eventsPerPage: 10,
                        selectedColumns: ['Name', 'Start Date'],
                        active: 'startDate',
                        direction: 'asc',
                    },
                },
            },
        } as any;

        component.ngOnChanges();
        component.userSettingsFormGroup.get('eventsPerPage').setValue(25);

        await component.onSubmit(new Event('submit'));

        const payload = updateUserPropertiesSpy.mock.calls[0][1];
        expect(payload.settings.appSettings.dashboardActionPrompts).toBeUndefined();
        expect(payload.settings.dashboardSettings.eventTableFilters).toBeUndefined();
        expect(payload.settings.dashboardSettings.sleepTrend).toBeUndefined();
        expect(payload.settings.dashboardSettings.autoTiles).toBeUndefined();
        expect(payload.settings.dashboardSettings.tableSettings).toEqual({
            eventsPerPage: 25,
        });
    });

    it('should reject brandText values longer than 60 chars after trim', async () => {
        const userService = TestBed.inject(AppUserService);
        const updateUserPropertiesSpy = vi.spyOn(userService, 'updateUserProperties').mockResolvedValue(true as any);

        (component.user as any).stripeRole = 'basic';
        component.ngOnChanges();
        component.userSettingsFormGroup.get('brandText').setValue('A'.repeat(61));

        expect(component.userSettingsFormGroup.get('brandText').hasError('maxTrimmedLength')).toBe(true);
        expect(component.userSettingsFormGroup.valid).toBe(false);

        await component.onSubmit(new Event('submit'));
        expect(updateUserPropertiesSpy).not.toHaveBeenCalled();
    });

    it('should correctly save chart settings including visible metrics', async () => {
        const userService = TestBed.inject(AppUserService);
        const updateUserPropertiesSpy = vi.spyOn(userService, 'updateUserProperties').mockResolvedValue(true as any);

        component.ngOnChanges();

        // Simulate changing visible metrics
        // Initial state from mockUser is ['altitude']
        // Select only these 3 metrics
        const newMetrics = ['Altitude', 'Heart Rate', 'Speed'];
        component.userSettingsFormGroup.get('dataTypesToUse').setValue(newMetrics);

        // Submit the form
        await component.onSubmit(new Event('submit'));

        expect(updateUserPropertiesSpy).toHaveBeenCalledWith(
            expect.objectContaining({ uid: 'test-uid' }),
            expect.objectContaining({
                settings: expect.objectContaining({
                    chartSettings: expect.objectContaining({
                        dataTypeSettings: expect.objectContaining({
                            'Altitude': { enabled: true },
                            'Heart Rate': { enabled: true },
                            'Speed': { enabled: true },
                            // Verify a non-selected item is set to false
                            'Power': { enabled: false }
                        })
                    })
                })
            })
        );
    });

    it('should expose stamina metrics as selectable chart metrics', () => {
        const advancedGroup = component.dataGroups.find((group) => group.name === 'Advanced Data');

        expect(advancedGroup?.data).toContain(DataStamina.type);
        expect(advancedGroup?.data).toContain(DataPotentialStamina.type);
    });

    it('should initialize removeAscentForActivitiesSummaries with mandatory exclusions merged with user settings', () => {
        component.user.settings.summariesSettings = {
            removeAscentForEventTypes: ['Running']
        } as any;
        component.ngOnChanges();

        const formValue = component.userSettingsFormGroup.get('removeAscentForActivitiesSummaries').value;

        // Should contain 'Running' (from user)
        expect(formValue).toContain('Running');

        // Should contain mandatory exclusions (e.g., Alpine Skiing)
        ACTIVITIES_EXCLUDED_FROM_ASCENT.forEach(type => {
            expect(formValue).toContain(type);
        });

        // Should be unique
        expect(new Set(formValue).size).toBe(formValue.length);
    });
    it('should initialize removeDescentForActivitiesSummaries with mandatory exclusions merged with user settings', () => {
        component.user.settings.summariesSettings = {
            removeDescentForEventTypes: ['Running']
        } as any;
        component.ngOnChanges();

        const formValue = component.userSettingsFormGroup.get('removeDescentForActivitiesSummaries').value;

        // Should contain 'Running' (from user)
        expect(formValue).toContain('Running');

        // Should contain mandatory exclusions
        ACTIVITIES_EXCLUDED_FROM_DESCENT.forEach(type => {
            expect(formValue).toContain(type);
        });

        // Should be unique
        expect(new Set(formValue).size).toBe(formValue.length);
    });

    it('keeps save actions visible and disabled when form is invalid', () => {
        component.ngOnChanges();
        component.userSettingsFormGroup.get('dataTypesToUse').setValue([]);
        fixture.detectChanges();

        const desktopSaveButton = fixture.nativeElement.querySelector('.qs-form-actions-floating button') as HTMLButtonElement;
        const mobileSaveButton = fixture.nativeElement.querySelector('.mobile-save-bar button') as HTMLButtonElement;

        expect(desktopSaveButton).toBeTruthy();
        expect(mobileSaveButton).toBeTruthy();
        expect(desktopSaveButton.disabled).toBe(true);
        expect(mobileSaveButton.disabled).toBe(true);
    });

    it('allows an empty display name', () => {
        component.ngOnChanges();
        component.userSettingsFormGroup.get('displayName').setValue('');

        expect(component.userSettingsFormGroup.get('displayName').valid).toBe(true);
        expect(component.userSettingsFormGroup.valid).toBe(true);
    });

    it('should not open delete dialog when a deletion is already in progress', () => {
        const dialog = TestBed.inject(MatDialog) as { open: ReturnType<typeof vi.fn> };
        component.isDeleting = true;

        component.deleteUser(new Event('click'));

        expect(dialog.open).not.toHaveBeenCalled();
    });

    it('shows validation helper when required profile controls are invalid', () => {
        component.ngOnChanges();
        component.userSettingsFormGroup.get('dataTypesToUse').setValue([]);
        expect(component.userSettingsFormGroup.invalid).toBe(true);
        expect(component.shouldShowValidationDebug).toBe(true);
        expect(component.invalidControlDiagnostics).toEqual(expect.arrayContaining([
            expect.objectContaining({
                control: 'dataTypesToUse'
            })
        ]));
    });

    it('logs invalid control diagnostics when submit is blocked by validation', async () => {
        const logger = TestBed.inject(LoggerService);
        const warnSpy = vi.spyOn(logger, 'warn');

        component.ngOnChanges();
        component.userSettingsFormGroup.get('dataTypesToUse').setValue([]);
        component.userSettingsFormGroup.get('dataTypesToUse').markAsTouched();

        await component.onSubmit(new Event('submit'));

        expect(warnSpy).toHaveBeenCalledWith(
            '[UserSettingsComponent] Save blocked by invalid form controls',
            expect.objectContaining({
                uid: 'test-uid',
                invalidControls: expect.arrayContaining([
                    expect.objectContaining({
                        control: 'dataTypesToUse'
                    })
                ])
            })
        );
    });

    it('preserves dirty chart edits when the same user input refreshes', () => {
        component.ngOnChanges();
        component.userSettingsFormGroup.get('chartStrokeWidth').setValue(5);
        component.userSettingsFormGroup.get('chartStrokeWidth').markAsDirty();
        component.userSettingsFormGroup.markAsDirty();
        expect(component.userSettingsFormGroup.dirty).toBe(true);

        component.user = { ...(component.user as any), displayName: 'Remote Update' } as any;
        component.ngOnChanges();

        expect(component.userSettingsFormGroup.get('chartStrokeWidth').value).toBe(5);
        expect(component.userSettingsFormGroup.dirty).toBe(true);
    });

    it('marks the form pristine after successful save', async () => {
        const userService = TestBed.inject(AppUserService);
        vi.spyOn(userService, 'updateUserProperties').mockResolvedValue(true as any);

        component.ngOnChanges();
        component.userSettingsFormGroup.get('chartStrokeWidth').setValue(7);
        component.userSettingsFormGroup.get('chartStrokeWidth').markAsDirty();
        component.userSettingsFormGroup.markAsDirty();
        expect(component.userSettingsFormGroup.dirty).toBe(true);

        await component.onSubmit(new Event('submit'));

        expect(component.userSettingsFormGroup.pristine).toBe(true);
    });

    it('normalizes malformed legacy settings so required chart/unit controls stay valid', () => {
        component.user = {
            ...(component.user as any),
            settings: {
                ...(component.user as any).settings,
                chartSettings: {
                    ...(component.user as any).settings.chartSettings,
                    dataTypeSettings: {
                        Altitude: { enabled: false },
                        Speed: { enabled: false }
                    }
                },
                unitSettings: {
                    ...(component.user as any).settings.unitSettings,
                    speedUnits: [],
                    paceUnits: [],
                    swimPaceUnits: [],
                    verticalSpeedUnits: [],
                    distanceUnits: 'not-real'
                },
                dashboardSettings: {
                    ...(component.user as any).settings.dashboardSettings,
                    tableSettings: {}
                }
            }
        } as any;

        component.ngOnChanges();

        expect(component.userSettingsFormGroup.get('dataTypesToUse').value.length).toBeGreaterThan(0);
        expect(component.userSettingsFormGroup.get('speedUnitsToUse').value.length).toBeGreaterThan(0);
        expect(component.userSettingsFormGroup.get('paceUnitsToUse').value.length).toBeGreaterThan(0);
        expect(component.userSettingsFormGroup.get('swimPaceUnitsToUse').value.length).toBeGreaterThan(0);
        expect(component.userSettingsFormGroup.get('verticalSpeedUnitsToUse').value.length).toBeGreaterThan(0);
        expect(component.userSettingsFormGroup.get('distanceUnitsToUse').value).toBe(DistanceUnits.Kilometers);
        expect(component.userSettingsFormGroup.get('eventsPerPage').value).toBe(10);
    });

    it('exposes invalid control diagnostics with labels', () => {
        component.ngOnChanges();
        component.userSettingsFormGroup.get('dataTypesToUse').setValue([]);
        component.userSettingsFormGroup.get('dataTypesToUse').markAsTouched();

        const diagnostics = component.invalidControlDiagnostics;
        const dataTypeDiagnostic = diagnostics.find(entry => entry.control === 'dataTypesToUse');

        expect(dataTypeDiagnostic).toBeTruthy();
        expect(dataTypeDiagnostic?.label).toBe('Default chart metrics');
        expect(dataTypeDiagnostic?.errors).toContain('required');
    });
});
