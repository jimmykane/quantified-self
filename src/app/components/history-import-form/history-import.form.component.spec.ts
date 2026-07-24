import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HistoryImportFormComponent } from './history-import.form.component';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { ReactiveFormsModule } from '@angular/forms';
import { MatNativeDateModule } from '@angular/material/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatSnackBarModule, MatSnackBar } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AppEventService } from '../../services/app.event.service';
import { AppUserService } from '../../services/app.user.service';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { LoggerService } from '../../services/logger.service';
import { AppAuthService } from '../../authentication/app.auth.service';
import { AppSleepService } from '../../services/app.sleep.service';
import { APP_STORAGE } from '../../services/storage/app.storage.token';
import { Firestore } from 'app/firebase/firestore';
import { of } from 'rxjs';
import { ServiceNames, UserServiceMetaInterface } from '@sports-alliance/sports-lib';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Component, Input, NO_ERRORS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common'; // Added CommonModule
import { HISTORY_IMPORT_ACTIVITIES_PER_DAY_LIMIT } from '@shared/history-import.constants';

vi.mock('../../services/app.event.service');
vi.mock('../../services/app.user.service');
vi.mock('../../services/app.analytics.service');
vi.mock('../../services/logger.service');

vi.mock('@sports-alliance/sports-lib', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@sports-alliance/sports-lib')>();

    return {
        ...actual,
        ServiceNames: {
            ...actual.ServiceNames,
            COROSAPI: 'COROSAPI',
            SuuntoApp: 'SuuntoApp',
            GarminAPI: 'GarminAPI'
        }
    };
});

describe('HistoryImportFormComponent', () => {
    let component: HistoryImportFormComponent;
    let fixture: ComponentFixture<HistoryImportFormComponent>;
    let mockEventService: any;
    let mockUserService: any;
    let mockAnalyticsService: any;
    let mockLoggerService: any;
    let mockAuthService: any;
    let mockSleepService: any;
    let snackBar: MatSnackBar;

    beforeEach(async () => {
        mockEventService = {};
        mockUserService = {
            isPro: vi.fn().mockResolvedValue(true),
            importServiceHistoryForCurrentUser: vi.fn().mockResolvedValue(true),
            backfillSuuntoSleepForCurrentUser: vi.fn().mockResolvedValue({
                queued: 135,
                startDate: '2016-01-01T00:00:00.000Z',
                endDate: '2026-04-30T12:00:00.000Z',
                nextAllowedAtMs: 1_778_244_000_000,
            }),
            backfillCorosSleepForCurrentUser: vi.fn().mockResolvedValue({
                queued: 4,
                startDate: '2026-01-30T12:00:00.000Z',
                endDate: '2026-04-30T12:00:00.000Z',
                nextAllowedAtMs: 1_778_244_000_000,
            }),
            backfillGarminSleepForCurrentUser: vi.fn().mockResolvedValue({
                queued: 43,
                startDate: '2016-01-01T00:00:00.000Z',
                endDate: '2026-04-30T12:00:00.000Z',
                nextAllowedAtMs: 1_780_231_200_000,
            }),
            user$: of({ uid: '123' }),
            hasPaidAccessSignal: vi.fn(() => true)
        };
        mockAnalyticsService = {
            logEvent: vi.fn()
        };
        mockLoggerService = {
            error: vi.fn()
        };
        mockAuthService = {
            getUser: vi.fn().mockResolvedValue({ uid: '123', stripeRole: 'pro' }),
            user$: of({ uid: '123' })
        };
        mockSleepService = {
            watchSyncState: vi.fn().mockReturnValue(of(null)),
        };

        await TestBed.configureTestingModule({
            declarations: [HistoryImportFormComponent],
            schemas: [NO_ERRORS_SCHEMA],
            imports: [
                CommonModule, // Added CommonModule
                MatDatepickerModule,
                MatFormFieldModule,
                MatInputModule,
                MatCheckboxModule,
                ReactiveFormsModule,
                MatNativeDateModule,
                MatIconModule,
                MatButtonModule,
                MatCardModule,
                MatSnackBarModule,
                MatProgressSpinnerModule,
                NoopAnimationsModule
            ],
            providers: [
                { provide: AppEventService, useValue: mockEventService },
                { provide: AppUserService, useValue: mockUserService },
                { provide: AppAnalyticsService, useValue: mockAnalyticsService },
                { provide: LoggerService, useValue: mockLoggerService },
                { provide: AppAuthService, useValue: mockAuthService },
                { provide: AppSleepService, useValue: mockSleepService },
                { provide: Firestore, useValue: {} },
                { provide: APP_STORAGE, useValue: localStorage },
            ]
        }).compileComponents();

        snackBar = TestBed.inject(MatSnackBar);
    });

    beforeEach(() => {
        fixture = TestBed.createComponent(HistoryImportFormComponent);
        component = fixture.componentInstance;
        component.serviceName = ServiceNames.COROSAPI;
        vi.spyOn(snackBar, 'open');
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should have correct processing capacity constant', () => {
        expect(component.processingCapacityPerDay).toBe(5000);
    });

    it('should render Suunto sleep backfill button for connected Pro users', async () => {
        await fixture.whenStable();
        component.serviceName = ServiceNames.SuuntoApp;
        component.userMetaForService = {} as UserServiceMetaInterface;
        component.providerConnected = true;
        component.isPro = true;
        (component as any).processChanges();
        fixture.detectChanges();

        const text = fixture.nativeElement.textContent;
        expect(text).toContain('Import Sleep History');
        expect(text).toContain('Imports Suunto sleep');
        expect(text).toContain('once every 7 days');
    });

    it('should render Garmin sleep backfill button for connected Pro users', async () => {
        await fixture.whenStable();
        component.serviceName = ServiceNames.GarminAPI;
        component.userMetaForService = {} as UserServiceMetaInterface;
        component.providerConnected = true;
        component.missingPermissions = [];
        component.isPro = true;
        (component as any).processChanges();
        fixture.detectChanges();

        const text = fixture.nativeElement.textContent;
        expect(text).toContain('Import Sleep History');
        expect(text).toContain('Imports Garmin sleep');
        expect(text).toContain('Records may appear gradually');
        expect(text).toContain('once every 30 days');
    });

    it('should render Garmin sleep backfill for newly connected users without activity history meta', async () => {
        await fixture.whenStable();
        component.serviceName = ServiceNames.GarminAPI;
        component.userMetaForService = undefined as any;
        component.providerConnected = true;
        component.missingPermissions = [];
        component.isPro = true;
        (component as any).processChanges();
        fixture.detectChanges();

        const text = fixture.nativeElement.textContent;
        const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
        const sleepButton = buttons.find(button => button.textContent?.includes('Import Sleep History'));

        expect(text).toContain('Import Sleep History');
        expect(text).toContain('Imports Garmin sleep');
        expect(sleepButton?.disabled).toBe(false);
    });

    it('should not render sleep backfill when the parent provider is disconnected', async () => {
        await fixture.whenStable();
        component.serviceName = ServiceNames.GarminAPI;
        component.userMetaForService = {} as UserServiceMetaInterface;
        component.providerConnected = false;
        component.missingPermissions = [];
        component.isPro = true;
        (component as any).processChanges();
        fixture.detectChanges();

        expect(fixture.nativeElement.textContent).not.toContain('Import Sleep History');
    });

    it('should render COROS sleep backfill for connected Pro users within the provider lookback', async () => {
        await fixture.whenStable();
        component.serviceName = ServiceNames.COROSAPI;
        component.userMetaForService = {} as UserServiceMetaInterface;
        component.providerConnected = true;
        component.isPro = true;
        (component as any).processChanges();
        fixture.detectChanges();

        const text = fixture.nativeElement.textContent;
        expect(text).toContain('Import Sleep History');
        expect(text).toContain('Imports available COROS sleep');
        expect(text).toContain('up to three months');
        expect(text).toContain('once every 7 days');
    });

    it('should disable sleep backfill during the provider cooldown', async () => {
        await fixture.whenStable();
        mockSleepService.watchSyncState.mockReturnValueOnce(of({
            provider: 'SuuntoApp',
            status: 'ready',
            nextBackfillAllowedAtMs: Date.now() + 60_000,
            updatedAtMs: Date.now(),
        }));
        component.serviceName = ServiceNames.SuuntoApp;
        component.userMetaForService = {} as UserServiceMetaInterface;
        component.providerConnected = true;
        component.isPro = true;
        (component as any).processChanges();
        fixture.detectChanges();

        const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
        const sleepButton = buttons.find(button => button.textContent?.includes('Import Sleep History'));
        expect(sleepButton?.disabled).toBe(true);
        expect(fixture.nativeElement.textContent).toContain('Next available');
    });

    it('should queue Suunto sleep backfill from the separate action', async () => {
        await fixture.whenStable();
        component.serviceName = ServiceNames.SuuntoApp;
        component.userMetaForService = {} as UserServiceMetaInterface;
        component.providerConnected = true;
        component.isPro = true;
        (component as any).processChanges();

        await component.onSleepBackfill({
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
        } as any);

        expect(mockUserService.backfillSuuntoSleepForCurrentUser).toHaveBeenCalled();
        expect(mockAnalyticsService.logEvent).toHaveBeenCalledWith('backfilled_sleep_history', {
            method: ServiceNames.SuuntoApp,
            source: 'history_import',
        });
        expect(component.pendingSleepBackfillResult()?.queued).toBe(135);
    });

    it('should queue COROS sleep backfill from the separate action', async () => {
        await fixture.whenStable();
        component.serviceName = ServiceNames.COROSAPI;
        component.userMetaForService = {} as UserServiceMetaInterface;
        component.providerConnected = true;
        component.isPro = true;
        (component as any).processChanges();

        await component.onSleepBackfill({
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
        } as any);

        expect(mockUserService.backfillCorosSleepForCurrentUser).toHaveBeenCalled();
        expect(mockAnalyticsService.logEvent).toHaveBeenCalledWith('backfilled_sleep_history', {
            method: ServiceNames.COROSAPI,
            source: 'history_import',
        });
        expect(component.pendingSleepBackfillResult()?.queued).toBe(4);
    });

    it('should request Garmin sleep backfill from the separate action', async () => {
        await fixture.whenStable();
        component.serviceName = ServiceNames.GarminAPI;
        component.userMetaForService = {} as UserServiceMetaInterface;
        component.providerConnected = true;
        component.missingPermissions = [];
        component.isPro = true;
        (component as any).processChanges();

        await component.onSleepBackfill({
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
        } as any);

        expect(mockUserService.backfillGarminSleepForCurrentUser).toHaveBeenCalled();
        expect(mockAnalyticsService.logEvent).toHaveBeenCalledWith('backfilled_sleep_history', {
            method: ServiceNames.GarminAPI,
            source: 'history_import',
        });
        expect(component.pendingSleepBackfillResult()?.queued).toBe(43);
    });

    it('should disable Garmin sleep backfill when health permissions are missing', async () => {
        await fixture.whenStable();
        component.serviceName = ServiceNames.GarminAPI;
        component.userMetaForService = {} as UserServiceMetaInterface;
        component.providerConnected = true;
        component.missingPermissions = ['HEALTH_EXPORT'];
        component.isPro = true;
        (component as any).processChanges();
        fixture.detectChanges();

        const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
        const sleepButton = buttons.find(button => button.textContent?.includes('Import Sleep History'));
        expect(sleepButton?.disabled).toBe(true);
        expect(fixture.nativeElement.textContent).toContain('Reconnect Garmin');
    });

    it('should still queue Suunto sleep backfill when analytics logging fails', async () => {
        await fixture.whenStable();
        component.serviceName = ServiceNames.SuuntoApp;
        component.userMetaForService = {} as UserServiceMetaInterface;
        component.providerConnected = true;
        component.isPro = true;
        mockAnalyticsService.logEvent.mockImplementationOnce(() => {
            throw new Error('analytics unavailable');
        });
        (component as any).processChanges();

        await component.onSleepBackfill({
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
        } as any);

        expect(mockLoggerService.error).toHaveBeenCalledWith(expect.any(Error));
        expect(mockUserService.backfillSuuntoSleepForCurrentUser).toHaveBeenCalled();
        expect(component.pendingSleepBackfillResult()?.queued).toBe(135);
    });

    it('should calculate cooldownDays correctly', () => {
        // Hardcoded 500 to match constant HISTORY_IMPORT_ACTIVITIES_PER_DAY_LIMIT
        const limit = 500;

        // Inject mock limit since component might import real one but we want to assert logic
        (component as any).activitiesPerDayLimit = limit;

        component.userMetaForService = {
            processedActivitiesFromLastHistoryImportCount: limit
        } as UserServiceMetaInterface;
        expect(component.cooldownDays).toBe(1);

        component.userMetaForService = {
            processedActivitiesFromLastHistoryImportCount: limit * 2
        } as UserServiceMetaInterface;
        expect(component.cooldownDays).toBe(2);

        component.userMetaForService = {
            processedActivitiesFromLastHistoryImportCount: limit + 1
        } as UserServiceMetaInterface;
        expect(component.cooldownDays).toBe(2); // Should ceil

        component.userMetaForService = {
            processedActivitiesFromLastHistoryImportCount: 100
        } as UserServiceMetaInterface;
        expect(component.cooldownDays).toBe(1); // Minimum 1 day calculation effectively (ceil(0.2) = 1)

        component.userMetaForService = {
            processedActivitiesFromLastHistoryImportCount: 0
        } as UserServiceMetaInterface;
        expect(component.cooldownDays).toBe(0);
    });

    it('should disable form when missing required Garmin permissions', () => {
        component.serviceName = ServiceNames.GarminAPI;
        component.missingPermissions = ['HISTORICAL_DATA_EXPORT'];
        component.userMetaForService = {
            didLastHistoryImport: 0 // Never imported
        } as any;

        (component as any).processChanges();

        expect(component.isMissingGarminPermissions).toBe(true);
        expect(component.isAllowedToDoHistoryImport).toBe(true); // Should be true to show the form
        expect(component.formGroup.disabled).toBe(true);
    });

    describe('isHistoryImportPending (optimistic UI)', () => {
        it('should initially be false', () => {
            expect(component.isHistoryImportPending()).toBe(false);
        });

        it('should be set to true after successful import submission', async () => {
            // Setup component for allowed import
            component.serviceName = ServiceNames.COROSAPI;
            component.userMetaForService = {} as UserServiceMetaInterface; // No previous import
            component.isPro = true;
            (component as any).processChanges();

            // Enable form and set valid values
            component.formGroup.enable();
            component.formGroup.patchValue({
                startDate: new Date(),
                endDate: new Date(),
                accepted: true
            });

            expect(component.isHistoryImportPending()).toBe(false);

            // Submit the form
            const mockEvent = { preventDefault: vi.fn() } as any;
            await component.onSubmit(mockEvent);

            expect(component.isHistoryImportPending()).toBe(true);
            expect(mockUserService.importServiceHistoryForCurrentUser).toHaveBeenCalled();
        });

        it('should store pendingImportResult from backend response (COROS/Suunto/Wahoo)', async () => {
            // Setup component for allowed import
            component.serviceName = ServiceNames.COROSAPI;
            component.userMetaForService = {} as UserServiceMetaInterface;
            component.isPro = true;
            (component as any).processChanges();

            // Enable form and set valid values
            component.formGroup.enable();
            component.formGroup.patchValue({
                startDate: new Date(),
                endDate: new Date(),
                accepted: true
            });

            // Mock backend response with stats (like COROS/Suunto returns)
            const mockStats = {
                successCount: 150,
                failureCount: 5,
                processedBatches: 2,
                failedBatches: 0
            };
            mockUserService.importServiceHistoryForCurrentUser.mockResolvedValueOnce({
                result: 'History items added to queue',
                stats: mockStats
            });

            expect(component.pendingImportResult()).toBeNull();

            const mockEvent = { preventDefault: vi.fn() } as any;
            await component.onSubmit(mockEvent);

            expect(component.pendingImportResult()).toEqual(mockStats);
            // We now check for the verbal estimation
            // 150 / 24000 = very small fraction of a day -> very soon
            expect(component.estimatedCompletionVerbal).toContain('Should be done very soon! 🚀');

            // Should also display the capacity
            const compiled = fixture.nativeElement;
            expect(compiled.textContent).toContain('5,000 / day capacity');
        });

        it('should show "No new activities" snackbar when successCount is 0', async () => {
            // Setup component for allowed import
            component.serviceName = ServiceNames.COROSAPI;
            component.userMetaForService = {} as UserServiceMetaInterface;
            component.isPro = true;
            (component as any).processChanges();

            // Enable form and set valid values
            component.formGroup.enable();
            component.formGroup.patchValue({
                startDate: new Date(),
                endDate: new Date(),
                accepted: true
            });

            // Mock backend response with 0 items
            const mockStats = {
                successCount: 0,
                failureCount: 0,
                processedBatches: 1,
                failedBatches: 0
            };
            mockUserService.importServiceHistoryForCurrentUser.mockResolvedValueOnce({
                result: 'History items added to queue',
                stats: mockStats
            });

            const mockEvent = { preventDefault: vi.fn() } as any;
            await component.onSubmit(mockEvent);

            expect(component.pendingImportResult()).toEqual(mockStats);
            expect(snackBar.open).toHaveBeenCalledWith(
                'No new activities found to import.',
                undefined,
                { duration: 3000 }
            );
        });

        it('should show error when start date is after end date', () => {
            // Valid simple form
            component.serviceName = ServiceNames.GarminAPI;
            component.userMetaForService = {} as UserServiceMetaInterface;
            (component as any).processChanges();
            component.formGroup.enable();

            const startDate = new Date();
            const endDate = new Date(startDate.getTime() - 86400000); // Yesterday

            component.formGroup.patchValue({
                startDate: startDate,
                endDate: endDate,
                accepted: true
            });

            expect(component.formGroup.valid).toBe(false);
            expect(component.formGroup.errors?.['dateRangeInvalid']).toBe(true);
        });

        it('should enforce COROS 3-month limit on minDate', () => {
            component.serviceName = ServiceNames.COROSAPI;
            component.userMetaForService = {} as UserServiceMetaInterface;

            // Trigger logic
            (component as any).processChanges();

            expect(component.minDate).toBeTruthy();
            const expectedMinDate = new Date();
            expectedMinDate.setMonth(expectedMinDate.getMonth() - component.corosHistoryLimitMonths);

            // Check roughly equal (within slightly different execution times)
            expect(component.minDate!.getDate()).toBe(expectedMinDate.getDate());
            expect(component.minDate!.getMonth()).toBe(expectedMinDate.getMonth());
        });

        it('should enforce Garmin 5-year limit on minDate', () => {
            component.serviceName = ServiceNames.GarminAPI;
            component.userMetaForService = {} as UserServiceMetaInterface;

            // Trigger logic
            (component as any).processChanges();

            expect(component.minDate).toBeTruthy();
            const expectedMinDate = new Date();
            expectedMinDate.setFullYear(expectedMinDate.getFullYear() - 5);

            // Check roughly equal (within slightly different execution times)
            expect(component.minDate!.getDate()).toBe(expectedMinDate.getDate());
            expect(component.minDate!.getFullYear()).toBe(expectedMinDate.getFullYear());
            expect(component.minDate!.getMonth()).toBe(expectedMinDate.getMonth());
        });

        it('should NOT be set to true if import fails', async () => {
            // Setup component for allowed import
            component.serviceName = ServiceNames.SuuntoApp;
            component.userMetaForService = {} as UserServiceMetaInterface;
            component.isPro = true;
            (component as any).processChanges();

            // Enable form and set valid values
            component.formGroup.enable();
            component.formGroup.patchValue({
                startDate: new Date(),
                endDate: new Date(),
                accepted: true
            });

            // Make the import fail
            mockUserService.importServiceHistoryForCurrentUser.mockRejectedValueOnce(new Error('API Error'));

            expect(component.isHistoryImportPending()).toBe(false);

            const mockEvent = { preventDefault: vi.fn() } as any;
            await component.onSubmit(mockEvent);

            // Should remain false on error
            expect(component.isHistoryImportPending()).toBe(false);
        });

        it('should normalize dates to start of day and end of day on submission', async () => {
            component.serviceName = ServiceNames.SuuntoApp;
            component.userMetaForService = {} as UserServiceMetaInterface;
            component.isPro = true;
            (component as any).processChanges();
            component.formGroup.enable();

            // Set arbitrary dates
            const start = new Date(2024, 0, 15, 12, 30); // Jan 15, 12:30
            const end = new Date(2024, 0, 16, 14, 45);   // Jan 16, 14:45

            component.formGroup.patchValue({
                startDate: start,
                endDate: end,
                accepted: true
            });

            const mockEvent = { preventDefault: vi.fn() } as any;
            await component.onSubmit(mockEvent);

            // Verify normalization
            const sentStart = mockUserService.importServiceHistoryForCurrentUser.mock.calls[0][1];
            const sentEnd = mockUserService.importServiceHistoryForCurrentUser.mock.calls[0][2];

            expect(sentStart.getHours()).toBe(0);
            expect(sentStart.getMinutes()).toBe(0);
            expect(sentStart.getSeconds()).toBe(0);

            expect(sentEnd.getHours()).toBe(23);
            expect(sentEnd.getMinutes()).toBe(59);
            expect(sentEnd.getSeconds()).toBe(59);
        });

        it('should work for all service types', async () => {
            for (const serviceName of [ServiceNames.COROSAPI, ServiceNames.SuuntoApp, ServiceNames.GarminAPI, ServiceNames.WahooAPI]) {
                // Reset the signal
                component.isHistoryImportPending.set(false);

                component.serviceName = serviceName;
                component.userMetaForService = {} as UserServiceMetaInterface;
                component.missingPermissions = [];
                component.isPro = true;
                (component as any).processChanges();

                component.formGroup.enable();
                component.formGroup.patchValue({
                    startDate: new Date(),
                    endDate: new Date(),
                    accepted: true
                });

                mockUserService.importServiceHistoryForCurrentUser.mockResolvedValue({ success: true });

                const mockEvent = { preventDefault: vi.fn() } as any;
                await component.onSubmit(mockEvent);

                expect(component.isHistoryImportPending()).toBe(true);
            }
        });
    });

    describe('Wahoo history imports', () => {
        it('enables a first import and renders the generic confirmation copy', () => {
            component.serviceName = ServiceNames.WahooAPI;
            component.userMetaForService = {} as UserServiceMetaInterface;
            component.isPro = true;

            (component as any).processChanges();
            fixture.detectChanges();

            expect(component.isAllowedToDoHistoryImport).toBe(true);
            expect(component.formGroup.enabled).toBe(true);
            expect(fixture.nativeElement.textContent).toContain('I understand this may take hours to days.');
        });

        it('disables a repeated import during the activity-based cooldown and renders its status', () => {
            component.serviceName = ServiceNames.WahooAPI;
            component.userMetaForService = {
                didLastHistoryImport: Date.now(),
                processedActivitiesFromLastHistoryImportCount: HISTORY_IMPORT_ACTIVITIES_PER_DAY_LIMIT,
            } as UserServiceMetaInterface;
            component.isPro = true;

            (component as any).processChanges();
            fixture.detectChanges();

            expect(component.isAllowedToDoHistoryImport).toBe(false);
            expect(component.formGroup.disabled).toBe(true);
            expect(fixture.nativeElement.textContent).toContain('500 activities scheduled from the last import.');
            expect(fixture.nativeElement.textContent).toContain('Cooldown active for 1 day.');
            expect(component.nextImportAvailableDate.getTime()).toBeGreaterThan(Date.now());
        });

        it('enables a repeated import after the activity-based cooldown', () => {
            component.serviceName = ServiceNames.WahooAPI;
            component.userMetaForService = {
                didLastHistoryImport: Date.now() - (2 * 24 * 60 * 60 * 1000),
                processedActivitiesFromLastHistoryImportCount: HISTORY_IMPORT_ACTIVITIES_PER_DAY_LIMIT,
            } as UserServiceMetaInterface;
            component.isPro = true;

            (component as any).processChanges();

            expect(component.isAllowedToDoHistoryImport).toBe(true);
            expect(component.formGroup.enabled).toBe(true);
        });

        it('renders Wahoo queue statistics after a successful import request', async () => {
            component.serviceName = ServiceNames.WahooAPI;
            component.userMetaForService = {} as UserServiceMetaInterface;
            component.isPro = true;
            (component as any).processChanges();
            component.formGroup.patchValue({
                startDate: new Date(),
                endDate: new Date(),
                accepted: true,
            });
            mockUserService.importServiceHistoryForCurrentUser.mockResolvedValueOnce({
                result: 'History items added to queue',
                stats: {
                    successCount: 42,
                    failureCount: 0,
                    processedBatches: 1,
                    failedBatches: 0,
                },
            });

            await component.onSubmit({ preventDefault: vi.fn() } as any);
            fixture.detectChanges();

            expect(component.isHistoryImportPending()).toBe(true);
            expect(fixture.nativeElement.textContent).toContain('42 activities scheduled.');
            expect(fixture.nativeElement.textContent).toContain('5,000 / day capacity');
        });
    });
});
