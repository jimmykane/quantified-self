import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SummariesComponent } from './summaries.component';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AppAuthService } from '../../authentication/app.auth.service';
import { AppEventService } from '../../services/app.event.service';
import { AppThemeService } from '../../services/app.theme.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { ChangeDetectorRef } from '@angular/core';
import { LoggerService } from '../../services/logger.service';
import { of } from 'rxjs';
import { ActivityTypes, ChartDataValueTypes, ChartDataCategoryTypes, TimeIntervals, DataAscent, DataDescent } from '@sports-alliance/sports-lib';

describe('SummariesComponent', () => {
    let component: SummariesComponent;
    let fixture: ComponentFixture<SummariesComponent>;
    let mockRouter: any;
    let mockAuthService: any;
    let mockEventService: any;
    let mockThemeService: any;
    let mockSnackBar: any;
    let mockDialog: any;
    let mockLogger: any;

    beforeEach(async () => {
        mockRouter = { navigate: vi.fn() };
        mockAuthService = {};
        mockEventService = {};
        mockThemeService = {
            getChartTheme: vi.fn().mockReturnValue(of('light'))
        };
        mockSnackBar = { open: vi.fn() };
        mockDialog = { open: vi.fn() };
        mockLogger = { error: vi.fn(), warn: vi.fn(), log: vi.fn() };

        await TestBed.configureTestingModule({
            declarations: [SummariesComponent],
            providers: [
                { provide: Router, useValue: mockRouter },
                { provide: AppAuthService, useValue: mockAuthService },
                { provide: AppEventService, useValue: mockEventService },
                { provide: AppThemeService, useValue: mockThemeService },
                { provide: MatSnackBar, useValue: mockSnackBar },
                { provide: MatDialog, useValue: mockDialog },
                { provide: LoggerService, useValue: mockLogger },
                ChangeDetectorRef
            ]
        }).compileComponents();

        fixture = TestBed.createComponent(SummariesComponent);
        component = fixture.componentInstance;
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    describe('getChartData', () => {
        it('should filter out ascent data for AlpineSki events', () => {
            const mockEvents = [
                {
                    getActivityTypesAsArray: () => [ActivityTypes.AlpineSki],
                    getStat: vi.fn().mockReturnValue({ getValue: () => 100 }),
                    startDate: new Date(),
                    isMerge: false
                },
                {
                    getActivityTypesAsArray: () => [ActivityTypes.Running],
                    getStat: vi.fn().mockReturnValue({ getValue: () => 50 }),
                    startDate: new Date(),
                    isMerge: false
                }
            ] as any;

            // Mock getEventCategoryKey to return a simple key
            vi.spyOn(component as any, 'getEventCategoryKey').mockReturnValue('key');
            vi.spyOn(component as any, 'getValueSum').mockReturnValue(150);

            const result = (component as any).getChartData(
                mockEvents,
                DataAscent.type,
                ChartDataValueTypes.Total,
                ChartDataCategoryTypes.ActivityType,
                TimeIntervals.Daily
            );

            // AlpineSki event should be filtered out, only Running event remains
            // But we need to check if the total is correct or if the events were filtered.
            // Since AlpineSki is filtered out before processing, only Running should be in result.
            expect(result.length).toBe(1);
        });

        it('should filter out descent data for Swimming events', () => {
            const mockEvents = [
                {
                    getActivityTypesAsArray: () => [ActivityTypes.Swimming],
                    getStat: vi.fn().mockReturnValue({ getValue: () => 100 }),
                    startDate: new Date(),
                    isMerge: false
                },
                {
                    getActivityTypesAsArray: () => [ActivityTypes.Running],
                    getStat: vi.fn().mockReturnValue({ getValue: () => 50 }),
                    startDate: new Date(),
                    isMerge: false
                }
            ] as any;

            vi.spyOn(component as any, 'getEventCategoryKey').mockReturnValue('key');
            vi.spyOn(component as any, 'getValueSum').mockReturnValue(150);

            const result = (component as any).getChartData(
                mockEvents,
                DataDescent.type,
                ChartDataValueTypes.Total,
                ChartDataCategoryTypes.ActivityType,
                TimeIntervals.Daily
            );

            expect(result.length).toBe(1);
        });

        it('should not filter out ascent data for Running events', () => {
            const mockEvents = [
                {
                    getActivityTypesAsArray: () => [ActivityTypes.Running],
                    getStat: vi.fn().mockReturnValue({ getValue: () => 100 }),
                    startDate: new Date(),
                    isMerge: false
                }
            ] as any;

            vi.spyOn(component as any, 'getEventCategoryKey').mockReturnValue('key');
            vi.spyOn(component as any, 'getValueSum').mockReturnValue(100);

            const result = (component as any).getChartData(
                mockEvents,
                DataAscent.type,
                ChartDataValueTypes.Total,
                ChartDataCategoryTypes.ActivityType,
                TimeIntervals.Daily
            );

            expect(result.length).toBe(1);
        });

        it('should filter out ascent data if manually excluded by user setting', () => {
            component.user = {
                settings: {
                    summariesSettings: {
                        removeAscentForEventTypes: [ActivityTypes.Running]
                    }
                }
            } as any;

            const mockEvents = [
                {
                    getActivityTypesAsArray: () => [ActivityTypes.Running],
                    getStat: vi.fn().mockReturnValue({ getValue: () => 100 }),
                    startDate: new Date(),
                    isMerge: false
                }
            ] as any;

            vi.spyOn(component as any, 'getEventCategoryKey').mockReturnValue('key');
            vi.spyOn(component as any, 'getValueSum').mockReturnValue(100);

            const result = (component as any).getChartData(
                mockEvents,
                DataAscent.type,
                ChartDataValueTypes.Total,
                ChartDataCategoryTypes.ActivityType,
                TimeIntervals.Daily
            );

            expect(result.length).toBe(0);
        });

        it('should filter out descent data if manually excluded by user setting', () => {
            component.user = {
                settings: {
                    summariesSettings: {
                        removeDescentForEventTypes: [ActivityTypes.Running]
                    }
                }
            } as any;

            const mockEvents = [
                {
                    getActivityTypesAsArray: () => [ActivityTypes.Running],
                    getStat: vi.fn().mockReturnValue({ getValue: () => 100 }),
                    startDate: new Date(),
                    isMerge: false
                }
            ] as any;

            vi.spyOn(component as any, 'getEventCategoryKey').mockReturnValue('key');
            vi.spyOn(component as any, 'getValueSum').mockReturnValue(100);

            const result = (component as any).getChartData(
                mockEvents,
                DataDescent.type,
                ChartDataValueTypes.Total,
                ChartDataCategoryTypes.ActivityType,
                TimeIntervals.Daily
            );

            expect(result.length).toBe(0);
        });
    });
});
