import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UserSettingsComponent } from './user-settings.component';
import { AppAuthService } from '../../authentication/app.auth.service';
import { AppUserService } from '../../services/app.user.service';
import { ActivatedRoute, Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppWindowService } from '../../services/app.window.service';
import { MatDialog } from '@angular/material/dialog';
import { LoggerService } from '../../services/logger.service';
import { Analytics } from '@angular/fire/analytics';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MaterialModule } from '../../modules/material.module';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { of } from 'rxjs';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { Privacy, User, ACTIVITIES_EXCLUDED_FROM_ASCENT } from '@sports-alliance/sports-lib';



describe('UserSettingsComponent', () => {
    let component: UserSettingsComponent;
    let fixture: ComponentFixture<UserSettingsComponent>;

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
        await TestBed.configureTestingModule({
            declarations: [UserSettingsComponent],
            imports: [ReactiveFormsModule, MaterialModule, NoopAnimationsModule],
            providers: [
                { provide: AppAuthService, useValue: { user$: of(null) } },
                { provide: ActivatedRoute, useValue: { snapshot: { data: {} } } },
                { provide: ActivatedRoute, useValue: { snapshot: { data: {} } } },
                { provide: AppUserService, useValue: { isBranded: vi.fn().mockResolvedValue(false), updateUserProperties: vi.fn(), isAdmin: vi.fn().mockResolvedValue(false) } },
                { provide: Router, useValue: {} },
                { provide: MatSnackBar, useValue: { open: vi.fn() } },
                { provide: AppWindowService, useValue: {} },
                { provide: MatDialog, useValue: {} },
                { provide: LoggerService, useValue: { error: vi.fn() } },
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

    it('should default privacy to Private if user.privacy is missing', () => {
        // mockUser has no privacy property
        component.ngOnChanges();
        expect(component.userSettingsFormGroup.get('privacy').value).toBe(Privacy.Private);
    });

    it('should use user.privacy if available', () => {
        component.user.privacy = Privacy.Public;
        component.ngOnChanges();
        expect(component.userSettingsFormGroup.get('privacy').value).toBe(Privacy.Public);
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

    it('should save acceptedTrackingPolicy when form is submitted', async () => {
        const userService = TestBed.inject(AppUserService);
        const updateUserPropertiesSpy = vi.spyOn(userService, 'updateUserProperties').mockResolvedValue(true as any);
        const analyticsService = TestBed.inject(AppAnalyticsService) as any;
        vi.spyOn(analyticsService, 'logEvent');

        component.user.acceptedTrackingPolicy = false;
        component.ngOnChanges();

        // Change the value
        component.userSettingsFormGroup.get('acceptedTrackingPolicy').setValue(true);

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

        // Submit the form
        await component.onSubmit(new Event('submit'));

        expect(updateUserPropertiesSpy).toHaveBeenCalledWith(
            expect.objectContaining({ uid: 'test-uid' }),
            expect.objectContaining({
                acceptedMarketingPolicy: true
            })
        );
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
});
