import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EventCardStatsTableComponent } from './event.card.stats-table.component';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { MatTableModule } from '@angular/material/table';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ActivityInterface, EventInterface, UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
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
    } as unknown as ActivityInterface;

    const mockEvent = {
        getID: () => 'event1',
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
});
