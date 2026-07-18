import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EventCardStatsTableComponent } from './event.card.stats-table.component';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { MatTableModule } from '@angular/material/table';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import {
    ActivityInterface,
    DataBeginningPotentialStamina,
    DataPace,
    DataPaceAvg,
    DataPaceMax,
    DataPaceMin,
    DataPotentialStaminaAvg,
    DataSpeedAvgKilometersPerHour,
    DataSpeedAvgMilesPerHour,
    DataStaminaMin,
    EventInterface,
    ServiceNames,
    User,
    UserUnitSettingsInterface
} from '@sports-alliance/sports-lib';
import { DataExportService } from '../../../services/data-export.service';
import { AppEventService } from '../../../services/app.event.service';
import { NEVER, of } from 'rxjs';

describe('EventCardStatsTableComponent', () => {
    let component: EventCardStatsTableComponent;
    let fixture: ComponentFixture<EventCardStatsTableComponent>;
    let mockEventColorService: any;
    let mockDataExportService: any;
    let mockEventService: any;

    const mockActivity = {
        creator: { name: 'Player 1' },
        getStatsAsArray: () => [],
        getStat: () => null,
        type: 'Run',
        getID: () => 'act1',
    } as unknown as ActivityInterface;

    const mockEvent = {
        getID: () => 'event1',
        isMerge: true,
    } as unknown as EventInterface;

    const mockUser = {
        uid: 'user-1',
    } as User;

    const mockUserUnitSettings = {
        swimPaceUnits: [],
        paceUnits: [],
        gradeAdjustedPaceUnits: [],
        speedUnits: [],
        verticalSpeedUnits: [],
    } as unknown as UserUnitSettingsInterface;

    beforeEach(async () => {
        mockEventColorService = {
            getActivityColor: vi.fn().mockReturnValue('#ff0000'),
        };
        mockDataExportService = {
            getColumnHeaderName: vi.fn((columnHeader: string) => {
                if (columnHeader === 'Name' || columnHeader === 'Difference') {
                    return columnHeader;
                }
                return columnHeader.slice(0, -7);
            }),
            copyToMarkdown: vi.fn(),
            copyToSheets: vi.fn(),
        };
        mockEventService = {
            getEventMetaDataKeys: vi.fn().mockReturnValue(of([])),
        };

        await TestBed.configureTestingModule({
            imports: [MatTableModule, NoopAnimationsModule],
            declarations: [EventCardStatsTableComponent],
            providers: [
                { provide: AppEventColorService, useValue: mockEventColorService },
                { provide: DataExportService, useValue: mockDataExportService },
                { provide: AppEventService, useValue: mockEventService },
            ],
            schemas: [NO_ERRORS_SCHEMA],
        }).compileComponents();
    });

    beforeEach(() => {
        fixture = TestBed.createComponent(EventCardStatsTableComponent);
        component = fixture.componentInstance;
        component.event = mockEvent;
        component.user = mockUser;
        component.userUnitSettings = mockUserUnitSettings;
        component.selectedActivities = [mockActivity];
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should toggle row selection', () => {
        const row = { Name: 'Distance', 'Player 1 #ff0000': '10 km' };
        component.toggleRow(row);
        expect(component.selection.isSelected(row)).toBe(true);
        component.toggleRow(row);
        expect(component.selection.isSelected(row)).toBe(false);
    });

    it('should clear selection', () => {
        const row = { Name: 'Distance' };
        component.selection.select(row);
        expect(component.selection.hasValue()).toBe(true);
        component.clearSelection();
        expect(component.selection.hasValue()).toBe(false);
    });

    it('should copy selected rows to clipboard as markdown with event-level provider attribution for ambiguous single-provider headers', () => {
        mockEventService.getEventMetaDataKeys.mockReturnValue(of([ServiceNames.GarminAPI]));
        component.ngOnChanges({});
        component.columns = ['Name', 'Player 1 #ff0000'];
        const row1 = { Name: 'Distance', 'Player 1 #ff0000': '10 km' };
        component.selection.select(row1);

        component.copyToClipboard();

        expect(mockDataExportService.copyToMarkdown).toHaveBeenCalledWith([row1], component.columns, {
            attributionLabel: 'Garmin',
        });
    });

    it('should copy selected rows to clipboard as TSV (Sheets) with event-level provider attribution for ambiguous single-provider headers', () => {
        mockEventService.getEventMetaDataKeys.mockReturnValue(of([ServiceNames.SuuntoApp]));
        component.ngOnChanges({});
        component.columns = ['Name', 'Player 1 #ff0000'];
        const row1 = { Name: 'Distance', 'Player 1 #ff0000': '10 km' };
        component.selection.select(row1);

        component.copyToSheets();

        expect(mockDataExportService.copyToSheets).toHaveBeenCalledWith([row1], component.columns, {
            attributionLabel: 'Suunto',
        });
    });

    it('should trigger Sheets export immediately even while metadata attribution is still loading', () => {
        const garminActivity = {
            ...mockActivity,
            creator: { name: 'Garmin' },
            getID: () => 'act-garmin',
        } as unknown as ActivityInterface;
        mockEventService.getEventMetaDataKeys.mockReturnValue(NEVER);
        component.event = { ...mockEvent, isMerge: false } as EventInterface;
        component.selectedActivities = [garminActivity];
        component.ngOnChanges({});

        const row1 = { Name: 'Distance', 'Value #ff0000': '10 km' };
        component.selection.select(row1);

        component.copyToSheets();

        expect(mockDataExportService.copyToSheets).toHaveBeenCalledWith([row1], component.columns, expect.objectContaining({
            attributionLabel: 'Garmin',
        }));
    });

    it('should omit export attribution when merge headers already expose the device name', () => {
        const explicitDeviceActivity = {
            ...mockActivity,
            creator: { name: 'Edge 540' },
            getID: () => 'act-edge-540',
        } as unknown as ActivityInterface;
        mockEventService.getEventMetaDataKeys.mockReturnValue(of([ServiceNames.GarminAPI]));
        component.selectedActivities = [explicitDeviceActivity];
        component.ngOnChanges({});

        const row1 = { Name: 'Distance', 'Edge 540 #ff0000': '10 km' };
        component.selection.select(row1);

        component.copyToClipboard();

        expect(mockDataExportService.copyToMarkdown).toHaveBeenCalledWith([row1], component.columns, undefined);
    });

    it('should add per-series provider attribution for ambiguous mixed-provider headers', () => {
        const garminActivity = {
            ...mockActivity,
            creator: {
                name: 'Player 1',
                devices: [{ manufacturer: 'Garmin', name: 'Forerunner 965' }],
            },
            getID: () => 'act-garmin',
        } as unknown as ActivityInterface;
        const suuntoActivity = {
            ...mockActivity,
            creator: {
                name: 'Player 2',
                devices: [{ manufacturer: 'Suunto', name: 'Vertical' }],
            },
            getID: () => 'act-suunto',
        } as unknown as ActivityInterface;
        const wahooActivity = {
            ...mockActivity,
            creator: {
                name: 'Player 3',
                devices: [{ manufacturer: 'Wahoo Fitness', name: 'ELEMNT RIVAL' }],
            },
            getID: () => 'act-wahoo',
        } as unknown as ActivityInterface;

        mockEventService.getEventMetaDataKeys.mockReturnValue(of([
            ServiceNames.GarminAPI,
            ServiceNames.SuuntoApp,
            ServiceNames.WahooAPI,
        ]));
        component.selectedActivities = [garminActivity, suuntoActivity, wahooActivity];
        component.ngOnChanges({});

        const row1 = {
            Name: 'Distance',
            'Player 1 #ff0000': '10 km',
            'Player 2 #ff0000': '12 km',
            'Player 3 #ff0000': '11 km',
        };
        component.selection.select(row1);

        component.copyToClipboard();

        expect(mockDataExportService.copyToMarkdown).toHaveBeenCalledWith([row1], component.columns, {
            seriesPresentations: {
                'Player 1 #ff0000': expect.objectContaining({
                    serviceName: ServiceNames.GarminAPI,
                    exportLabel: 'Garmin',
                }),
                'Player 2 #ff0000': expect.objectContaining({
                    serviceName: ServiceNames.SuuntoApp,
                    exportLabel: 'Suunto',
                }),
                'Player 3 #ff0000': expect.objectContaining({
                    serviceName: ServiceNames.WahooAPI,
                    exportLabel: 'Wahoo',
                }),
            },
        });
    });

    it('should NOT copy to markdown if selection is empty', () => {
        component.selection.clear();
        component.copyToClipboard();
        expect(mockDataExportService.copyToMarkdown).not.toHaveBeenCalled();
    });

    it('should NOT copy to sheets if selection is empty', () => {
        component.selection.clear();
        component.copyToSheets();
        expect(mockDataExportService.copyToSheets).not.toHaveBeenCalled();
    });

    it('should clear selection on changes', () => {
        component.selection.select({ Name: 'Test' });
        expect(component.selection.hasValue()).toBe(true);
        component.ngOnChanges({});
        expect(component.selection.hasValue()).toBe(false);
    });

    // Removed navigator.clipboard test as logic is now in DataExportService

    it('should add Software Version row if swInfo is present', () => {
        const activityWithVersion = {
            ...mockActivity,
            creator: { name: 'Garmin', swInfo: '12.00' },
            getID: () => 'act1'
        } as unknown as ActivityInterface;

        component.selectedActivities = [activityWithVersion];
        component.ngOnChanges({});

        const swRow = component.data.data.find(row => row.Name === 'Software Version');
        expect(swRow).toBeDefined();
        expect(swRow['Garmin #ff0000']).toBe('12.00');
    });

    it('should NOT add Software Version row if versions are empty', () => {
        const activityNoVersion = {
            ...mockActivity,
            creator: { name: 'Garmin', swInfo: '' },
            getID: () => 'act1'
        } as unknown as ActivityInterface;

        component.selectedActivities = [activityNoVersion];
        component.ngOnChanges({});

        const swRow = component.data.data.find(row => row.Name === 'Software Version');
        expect(swRow).toBeUndefined();
    });

    it('should use value header when event is not a merge and there is one activity', () => {
        component.event = { ...mockEvent, isMerge: false } as EventInterface;
        const activity = {
            ...mockActivity,
            type: 'Ride',
            creator: { name: 'Garmin' },
            getID: () => 'act1'
        } as unknown as ActivityInterface;
        component.selectedActivities = [activity];
        component.ngOnChanges({});

        expect(component.columns).toContain('Value #ff0000');
    });

    it('should hide activity header label when event is not a merge and there is one activity', () => {
        component.event = { ...mockEvent, isMerge: false } as EventInterface;
        component.selectedActivities = [mockActivity];
        component.ngOnChanges({});

        expect(component.shouldShowActivityHeaderLabel('Value #ff0000')).toBe(false);
        expect(component.shouldShowActivityHeaderLabel('Name')).toBe(false);
    });

    it('should hide header row when there is only one activity', () => {
        component.selectedActivities = [mockActivity];
        component.ngOnChanges({});

        expect(component.shouldShowHeaderRow()).toBe(false);
    });

    it('should show header row when there are multiple activities', () => {
        const activity2 = {
            ...mockActivity,
            creator: { name: 'Player 2' },
            getID: () => 'act2'
        } as unknown as ActivityInterface;
        component.selectedActivities = [mockActivity, activity2];
        component.ngOnChanges({});

        expect(component.shouldShowHeaderRow()).toBe(true);
    });

    it('should NOT add difference column when event is not a merge', () => {
        component.event = { ...mockEvent, isMerge: false } as EventInterface;
        const stat = {
            getType: () => 'Power',
            getDisplayType: () => 'Power',
            getDisplayValue: () => 100,
            getDisplayUnit: () => 'W',
            getValue: () => 100
        };
        const activity1 = {
            ...mockActivity,
            type: 'Ride',
            creator: { name: 'Device A' },
            getStatsAsArray: () => [stat],
            getStat: () => stat,
            getID: () => 'act1'
        } as unknown as ActivityInterface;
        const activity2 = {
            ...mockActivity,
            type: 'Ride',
            creator: { name: 'Device B' },
            getStatsAsArray: () => [stat],
            getStat: () => stat,
            getID: () => 'act2'
        } as unknown as ActivityInterface;
        component.selectedActivities = [activity1, activity2];
        component.ngOnChanges({});

        expect(component.columns).not.toContain('Difference');
    });

    it('should exclude stats that display as [object Object] for ANY activity', () => {
        const powerCurveStatGood = {
            getType: () => 'PowerCurve',
            getDisplayType: () => 'Power Curve',
            getDisplayValue: () => '100W',
            getDisplayUnit: () => '',
            getValue: () => 100
        };

        const powerCurveStatBad = {
            getType: () => 'PowerCurve',
            getDisplayType: () => 'Power Curve',
            getDisplayValue: () => ({} as any), // Simulating an object return
            getDisplayUnit: () => '',
            getValue: () => 0
        };

        const activity1 = {
            ...mockActivity,
            creator: { name: 'Player 1' },
            getStatsAsArray: () => [powerCurveStatGood],
            getStat: (type: string) => type === 'PowerCurve' ? powerCurveStatGood : null,
            getID: () => 'act1'
        } as unknown as ActivityInterface;

        const activity2 = {
            ...mockActivity,
            creator: { name: 'Player 2' },
            getStatsAsArray: () => [powerCurveStatBad],
            getStat: (type: string) => type === 'PowerCurve' ? powerCurveStatBad : null,
            getID: () => 'act2'
        } as unknown as ActivityInterface;

        component.selectedActivities = [activity1, activity2];
        component.ngOnChanges({});

        const powerCurveRow = component.data.data.find(row => row.Name === 'Power Curve');
        expect(powerCurveRow).toBeUndefined();
    });

    it('should normalize unit-derived labels and still attach diff per type', () => {
        const typeA = DataSpeedAvgKilometersPerHour.type;
        const typeB = DataSpeedAvgMilesPerHour.type;

        const statA1 = {
            getType: () => typeA,
            getDisplayType: () => 'Average speed in kilometers per hour',
            getDisplayValue: () => 30,
            getDisplayUnit: () => 'km/h',
            getValue: () => 30
        };
        const statA2 = {
            getType: () => typeB,
            getDisplayType: () => 'Average speed in miles per hour',
            getDisplayValue: () => 18,
            getDisplayUnit: () => 'mph',
            getValue: () => 18
        };

        const statB1 = {
            getType: () => typeA,
            getDisplayType: () => 'Average speed in kilometers per hour',
            getDisplayValue: () => 28,
            getDisplayUnit: () => 'km/h',
            getValue: () => 28
        };
        const statB2 = {
            getType: () => typeB,
            getDisplayType: () => 'Average speed in miles per hour',
            getDisplayValue: () => 17,
            getDisplayUnit: () => 'mph',
            getValue: () => 17
        };

        const activity1 = {
            ...mockActivity,
            creator: { name: 'Device A' },
            getStatsAsArray: () => [statA1, statA2],
            getStat: (type: string) => {
                if (type === typeA) return statA1;
                if (type === typeB) return statA2;
                return null;
            },
            getID: () => 'act1'
        } as unknown as ActivityInterface;

        const activity2 = {
            ...mockActivity,
            creator: { name: 'Device B' },
            getStatsAsArray: () => [statB1, statB2],
            getStat: (type: string) => {
                if (type === typeA) return statB1;
                if (type === typeB) return statB2;
                return null;
            },
            getID: () => 'act2'
        } as unknown as ActivityInterface;

        component.event = { ...mockEvent, isMerge: true } as EventInterface;
        component.selectedActivities = [activity1, activity2];
        component.ngOnChanges({});

        const speedRows = component.data.data.filter(row => row.Name === 'Average Speed');
        expect(speedRows.length).toBe(2);
        speedRows.forEach((row) => expect(row['Difference']).toBeDefined());
    });

    it('should include pace avg/min/max when base pace unit is selected', () => {
        component.userUnitSettings = {
            ...mockUserUnitSettings,
            paceUnits: [DataPace.type],
        } as unknown as UserUnitSettingsInterface;

        const avgStat = {
            getType: () => DataPaceAvg.type,
            getDisplayType: () => 'Average Pace',
            getDisplayValue: () => '5:00',
            getDisplayUnit: () => '/km',
            getValue: () => 300
        };
        const minStat = {
            getType: () => DataPaceMin.type,
            getDisplayType: () => 'Minimum Pace',
            getDisplayValue: () => '3:40',
            getDisplayUnit: () => '/km',
            getValue: () => 220
        };
        const maxStat = {
            getType: () => DataPaceMax.type,
            getDisplayType: () => 'Maximum Pace',
            getDisplayValue: () => '6:20',
            getDisplayUnit: () => '/km',
            getValue: () => 380
        };

        const activity = {
            ...mockActivity,
            creator: { name: 'Device A' },
            getStatsAsArray: () => [avgStat, minStat, maxStat],
            getStat: (type: string) => {
                if (type === DataPaceAvg.type) return avgStat;
                if (type === DataPaceMin.type) return minStat;
                if (type === DataPaceMax.type) return maxStat;
                return null;
            },
            getID: () => 'act1'
        } as unknown as ActivityInterface;

        component.event = { ...mockEvent, isMerge: false } as EventInterface;
        component.selectedActivities = [activity];
        component.ngOnChanges({});

        const rowTypes = component.data.data.map((row: any) => row['__statType']);
        expect(rowTypes).toContain(DataPaceAvg.type);
        expect(rowTypes).toContain(DataPaceMin.type);
        expect(rowTypes).toContain(DataPaceMax.type);
    });

    it('should include Garmin stamina stats in detailed statistics', () => {
        const staminaStats = [
            {
                getType: () => DataStaminaMin.type,
                getDisplayType: () => DataStaminaMin.type,
                getDisplayValue: () => 34,
                getDisplayUnit: () => '%',
                getValue: () => 34
            },
            {
                getType: () => DataPotentialStaminaAvg.type,
                getDisplayType: () => DataPotentialStaminaAvg.type,
                getDisplayValue: () => 79.8,
                getDisplayUnit: () => '%',
                getValue: () => 79.8
            },
            {
                getType: () => DataBeginningPotentialStamina.type,
                getDisplayType: () => DataBeginningPotentialStamina.type,
                getDisplayValue: () => 95,
                getDisplayUnit: () => '%',
                getValue: () => 95
            }
        ];

        const activity = {
            ...mockActivity,
            creator: { name: 'Garmin' },
            getStatsAsArray: () => staminaStats,
            getStat: (type: string) => staminaStats.find((stat) => stat.getType() === type) || null,
            getID: () => 'act1'
        } as unknown as ActivityInterface;

        component.event = { ...mockEvent, isMerge: false } as EventInterface;
        component.selectedActivities = [activity];
        component.ngOnChanges({});

        const rowTypes = component.data.data.map((row: any) => row['__statType']);
        expect(rowTypes).toContain(DataStaminaMin.type);
        expect(rowTypes).toContain(DataPotentialStaminaAvg.type);
        expect(rowTypes).toContain(DataBeginningPotentialStamina.type);
    });
});
