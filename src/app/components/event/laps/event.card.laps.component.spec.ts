import { ChangeDetectorRef, NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatSelectionListChange } from '@angular/material/list';
import {
    ActivityInterface,
    DataDuration,
    DataPaceAvg,
    DataSpeedAvg,
    EventInterface,
    LapInterface,
    LapTypes,
    UserUnitSettingsInterface
} from '@sports-alliance/sports-lib';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { vi } from 'vitest';
import { EventCardLapsComponent } from './event.card.laps.component';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { AppUserSettingsQueryService } from '../../../services/app.user-settings-query.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { normalizeEventDetailsSettings } from '../../../helpers/event-lap-table-columns.helper';

function createActivity(laps: LapInterface[]): ActivityInterface {
    return {
        type: 'Running',
        getID: () => 'activity-1',
        getLaps: () => laps,
    } as ActivityInterface;
}

function createRenderableLap(type: LapTypes): LapInterface {
    return {
        type,
        getStatsAsArray: () => [],
        getStat: () => undefined,
        getDuration: () => ({
            getDisplayValue: () => '00:10',
            getStopwatchDisplayValue: () => '0:12.85',
        }),
    } as unknown as LapInterface;
}

function createLapColumnSelectionChange(metricTypes: string[]): MatSelectionListChange {
    return {
        source: {
            selectedOptions: {
                selected: metricTypes.map((value) => ({ value })),
            },
        },
    } as unknown as MatSelectionListChange;
}

describe('EventCardLapsComponent', () => {
    let component: EventCardLapsComponent;
    let fixture: ComponentFixture<EventCardLapsComponent>;
    let eventDetailsSettings: ReturnType<typeof signal>;
    let updateLapTableColumns: ReturnType<typeof vi.fn>;
    let snackBar: { open: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
        eventDetailsSettings = signal(normalizeEventDetailsSettings(null));
        updateLapTableColumns = vi.fn().mockResolvedValue(undefined);
        snackBar = { open: vi.fn() };
        await TestBed.configureTestingModule({
            declarations: [EventCardLapsComponent],
            providers: [
                { provide: AppEventColorService, useValue: {} },
                { provide: ChangeDetectorRef, useValue: { markForCheck: vi.fn(), detectChanges: vi.fn() } },
                {
                    provide: AppUserSettingsQueryService,
                    useValue: { eventDetailsSettings, updateLapTableColumns },
                },
                { provide: MatSnackBar, useValue: snackBar },
            ],
            schemas: [NO_ERRORS_SCHEMA],
        }).compileComponents();

        fixture = TestBed.createComponent(EventCardLapsComponent);
        component = fixture.componentInstance;
        component.selectedActivities = [] as ActivityInterface[];
        component.unitSettings = {} as UserUnitSettingsInterface;
        component.event = { getActivities: () => [] } as EventInterface;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should resolve renderable lap types when visible laps exist', () => {
        const activity = createActivity([
            createRenderableLap(LapTypes.Manual),
        ]);
        component.selectedActivities = [activity];
        component.ngOnChanges();

        expect(component.availableLapTypes).toEqual([LapTypes.Manual]);
        expect(component.lapTableGroups).toHaveLength(1);
        expect(component.lapTableGroups[0]?.tables[0]?.dataSource.data[0].Duration).toBe('0:12.85');
        expect(component.getDataSource(activity, LapTypes.Manual)?.data[0].Duration).toBe('0:12.85');
    });

    it('shows running pace instead of a mislabeled average speed column', () => {
        const pace = new DataPaceAvg(300);
        const activity = createActivity([{
            ...createRenderableLap(LapTypes.Manual),
            getStat: (type: string) => type === DataPaceAvg.type ? pace : undefined,
        } as unknown as LapInterface]);
        component.selectedActivities = [activity];

        component.ngOnChanges();

        expect(component.getColumns(activity, LapTypes.Manual)).toContain(DataPaceAvg.type);
        expect(component.getColumns(activity, LapTypes.Manual)).not.toContain(DataSpeedAvg.type);
        expect(component.getDataSource(activity, LapTypes.Manual)?.data[0][DataPaceAvg.type]).toBe('05:00 min/km');
    });

    it('shows unit-aware metric averages directly below the table header', () => {
        const activity = createActivity([300, 330].map((pace) => ({
            ...createRenderableLap(LapTypes.Manual),
            getStat: (type: string) => type === DataPaceAvg.type ? new DataPaceAvg(pace) : undefined,
        } as unknown as LapInterface)));
        component.selectedActivities = [activity];

        component.ngOnChanges();

        const rows = component.getDataSource(activity, LapTypes.Manual)?.data;
        expect(rows?.[0]).toMatchObject({
            '#': 'Avg',
            isLapAverage: true,
            [DataPaceAvg.type]: '05:15 min/km',
        });
        expect(rows?.[1]?.['#']).toBe(1);
    });

    it('does not average accumulated lap totals', () => {
        const activity = createActivity([120, 180].map((duration, index) => ({
            ...createRenderableLap(LapTypes.Manual),
            getDuration: () => new DataDuration(duration),
            getStat: (type: string) => type === DataPaceAvg.type
                ? new DataPaceAvg(index === 0 ? 300 : 330)
                : undefined,
        } as unknown as LapInterface)));
        component.selectedActivities = [activity];

        component.ngOnChanges();

        const averageRow = component.getDataSource(activity, LapTypes.Manual)?.data[0];
        expect(averageRow).toMatchObject({
            '#': 'Avg',
            [DataPaceAvg.type]: '05:15 min/km',
        });
        expect(averageRow).not.toHaveProperty(DataDuration.type);
    });

    it('keeps table average rows sport-aware', () => {
        const running = createActivity([{
            ...createRenderableLap(LapTypes.Manual),
            getStat: (type: string) => type === DataPaceAvg.type ? new DataPaceAvg(300) : undefined,
        } as unknown as LapInterface]);
        const cycling = {
            ...createActivity([{
                ...createRenderableLap(LapTypes.Manual),
                getStat: (type: string) => type === DataSpeedAvg.type ? new DataSpeedAvg(5) : undefined,
            } as unknown as LapInterface]),
            getID: () => 'activity-2',
            type: 'Cycling',
        } as ActivityInterface;
        component.selectedActivities = [running, cycling];

        component.ngOnChanges();

        expect(component.getDataSource(running, LapTypes.Manual)?.data[0]).toMatchObject({
            '#': 'Avg',
            isLapAverage: true,
            [DataPaceAvg.type]: '05:00 min/km',
        });
        expect(component.getDataSource(cycling, LapTypes.Manual)?.data[0]).toMatchObject({
            '#': 'Avg',
            isLapAverage: true,
            [DataSpeedAvg.type]: '18.00 km/h',
        });
    });

    it('uses speed for cycling laps', () => {
        const speed = new DataSpeedAvg(5);
        const activity = {
            ...createActivity([{
                ...createRenderableLap(LapTypes.Manual),
                getStat: (type: string) => type === DataSpeedAvg.type ? speed : undefined,
            } as unknown as LapInterface]),
            type: 'Cycling',
        } as ActivityInterface;
        component.selectedActivities = [activity];

        component.ngOnChanges();

        expect(component.getColumns(activity, LapTypes.Manual)).toContain(DataSpeedAvg.type);
        expect(component.getDataSource(activity, LapTypes.Manual)?.data[0][DataSpeedAvg.type]).toBe('18.00 km/h');
    });

    it('updates an owner-selected sport family column layout immediately and persists it', async () => {
        const activity = createActivity([createRenderableLap(LapTypes.Manual)]);
        component.canCustomize = true;
        component.selectedActivities = [activity];
        component.ngOnChanges();

        await component.onLapColumnSelectionChange(
            'running',
            createLapColumnSelectionChange([DataPaceAvg.type]),
        );

        expect(component.getColumnsToDisplay('Running')).toEqual(['#', DataPaceAvg.type]);
        expect(updateLapTableColumns).toHaveBeenCalledWith('running', [DataPaceAvg.type]);
    });

    it('keeps independent column menu groups for multisport event details', () => {
        const running = createActivity([createRenderableLap(LapTypes.Manual)]);
        const cycling = {
            ...createActivity([createRenderableLap(LapTypes.Manual)]),
            getID: () => 'activity-2',
            type: 'Cycling',
        } as ActivityInterface;
        component.canCustomize = true;
        component.selectedActivities = [running, cycling];

        component.ngOnChanges();

        expect(component.lapColumnMenuGroups.map((group) => group.family)).toEqual(['running', 'cycling']);
        expect(component.lapColumnMenuGroups[0]?.selectedMetricTypes).toContain(DataPaceAvg.type);
        expect(component.lapColumnMenuGroups[1]?.selectedMetricTypes).toContain(DataSpeedAvg.type);
    });

    it('restores the prior column layout when its profile save fails', async () => {
        const activity = createActivity([createRenderableLap(LapTypes.Manual)]);
        updateLapTableColumns.mockRejectedValueOnce(new Error('save failed'));
        component.canCustomize = true;
        component.selectedActivities = [activity];
        component.ngOnChanges();

        await component.onLapColumnSelectionChange(
            'running',
            createLapColumnSelectionChange([DataPaceAvg.type]),
        );

        expect(component.getColumnsToDisplay('Running')).toContain(DataDuration.type);
        expect(snackBar.open).toHaveBeenCalledWith('Could not save lap columns. Please try again.', 'Close');
    });

    it('should format durations from cached lap data without the stopwatch formatter', () => {
        const activity = createActivity([{
            ...createRenderableLap(LapTypes.Manual),
            getDuration: () => ({
                getValue: () => 12.85,
            }),
        } as unknown as LapInterface]);
        component.selectedActivities = [activity];

        component.ngOnChanges();

        expect(component.getDataSource(activity, LapTypes.Manual)?.data[0].Duration).toBe('0:12.85');
    });

    it('should exclude session end laps from the rendered lap tables', () => {
        const activity = createActivity([
            { type: LapTypes.session_end } as LapInterface,
        ]);
        component.selectedActivities = [activity];

        component.ngOnChanges();

        expect(component.availableLapTypes).toEqual([]);
        expect(component.getDataSource(activity, LapTypes.session_end)).toBeUndefined();
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('app-event-section-header')).toBeNull();
    });

    it('should exclude laps with a missing type from the rendered lap tables', () => {
        const activity = createActivity([
            createRenderableLap(undefined),
        ]);
        component.selectedActivities = [activity];

        component.ngOnChanges();

        expect(component.availableLapTypes).toEqual([]);
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('app-event-section-header')).toBeNull();
    });

    it('should hide the section when a lap type has no table rows', () => {
        const lap = createRenderableLap(LapTypes.Manual);
        const activity = {
            type: 'Running',
            getID: () => 'activity-1',
            getLaps: vi.fn()
                .mockReturnValueOnce([lap])
                .mockReturnValueOnce([]),
        } as unknown as ActivityInterface;
        component.selectedActivities = [activity];

        component.ngOnChanges();

        expect(component.availableLapTypes).toEqual([]);
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('mat-divider')).toBeNull();
        expect(fixture.nativeElement.querySelector('app-event-section-header')).toBeNull();
    });

    it('should not render the index column header icon', () => {
        const template = readFileSync(
            resolve(process.cwd(), 'src/app/components/event/laps/event.card.laps.component.html'),
            'utf8',
        );

        expect(template).toContain("@if (column !== '#')");
        expect(template).toContain('<app-data-type-icon [dataType]="column"></app-data-type-icon>');
        expect(template).toContain("[class.lap-index-cell]=\"column === '#'");
        expect(template).toContain("[class.lap-duration-cell]=\"column === 'Duration'");
        expect(template).toContain('lapColumnFamiliesMenu');
        expect(template).toContain('Choose columns for {{ group.label.toLowerCase() }} laps');
        expect(template).toContain('row.isLapAverage');
        expect(template).toContain('lap-average-row');
        expect(template).not.toContain('lap-header-averages');
        expect(template).toContain('lapTableGroup.tables');
        expect(template).not.toContain('getDataSource(');
        expect(template).not.toContain('getColumns(');
    });
});
