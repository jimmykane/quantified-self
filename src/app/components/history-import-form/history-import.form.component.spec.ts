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
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AppEventService } from '../../services/app.event.service';
import { AppUserService } from '../../services/app.user.service';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { LoggerService } from '../../services/logger.service';
import { ServiceNames, UserServiceMetaInterface } from '@sports-alliance/sports-lib';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/app.event.service');
vi.mock('../../services/app.user.service');
vi.mock('../../services/app.analytics.service');
vi.mock('../../services/logger.service');

vi.mock('@sports-alliance/sports-lib', () => ({
    ServiceNames: {
        COROSAPI: 'COROSAPI',
        SuuntoApp: 'SuuntoApp',
        GarminAPI: 'GarminAPI'
    },
    UserServiceMetaInterface: {}
}));

describe('HistoryImportFormComponent', () => {
    let component: HistoryImportFormComponent;
    let fixture: ComponentFixture<HistoryImportFormComponent>;
    let mockEventService: any;
    let mockUserService: any;
    let mockAnalyticsService: any;
    let mockLoggerService: any;

    beforeEach(async () => {
        mockEventService = {};
        mockUserService = {
            isPro: vi.fn().mockResolvedValue(true),
            importServiceHistoryForCurrentUser: vi.fn().mockResolvedValue(true)
        };
        mockAnalyticsService = {
            logEvent: vi.fn()
        };
        mockLoggerService = {
            error: vi.fn()
        };

        await TestBed.configureTestingModule({
            declarations: [HistoryImportFormComponent],
            imports: [
                MatDatepickerModule,
                MatFormFieldModule,
                MatInputModule,
                MatCheckboxModule,
                ReactiveFormsModule,
                MatNativeDateModule,
                MatIconModule,
                MatButtonModule,
                MatSnackBarModule,
                MatProgressSpinnerModule,
                NoopAnimationsModule
            ],
            providers: [
                { provide: AppEventService, useValue: mockEventService },
                { provide: AppUserService, useValue: mockUserService },
                { provide: AppAnalyticsService, useValue: mockAnalyticsService },
                { provide: LoggerService, useValue: mockLoggerService }
            ]
        }).compileComponents();
    });

    beforeEach(() => {
        fixture = TestBed.createComponent(HistoryImportFormComponent);
        component = fixture.componentInstance;
        component.serviceName = ServiceNames.COROSAPI;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
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
});
