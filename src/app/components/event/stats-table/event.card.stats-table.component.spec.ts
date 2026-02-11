import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EventCardStatsTableComponent } from './event.card.stats-table.component';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { MatTableModule } from '@angular/material/table';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import {
    ActivityInterface,
    DataSpeedAvgKilometersPerHour,
    DataSpeedAvgMilesPerHour,
    EventInterface,
    UserUnitSettingsInterface
} from '@sports-alliance/sports-lib';
import { DataExportService } from '../../../services/data-export.service';

describe('EventCardStatsTableComponent', () => {
    let component: EventCardStatsTableComponent;
    let fixture: ComponentFixture<EventCardStatsTableComponent>;
    let mockEventColorService: any;
    let mockDataExportService: any;

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
            getColumnHeaderName: vi.fn(name => name),
            copyToMarkdown: vi.fn(),
            copyToSheets: vi.fn(),
        };

        await TestBed.configureTestingModule({
            imports: [MatTableModule, NoopAnimationsModule],
            declarations: [EventCardStatsTableComponent],
            providers: [
                { provide: AppEventColorService, useValue: mockEventColorService },
                { provide: DataExportService, useValue: mockDataExportService },
            ],
            schemas: [NO_ERRORS_SCHEMA],
        }).compileComponents();
    });

    beforeEach(() => {
        fixture = TestBed.createComponent(EventCardStatsTableComponent);
        component = fixture.componentInstance;
        component.event = mockEvent;
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

    it('should copy selected rows to clipboard as markdown', () => {
        component.columns = ['Name', 'Player 1 #ff0000'];
        const row1 = { Name: 'Distance', 'Player 1 #ff0000': '10 km' };
        component.selection.select(row1);

        component.copyToClipboard();

        expect(mockDataExportService.copyToMarkdown).toHaveBeenCalledWith([row1], component.columns);
    });

    it('should copy selected rows to clipboard as TSV (Sheets)', () => {
        component.columns = ['Name', 'Player 1 #ff0000'];
        const row1 = { Name: 'Distance', 'Player 1 #ff0000': '10 km' };
        component.selection.select(row1);

        component.copyToSheets();

        expect(mockDataExportService.copyToSheets).toHaveBeenCalledWith([row1], component.columns);
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
});
