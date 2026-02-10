import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EventCardStatsGridComponent } from './event.card.stats-grid.component';
import { AppUserSettingsQueryService } from '../../../services/app.user-settings-query.service';
import { signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { ActivityTypes, UserSummariesSettingsInterface, UserUnitSettingsInterface, ActivityUtilities, DynamicDataLoader } from '@sports-alliance/sports-lib';
import { SimpleChange } from '@angular/core';
import { DataAscent, DataDescent, DataDuration, DataPowerAvg, DataPowerMax, DataPowerMin, DataTemperatureMax } from '@sports-alliance/sports-lib';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { afterEach, vi } from 'vitest';

const createStat = (type: string) => ({
    getType: () => type,
    getDisplayType: () => type,
    getDisplayValue: () => '1',
    getDisplayUnit: () => '',
    getValue: () => 1,
}) as any;

describe('EventCardStatsGridComponent', () => {
    let component: EventCardStatsGridComponent;
    let fixture: ComponentFixture<EventCardStatsGridComponent>;
    let mockUserSettingsQueryService: any;

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

        await TestBed.configureTestingModule({
            declarations: [EventCardStatsGridComponent],
            providers: [
                { provide: AppUserSettingsQueryService, useValue: mockUserSettingsQueryService },
                { provide: AppEventColorService, useValue: { getDifferenceColor: vi.fn(() => '#00ff00') } },
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

    it('should build metric tabs and default to Overall when available', () => {
        const activity = { type: ActivityTypes.Cycling } as any;
        const durationStat = createStat(DataDuration.type);
        const powerStat = createStat(DataPowerAvg.type);
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
        const activity = { type: ActivityTypes.Cycling } as any;
        const temperatureStat = createStat(DataTemperatureMax.type);
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

    it('should hide tabs without matching stat data', () => {
        const activity = { type: ActivityTypes.Cycling } as any;
        const durationStat = createStat(DataDuration.type);
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
        const activity = { type: ActivityTypes.Cycling } as any;
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
});
