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
import { ChangeDetectorRef, CUSTOM_ELEMENTS_SCHEMA, NgZone, signal } from '@angular/core';
import { of } from 'rxjs';
import { ActivityTypes, DataAltitude, DataPace, DataPowerAvg, DataSpeedAvgKilometersPerHour, LapTypes, XAxisTypes } from '@sports-alliance/sports-lib';
import { AppUserUtilities } from '../../../utils/app.user.utilities';

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
        mockEventColorService = {
            getActivityColor: vi.fn().mockReturnValue('#ff0000')
        };
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
            ],
            schemas: [CUSTOM_ELEMENTS_SCHEMA]
        }).compileComponents();

        fixture = TestBed.createComponent(EventCardChartComponent);
        component = fixture.componentInstance;

        // Mock the core and charts objects
        (component as any).core = {
            Container: function () {
                return {
                    createChild: vi.fn().mockReturnValue({}),
                    id: '',
                    background: {
                        fillOpacity: 0,
                        fill: {},
                        stroke: {},
                        strokeOpacity: 0,
                        strokeWidth: 0
                    },
                    padding: vi.fn(),
                    filters: { push: vi.fn() }
                };
            },
            Color: vi.fn().mockReturnValue({}),
            color: vi.fn().mockReturnValue({}),
            InterfaceColorSet: function () { this.getFor = vi.fn(); },
            Label: function () { return { align: '', text: '' }; },
            DropShadowFilter: function () { return { dy: 0, dx: 0, opacity: 0, blur: 0 }; },
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

    it('should fallback to default chart lap types when settings lapTypes is empty', () => {
        mockUserSettingsQuery.chartSettings.set({
            ...mockUserSettingsQuery.chartSettings(),
            lapTypes: []
        });

        expect(component.lapTypes).toEqual(AppUserUtilities.getDefaultChartLapTypes());
    });

    describe('createLabel', () => {
        it('should include gain and loss for Running', () => {
            component.event = {
                getActivityTypesAsArray: () => [ActivityTypes.Running],
                getActivities: () => []
            } as any;

            const series = {
                dummyData: {
                    stream: { type: DataAltitude.type },
                    activity: { creator: { name: 'Test' } }
                }
            } as any;

            // Mock container and createChild
            const mockContainer = {
                createChild: vi.fn().mockReturnValue({
                    createChild: vi.fn().mockReturnValue({}),
                    id: '',
                    background: {
                        fillOpacity: 0,
                        fill: {},
                        stroke: {},
                        strokeOpacity: 0,
                        strokeWidth: 0
                    },
                    padding: vi.fn(),
                    filters: { push: vi.fn() }
                })
            };

            const labelDataMock: any = {
                name: 'Test Label',
                average: { value: 10, unit: 'u' },
                max: { value: 20, unit: 'u' },
                min: { value: 5, unit: 'u' },
                minToMaxDiff: { value: 15, unit: 'u' },
                gain: { value: 10, unit: 'u' },
                loss: { value: 10, unit: 'u' },
                slopePercentage: { value: 5 }
            };

            const label = (component as any).createLabel(mockContainer, series, labelDataMock);

            expect(label).toBeDefined();
        });
    });

    describe('createOrUpdateChartSeries labels', () => {
        it('should normalize unit-derived speed label in tooltip, legend, and dummyData displayName', () => {
            const activity = {
                creator: { name: 'Garmin' },
                getID: () => 'a1'
            } as any;
            const stream = { type: DataSpeedAvgKilometersPerHour.type } as any;

            component.event = {
                getActivities: () => [activity, { creator: { name: 'Coros' }, getID: () => 'a2' }],
                isMultiSport: () => false,
                getActivityTypesAsArray: () => [ActivityTypes.Cycling],
            } as any;

            (component as any).chart = {
                isDisposed: () => false,
                series: {
                    values: [],
                    push: vi.fn((series: any) => series),
                },
                yAxes: {
                    getIndex: vi.fn().mockReturnValue({}),
                    push: vi.fn().mockReturnValue({}),
                },
            };
            (component as any).charts = {
                LineSeries: function () {
                    return {
                        adapter: { add: vi.fn() },
                        events: { on: vi.fn() },
                        dataFields: {},
                        legendSettings: {},
                    };
                },
            };

            vi.spyOn(component as any, 'attachSeriesEventListeners').mockImplementation(() => { });
            vi.spyOn(component as any, 'convertStreamDataToSeriesData').mockReturnValue([]);
            vi.spyOn(component as any, 'getYAxisForSeries').mockReturnValue({});

            const series = (component as any).createOrUpdateChartSeries(activity, stream);

            expect(series).toBeTruthy();
            expect(series.dummyData.displayName).toBe('Average Speed');
            expect(series.tooltipText).toContain('Average Speed');
            expect(series.legendSettings.labelText).toContain('Average Speed');
        });

        it('should keep non-unit-derived power labels unchanged', () => {
            const activity = {
                creator: { name: 'Garmin' },
                getID: () => 'a1'
            } as any;
            const stream = { type: DataPowerAvg.type } as any;

            component.event = {
                getActivities: () => [activity, { creator: { name: 'Coros' }, getID: () => 'a2' }],
                isMultiSport: () => false,
                getActivityTypesAsArray: () => [ActivityTypes.Cycling],
            } as any;

            (component as any).chart = {
                isDisposed: () => false,
                series: {
                    values: [],
                    push: vi.fn((series: any) => series),
                },
                yAxes: {
                    getIndex: vi.fn().mockReturnValue({}),
                    push: vi.fn().mockReturnValue({}),
                },
            };
            (component as any).charts = {
                LineSeries: function () {
                    return {
                        adapter: { add: vi.fn() },
                        events: { on: vi.fn() },
                        dataFields: {},
                        legendSettings: {},
                    };
                },
            };

            vi.spyOn(component as any, 'attachSeriesEventListeners').mockImplementation(() => { });
            vi.spyOn(component as any, 'convertStreamDataToSeriesData').mockReturnValue([]);
            vi.spyOn(component as any, 'getYAxisForSeries').mockReturnValue({});

            const series = (component as any).createOrUpdateChartSeries(activity, stream);

            expect(series).toBeTruthy();
            expect(series.dummyData.displayName).toBe('Average Power');
            expect(series.tooltipText).toContain('Average Power');
            expect(series.legendSettings.labelText).toContain('Average Power');
        });
    });

    describe('pace axis outlier scaling', () => {
        it('should refresh pace axis bounds when updating an existing pace series', () => {
            const existingSeries: any = {
                id: 's1',
                dummyData: { stream: { type: DataPace.type } },
                yAxis: {},
                data: []
            };
            const activity = { getID: () => 'a1', creator: { name: 'Runner' } } as any;
            const stream = { type: DataPace.type } as any;

            component.event = {
                getActivities: () => [activity],
                isMultiSport: () => false,
                getActivityTypesAsArray: () => [ActivityTypes.Running],
            } as any;

            (component as any).chart = {
                isDisposed: () => false,
                series: {
                    values: [existingSeries],
                    push: vi.fn((series: any) => series),
                },
            };

            vi.spyOn(component as any, 'convertStreamDataToSeriesData').mockReturnValue([{ value: 300 }]);
            vi.spyOn(component as any, 'getSeriesIDFromActivityAndStream').mockReturnValue('s1');
            const refreshSpy = vi.spyOn(component as any, 'refreshPaceAxisRangeForSeries').mockImplementation(() => { });

            (component as any).createOrUpdateChartSeries(activity, stream);

            expect(refreshSpy).toHaveBeenCalledWith(existingSeries);
        });
    });

    describe('addLapGuides', () => {
        it('should normalize lap types from source data when rendering guides', () => {
            const createdRanges: any[] = [];
            const xAxis = {
                axisRanges: {
                    template: { grid: { disabled: true } },
                    create: vi.fn(() => {
                        const range = {
                            value: 0,
                            grid: {
                                disabled: false,
                                stroke: null,
                                strokeWidth: 0,
                                strokeOpacity: 0,
                                strokeDasharray: '',
                                above: false,
                                zIndex: 0,
                                tooltipText: '',
                                tooltipPosition: ''
                            },
                            label: {
                                text: '',
                                tooltipText: '',
                                inside: false,
                                paddingTop: 0,
                                paddingBottom: 0,
                                zIndex: 0,
                                fontSize: '',
                                background: {
                                    fillOpacity: 0,
                                    stroke: null,
                                    strokeWidth: 0,
                                    width: 0
                                },
                                fill: null,
                                horizontalCenter: '',
                                valign: '',
                                textAlign: '',
                                dy: 0
                            }
                        };
                        createdRanges.push(range);
                        return range;
                    })
                }
            };
            const chart = {
                xAxes: {
                    getIndex: vi.fn(() => xAxis)
                }
            } as any;

            const activity = {
                creator: { name: 'Runner' },
                getID: () => 'activity-1',
                startDate: new Date('2026-01-01T00:00:00.000Z'),
                getLaps: () => [
                    { type: 'manual', endDate: new Date('2026-01-01T00:01:00.000Z') },
                    { type: 'session_end', endDate: new Date('2026-01-01T00:02:00.000Z') }
                ]
            } as any;

            (component as any).addLapGuides(chart, [activity], XAxisTypes.Duration, [LapTypes.Manual]);

            expect(createdRanges).toHaveLength(1);
            expect(createdRanges[0].label.text).toBe('1');
            expect(createdRanges[0].date.getTime()).toBe(60_000);
        });

        it('should assign each lap guide its own label text', () => {
            const createdRanges: any[] = [];
            const xAxis = {
                axisRanges: {
                    template: { grid: { disabled: true } },
                    create: vi.fn(() => {
                        const range = {
                            value: 0,
                            grid: {
                                disabled: false,
                                stroke: null,
                                strokeWidth: 0,
                                strokeOpacity: 0,
                                strokeDasharray: '',
                                above: false,
                                zIndex: 0,
                                tooltipText: '',
                                tooltipPosition: ''
                            },
                            label: {
                                text: '',
                                tooltipText: '',
                                inside: false,
                                paddingTop: 0,
                                paddingBottom: 0,
                                zIndex: 0,
                                fontSize: '',
                                background: {
                                    fillOpacity: 0,
                                    stroke: null,
                                    strokeWidth: 0,
                                    width: 0
                                },
                                fill: null,
                                horizontalCenter: '',
                                valign: '',
                                textAlign: '',
                                dy: 0
                            }
                        };
                        createdRanges.push(range);
                        return range;
                    })
                }
            };

            const chart = {
                xAxes: {
                    getIndex: vi.fn(() => xAxis)
                }
            } as any;

            const activity = {
                creator: { name: 'Runner' },
                getID: () => 'activity-1',
                startDate: new Date('2026-01-01T00:00:00.000Z'),
                getLaps: () => [
                    { type: LapTypes.Manual, endDate: new Date('2026-01-01T00:01:00.000Z') },
                    { type: LapTypes.Manual, endDate: new Date('2026-01-01T00:02:00.000Z') },
                    { type: LapTypes.Start, endDate: new Date('2026-01-01T00:03:00.000Z') }
                ]
            } as any;

            (component as any).addLapGuides(chart, [activity], XAxisTypes.Duration, [LapTypes.Manual]);

            expect(createdRanges).toHaveLength(2);
            expect(createdRanges[0].label.text).toBe('1');
            expect(createdRanges[1].label.text).toBe('2');
            expect(createdRanges[0].date.getTime()).toBe(60_000);
            expect(createdRanges[1].date.getTime()).toBe(120_000);
        });

        it('should place time-axis guides at absolute lap end time', () => {
            const createdRanges: any[] = [];
            const xAxis = {
                axisRanges: {
                    template: { grid: { disabled: true } },
                    create: vi.fn(() => {
                        const range = {
                            date: null,
                            grid: {
                                disabled: false,
                                stroke: null,
                                strokeWidth: 0,
                                strokeOpacity: 0,
                                strokeDasharray: '',
                                above: false,
                                zIndex: 0,
                                tooltipText: '',
                                tooltipPosition: ''
                            },
                            label: {
                                text: '',
                                tooltipText: '',
                                inside: false,
                                paddingTop: 0,
                                paddingBottom: 0,
                                zIndex: 0,
                                fontSize: '',
                                background: {
                                    fillOpacity: 0,
                                    stroke: null,
                                    strokeWidth: 0,
                                    width: 0
                                },
                                fill: null,
                                horizontalCenter: '',
                                valign: '',
                                textAlign: '',
                                dy: 0
                            }
                        };
                        createdRanges.push(range);
                        return range;
                    })
                }
            };

            const chart = {
                xAxes: {
                    getIndex: vi.fn(() => xAxis)
                }
            } as any;

            const lapEnd = new Date('2026-01-01T00:01:00.000Z');
            const activity = {
                creator: { name: 'Runner' },
                getID: () => 'activity-1',
                startDate: new Date('2026-01-01T00:00:00.000Z'),
                getLaps: () => [
                    { type: LapTypes.Manual, endDate: lapEnd },
                    { type: LapTypes.Start, endDate: new Date('2026-01-01T00:03:00.000Z') }
                ]
            } as any;

            (component as any).addLapGuides(chart, [activity], XAxisTypes.Time, [LapTypes.Manual]);

            expect(createdRanges).toHaveLength(1);
            expect(createdRanges[0].date.getTime()).toBe(lapEnd.getTime());
        });

        it('should fallback to cumulative lap duration when indoor lap timestamps collapse to start time', () => {
            const createdRanges: any[] = [];
            const xAxis = {
                axisRanges: {
                    template: { grid: { disabled: true } },
                    create: vi.fn(() => {
                        const range = {
                            date: null,
                            value: 0,
                            grid: {
                                disabled: false,
                                stroke: null,
                                strokeWidth: 0,
                                strokeOpacity: 0,
                                strokeDasharray: '',
                                above: false,
                                zIndex: 0,
                                tooltipText: '',
                                tooltipPosition: ''
                            },
                            label: {
                                text: '',
                                tooltipText: '',
                                inside: false,
                                paddingTop: 0,
                                paddingBottom: 0,
                                zIndex: 0,
                                fontSize: '',
                                background: {
                                    fillOpacity: 0,
                                    stroke: null,
                                    strokeWidth: 0,
                                    width: 0
                                },
                                fill: null,
                                horizontalCenter: '',
                                valign: '',
                                textAlign: '',
                                dy: 0
                            }
                        };
                        createdRanges.push(range);
                        return range;
                    })
                }
            };

            const chart = {
                xAxes: {
                    getIndex: vi.fn(() => xAxis)
                }
            } as any;

            const start = new Date('2026-01-01T00:00:00.000Z');
            const activity = {
                creator: { name: 'Trainer Ride' },
                type: 'Indoor Cycling',
                isTrainer: () => true,
                getID: () => 'activity-indoor',
                startDate: start,
                getLaps: () => [
                    {
                        type: LapTypes.Manual,
                        startDate: start,
                        endDate: start,
                        getDuration: () => ({ getValue: () => 60 })
                    },
                    {
                        type: LapTypes.Manual,
                        startDate: start,
                        endDate: start,
                        getDuration: () => ({ getValue: () => 75 })
                    },
                    {
                        type: LapTypes.Start,
                        startDate: start,
                        endDate: start,
                        getDuration: () => ({ getValue: () => 10 })
                    }
                ]
            } as any;

            (component as any).addLapGuides(chart, [activity], XAxisTypes.Duration, [LapTypes.Manual]);

            expect(createdRanges).toHaveLength(2);
            expect(createdRanges[0].date.getTime()).toBe(60_000);
            expect(createdRanges[1].date.getTime()).toBe(135_000);
        });
    });
});
