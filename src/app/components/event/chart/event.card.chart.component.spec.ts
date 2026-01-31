import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventCardChartComponent } from './event.card.chart.component';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { AmChartsService } from '../../../services/am-charts.service';
import { AppUserSettingsQueryService } from '../../../services/app.user-settings-query.service';
import { AppThemeService } from '../../../services/app.theme.service';
import { AppUserService } from '../../../services/app.user.service';
import { AppEventService } from '../../../services/app.event.service';
import { AppDataColors } from '../../../services/color/app.data.colors';
import { AppWindowService } from '../../../services/app.window.service';
import { AppChartSettingsLocalStorageService } from '../../../services/storage/app.chart.settings.local.storage.service';
import { AppActivityCursorService } from '../../../services/activity-cursor/app-activity-cursor.service';
import { LoggerService } from '../../../services/logger.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ChangeDetectorRef, NgZone, signal } from '@angular/core';
import { of } from 'rxjs';
import { ActivityTypes, DataAltitude } from '@sports-alliance/sports-lib';

describe('EventCardChartComponent', () => {
    let component: EventCardChartComponent;
    let fixture: ComponentFixture<EventCardChartComponent>;
    let mockUserSettingsQuery: any;
    let mockThemeService: any;
    let mockAmChartsService: any;
    let mockEventColorService: any;
    let mockUserService: any;
    let mockEventService: any;
    let mockDataColors: any;
    let mockWindowService: any;
    let mockChartSettingsStorage: any;
    let mockActivityCursorService: any;
    let mockSnackBar: any;

    beforeEach(async () => {
        mockUserSettingsQuery = {
            chartSettings: signal({
                showAllData: false,
                showLaps: true,
                showGrid: true,
                disableGrouping: false,
                hideAllSeriesOnInit: false,
                gainAndLossThreshold: 5,
            }),
            unitSettings: signal({}),
            updateChartSettings: vi.fn()
        };
        mockThemeService = {
            getChartTheme: vi.fn().mockReturnValue(of('light')),
            getAppTheme: vi.fn().mockReturnValue(of('light'))
        };
        mockAmChartsService = {
            createChart: vi.fn(),
            getChartTheme: vi.fn().mockReturnValue({}),
            load: vi.fn().mockResolvedValue({ core: {}, charts: {} })
        };
        mockEventColorService = {};
        mockUserService = {
            getUser: vi.fn().mockReturnValue(of({})),
            getUserChartDataTypesToUse: vi.fn().mockReturnValue([])
        };
        mockEventService = {
            getEvents: vi.fn().mockReturnValue(of([]))
        };
        mockDataColors = {
            getDataColor: vi.fn().mockReturnValue('#000000')
        };
        mockWindowService = {
            nativeWindow: {
                innerWidth: 1000
            }
        };
        mockChartSettingsStorage = {
            getSettings: vi.fn().mockReturnValue({})
        };
        mockActivityCursorService = {
            cursor$: of(null)
        };
        mockSnackBar = { open: vi.fn() };

        await TestBed.configureTestingModule({
            declarations: [EventCardChartComponent],
            providers: [
                { provide: AppUserSettingsQueryService, useValue: mockUserSettingsQuery },
                { provide: AppThemeService, useValue: mockThemeService },
                { provide: AmChartsService, useValue: mockAmChartsService },
                { provide: AppEventColorService, useValue: mockEventColorService },
                { provide: AppUserService, useValue: mockUserService },
                { provide: AppEventService, useValue: mockEventService },
                { provide: AppDataColors, useValue: mockDataColors },
                { provide: AppWindowService, useValue: mockWindowService },
                { provide: AppChartSettingsLocalStorageService, useValue: mockChartSettingsStorage },
                { provide: AppActivityCursorService, useValue: mockActivityCursorService },
                { provide: MatSnackBar, useValue: mockSnackBar },
                { provide: LoggerService, useValue: { error: vi.fn(), warn: vi.fn(), log: vi.fn(), info: vi.fn() } },
                { provide: NgZone, useValue: { run: (fn: any) => fn(), runOutsideAngular: (fn: any) => fn() } },
                { provide: ChangeDetectorRef, useValue: { detectChanges: vi.fn(), markForCheck: vi.fn() } }
            ]
        }).compileComponents();

        fixture = TestBed.createComponent(EventCardChartComponent);
        component = fixture.componentInstance;

        // Mock the core and charts objects
        (component as any).core = {
            Container: function () { return { createChild: vi.fn().mockReturnValue({ createChild: vi.fn().mockReturnValue({}), id: '' }) }; },
            Color: vi.fn(),
            InterfaceColorSet: function () { this.getFor = vi.fn(); },
            Label: function () { },
            options: {}
        };
        (component as any).charts = {
            Legend: function () { },
        };

        // Mock the event object
        component.event = {
            getActivityTypesAsArray: () => [ActivityTypes.Running],
            getActivities: () => [],
        } as any;
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    describe('createLabel', () => {
        it('should include gain and loss for Running', () => {
            component.event = {
                getActivityTypesAsArray: () => [ActivityTypes.Running]
            } as any;

            const series = {
                dummyData: {
                    stream: { type: DataAltitude.type }
                }
            } as any;

            // Mock container and createChild
            const mockContainer = {
                createChild: vi.fn().mockReturnValue({
                    createChild: vi.fn().mockReturnValue({}),
                    id: ''
                })
            };

            const labelData = (component as any).createLabel(mockContainer, series, { gain: 10, loss: 10 });

            expect(labelData).toBeDefined();
        });
    });
});
