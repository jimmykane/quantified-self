import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EventCardStatsGridComponent } from './event.card.stats-grid.component';
import { AppUserSettingsQueryService } from '../../../services/app.user-settings-query.service';
import { ElementRef, signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { ActivityTypes, UserSummariesSettingsInterface, UserUnitSettingsInterface, ActivityUtilities, DynamicDataLoader } from '@sports-alliance/sports-lib';
import { SimpleChange } from '@angular/core';
import { DataAscent, DataDescent, DataDuration, DataPaceAvg, DataPowerAvg, DataPowerMax, DataPowerMin, DataTemperatureMax } from '@sports-alliance/sports-lib';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { AppEventSummaryTabsLocalStorageService } from '../../../services/storage/app.event-summary-tabs.local.storage.service';
import { afterEach, vi } from 'vitest';

const createStat = (type: string) => ({
    getType: () => type,
    getDisplayType: () => type,
    getDisplayValue: () => '1',
    getDisplayUnit: () => '',
    getValue: () => 1,
}) as any;

const createTabGroupElement = (heights: number[]): HTMLElement => {
    const tabGroupElement = document.createElement('div');
    const tabBodyWrapper = document.createElement('div');
    tabBodyWrapper.className = 'mat-mdc-tab-body-wrapper';
    tabGroupElement.appendChild(tabBodyWrapper);

    heights.forEach((height, index) => {
        const tabBodyContent = document.createElement('div');
        tabBodyContent.className = 'mat-mdc-tab-body-content';
        Object.defineProperty(tabBodyContent, 'scrollHeight', {
            configurable: true,
            get: () => heights[index],
        });
        tabBodyWrapper.appendChild(tabBodyContent);
    });

    return tabGroupElement;
};

const createTabGroupElementWithResizableIntrinsicHeights = (intrinsicHeights: number[]): HTMLElement => {
    const tabGroupElement = document.createElement('div');
    const tabBodyWrapper = document.createElement('div');
    tabBodyWrapper.className = 'mat-mdc-tab-body-wrapper';
    tabGroupElement.appendChild(tabBodyWrapper);

    intrinsicHeights.forEach((intrinsicHeight, index) => {
        const tabBodyContent = document.createElement('div');
        tabBodyContent.className = 'mat-mdc-tab-body-content';
        Object.defineProperty(tabBodyContent, 'scrollHeight', {
            configurable: true,
            get: () => {
                // When measured with height:auto, return intrinsic content height.
                if (tabBodyContent.style.height === 'auto') {
                    return intrinsicHeights[index];
                }

                // Otherwise simulate the "stuck tall" path caused by shared wrapper min-height.
                const raw = tabGroupElement.style.getPropertyValue('--summary-tabs-body-min-height');
                const appliedMin = Number.parseInt(raw, 10) || 0;
                return Math.max(intrinsicHeights[index], appliedMin);
            },
        });
        tabBodyWrapper.appendChild(tabBodyContent);
    });

    return tabGroupElement;
};

describe('EventCardStatsGridComponent', () => {
    let component: EventCardStatsGridComponent;
    let fixture: ComponentFixture<EventCardStatsGridComponent>;
    let mockUserSettingsQueryService: any;
    let mockEventSummaryTabsLocalStorageService: any;
    const originalResizeObserver = globalThis.ResizeObserver;

    const mockUnitSettings: UserUnitSettingsInterface = {
        distanceUnits: 'kilometers',
        speedUnits: 'km/h',
        paceUnits: 'min/km',
        weightUnits: 'kg',
        heightUnits: 'cm',
    } as any;

    const mockSummariesSettings: UserSummariesSettingsInterface = {
        removeAscentForEventTypes: [],
        removeDescentForEventTypes: [],
    } as any;

    beforeEach(async () => {
        mockUserSettingsQueryService = {
            unitSettings: signal(mockUnitSettings),
            summariesSettings: signal(mockSummariesSettings),
        };
        mockEventSummaryTabsLocalStorageService = {
            getLastSelectedStatsTabId: vi.fn(() => ''),
            setLastSelectedStatsTabId: vi.fn(),
            clearLastSelectedStatsTabId: vi.fn(),
        };

        await TestBed.configureTestingModule({
            declarations: [EventCardStatsGridComponent],
            providers: [
                { provide: AppUserSettingsQueryService, useValue: mockUserSettingsQueryService },
                { provide: AppEventColorService, useValue: { getDifferenceColor: vi.fn(() => '#00ff00') } },
                { provide: AppEventSummaryTabsLocalStorageService, useValue: mockEventSummaryTabsLocalStorageService },
            ],
            schemas: [NO_ERRORS_SCHEMA],
        }).compileComponents();

        fixture = TestBed.createComponent(EventCardStatsGridComponent);
        component = fixture.componentInstance;

        // Mock Event
        const mockEvent = {
            getActivities: () => [],
            getActivityTypesAsArray: () => [],
            getStat: (type: string) => null,
            getStats: () => [],
        } as any;
        component.event = mockEvent;
        component.selectedActivities = [];
    });

    afterEach(() => {
        if (originalResizeObserver) {
            (globalThis as any).ResizeObserver = originalResizeObserver;
        } else {
            delete (globalThis as any).ResizeObserver;
        }
        vi.restoreAllMocks();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should filter out ascent when manually excluded', () => {
        const activityTypes = [ActivityTypes.Cycling];
        const mockEvent = {
            getActivities: () => [{ type: ActivityTypes.Cycling }],
            getActivityTypesAsArray: () => activityTypes,
            getStat: (type: string) => {
                if (type === DataAscent.type) return { getDisplayValue: () => 100, getDisplayUnit: () => 'm', getValue: () => 100 };
                if (type === DataDuration.type) return { getDisplayValue: () => '1:00:00', getDisplayUnit: () => '', getValue: () => 3600 };
                return null;
            },
            getStats: () => [],
        } as any;
        component.event = mockEvent;
        component.selectedActivities = mockEvent.getActivities();

        // Manually exclude Cycling from ascent
        mockUserSettingsQueryService.summariesSettings.set({
            removeAscentForEventTypes: [ActivityTypes.Cycling],
            removeDescentForEventTypes: [],
        });

        component.ngOnChanges({
            event: new SimpleChange(null, mockEvent, true),
            selectedActivities: new SimpleChange(null, component.selectedActivities, true),
        });

        expect(component.displayedStatsToShow).not.toContain(DataAscent.type);
    });

    it('should filter out descent when manually excluded', () => {
        const activityTypes = [ActivityTypes.Cycling];
        const mockEvent = {
            getActivities: () => [{ type: ActivityTypes.Cycling }],
            getActivityTypesAsArray: () => activityTypes,
            getStat: (type: string) => {
                if (type === DataDescent.type) return { getDisplayValue: () => 100, getDisplayUnit: () => 'm', getValue: () => 100 };
                if (type === DataDuration.type) return { getDisplayValue: () => '1:00:00', getDisplayUnit: () => '', getValue: () => 3600 };
                return null;
            },
            getStats: () => [],
        } as any;
        component.event = mockEvent;
        component.selectedActivities = mockEvent.getActivities();

        // Manually exclude Cycling from descent
        mockUserSettingsQueryService.summariesSettings.set({
            removeAscentForEventTypes: [],
            removeDescentForEventTypes: [ActivityTypes.Cycling],
        });

        component.ngOnChanges({
            event: new SimpleChange(null, mockEvent, true),
            selectedActivities: new SimpleChange(null, component.selectedActivities, true),
        });

        expect(component.displayedStatsToShow).not.toContain(DataDescent.type);
    });

    it('should include ascent and descent when not excluded', () => {
        const activityTypes = [ActivityTypes.Cycling];
        const mockEvent = {
            getActivities: () => [{ type: ActivityTypes.Cycling }],
            getActivityTypesAsArray: () => activityTypes,
            getStat: (type: string) => ({ getDisplayValue: () => 100, getDisplayUnit: () => 'm', getValue: () => 100 }),
            getStats: () => [],
        } as any;
        component.event = mockEvent;
        component.selectedActivities = mockEvent.getActivities();

        mockUserSettingsQueryService.summariesSettings.set({
            removeAscentForEventTypes: [],
            removeDescentForEventTypes: [],
        });

        component.ngOnChanges({
            event: new SimpleChange(null, mockEvent, true),
            selectedActivities: new SimpleChange(null, component.selectedActivities, true),
        });

        expect(component.displayedStatsToShow).toContain(DataAscent.type);
        expect(component.displayedStatsToShow).toContain(DataDescent.type);
    });

    it('should auto-exclude ascent for Alpine Skiing', () => {
        const activityTypes = [ActivityTypes.AlpineSki];
        const mockEvent = {
            getActivities: () => [{ type: ActivityTypes.AlpineSki }],
            getActivityTypesAsArray: () => activityTypes,
            getStat: (type: string) => ({ getDisplayValue: () => 100, getDisplayUnit: () => 'm', getValue: () => 100 }),
            getStats: () => [],
        } as any;
        component.event = mockEvent;
        component.selectedActivities = mockEvent.getActivities();

        mockUserSettingsQueryService.summariesSettings.set({
            removeAscentForEventTypes: [],
            removeDescentForEventTypes: [],
        });

        component.ngOnChanges({
            event: new SimpleChange(null, mockEvent, true),
            selectedActivities: new SimpleChange(null, component.selectedActivities, true),
        });

        expect(component.displayedStatsToShow).not.toContain(DataAscent.type);
        expect(component.displayedStatsToShow).toContain(DataDescent.type); // Descent should still be there for alpine skiing
    });

    it('should compute diff map when event is a merge and two activities are selected', () => {
        const durationStatA = {
            getType: () => DataDuration.type,
            getDisplayType: () => 'Duration',
            getDisplayValue: () => '1000',
            getDisplayUnit: () => 's',
            getValue: () => 1000
        };
        const durationStatB = {
            getType: () => DataDuration.type,
            getDisplayType: () => 'Duration',
            getDisplayValue: () => '1500',
            getDisplayUnit: () => 's',
            getValue: () => 1500
        };

        const activity1 = {
            type: ActivityTypes.Cycling,
            getStat: (type: string) => (type === DataDuration.type ? durationStatA : null),
            getStatsAsArray: () => [durationStatA],
        } as any;
        const activity2 = {
            type: ActivityTypes.Cycling,
            getStat: (type: string) => (type === DataDuration.type ? durationStatB : null),
            getStatsAsArray: () => [durationStatB],
        } as any;

        const mockEvent = {
            isMerge: true,
            getActivities: () => [activity1, activity2],
            getActivityTypesAsArray: () => [ActivityTypes.Cycling],
            getStats: () => [],
        } as any;

        vi.spyOn(ActivityUtilities, 'getSummaryStatsForActivities').mockReturnValue([durationStatA] as any);
        vi.spyOn(DynamicDataLoader, 'getUnitBasedDataFromDataInstance').mockReturnValue([durationStatA] as any);
        vi.spyOn(DynamicDataLoader, 'getDataInstanceFromDataType').mockReturnValue({
            getDisplayValue: () => '500',
            getDisplayUnit: () => 's'
        } as any);

        component.event = mockEvent;
        component.selectedActivities = [activity1, activity2];

        component.ngOnChanges({
            event: new SimpleChange(null, mockEvent, true),
            selectedActivities: new SimpleChange(null, component.selectedActivities, true),
        });

        expect(component.showDiff).toBe(true);
    });

    it('should not compute diff map when event is not a merge', () => {
        const activity = {
            type: ActivityTypes.Cycling,
            getStat: () => null,
            getStatsAsArray: () => [],
        } as any;
        const mockEvent = {
            isMerge: false,
            getActivities: () => [activity, activity],
            getActivityTypesAsArray: () => [ActivityTypes.Cycling],
            getStats: () => new Map(),
        } as any;

        component.event = mockEvent;
        component.selectedActivities = [activity, activity];

        component.ngOnChanges({
            event: new SimpleChange(null, mockEvent, true),
            selectedActivities: new SimpleChange(null, component.selectedActivities, true),
        });

        expect(component.showDiff).toBe(false);
        expect(component.diffByType.size).toBe(0);
    });

    it('should use activity summary stats source for partial merge selections without event fallback', () => {
        const durationStat = createStat(DataDuration.type);
        const activity1 = {
            type: ActivityTypes.Cycling,
            getStat: () => null,
            getStatsAsArray: () => [durationStat],
        } as any;
        const activity2 = {
            type: ActivityTypes.Cycling,
            getStat: () => null,
            getStatsAsArray: () => [durationStat],
        } as any;
        const activity3 = {
            type: ActivityTypes.Cycling,
            getStat: () => null,
            getStatsAsArray: () => [durationStat],
        } as any;
        const eventStatsSpy = vi.fn(() => new Map());
        const mockEvent = {
            isMerge: true,
            getActivities: () => [activity1, activity2, activity3],
            getActivityTypesAsArray: () => [ActivityTypes.Cycling],
            getStats: eventStatsSpy,
        } as any;

        const summarySpy = vi.spyOn(ActivityUtilities, 'getSummaryStatsForActivities').mockReturnValue([durationStat] as any);

        component.event = mockEvent;
        component.selectedActivities = [activity1, activity2];
        component.statsToShow = [DataDuration.type];

        component.ngOnChanges({
            event: new SimpleChange(null, mockEvent, true),
            selectedActivities: new SimpleChange(null, component.selectedActivities, true),
            statsToShow: new SimpleChange(null, component.statsToShow, true),
        });

        expect(summarySpy).toHaveBeenCalledWith([activity1, activity2]);
        expect(eventStatsSpy).not.toHaveBeenCalled();
        expect(component.stats.length).toBe(1);
        expect(component.stats[0].getType()).toBe(DataDuration.type);
    });

    it('should use event stats source for full merge selections', () => {
        const durationStat = createStat(DataDuration.type);
        const powerStat = createStat(DataPowerAvg.type);
        const activity1 = {
            type: ActivityTypes.Cycling,
            getStat: () => null,
            getStatsAsArray: () => [powerStat],
        } as any;
        const activity2 = {
            type: ActivityTypes.Cycling,
            getStat: () => null,
            getStatsAsArray: () => [powerStat],
        } as any;
        const eventStatsMap = new Map<string, any>([[DataDuration.type, durationStat]]);
        const mockEvent = {
            isMerge: true,
            getActivities: () => [activity1, activity2],
            getActivityTypesAsArray: () => [ActivityTypes.Cycling],
            getStats: () => eventStatsMap,
        } as any;

        const summarySpy = vi.spyOn(ActivityUtilities, 'getSummaryStatsForActivities').mockReturnValue([powerStat] as any);

        component.event = mockEvent;
        component.selectedActivities = [activity1, activity2];
        component.statsToShow = [DataDuration.type];

        component.ngOnChanges({
            event: new SimpleChange(null, mockEvent, true),
            selectedActivities: new SimpleChange(null, component.selectedActivities, true),
            statsToShow: new SimpleChange(null, component.statsToShow, true),
        });

        expect(summarySpy).not.toHaveBeenCalled();
        expect(component.stats.length).toBe(1);
        expect(component.stats[0].getType()).toBe(DataDuration.type);
    });

    it('should use selected activity stats for single-activity events', () => {
        const selectedActivityStat = createStat(DataPowerAvg.type);
        const eventLevelStat = createStat(DataDuration.type);
        const activity = {
            type: ActivityTypes.Running,
            getStats: () => new Map([[DataPowerAvg.type, selectedActivityStat]]),
            getStat: () => null,
            getStatsAsArray: () => [selectedActivityStat],
        } as any;
        const mockEvent = {
            isMerge: false,
            getActivities: () => [activity],
            getActivityTypesAsArray: () => [ActivityTypes.Running],
            getStats: () => new Map([[DataDuration.type, eventLevelStat]]),
        } as any;

        component.event = mockEvent;
        component.selectedActivities = [activity];
        component.statsToShow = [DataPowerAvg.type, DataDuration.type];

        component.ngOnChanges({
            event: new SimpleChange(null, mockEvent, true),
            selectedActivities: new SimpleChange(null, component.selectedActivities, true),
            statsToShow: new SimpleChange(null, component.statsToShow, true),
        });

        expect(component.stats.map((stat) => stat.getType())).toEqual([DataPowerAvg.type]);
    });

    it('should include composite family min/max in diff map when avg is requested', () => {
        const powerAvgStat = {
            getType: () => DataPowerAvg.type,
            getDisplayType: () => 'Average Power',
            getDisplayValue: () => '250',
            getDisplayUnit: () => 'W',
            getValue: () => 250
        };
        const powerMinStat = {
            getType: () => DataPowerMin.type,
            getDisplayType: () => 'Minimum Power',
            getDisplayValue: () => '120',
            getDisplayUnit: () => 'W',
            getValue: () => 120
        };
        const powerMaxStat = {
            getType: () => DataPowerMax.type,
            getDisplayType: () => 'Maximum Power',
            getDisplayValue: () => '680',
            getDisplayUnit: () => 'W',
            getValue: () => 680
        };

        const activity1 = {
            type: ActivityTypes.Cycling,
            getStat: (type: string) => {
                if (type === DataPowerAvg.type) return { getValue: () => 250 };
                if (type === DataPowerMin.type) return { getValue: () => 120 };
                if (type === DataPowerMax.type) return { getValue: () => 680 };
                return null;
            },
            getStatsAsArray: () => [powerAvgStat, powerMinStat, powerMaxStat],
        } as any;

        const activity2 = {
            type: ActivityTypes.Cycling,
            getStat: (type: string) => {
                if (type === DataPowerAvg.type) return { getValue: () => 230 };
                if (type === DataPowerMin.type) return { getValue: () => 110 };
                if (type === DataPowerMax.type) return { getValue: () => 650 };
                return null;
            },
            getStatsAsArray: () => [powerAvgStat, powerMinStat, powerMaxStat],
        } as any;

        const mockEvent = {
            isMerge: true,
            getActivities: () => [activity1, activity2],
            getStats: () => new Map([
                [DataPowerAvg.type, powerAvgStat],
                [DataPowerMin.type, powerMinStat],
                [DataPowerMax.type, powerMaxStat],
            ]),
        } as any;

        vi.spyOn(ActivityUtilities, 'getSummaryStatsForActivities').mockReturnValue([
            powerAvgStat,
            powerMinStat,
            powerMaxStat,
        ] as any);
        vi.spyOn(DynamicDataLoader, 'getUnitBasedDataFromDataInstance').mockImplementation((stat: any) => [stat]);
        vi.spyOn(DynamicDataLoader, 'getDataInstanceFromDataType').mockReturnValue({
            getDisplayValue: () => '10',
            getDisplayUnit: () => 'W'
        } as any);

        component.event = mockEvent;
        component.selectedActivities = [activity1, activity2];
        component.statsToShow = [DataPowerAvg.type];

        component.ngOnChanges({
            event: new SimpleChange(null, mockEvent, true),
            selectedActivities: new SimpleChange(null, component.selectedActivities, true),
            statsToShow: new SimpleChange(null, component.statsToShow, true),
        });

        expect(component.showDiff).toBe(true);
        expect(component.diffByType.has(DataPowerAvg.type)).toBe(true);
        expect(component.diffByType.has(DataPowerMin.type)).toBe(true);
        expect(component.diffByType.has(DataPowerMax.type)).toBe(true);
    });

    it('should include ground-contact family min/max in diff map when avg is requested', () => {
        const gctAvgType = 'Average Ground Contact Time';
        const gctMinType = 'Minimum Ground Contact Time';
        const gctMaxType = 'Maximum Ground Contact Time';

        const gctAvgStat = {
            getType: () => gctAvgType,
            getDisplayType: () => gctAvgType,
            getDisplayValue: () => '250',
            getDisplayUnit: () => 'ms',
            getValue: () => 250
        };
        const gctMinStat = {
            getType: () => gctMinType,
            getDisplayType: () => gctMinType,
            getDisplayValue: () => '210',
            getDisplayUnit: () => 'ms',
            getValue: () => 210
        };
        const gctMaxStat = {
            getType: () => gctMaxType,
            getDisplayType: () => gctMaxType,
            getDisplayValue: () => '320',
            getDisplayUnit: () => 'ms',
            getValue: () => 320
        };

        const activity1 = {
            type: ActivityTypes.Running,
            getStat: (type: string) => {
                if (type === gctAvgType) return { getValue: () => 250 };
                if (type === gctMinType) return { getValue: () => 210 };
                if (type === gctMaxType) return { getValue: () => 320 };
                return null;
            },
            getStatsAsArray: () => [gctAvgStat, gctMinStat, gctMaxStat],
        } as any;

        const activity2 = {
            type: ActivityTypes.Running,
            getStat: (type: string) => {
                if (type === gctAvgType) return { getValue: () => 260 };
                if (type === gctMinType) return { getValue: () => 220 };
                if (type === gctMaxType) return { getValue: () => 330 };
                return null;
            },
            getStatsAsArray: () => [gctAvgStat, gctMinStat, gctMaxStat],
        } as any;

        const mockEvent = {
            isMerge: true,
            getActivities: () => [activity1, activity2],
            getStats: () => new Map([
                [gctAvgType, gctAvgStat],
                [gctMinType, gctMinStat],
                [gctMaxType, gctMaxStat],
            ]),
        } as any;

        vi.spyOn(ActivityUtilities, 'getSummaryStatsForActivities').mockReturnValue([
            gctAvgStat,
            gctMinStat,
            gctMaxStat,
        ] as any);
        vi.spyOn(DynamicDataLoader, 'getUnitBasedDataFromDataInstance').mockImplementation((stat: any) => [stat]);
        vi.spyOn(DynamicDataLoader, 'getDataInstanceFromDataType').mockReturnValue({
            getDisplayValue: () => '10',
            getDisplayUnit: () => 'ms'
        } as any);

        component.event = mockEvent;
        component.selectedActivities = [activity1, activity2];
        component.statsToShow = [gctAvgType];

        component.ngOnChanges({
            event: new SimpleChange(null, mockEvent, true),
            selectedActivities: new SimpleChange(null, component.selectedActivities, true),
            statsToShow: new SimpleChange(null, component.statsToShow, true),
        });

        expect(component.showDiff).toBe(true);
        expect(component.diffByType.has(gctAvgType)).toBe(true);
        expect(component.diffByType.has(gctMinType)).toBe(true);
        expect(component.diffByType.has(gctMaxType)).toBe(true);
    });

    it('should build metric tabs and default to Overall when available', () => {
        const durationStat = createStat(DataDuration.type);
        const powerStat = createStat(DataPowerAvg.type);
        const activity = {
            type: ActivityTypes.Cycling,
            getStats: () => new Map([
                [DataDuration.type, durationStat],
                [DataPowerAvg.type, powerStat],
            ]),
        } as any;
        const mockEvent = {
            isMerge: false,
            getActivities: () => [activity],
            getStats: () => new Map([
                [DataDuration.type, durationStat],
                [DataPowerAvg.type, powerStat],
            ]),
        } as any;

        component.event = mockEvent;
        component.selectedActivities = [activity];
        component.statsToShow = [DataDuration.type, DataPowerAvg.type];

        component.ngOnChanges({
            event: new SimpleChange(null, mockEvent, true),
            selectedActivities: new SimpleChange(null, component.selectedActivities, true),
            statsToShow: new SimpleChange(null, component.statsToShow, true),
        });

        expect(component.metricTabs.map(tab => tab.label)).toEqual(['Overall', 'Performance']);
        expect(component.selectedTabIndex).toBe(0);
    });

    it('should fallback to first visible tab when Overall is not available', () => {
        const temperatureStat = createStat(DataTemperatureMax.type);
        const activity = {
            type: ActivityTypes.Cycling,
            getStats: () => new Map([
                [DataTemperatureMax.type, temperatureStat],
            ]),
        } as any;
        const mockEvent = {
            isMerge: false,
            getActivities: () => [activity],
            getStats: () => new Map([
                [DataTemperatureMax.type, temperatureStat],
            ]),
        } as any;

        component.event = mockEvent;
        component.selectedActivities = [activity];
        component.statsToShow = [DataTemperatureMax.type];

        component.ngOnChanges({
            event: new SimpleChange(null, mockEvent, true),
            selectedActivities: new SimpleChange(null, component.selectedActivities, true),
            statsToShow: new SimpleChange(null, component.statsToShow, true),
        });

        expect(component.metricTabs.map(tab => tab.label)).toEqual(['Environment']);
        expect(component.selectedTabIndex).toBe(0);
    });

    it('should restore remembered tab when it is visible', () => {
        mockEventSummaryTabsLocalStorageService.getLastSelectedStatsTabId.mockReturnValue('performance');

        const durationStat = createStat(DataDuration.type);
        const powerStat = createStat(DataPowerAvg.type);
        const activity = {
            type: ActivityTypes.Cycling,
            getStats: () => new Map([
                [DataDuration.type, durationStat],
                [DataPowerAvg.type, powerStat],
            ]),
        } as any;
        const mockEvent = {
            isMerge: false,
            getActivities: () => [activity],
            getStats: () => new Map([
                [DataDuration.type, durationStat],
                [DataPowerAvg.type, powerStat],
            ]),
        } as any;

        component.event = mockEvent;
        component.selectedActivities = [activity];
        component.statsToShow = [DataDuration.type, DataPowerAvg.type];

        component.ngOnChanges({
            event: new SimpleChange(null, mockEvent, true),
            selectedActivities: new SimpleChange(null, component.selectedActivities, true),
            statsToShow: new SimpleChange(null, component.statsToShow, true),
        });

        expect(component.metricTabs.map(tab => tab.id)).toEqual(['overall', 'performance']);
        expect(component.selectedTabIndex).toBe(1);
    });

    it('should fallback to overall and persist fallback when remembered tab is hidden', () => {
        mockEventSummaryTabsLocalStorageService.getLastSelectedStatsTabId.mockReturnValue('environment');

        const durationStat = createStat(DataDuration.type);
        const powerStat = createStat(DataPowerAvg.type);
        const activity = {
            type: ActivityTypes.Cycling,
            getStats: () => new Map([
                [DataDuration.type, durationStat],
                [DataPowerAvg.type, powerStat],
            ]),
        } as any;
        const mockEvent = {
            isMerge: false,
            getActivities: () => [activity],
            getStats: () => new Map([
                [DataDuration.type, durationStat],
                [DataPowerAvg.type, powerStat],
            ]),
        } as any;

        component.event = mockEvent;
        component.selectedActivities = [activity];
        component.statsToShow = [DataDuration.type, DataPowerAvg.type];

        component.ngOnChanges({
            event: new SimpleChange(null, mockEvent, true),
            selectedActivities: new SimpleChange(null, component.selectedActivities, true),
            statsToShow: new SimpleChange(null, component.statsToShow, true),
        });

        expect(component.selectedTabIndex).toBe(0);
        expect(mockEventSummaryTabsLocalStorageService.setLastSelectedStatsTabId).toHaveBeenCalledWith('overall');
    });

    it('should fallback to first visible tab and persist fallback when overall is not visible', () => {
        mockEventSummaryTabsLocalStorageService.getLastSelectedStatsTabId.mockReturnValue('performance');

        const temperatureStat = createStat(DataTemperatureMax.type);
        const activity = {
            type: ActivityTypes.Cycling,
            getStats: () => new Map([
                [DataTemperatureMax.type, temperatureStat],
            ]),
        } as any;
        const mockEvent = {
            isMerge: false,
            getActivities: () => [activity],
            getStats: () => new Map([
                [DataTemperatureMax.type, temperatureStat],
            ]),
        } as any;

        component.event = mockEvent;
        component.selectedActivities = [activity];
        component.statsToShow = [DataTemperatureMax.type];

        component.ngOnChanges({
            event: new SimpleChange(null, mockEvent, true),
            selectedActivities: new SimpleChange(null, component.selectedActivities, true),
            statsToShow: new SimpleChange(null, component.statsToShow, true),
        });

        expect(component.metricTabs.map(tab => tab.id)).toEqual(['environment']);
        expect(component.selectedTabIndex).toBe(0);
        expect(mockEventSummaryTabsLocalStorageService.setLastSelectedStatsTabId).toHaveBeenCalledWith('environment');
    });

    it('should hide tabs without matching stat data', () => {
        const durationStat = createStat(DataDuration.type);
        const activity = {
            type: ActivityTypes.Cycling,
            getStats: () => new Map([
                [DataDuration.type, durationStat],
            ]),
        } as any;
        const mockEvent = {
            isMerge: false,
            getActivities: () => [activity],
            getStats: () => new Map([
                [DataDuration.type, durationStat],
            ]),
        } as any;

        component.event = mockEvent;
        component.selectedActivities = [activity];
        component.statsToShow = [DataDuration.type, DataPowerAvg.type];

        component.ngOnChanges({
            event: new SimpleChange(null, mockEvent, true),
            selectedActivities: new SimpleChange(null, component.selectedActivities, true),
            statsToShow: new SimpleChange(null, component.statsToShow, true),
        });

        expect(component.metricTabs.map(tab => tab.label)).toEqual(['Overall']);
        expect(component.metricTabs[0].metricTypes).toEqual([DataDuration.type]);
    });

    it('should clear grouped tabs and selected index on empty selection', () => {
        const activity = {
            type: ActivityTypes.Cycling,
            getStats: () => new Map(),
        } as any;
        const mockEvent = {
            isMerge: false,
            getActivities: () => [activity],
            getStats: () => new Map(),
        } as any;

        component.event = mockEvent;
        component.selectedActivities = [activity];
        component.statsToShow = [DataDuration.type, DataPowerAvg.type];

        component.ngOnChanges({
            event: new SimpleChange(null, mockEvent, true),
            selectedActivities: new SimpleChange(null, component.selectedActivities, true),
            statsToShow: new SimpleChange(null, component.statsToShow, true),
        });

        component.selectedActivities = [];
        component.ngOnChanges({
            selectedActivities: new SimpleChange([activity], [], false),
        });

        expect(component.metricTabs.length).toBe(0);
        expect(component.displayedStatsToShow.length).toBe(0);
        expect(component.selectedTabIndex).toBe(0);
    });

    it('should keep single-value overrides while diff mode is enabled', () => {
        const tab = {
            id: 'overall',
            label: 'Overall',
            metricTypes: [DataPowerAvg.type],
            singleValueTypes: [DataPowerAvg.type],
        } as any;

        component.showDiff = true;
        expect(component.getSingleValueTypesForTab(tab)).toEqual([DataPowerAvg.type]);

        component.showDiff = false;
        expect(component.getSingleValueTypesForTab(tab)).toEqual([DataPowerAvg.type]);
    });

    it('should force all overall metric types to single-value rendering', () => {
        const tab = {
            id: 'overall',
            label: 'Overall',
            metricTypes: [DataPowerAvg.type, DataPaceAvg.type],
            singleValueTypes: [DataPowerAvg.type],
        } as any;

        component.showDiff = true;
        expect(component.getSingleValueTypesForTab(tab)).toEqual([DataPowerAvg.type, DataPaceAvg.type]);

        component.showDiff = false;
        expect(component.getSingleValueTypesForTab(tab)).toEqual([DataPowerAvg.type, DataPaceAvg.type]);
    });

    it('should persist selected tab id on tab click', () => {
        component.metricTabs = [
            { id: 'overall', label: 'Overall', metricTypes: [] },
            { id: 'performance', label: 'Performance', metricTypes: [] },
        ] as any;

        component.onSelectedTabIndexChange(1);

        expect(component.selectedTabIndex).toBe(1);
        expect(mockEventSummaryTabsLocalStorageService.setLastSelectedStatsTabId).toHaveBeenCalledWith('performance');
    });

    it('should return the configured icon for each summary tab id', () => {
        expect(component.getTabIcon('overall')).toBe('leaderboard');
        expect(component.getTabIcon('performance')).toBe('monitoring');
        expect(component.getTabIcon('altitude')).toBe('terrain');
        expect(component.getTabIcon('environment')).toBe('landscape_2');
        expect(component.getTabIcon('device')).toBe('devices');
        expect(component.getTabIcon('physiological')).toBe('demography');
        expect(component.getTabIcon('other')).toBe('category');
    });

    it('should apply tallest tab panel height as shared min-height', () => {
        const tabGroupElement = createTabGroupElement([120, 220, 190]);
        component.summaryTabGroupRef = new ElementRef(tabGroupElement);

        (component as any).syncTabBodyHeight();

        expect(tabGroupElement.style.getPropertyValue('--summary-tabs-body-min-height')).toBe('220px');
    });

    it('should clear shared min-height and skip height sync on mobile viewport', () => {
        const tabGroupElement = createTabGroupElement([120, 220, 190]);
        component.summaryTabGroupRef = new ElementRef(tabGroupElement);
        tabGroupElement.style.setProperty('--summary-tabs-body-min-height', '220px');
        vi.spyOn(component as any, 'isMobileViewport').mockReturnValue(true);

        (component as any).syncTabBodyHeight();

        expect(tabGroupElement.style.getPropertyValue('--summary-tabs-body-min-height')).toBe('');
        expect((component as any).lastAppliedMinHeightPx).toBe(0);
    });

    it('should reduce shared min-height when intrinsic content gets shorter on wider resize', () => {
        const intrinsicHeights = [220, 180];
        const tabGroupElement = createTabGroupElementWithResizableIntrinsicHeights(intrinsicHeights);
        component.summaryTabGroupRef = new ElementRef(tabGroupElement);

        (component as any).syncTabBodyHeight();
        expect(tabGroupElement.style.getPropertyValue('--summary-tabs-body-min-height')).toBe('220px');

        intrinsicHeights[0] = 120;
        intrinsicHeights[1] = 100;

        (component as any).syncTabBodyHeight();
        expect(tabGroupElement.style.getPropertyValue('--summary-tabs-body-min-height')).toBe('120px');
    });

    it('should ignore tiny height deltas to prevent pixel-level wobble', () => {
        const heights = [220, 180];
        const tabGroupElement = createTabGroupElement(heights);
        component.summaryTabGroupRef = new ElementRef(tabGroupElement);

        (component as any).syncTabBodyHeight();
        expect(tabGroupElement.style.getPropertyValue('--summary-tabs-body-min-height')).toBe('220px');

        heights[0] = 219; // 1px delta should be ignored
        (component as any).syncTabBodyHeight();
        expect(tabGroupElement.style.getPropertyValue('--summary-tabs-body-min-height')).toBe('220px');

        heights[0] = 216; // larger delta should be applied
        (component as any).syncTabBodyHeight();
        expect(tabGroupElement.style.getPropertyValue('--summary-tabs-body-min-height')).toBe('216px');
    });

    it('should not shrink shared min-height during tab-switch grow-only sync', () => {
        const heights = [220, 180];
        const tabGroupElement = createTabGroupElement(heights);
        component.summaryTabGroupRef = new ElementRef(tabGroupElement);

        (component as any).syncTabBodyHeight('allow_shrink');
        expect(tabGroupElement.style.getPropertyValue('--summary-tabs-body-min-height')).toBe('220px');

        heights[0] = 180;
        heights[1] = 170;
        (component as any).syncTabBodyHeight('only_grow');
        expect(tabGroupElement.style.getPropertyValue('--summary-tabs-body-min-height')).toBe('220px');
    });

    it('should grow shared min-height immediately when switching to a taller tab', () => {
        const heights = [220, 292, 180, 170];
        const tabGroupElement = createTabGroupElement(heights);
        component.summaryTabGroupRef = new ElementRef(tabGroupElement);
        component.metricTabs = [
            { id: 'overall', label: 'Overall', metricTypes: [] },
            { id: 'performance', label: 'Performance', metricTypes: [] },
            { id: 'altitude', label: 'Altitude', metricTypes: [] },
            { id: 'environment', label: 'Environment', metricTypes: [] },
        ] as any;

        (component as any).syncTabBodyHeight('allow_shrink');
        expect(tabGroupElement.style.getPropertyValue('--summary-tabs-body-min-height')).toBe('292px');

        tabGroupElement.style.setProperty('--summary-tabs-body-min-height', '220px');
        (component as any).lastAppliedMinHeightPx = 220;
        component.onSelectedTabIndexChange(1);

        expect(tabGroupElement.style.getPropertyValue('--summary-tabs-body-min-height')).toBe('292px');
    });

    it('should coalesce repeated height sync scheduling into one animation frame', () => {
        const tabGroupElement = createTabGroupElement([100, 140]);
        component.summaryTabGroupRef = new ElementRef(tabGroupElement);

        let scheduledCallback: FrameRequestCallback | null = null;
        const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
            scheduledCallback = callback;
            return 99;
        });
        const syncSpy = vi.spyOn(component as any, 'syncTabBodyHeight');

        (component as any).scheduleTabBodyHeightSync();
        (component as any).scheduleTabBodyHeightSync();

        expect(rafSpy).toHaveBeenCalledTimes(1);
        expect(syncSpy).not.toHaveBeenCalled();

        scheduledCallback?.(0);
        expect(syncSpy).toHaveBeenCalledTimes(1);
    });

    it('should skip scheduling height sync animation frame on mobile viewport', () => {
        component.summaryTabGroupRef = new ElementRef(createTabGroupElement([100, 140]));
        vi.spyOn(component as any, 'isMobileViewport').mockReturnValue(true);
        const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame');

        (component as any).scheduleTabBodyHeightSync();

        expect(rafSpy).not.toHaveBeenCalled();
        expect((component as any).measureRafId).toBeNull();
    });

    it('should safely skip observer setup when ResizeObserver is unavailable', () => {
        (globalThis as any).ResizeObserver = undefined;
        component.summaryTabGroupRef = new ElementRef(createTabGroupElement([120]));

        expect(() => (component as any).setupTabBodyResizeObserver()).not.toThrow();
        expect((component as any).resizeObserver).toBeNull();
    });

    it('should observe tab group container to react to width-only resize changes', () => {
        const tabGroupElement = createTabGroupElement([120, 180]);
        component.summaryTabGroupRef = new ElementRef(tabGroupElement);

        const observeSpy = vi.fn();
        (globalThis as any).ResizeObserver = vi.fn().mockImplementation(() => ({
            observe: observeSpy,
            disconnect: vi.fn(),
        }));

        (component as any).setupTabBodyResizeObserver();

        expect(observeSpy).toHaveBeenCalledWith(tabGroupElement);
    });

    it('should register and cleanup window resize listener', () => {
        const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
        const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
        (globalThis as any).ResizeObserver = vi.fn().mockImplementation(() => ({
            observe: vi.fn(),
            disconnect: vi.fn(),
        }));
        component.summaryTabGroupRef = new ElementRef(createTabGroupElement([120, 180]));

        component.ngAfterViewInit();
        component.ngOnDestroy();

        expect(addEventListenerSpy).toHaveBeenCalledWith('resize', (component as any).windowResizeListener);
        expect(removeEventListenerSpy).toHaveBeenCalledWith('resize', (component as any).windowResizeListener);
    });

    it('should register and cleanup window load listener when page is not fully loaded yet', () => {
        const readyStateSpy = vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
        const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
        const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
        (globalThis as any).ResizeObserver = vi.fn().mockImplementation(() => ({
            observe: vi.fn(),
            disconnect: vi.fn(),
        }));
        component.summaryTabGroupRef = new ElementRef(createTabGroupElement([120, 180]));

        component.ngAfterViewInit();
        component.ngOnDestroy();

        expect(addEventListenerSpy).toHaveBeenCalledWith('load', (component as any).windowLoadListener, { once: true });
        expect(removeEventListenerSpy).toHaveBeenCalledWith('load', (component as any).windowLoadListener);
        readyStateSpy.mockRestore();
    });

    it('should disconnect observer and cancel pending frame on destroy', () => {
        const disconnectSpy = vi.fn();
        (globalThis as any).ResizeObserver = vi.fn().mockImplementation(() => ({
            observe: vi.fn(),
            disconnect: disconnectSpy,
        }));

        component.summaryTabGroupRef = new ElementRef(createTabGroupElement([120, 180]));

        vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(() => 77);
        const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => { });

        (component as any).setupTabBodyResizeObserver();
        (component as any).scheduleTabBodyHeightSync();
        component.ngOnDestroy();

        expect(disconnectSpy).toHaveBeenCalledTimes(1);
        expect(cancelSpy).toHaveBeenCalledWith(77);
        expect((component as any).resizeObserver).toBeNull();
        expect((component as any).measureRafId).toBeNull();
    });

    it('should disable tab animation during prewarm and restore it after', () => {
        component.summaryTabGroupRef = new ElementRef(createTabGroupElement([120, 180]));
        component.metricTabs = [
            { id: 'overall', label: 'Overall', metricTypes: [] },
            { id: 'performance', label: 'Performance', metricTypes: [] },
        ] as any;
        component.selectedTabIndex = 0;

        const prewarmSpy = vi.spyOn(component as any, 'prewarmAllTabsSynchronously').mockImplementation(() => {
            expect(component.tabAnimationDuration).toBe('0ms');
        });

        expect(component.tabAnimationDuration).toBe('300ms');
        (component as any).scheduleInitialTabsPrewarm();

        expect(prewarmSpy).toHaveBeenCalledTimes(1);
        expect(component.tabAnimationDuration).toBe('300ms');
    });
});
