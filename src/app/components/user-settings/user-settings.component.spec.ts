import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Clipboard } from '@angular/cdk/clipboard';
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
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { MatFormField } from '@angular/material/form-field';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { BehaviorSubject, of } from 'rxjs';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { AppLocaleService } from '../../services/app.locale.service';
import { SharedModule } from '../../modules/shared.module';
import {
    ACTIVITIES_EXCLUDED_FROM_ASCENT,
    ACTIVITIES_EXCLUDED_FROM_DESCENT,
    ActivityTypes,
    DistanceUnits,
    GradeAdjustedPaceUnits,
    GradeAdjustedSpeedUnits,
    PaceUnits,
    DataPotentialStamina,
    SpeedUnits,
    DataStamina,
    SwimPaceUnits,
    User,
    VerticalSpeedUnits,
    WeightUnits,
} from '@sports-alliance/sports-lib';



describe('UserSettingsComponent', () => {
    let component: UserSettingsComponent;
    let fixture: ComponentFixture<UserSettingsComponent>;
    let mockActivatedRoute: any;
    let mockRouter: any;
    let clipboardMock: { copy: ReturnType<typeof vi.fn> };
    let snackBarMock: { open: ReturnType<typeof vi.fn> };
    let queryParamMapSubject: BehaviorSubject<any>;
    let hapticsServiceMock: any;
    let localeServiceMock: any;

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
        hapticsServiceMock = {
            selection: vi.fn(),
            success: vi.fn(),
            warning: vi.fn(),
            error: vi.fn(),
        };
        localeServiceMock = {
            cachePreference: vi.fn().mockReturnValue('unchanged'),
            reload: vi.fn(),
        };
        clipboardMock = { copy: vi.fn(() => true) };
        snackBarMock = { open: vi.fn() };

        await TestBed.configureTestingModule({
            declarations: [UserSettingsComponent],
            imports: [ReactiveFormsModule, MaterialModule, SharedModule, NoopAnimationsModule],
            providers: [
                { provide: AppAuthService, useValue: { user$: of(null) } },
                { provide: Clipboard, useValue: clipboardMock },
                { provide: ActivatedRoute, useValue: mockActivatedRoute },
                { provide: AppUserService, useValue: { isBranded: vi.fn().mockResolvedValue(false), updateUserProperties: vi.fn(), isAdmin: vi.fn().mockResolvedValue(false) } },
                { provide: Router, useValue: mockRouter },
                { provide: MatSnackBar, useValue: snackBarMock },
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
                { provide: AppHapticsService, useValue: hapticsServiceMock },
                { provide: AppLocaleService, useValue: localeServiceMock },
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

    it('exposes Theme directly and stages a selection without saving', () => {
        const theme = fixture.nativeElement.querySelector('.settings-theme-control');
        expect(theme.closest('.settings-panel-section')).toBeNull();
        const dark = Array.from(theme.querySelectorAll('mat-button-toggle'))
            .find((button: HTMLElement) => button.textContent.trim() === 'Dark') as HTMLElement;
        dark.querySelector('button').click();
        fixture.detectChanges();
        expect(component.userSettingsFormGroup.get('appTheme').value).toBe(component.appThemeOptions[2].value);
        expect(component.userSettingsFormGroup.dirty).toBe(true);
        expect(fixture.nativeElement.querySelector('.settings-save-bar')).toBeTruthy();
        expect(TestBed.inject(AppUserService).updateUserProperties).not.toHaveBeenCalled();
        expect(hapticsServiceMock.selection).toHaveBeenCalledOnce();
    });

    it('hides Save while pristine and ignores an implicit submit', async () => {
        expect(fixture.nativeElement.querySelector('.settings-save-bar')).toBeNull();
        await component.onSubmit(new Event('submit'));
        expect(TestBed.inject(AppUserService).updateUserProperties).not.toHaveBeenCalled();
        expect(hapticsServiceMock.success).not.toHaveBeenCalled();
    });

    it('places name in Account, watermark in Charts, and week start in Units', () => {
        const account = fixture.nativeElement.querySelector('#settings-account-content');
        const charts = fixture.nativeElement.querySelector('#settings-charts-content');
        const units = fixture.nativeElement.querySelector('#settings-units-content');
        expect(account.querySelector('[formControlName="displayName"]')).toBeTruthy();
        expect(account.querySelector('[formControlName="brandText"]')).toBeNull();
        expect(charts.querySelector('[formControlName="brandText"]')).toBeTruthy();
        expect(units.querySelector('[formControlName="startOfTheWeek"]')).toBeTruthy();
        const controls = Array.from(fixture.nativeElement.querySelectorAll('[formControlName]'))
            .map((element: Element) => element.getAttribute('formControlName'));
        expect(new Set(controls).size).toBe(controls.length);
    });

    it('updates summaries from staged settings and retains them while consent switches are locked', async () => {
        const form = component.userSettingsFormGroup;
        form.patchValue({ distanceUnitsToUse: DistanceUnits.Miles, weightUnitsToUse: WeightUnits.Pounds,
            acceptedTrackingPolicy: false, acceptedMarketingPolicy: true, dataTypesToUse: ['Heart Rate'], eventsPerPage: 50 });
        form.markAsDirty();
        expect(component.sectionSummaries().units).toContain('Miles');
        expect(component.sectionSummaries().units).toContain('Pounds');
        expect(component.sectionSummaries().charts).toContain('1 default metric');
        expect(component.sectionSummaries().dashboard).toBe('50 activities per page');
        expect(component.sectionSummaries().privacy).toBe('Analytics off · Marketing on');
        form.get('acceptedMarketingPolicy').disable();
        expect(component.sectionSummaries().privacy).toBe('Analytics off · Marketing on');
        await component.selectSettingsSection('charts');
        await component.selectSettingsSection('privacy');
        expect(form.dirty).toBe(true);
        expect(component.sectionSummaries().units).toContain('Miles');
    });

    it('refreshes untouched remote consent summaries without losing local edits', () => {
        const name = component.userSettingsFormGroup.get('displayName');
        name.setValue('Local name'); name.markAsDirty();
        component.user = { ...component.user, acceptedMarketingPolicy: true };
        component.ngOnChanges();
        expect(name.value).toBe('Local name');
        expect(component.sectionSummaries().privacy).toContain('Marketing on');
        expect(component.sectionSummaries().account).toContain('Local name');
        expect(hapticsServiceMock.selection).not.toHaveBeenCalled();
    });

    it.each([{ section: 'profile', active: 'account' }, { section: 'app', active: null }])(
        'retains the old $section link without an extra disclosure or haptic', ({ section, active }) => {
            queryParamMapSubject.next(convertToParamMap({ section }));
            fixture.detectChanges();
            expect(component.activeSection).toBe(active);
            expect(fixture.nativeElement.querySelector('.settings-theme-control')).toBeTruthy();
            expect(hapticsServiceMock.selection).not.toHaveBeenCalled();
        });

    it('opens Customize units without dirtying the form and retains edits across collapse', () => {
        component.activeSection = 'units'; fixture.detectChanges();
        const toggle = fixture.nativeElement.querySelector('.settings-customize-units') as HTMLButtonElement;
        const custom = fixture.nativeElement.querySelector('#settings-custom-units') as HTMLElement;
        toggle.click(); fixture.detectChanges();
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(custom.hidden).toBe(false);
        expect(component.userSettingsFormGroup.pristine).toBe(true);
        const weight = component.userSettingsFormGroup.get('weightUnitsToUse');
        weight.setValue(WeightUnits.Pounds); weight.markAsDirty();
        toggle.click(); fixture.detectChanges();
        expect(custom.hidden).toBe(true);
        expect(weight.value).toBe(WeightUnits.Pounds);
        expect(weight.dirty).toBe(true);
        expect(hapticsServiceMock.selection).toHaveBeenCalledTimes(2);
        component.isSaving = true;
        component.toggleCustomUnits(); component.onPreferenceChange();
        expect(hapticsServiceMock.selection).toHaveBeenCalledTimes(2);
    });

    it('keeps an accessible save error and staged choices for retry, then hides Save after success', async () => {
        const update = vi.mocked(TestBed.inject(AppUserService).updateUserProperties);
        update.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([]);
        const name = component.userSettingsFormGroup.get('displayName');
        name.setValue('Retry name'); name.markAsDirty();
        await component.onSubmit(new Event('submit')); fixture.detectChanges();
        const status = fixture.nativeElement.querySelector('.settings-save-status');
        expect(status.getAttribute('role')).toBe('alert');
        expect(status.textContent).toContain('Try again');
        expect(name.value).toBe('Retry name');
        expect(name.dirty).toBe(true);
        await component.onSubmit(new Event('submit')); fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.settings-save-bar')).toBeNull();
        expect(component.errorSaving).toBeNull();
        expect(hapticsServiceMock.error).toHaveBeenCalledOnce();
        expect(hapticsServiceMock.success).toHaveBeenCalledOnce();
    });

    it('defaults comparison line patterns off and emits one selection haptic for accepted toggle changes', () => {
        component.activeSection = 'charts';
        fixture.detectChanges();
        const control = component.userSettingsFormGroup.get('useDistinctComparisonLinePatterns');
        const toggle = fixture.debugElement.queryAll(By.directive(MatSlideToggle))
            .find(element => element.attributes['formControlName'] === 'useDistinctComparisonLinePatterns');
        expect(control.value).toBe(false);
        expect(toggle).toBeTruthy();
        expect(toggle.nativeElement.closest('.settings-slider-block')?.querySelector('[formControlName="chartStrokeWidth"]')).toBeTruthy();
        expect(hapticsServiceMock.selection).not.toHaveBeenCalled();
        toggle.triggerEventHandler('change', { checked: true });
        expect(hapticsServiceMock.selection).toHaveBeenCalledOnce();
        component.onDistinctLinePatternsChange(true);
        expect(hapticsServiceMock.selection).toHaveBeenCalledOnce();
        component.isSaving = true;
        component.onDistinctLinePatternsChange(false);
        expect(hapticsServiceMock.selection).toHaveBeenCalledOnce();
    });

    it('disables the line pattern control during save and restores it after completion', async () => {
        const control = component.userSettingsFormGroup.get('useDistinctComparisonLinePatterns');
        control.setValue(true);
        let finishSave!: () => void;
        control.markAsDirty();
        vi.mocked(TestBed.inject(AppUserService).updateUserProperties).mockImplementationOnce(() => new Promise<[]>(resolve => {
            finishSave = () => resolve([]);
        }));
        component.userSettingsFormGroup.markAsDirty();
        const save = component.onSubmit(new Event('submit'));
        expect(control.disabled).toBe(true);
        expect(hapticsServiceMock.success).not.toHaveBeenCalled();
        finishSave();
        await save;
        expect(control.enabled).toBe(true);
        expect(control.value).toBe(true);
        expect(hapticsServiceMock.success).toHaveBeenCalledOnce();
    });

    it.each([false, true])('hydrates saved patterns %s and saves an explicit toggle change', async (enabled) => {
        component.user = {
            ...component.user,
            settings: { ...component.user.settings, chartSettings: {
                ...component.user.settings.chartSettings, useDistinctComparisonLinePatterns: enabled,
            } },
        } as User;
        component.ngOnChanges();
        expect(component.userSettingsFormGroup.get('useDistinctComparisonLinePatterns').value).toBe(enabled);
        expect(hapticsServiceMock.selection).not.toHaveBeenCalled();
        const control = component.userSettingsFormGroup.get('useDistinctComparisonLinePatterns');
        control.setValue(!enabled);
        control.markAsDirty();
        const userService = TestBed.inject(AppUserService);
        const update = vi.mocked(userService.updateUserProperties).mockResolvedValue(undefined);
        component.userSettingsFormGroup.markAsDirty();
        await component.onSubmit(new Event('submit'));
        expect(update).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            settings: expect.objectContaining({ chartSettings: expect.objectContaining({ useDistinctComparisonLinePatterns: !enabled }) }),
        }));
        expect(hapticsServiceMock.success).toHaveBeenCalledOnce();
    });

    it('does not overwrite a remotely changed pattern preference when saving unrelated settings', async () => {
        component.userSettingsFormGroup.get('displayName').setValue('Edited name');
        component.userSettingsFormGroup.get('displayName').markAsDirty();
        const update = vi.mocked(TestBed.inject(AppUserService).updateUserProperties).mockResolvedValue([]);
        component.userSettingsFormGroup.markAsDirty();
        await component.onSubmit(new Event('submit'));
        const chartSettings = update.mock.calls[0][1].settings.chartSettings;
        expect(chartSettings).not.toHaveProperty('useDistinctComparisonLinePatterns');
    });

    it('refreshes untouched patterns while preserving unrelated dirty edits without haptics', () => {
        const form = component.userSettingsFormGroup;
        form.get('displayName').setValue('Edited name');
        form.get('displayName').markAsDirty();
        component.user = { ...component.user, settings: { ...component.user.settings, chartSettings: {
            ...component.user.settings.chartSettings, useDistinctComparisonLinePatterns: true,
        } } } as User;
        component.ngOnChanges();
        expect(component.userSettingsFormGroup).toBe(form);
        expect(form.get('displayName').value).toBe('Edited name');
        expect(form.get('useDistinctComparisonLinePatterns').value).toBe(true);
        expect(form.get('useDistinctComparisonLinePatterns').pristine).toBe(true);
        expect(hapticsServiceMock.selection).not.toHaveBeenCalled();
    });

    it('keeps explicitly edited line patterns through a background preference refresh', () => {
        const control = component.userSettingsFormGroup.get('useDistinctComparisonLinePatterns');
        control.setValue(true);
        control.markAsDirty();
        component.user = { ...component.user, settings: { ...component.user.settings, chartSettings: {
            ...component.user.settings.chartSettings, useDistinctComparisonLinePatterns: false,
        } } } as User;
        component.ngOnChanges();
        expect(control.value).toBe(true);
        expect(control.dirty).toBe(true);
        expect(hapticsServiceMock.selection).not.toHaveBeenCalled();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('labels expanded chart availability as recorded metrics', () => {
        const template = readFileSync(resolve(process.cwd(), 'src/app/components/user-settings/user-settings.component.html'), 'utf8');

        expect(template).toContain('Include all recorded metrics');
        expect(template).not.toContain('Show All Data Points');
    });

    it('shows email in the Account identity strip when available', () => {
        component.activeSection = 'account';
        component.user = { ...(component.user as any), email: 'runner@example.com' } as any;
        component.ngOnChanges();
        fixture.detectChanges();

        const emailLine = fixture.nativeElement.querySelector('.user-email') as HTMLElement | null;
        expect(emailLine).toBeTruthy();
        expect(emailLine?.textContent).toContain('runner@example.com');
    });

    it('hides the Account identity strip email when unavailable', () => {
        component.activeSection = 'account';
        component.user = { ...(component.user as any), email: null } as any;
        component.ngOnChanges();
        fixture.detectChanges();

        const emailLine = fixture.nativeElement.querySelector('.user-email');
        expect(emailLine).toBeNull();
    });

    it('copies the Account user ID to the clipboard', () => {
        component.activeSection = 'account';
        fixture.detectChanges();

        const copyButton = fixture.nativeElement.querySelector('button[aria-label="Copy user ID"]') as HTMLButtonElement;
        copyButton.click();

        expect(clipboardMock.copy).toHaveBeenCalledWith('test-uid');
        expect(snackBarMock.open).toHaveBeenCalledWith('User ID copied.', undefined, { duration: 2000 });
    });

    it('shows the profile identity strip only while Account is active', () => {
        component.activeSection = 'account';
        fixture.detectChanges();

        const profilePanel = fixture.nativeElement.querySelector('[aria-labelledby="settings-account-title"]');
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
            'units',
            'dashboard',
            'charts',
            'map',
            'privacy',
            'account',
        ]);
    });

    it('renders every settings disclosure in two ordered groups with Material buttons', () => {
        const groups = fixture.nativeElement.querySelectorAll('.settings-group');
        expect(groups).toHaveLength(2);
        expect(groups[0].querySelector('.settings-group-title').textContent).toBe('Preferences');
        expect(groups[1].querySelector('.settings-group-title').textContent).toBe('Privacy & account');
        const triggers = Array.from(fixture.nativeElement.querySelectorAll('.settings-section-trigger')) as HTMLButtonElement[];
        expect(triggers.map(button => button.getAttribute('aria-label'))).toEqual([
            'Units & formatting', 'Dashboard', 'Charts', 'Maps', 'Privacy & emails', 'Account',
        ]);
        expect(triggers.every(button => button.classList.contains('mat-mdc-button'))).toBe(true);
        expect(triggers.every(button => button.type === 'button')).toBe(true);
        expect(triggers.every(button => button.getAttribute('aria-expanded') === 'false')).toBe(true);
        expect(fixture.nativeElement.querySelector('app-workspace-section-navigation')).toBeNull();
        for (const button of triggers) {
            const panel = fixture.nativeElement.querySelector('#' + button.getAttribute('aria-controls'));
            expect(panel.getAttribute('aria-labelledby')).toBe(button.id);
            expect(panel.hidden).toBe(true);
        }
    });

    it('renders the settings heading before the overview', () => {
        const pageHeader = fixture.nativeElement.querySelector('.settings-page-header');
        expect(pageHeader).toBeTruthy();
        expect(pageHeader.nextElementSibling.classList.contains('settings-overview')).toBe(true);
    });

    it('expands and collapses a section through its button without discarding edits', async () => {
        const trigger = fixture.nativeElement.querySelector('button[aria-label="Account"]') as HTMLButtonElement;
        trigger.click();
        await fixture.whenStable(); fixture.detectChanges();
        expect(component.activeSection).toBe('account');
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        const form = component.userSettingsFormGroup;
        form.get('displayName').setValue('Unsaved name');
        form.get('displayName').markAsDirty();
        trigger.click();
        await fixture.whenStable(); fixture.detectChanges();
        expect(component.activeSection).toBeNull();
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        expect(form.get('displayName').value).toBe('Unsaved name');
        expect(form.dirty).toBe(true);
        expect(mockRouter.navigate).toHaveBeenLastCalledWith([], {
            relativeTo: mockActivatedRoute, queryParams: { section: null }, queryParamsHandling: 'merge',
        });
        expect(hapticsServiceMock.selection).toHaveBeenCalledTimes(2);
    });

    it('keeps save available for edits when Account is open', async () => {
        component.userSettingsFormGroup.get('displayName').markAsDirty();
        await component.selectSettingsSection('account');
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.settings-save-bar button')).toBeTruthy();
        expect(fixture.nativeElement.querySelector('.settings-save-status').textContent).toContain('Unsaved changes');
    });

    it('makes Save changes the only submit action, including inside collapsed sections', () => {
        component.userSettingsFormGroup.markAsDirty();
        fixture.detectChanges();
        const buttons = Array.from(fixture.nativeElement.querySelectorAll('form button')) as HTMLButtonElement[];
        expect(buttons.filter(button => button.type === 'submit'))
            .toEqual([fixture.nativeElement.querySelector('.settings-save-bar button')]);
        const deleteButton = buttons.find(button => button.textContent?.includes('Delete My Account'))!;
        expect(deleteButton.type).toBe('button');
    });

    it.each([false, true])('blocks edits and deletion during save and restores interaction after failure=%s', async fail => {
        const name = component.userSettingsFormGroup.get('displayName');
        name.setValue('Pending name');
        name.markAsDirty();
        component.activeSection = 'account';
        let finishSave!: () => void;
        const update = vi.mocked(TestBed.inject(AppUserService).updateUserProperties).mockImplementationOnce(() => new Promise<[]>(
            (resolve, reject) => { finishSave = () => fail ? reject(new Error('offline')) : resolve([]); }
        ));
        component.userSettingsFormGroup.markAsDirty();
        const save = component.onSubmit(new Event('submit'));
        fixture.detectChanges();
        const overview = fixture.nativeElement.querySelector('.settings-overview') as HTMLElement;
        const deleteButton = fixture.nativeElement.querySelector('.danger-card button') as HTMLButtonElement;
        expect(overview.hasAttribute('inert')).toBe(true);
        expect(deleteButton.disabled).toBe(true);
        expect(fixture.nativeElement.querySelector('.settings-save-bar mat-spinner')).toBeTruthy();
        deleteButton.click();
        component.deleteUser(new Event('click'));
        expect(TestBed.inject(MatDialog).open).not.toHaveBeenCalled();
        expect(update).toHaveBeenCalledTimes(1);
        finishSave();
        await save;
        fixture.detectChanges();
        expect(overview.hasAttribute('inert')).toBe(false);
        expect(deleteButton.disabled).toBe(false);
        expect(name.value).toBe('Pending name');
        expect(name.dirty).toBe(fail);
    });

    it('keeps subsection headings beneath their group and disclosure headings', () => {
        const panels = Array.from(fixture.nativeElement.querySelectorAll('.settings-panel-section')) as HTMLElement[];
        for (const panel of panels) {
            const headings = Array.from(panel.querySelectorAll('h1,h2,h3,h4,h5,h6'));
            expect(headings.every(heading => Number(heading.tagName.slice(1)) >= 4)).toBe(true);
        }
        const units = fixture.nativeElement.querySelector('#settings-units-content');
        expect(units.querySelectorAll('h4')).toHaveLength(3);
    });

    it('ignores disclosure actions while saving or deleting', async () => {
        component.isSaving = true;
        await component.toggleSettingsSection('privacy');
        component.isSaving = false; component.isDeleting = true;
        await component.toggleSettingsSection('account');
        expect(component.activeSection).toBeNull();
        expect(hapticsServiceMock.selection).not.toHaveBeenCalled();
        expect(mockRouter.navigate).not.toHaveBeenCalled();
    });

    it('lays out the overview in one column at every width with a sticky save action', () => {
        const styles = readFileSync(resolve(process.cwd(), 'src/app/components/user-settings/user-settings.component.scss'), 'utf8');
        const overviewColumns = Array.from(styles.matchAll(/\.settings-overview\s*\{([^}]*)\}/g))
            .flatMap(rule => Array.from(rule[1].matchAll(/grid-template-columns:\s*([^;]+);/g), match => match[1]));
        expect(styles).toContain('max-width: 800px');
        expect(overviewColumns).toEqual(['minmax(0, 1fr)']);
        expect(styles).toContain('position: sticky');
        expect(styles).not.toContain('position: fixed');
    });

    it('uses dynamic Material subscript sizing for settings form fields', () => {
        const sectionsWithFormFields = ['account', 'dashboard', 'map', 'charts', 'units'] as const;

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

    it('shows Privacy immediately before the final Account section', () => {
        const sectionIds = component.settingsSectionOptions.map(section => section.id);

        expect(sectionIds[sectionIds.length - 2]).toBe('privacy');
        expect(sectionIds[sectionIds.length - 1]).toBe('account');
    });

    it('should update section query param when a settings section is selected', async () => {
        component.activeSection = 'account';
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
        component.activeSection = 'account';
        fixture.detectChanges();

        const panels = fixture.nativeElement.querySelectorAll('.settings-panel-section');
        const profilePanel = fixture.nativeElement.querySelector('[aria-labelledby="settings-account-title"]');
        const mapPanel = fixture.nativeElement.querySelector('[aria-labelledby="settings-map-title"]');

        expect(panels).toHaveLength(6);
        expect(profilePanel.hidden).toBe(false);
        expect(mapPanel.hidden).toBe(true);

        component.activeSection = 'map';
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('[aria-labelledby="settings-account-title"]')).toBe(profilePanel);
        expect(fixture.nativeElement.querySelector('[aria-labelledby="settings-map-title"]')).toBe(mapPanel);
        expect(profilePanel.hidden).toBe(true);
        expect(mapPanel.hidden).toBe(false);
    });

    it('should update the active section from account query param changes', () => {
        component.activeSection = 'account';

        queryParamMapSubject.next(convertToParamMap({ section: 'account' }));

        expect(component.activeSection).toBe('account');
    });

    it('maps the legacy delete-account section query to account', () => {
        component.activeSection = 'account';

        queryParamMapSubject.next(convertToParamMap({ section: 'delete-account' }));

        expect(component.activeSection).toBe('account');
    });

    it('collapses the overview when the section query param is missing', () => {
        component.activeSection = 'units';

        queryParamMapSubject.next(convertToParamMap({}));

        expect(component.activeSection).toBeNull();
    });

    it('shows delete account as an action only while the account section is active', () => {
        component.activeSection = 'units';
        fixture.detectChanges();

        const accountPanel = fixture.nativeElement.querySelector('[aria-labelledby="settings-account-title"]');
        expect(accountPanel.querySelector('.danger-card')).toBeTruthy();
        expect(accountPanel.querySelector('app-mcp-connections')).toBeNull();
        expect(accountPanel.textContent).not.toContain('MCP connections');
        expect(accountPanel.querySelector('[formControlName="displayName"]')).toBeTruthy();
        expect(accountPanel.textContent).toContain('Delete My Account');
        expect(accountPanel.hidden).toBe(true);

        component.activeSection = 'account';
        fixture.detectChanges();

        expect(accountPanel.hidden).toBe(false);
        expect(fixture.nativeElement.querySelector('.settings-save-bar')).toBeNull();
    });

    it('should initialize acceptedTrackingPolicy from user data', () => {
        component.user.acceptedTrackingPolicy = true;
        component.ngOnChanges();
        expect(component.userSettingsFormGroup.get('acceptedTrackingPolicy').value).toBe(true);

        component.user.acceptedTrackingPolicy = false;
        component.ngOnChanges();
        expect(component.userSettingsFormGroup.get('acceptedTrackingPolicy').value).toBe(false);
    });

    it('opens both consent switches through the Privacy disclosure and direct section link', async () => {
        component.activeSection = 'account';
        fixture.detectChanges();
        const privacyTab = fixture.nativeElement.querySelector('#settings-privacy-title') as HTMLButtonElement;
        privacyTab.click();
        await fixture.whenStable(); fixture.detectChanges();
        expect(component.activeSection).toBe('privacy');
        expect(hapticsServiceMock.selection).toHaveBeenCalledTimes(1);
        const privacy = fixture.nativeElement.querySelector('[aria-labelledby="settings-privacy-title"]') as HTMLElement;
        const appearance = fixture.nativeElement.querySelector('.settings-theme-control') as HTMLElement;
        expect(privacy.hidden).toBe(false);
        expect(appearance.querySelector('mat-button-toggle-group[formControlName="appTheme"]')).toBeTruthy();
        expect(privacy.querySelectorAll('mat-slide-toggle')).toHaveLength(2);
        expect(appearance.querySelector('mat-slide-toggle')).toBeNull();
        expect(privacy.textContent).toContain('Save changes');
        expect(privacy.textContent).toContain('Account and billing emails will still be sent.');
        queryParamMapSubject.next(convertToParamMap({ section: 'profile' }));
        queryParamMapSubject.next(convertToParamMap({ section: 'privacy' }));
        fixture.detectChanges();
        expect(component.activeSection).toBe('privacy');
        expect(privacy.hidden).toBe(false);
        expect(hapticsServiceMock.selection).toHaveBeenCalledTimes(1);
    });

    it.each([
        { field: 'acceptedTrackingPolicy', label: 'Usage analytics', other: 'acceptedMarketingPolicy' },
        { field: 'acceptedMarketingPolicy', label: 'Marketing emails', other: 'acceptedTrackingPolicy' },
    ])('turns $label off through the visible switch and saves explicit false consent', async ({ field, label, other }) => {
        component.user = { ...component.user, acceptedTrackingPolicy: true, acceptedMarketingPolicy: true };
        component.ngOnChanges();
        queryParamMapSubject.next(convertToParamMap({ section: 'privacy' }));
        fixture.detectChanges();
        const toggle = fixture.nativeElement.querySelector(`mat-slide-toggle[formControlName="${field}"] button[role="switch"]`) as HTMLButtonElement;
        expect(toggle.getAttribute('aria-label')).toBe(label);
        expect(toggle.getAttribute('aria-checked')).toBe('true');
        toggle.click(); fixture.detectChanges();
        expect(toggle.getAttribute('aria-checked')).toBe('false');
        expect(component.userSettingsFormGroup.get(field)?.value).toBe(false);
        expect(component.userSettingsFormGroup.get(field)?.dirty).toBe(true);
        expect(hapticsServiceMock.selection).toHaveBeenCalledTimes(1);
        const update = vi.spyOn(TestBed.inject(AppUserService), 'updateUserProperties').mockResolvedValue(true);
        component.userSettingsFormGroup.markAsDirty();
        await component.onSubmit(new Event('submit'));
        expect(update).toHaveBeenCalledWith(expect.objectContaining({ uid: 'test-uid' }), expect.objectContaining({ [field]: false }));
        expect(update.mock.calls[0][1]).not.toHaveProperty(other);
        expect(hapticsServiceMock.success).toHaveBeenCalledTimes(1);
        component.user = { ...component.user, [field]: false };
        component.ngOnChanges(); fixture.detectChanges();
        expect(toggle.getAttribute('aria-checked')).toBe('false');
    });

    it('does not navigate or emit selection feedback for unchanged sections or busy consent controls', async () => {
        await component.selectSettingsSection(component.activeSection);
        expect(mockRouter.navigate).not.toHaveBeenCalled();
        component.isSaving = true;
        await component.selectSettingsSection('privacy');
        component.onPrivacyPreferenceChange();
        component.isSaving = false; component.isDeleting = true;
        component.onPrivacyPreferenceChange();
        expect(hapticsServiceMock.selection).not.toHaveBeenCalled();
        expect(component.activeSection).toBeNull();
    });

    it.each(['acceptedTrackingPolicy', 'acceptedMarketingPolicy'])('refreshes untouched %s while preserving unrelated edits', (field) => {
        component.user = { ...component.user, [field]: true };
        component.ngOnChanges();
        const form = component.userSettingsFormGroup;
        const name = form.get('displayName');
        name.setValue('Unsaved name');
        name.markAsDirty();
        component.user = { ...component.user, [field]: false };
        component.ngOnChanges();

        expect(component.userSettingsFormGroup).toBe(form);
        expect(name.value).toBe('Unsaved name');
        expect(name.dirty).toBe(true);
        expect(form.get(field).value).toBe(false);
        expect(form.get(field).pristine).toBe(true);
        expect(hapticsServiceMock.selection).not.toHaveBeenCalled();
    });

    it.each(['acceptedTrackingPolicy', 'acceptedMarketingPolicy'])('preserves an explicit %s edit during a background update', (field) => {
        component.user = { ...component.user, [field]: true };
        component.ngOnChanges();
        const control = component.userSettingsFormGroup.get(field);
        control.setValue(false);
        control.markAsDirty();
        component.user = { ...component.user, [field]: true, displayName: 'Remote name' };
        component.ngOnChanges();

        expect(control.value).toBe(false);
        expect(control.dirty).toBe(true);
        expect(hapticsServiceMock.selection).not.toHaveBeenCalled();
    });

    it.each([false, true])('locks privacy switches during save and restores them after failure=%s', async (fail) => {
        component.user = { ...component.user, acceptedTrackingPolicy: true, acceptedMarketingPolicy: true };
        component.ngOnChanges();
        queryParamMapSubject.next(convertToParamMap({ section: 'privacy' }));
        fixture.detectChanges();
        const marketing = component.userSettingsFormGroup.get('acceptedMarketingPolicy');
        marketing.setValue(false);
        marketing.markAsDirty();
        let finishSave!: () => void;
        const update = vi.mocked(TestBed.inject(AppUserService).updateUserProperties).mockImplementationOnce(() => new Promise<[]>(
            (resolve, reject) => { finishSave = () => fail ? reject(new Error('offline')) : resolve([]); }
        ));
        component.userSettingsFormGroup.markAsDirty();
        const save = component.onSubmit(new Event('submit'));
        fixture.detectChanges();
        const switches = Array.from(fixture.nativeElement.querySelectorAll('[aria-labelledby="settings-privacy-title"] button[role="switch"]')) as HTMLButtonElement[];
        expect(switches).toHaveLength(2);
        expect(switches.every(button => button.disabled)).toBe(true);
        switches.forEach(button => button.click());
        component.userSettingsFormGroup.markAsDirty();
        await component.onSubmit(new Event('submit'));
        expect(update).toHaveBeenCalledTimes(1);
        expect(marketing.value).toBe(false);
        finishSave();
        await save;
        fixture.detectChanges();

        expect(switches.every(button => !button.disabled)).toBe(true);
        expect(marketing.value).toBe(false);
        expect(marketing.dirty).toBe(fail);
        expect(hapticsServiceMock.selection).not.toHaveBeenCalled();
        expect(hapticsServiceMock[fail ? 'error' : 'success']).toHaveBeenCalledTimes(1);
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
        component.userSettingsFormGroup.markAsDirty();
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
        component.userSettingsFormGroup.markAsDirty();
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

        component.userSettingsFormGroup.markAsDirty();
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

        component.userSettingsFormGroup.markAsDirty();
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

        component.userSettingsFormGroup.markAsDirty();
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

        component.userSettingsFormGroup.markAsDirty();
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

    it('saves pounds independently and keeps them when applying a distance preset', async () => {
        const userService = TestBed.inject(AppUserService);
        const updateUserPropertiesSpy = vi.spyOn(userService, 'updateUserProperties').mockResolvedValue(true as any);
        component.ngOnChanges();
        expect(component.userSettingsFormGroup.get('weightUnitsToUse').value).toBe(WeightUnits.Kilograms);
        component.userSettingsFormGroup.get('weightUnitsToUse').setValue(WeightUnits.Pounds);
        component.onUnitPresetChange('miles');
        expect(component.userSettingsFormGroup.get('weightUnitsToUse').value).toBe(WeightUnits.Pounds);
        component.userSettingsFormGroup.markAsDirty();
        await component.onSubmit(new Event('submit'));
        expect(updateUserPropertiesSpy).toHaveBeenCalledWith(
            expect.objectContaining({ uid: 'test-uid' }),
            expect.objectContaining({ settings: expect.objectContaining({
                unitSettings: expect.objectContaining({ weightUnits: WeightUnits.Pounds, distanceUnits: DistanceUnits.Miles }),
            }) }),
        );
    });

    it('keeps weight-unit hydration silent and gives one selection feedback for a deliberate choice', () => {
        component.activeSection = 'units';
        fixture.detectChanges();
        expect(hapticsServiceMock.selection).not.toHaveBeenCalled();

        const weightSelect = fixture.debugElement.query(By.css('mat-select[formControlName="weightUnitsToUse"]'));
        expect(weightSelect).toBeTruthy();
        weightSelect.triggerEventHandler('selectionChange', { value: WeightUnits.Pounds });
        expect(hapticsServiceMock.selection).toHaveBeenCalledOnce();
    });

    it('should complete unit setup when saving a changed unit preference', async () => {
        const userService = TestBed.inject(AppUserService);
        const updateUserPropertiesSpy = vi.spyOn(userService, 'updateUserProperties').mockResolvedValue(true as any);

        (component.user.settings.appSettings as any).unitSetupCompleted = false;
        component.ngOnChanges();
        component.userSettingsFormGroup.get('distanceUnitsToUse').setValue(DistanceUnits.Miles);

        component.userSettingsFormGroup.markAsDirty();
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

        component.userSettingsFormGroup.markAsDirty();
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

    it('initializes missing regional formatting as Automatic', () => {
        expect(component.userSettingsFormGroup.get('formatLocale').value).toBe('auto');
        expect(component.selectedFormatLocaleLabel).toBe('Automatic (browser)');
        expect(component.formatLocaleOptions).toHaveLength(10);
        expect(component.formatLocaleOptions.map(option => option.value)).toEqual([
            'auto', 'en-GB', 'en-US', 'de-DE', 'fr-FR', 'es-ES', 'it-IT', 'nl-NL', 'pl-PL', 'el-GR',
        ]);
        expect(component.formatLocaleOptions.every(option => option.preview.date && option.preview.number)).toBe(true);
    });

    it('shows the unit preset before regional formatting and individual overrides', () => {
        component.activeSection = 'units';
        fixture.detectChanges();

        const regionalFormat = fixture.nativeElement.querySelector('.settings-regional-format');
        const presetGroup = fixture.nativeElement.querySelector('mat-button-toggle-group[aria-label="Unit preset"]');
        expect(regionalFormat).toBeTruthy();
        expect(presetGroup.compareDocumentPosition(regionalFormat) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(regionalFormat.textContent).toContain('Regional formatting');
        expect(regionalFormat.textContent).toContain('exported dates stay separate');
    });

    it('keeps regional options and previews readable at the narrow settings breakpoint', () => {
        const styles = readFileSync(
            resolve(process.cwd(), 'src/app/components/user-settings/user-settings.component.scss'),
            'utf8',
        );

        expect(styles).toMatch(/\.settings-regional-format mat-form-field\s*\{[^}]*flex:\s*0 1 auto/s);
        expect(styles).toContain('width: min(100%, 390px)');
        expect(styles).toMatch(/\.regional-format-option\s*\{[^}]*min-height:\s*64px/s);
        expect(styles).toMatch(/\.regional-format-option__content\s*\{[^}]*grid-template-columns:\s*1fr/s);
    });

    it('uses selection haptics only when the regional format changes deliberately', () => {
        expect(hapticsServiceMock.selection).not.toHaveBeenCalled();

        component.onFormatLocaleChange();

        expect(hapticsServiceMock.selection).toHaveBeenCalledOnce();
    });

    it('saves and applies a changed regional format', async () => {
        const userService = TestBed.inject(AppUserService);
        const updateUserPropertiesSpy = vi.spyOn(userService, 'updateUserProperties').mockResolvedValue(true as any);
        localeServiceMock.cachePreference.mockReturnValue('updated');
        component.userSettingsFormGroup.get('formatLocale').setValue('fr-FR');
        component.userSettingsFormGroup.get('formatLocale').markAsDirty();

        component.userSettingsFormGroup.markAsDirty();
        await component.onSubmit(new Event('submit'));

        expect(updateUserPropertiesSpy).toHaveBeenCalledWith(
            expect.objectContaining({ uid: 'test-uid' }),
            expect.objectContaining({
                settings: expect.objectContaining({
                    appSettings: expect.objectContaining({ formatLocale: 'fr-FR' }),
                }),
            }),
        );
        expect(localeServiceMock.cachePreference).toHaveBeenCalledWith('fr-FR');
        expect(localeServiceMock.reload).toHaveBeenCalledOnce();
        expect(hapticsServiceMock.success).toHaveBeenCalledOnce();
    });

    it('does not reconcile or reload an unchanged regional format', async () => {
        const userService = TestBed.inject(AppUserService);
        vi.spyOn(userService, 'updateUserProperties').mockResolvedValue(true as any);

        component.userSettingsFormGroup.markAsDirty();
        await component.onSubmit(new Event('submit'));

        expect(localeServiceMock.cachePreference).not.toHaveBeenCalled();
        expect(localeServiceMock.reload).not.toHaveBeenCalled();
    });

    it('reports when a saved regional format cannot be cached by the browser', async () => {
        const userService = TestBed.inject(AppUserService);
        vi.spyOn(userService, 'updateUserProperties').mockResolvedValue(true as any);
        localeServiceMock.cachePreference.mockReturnValue('storage-unavailable');
        component.userSettingsFormGroup.get('formatLocale').setValue('pl-PL');

        component.userSettingsFormGroup.markAsDirty();
        await component.onSubmit(new Event('submit'));

        expect(snackBarMock.open).toHaveBeenCalledWith(
            'Settings saved, but this browser could not apply the regional format.',
            undefined,
            { duration: 5000 },
        );
        expect(hapticsServiceMock.warning).toHaveBeenCalledOnce();
        expect(hapticsServiceMock.success).not.toHaveBeenCalled();
        expect(localeServiceMock.reload).not.toHaveBeenCalled();
    });

    it('does not cache or reload a changed regional format when the account save fails', async () => {
        const userService = TestBed.inject(AppUserService);
        vi.spyOn(userService, 'updateUserProperties').mockRejectedValueOnce(new Error('offline'));
        component.userSettingsFormGroup.get('formatLocale').setValue('el-GR');

        component.userSettingsFormGroup.markAsDirty();
        await component.onSubmit(new Event('submit'));

        expect(localeServiceMock.cachePreference).not.toHaveBeenCalled();
        expect(localeServiceMock.reload).not.toHaveBeenCalled();
        expect(hapticsServiceMock.error).toHaveBeenCalledOnce();
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

    it('allows reapplying the same preset after customizing its unit choices', () => {
        component.activeSection = 'units';
        component.onUnitPresetChange('kilometers');
        component.userSettingsFormGroup.get('paceUnitsToUse').setValue([PaceUnits.MinutesPerMile]);
        fixture.detectChanges();
        expect(component.selectedUnitPreset).toBeNull();
        const group = fixture.nativeElement.querySelector('mat-button-toggle-group[aria-label="Unit preset"]');
        expect(group.querySelector('[aria-checked="true"]')).toBeNull();
        expect(group.parentElement.textContent).toContain('Custom unit choices');
        const kilometers = Array.from(group.querySelectorAll('mat-button-toggle'))
            .find((toggle: HTMLElement) => toggle.textContent.trim() === 'Kilometers') as HTMLElement;
        hapticsServiceMock.selection.mockClear();
        kilometers.querySelector('button').click();
        fixture.detectChanges();
        expect(component.selectedUnitPreset).toBe('kilometers');
        expect(component.userSettingsFormGroup.get('paceUnitsToUse').value).toEqual([PaceUnits.MinutesPerKilometer]);
        expect(hapticsServiceMock.selection).toHaveBeenCalledOnce();
        expect(group.parentElement.textContent).not.toContain('Custom unit choices');
        component.onUnitPresetChange('kilometers');
        expect(hapticsServiceMock.selection).toHaveBeenCalledOnce();
    });

    it.each([
        { preset: 'kilometers' as const, distance: DistanceUnits.Kilometers, speed: SpeedUnits.KilometersPerHour,
            pace: PaceUnits.MinutesPerKilometer, swim: SwimPaceUnits.MinutesPer100Meter, vertical: VerticalSpeedUnits.MetersPerSecond,
            gap: GradeAdjustedPaceUnits.MinutesPerKilometer, gas: GradeAdjustedSpeedUnits.KilometersPerHour },
        { preset: 'miles' as const, distance: DistanceUnits.Miles, speed: SpeedUnits.MilesPerHour,
            pace: PaceUnits.MinutesPerMile, swim: SwimPaceUnits.MinutesPer100Yard, vertical: VerticalSpeedUnits.FeetPerSecond,
            gap: GradeAdjustedPaceUnits.MinutesPerMile, gas: GradeAdjustedSpeedUnits.MilesPerHour },
    ])('stages and saves $preset while preserving independent preferences', async expected => {
        component.userSettingsFormGroup.patchValue({weightUnitsToUse: WeightUnits.Pounds, startOfTheWeek: 0, formatLocale: 'en-GB'});
        component.onUnitPresetChange(expected.preset === 'miles' ? 'kilometers' : 'miles');
        component.onUnitPresetChange(expected.preset);
        expect(TestBed.inject(AppUserService).updateUserProperties).not.toHaveBeenCalled();
        component.activeSection = 'account';
        await component.onSubmit(new Event('submit'));
        expect(TestBed.inject(AppUserService).updateUserProperties).toHaveBeenCalledWith(
            component.user,
            expect.objectContaining({settings: expect.objectContaining({
                unitSettings: {
                    distanceUnits: expected.distance, speedUnits: [expected.speed], paceUnits: [expected.pace],
                    swimPaceUnits: [expected.swim], verticalSpeedUnits: [expected.vertical],
                    gradeAdjustedPaceUnits: [expected.gap], gradeAdjustedSpeedUnits: [expected.gas],
                    weightUnits: WeightUnits.Pounds, startOfTheWeek: 0,
                },
                appSettings: expect.objectContaining({formatLocale: 'en-GB'}),
            })}),
        );
        expect(component.selectedUnitPreset).toBe(expected.preset);
        expect(component.userSettingsFormGroup.pristine).toBe(true);
    });

    it('keeps individual unit controls mounted behind Customize units', () => {
        component.activeSection = 'units';
        fixture.detectChanges();

        const presetGroup = fixture.nativeElement.querySelector('mat-button-toggle-group[aria-label="Unit preset"]');
        const unitsFieldList = fixture.nativeElement.querySelector('.settings-field-list--units');
        const formFields = fixture.nativeElement.querySelectorAll('mat-form-field');

        expect(presetGroup).toBeTruthy();
        expect(unitsFieldList).toBeTruthy();
        expect(presetGroup.hasAttribute('hideSingleSelectionIndicator')).toBe(true);
        expect(fixture.nativeElement.querySelector('mat-expansion-panel')).toBeFalsy();
        expect(fixture.nativeElement.textContent).toContain('Customize units');
        expect(fixture.nativeElement.querySelector('#settings-custom-units').hidden).toBe(true);
        expect(fixture.nativeElement.textContent).toContain('Health and Training body weight');
        expect(fixture.nativeElement.textContent).toContain('first preference selects swim distance in meters or yards');
        expect(fixture.nativeElement.textContent).toContain('dive depth and rate units');
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

        component.userSettingsFormGroup.markAsDirty();
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

        component.userSettingsFormGroup.markAsDirty();
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

        component.userSettingsFormGroup.markAsDirty();
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

        component.userSettingsFormGroup.markAsDirty();
        await component.onSubmit(new Event('submit'));

        const payload = updateUserPropertiesSpy.mock.calls[0][1];
        expect(payload.brandText).toBe('Grace Brand');
    });

    it('should not include legacy showPoints in saved map settings', async () => {
        const userService = TestBed.inject(AppUserService);
        const updateUserPropertiesSpy = vi.spyOn(userService, 'updateUserProperties').mockResolvedValue(true as any);

        component.ngOnChanges();
        component.userSettingsFormGroup.markAsDirty();
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

        component.userSettingsFormGroup.markAsDirty();
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

        component.userSettingsFormGroup.markAsDirty();
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
        component.userSettingsFormGroup.markAsDirty();
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

    it('should make every Diving-group activity mandatory for both elevation exclusions', () => {
        component.ngOnChanges();
        const ascentFormValue = component.userSettingsFormGroup.get('removeAscentForActivitiesSummaries').value;
        const descentFormValue = component.userSettingsFormGroup.get('removeDescentForActivitiesSummaries').value;

        [
            ActivityTypes.Diving,
            ActivityTypes.ScubaDiving,
            ActivityTypes.FreeDiving,
            ActivityTypes.Snorkeling,
            ActivityTypes.Mermaiding,
        ].forEach((activityType) => {
            expect(ascentFormValue).toContain(activityType);
            expect(descentFormValue).toContain(activityType);
            expect(component.isMandatoryExclusion(activityType)).toBe(true);
            expect(component.isMandatoryDescentExclusion(activityType)).toBe(true);
        });
    });

    it('keeps save actions visible and disabled when form is invalid', () => {
        component.ngOnChanges();
        component.userSettingsFormGroup.markAsDirty();
        component.userSettingsFormGroup.get('dataTypesToUse').setValue([]);
        fixture.detectChanges();

        const saveButton = fixture.nativeElement.querySelector('.settings-save-bar button') as HTMLButtonElement;
        expect(saveButton).toBeTruthy();
        expect(saveButton.disabled).toBe(true);
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

        component.userSettingsFormGroup.markAsDirty();
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

        component.userSettingsFormGroup.markAsDirty();
        await component.onSubmit(new Event('submit'));

        expect(component.userSettingsFormGroup.pristine).toBe(true);
        expect(hapticsServiceMock.success).toHaveBeenCalledOnce();
    });

    it('uses an error haptic when a settings save fails', async () => {
        const userService = TestBed.inject(AppUserService);
        vi.spyOn(userService, 'updateUserProperties').mockRejectedValueOnce(new Error('offline'));

        component.ngOnChanges();
        component.userSettingsFormGroup.get('chartStrokeWidth').setValue(7);
        component.userSettingsFormGroup.get('chartStrokeWidth').markAsDirty();

        component.userSettingsFormGroup.markAsDirty();
        await component.onSubmit(new Event('submit'));

        expect(hapticsServiceMock.error).toHaveBeenCalledOnce();
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
