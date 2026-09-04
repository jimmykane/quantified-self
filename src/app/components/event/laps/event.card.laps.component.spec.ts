import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatMenuModule } from '@angular/material/menu';
import { MatTableModule } from '@angular/material/table';
import { MatSelectionListChange } from '@angular/material/list';
import {
    ActivityInterface,
    ActivityTypes,
    DataDuration,
    DataHeartRateMax,
    DataPaceAvg,
    DataSpeedAvg,
    DataSpeedMax,
    DataSpeedMin,
    EventImporterJSON,
    EventInterface,
    FileType,
    LapInterface,
    LapTypes,
    Privacy,
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

function createLapColumnSelectionChange(
    metricTypes: string[],
    selected = true,
): MatSelectionListChange {
    return {
        options: metricTypes.map((value) => ({ value, selected })),
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
            imports: [CommonModule, MatCheckboxModule, MatMenuModule, MatTableModule],
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

    it('renders a single lap type without tab chrome', () => {
        const activity = createActivity([createRenderableLap(LapTypes.Manual)]);
        component.selectedActivities = [activity];
        component.ngOnChanges();
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('mat-tab-group')).toBeNull();
        expect(fixture.nativeElement.querySelector('table[mat-table]')).toBeTruthy();
    });

    it('renders tabs when multiple lap types are available', () => {
        const activity = createActivity([
            createRenderableLap(LapTypes.Manual),
            createRenderableLap(LapTypes.AutoLap),
        ]);
        component.selectedActivities = [activity];
        component.ngOnChanges();
        fixture.detectChanges();

        expect(component.lapTableGroups).toHaveLength(2);
        expect(fixture.nativeElement.querySelector('mat-tab-group')).toBeTruthy();
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

    it('shows pace for persisted speed-only laps after Sports Lib JSON hydration', () => {
        const hydratedEvent = EventImporterJSON.getEventFromJSON({
            name: 'speed-only laps',
            startDate: 0,
            endDate: 2000,
            srcFileType: FileType.FIT,
            description: null,
            isMerge: false,
            privacy: Privacy.Private,
            powerCurve: null,
            stats: {},
            activities: [{
                name: null,
                startDate: 0,
                endDate: 2000,
                type: ActivityTypes.Running,
                powerMeter: false,
                trainer: false,
                powerCurve: null,
                stats: {},
                streams: [],
                laps: [4, 5].map((averageSpeed, index) => ({
                    lapId: index + 1,
                    startDate: index * 1000,
                    endDate: (index + 1) * 1000,
                    startIndex: null,
                    endIndex: null,
                    type: LapTypes.Manual,
                    stats: { [DataSpeedAvg.type]: averageSpeed },
                })),
                creator: { name: 'test', devices: [] },
                intensityZones: [],
                events: [],
            }],
        });
        const activity = hydratedEvent.getFirstActivity();
        component.event = hydratedEvent;
        component.selectedActivities = [activity];

        component.ngOnChanges();

        expect(component.getColumns(activity, LapTypes.Manual)).toContain(DataPaceAvg.type);
        const rows = component.getDataSource(activity, LapTypes.Manual)?.data;
        expect(rows?.[0]).toMatchObject({
            '#': 'Avg',
            isLapAverage: true,
            [DataPaceAvg.type]: '03:45 min/km',
        });
        expect(rows?.[1]).toMatchObject({ '#': 1, [DataPaceAvg.type]: '04:10 min/km' });
        expect(rows?.[2]).toMatchObject({ '#': 2, [DataPaceAvg.type]: '03:20 min/km' });
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

    it('renders selected cycling speed minimum and maximum lap metrics', async () => {
        const activity = {
            ...createActivity([{
                ...createRenderableLap(LapTypes.Manual),
                getStat: (type: string) => {
                    if (type === DataSpeedAvg.type) {
                        return new DataSpeedAvg(5);
                    }
                    if (type === DataSpeedMin.type) {
                        return new DataSpeedMin(1);
                    }
                    if (type === DataSpeedMax.type) {
                        return new DataSpeedMax(10);
                    }
                    return undefined;
                },
            } as unknown as LapInterface]),
            type: 'Cycling',
        } as ActivityInterface;
        component.canCustomize = true;
        component.selectedActivities = [activity];
        eventDetailsSettings.set(normalizeEventDetailsSettings({
            lapTableColumnsBySportFamily: { cycling: [] },
        }));
        fixture.detectChanges();

        component.ngOnChanges();
        await component.onLapColumnSelectionChange(
            'cycling',
            createLapColumnSelectionChange([DataSpeedAvg.type, DataSpeedMin.type, DataSpeedMax.type]),
        );

        expect(component.getColumns(activity, LapTypes.Manual)).toEqual([
            'selection',
            '#',
            DataSpeedAvg.type,
            DataSpeedMin.type,
            DataSpeedMax.type,
        ]);
        expect(component.getDataSource(activity, LapTypes.Manual)?.data).toEqual([
            {
                '#': 'Avg',
                isLapAverage: true,
                [DataSpeedAvg.type]: '18.00 km/h',
                [DataSpeedMin.type]: '3.60 km/h',
                [DataSpeedMax.type]: '36.00 km/h',
            },
            {
                '#': 1,
                [DataSpeedAvg.type]: '18.00 km/h',
                [DataSpeedMin.type]: '3.60 km/h',
                [DataSpeedMax.type]: '36.00 km/h',
            },
        ]);
    });

    it('updates an owner-selected sport family column layout immediately and persists it', async () => {
        const activity = createActivity([createRenderableLap(LapTypes.Manual)]);
        component.canCustomize = true;
        component.selectedActivities = [activity];
        eventDetailsSettings.set(normalizeEventDetailsSettings({
            lapTableColumnsBySportFamily: { running: [] },
        }));
        fixture.detectChanges();
        component.ngOnChanges();

        await component.onLapColumnSelectionChange(
            'running',
            createLapColumnSelectionChange([DataPaceAvg.type]),
        );

        expect(component.getColumnsToDisplay('Running')).toEqual(['#', DataPaceAvg.type]);
        expect(updateLapTableColumns).toHaveBeenCalledWith('running', [DataPaceAvg.type]);
    });

    it('keeps the open column menu group stable while a selected column refreshes the table', async () => {
        const activity = createActivity([{
            ...createRenderableLap(LapTypes.Manual),
            getStat: (type: string) => type === DataHeartRateMax.type
                ? new DataHeartRateMax(175)
                : undefined,
        } as unknown as LapInterface]);
        component.canCustomize = true;
        component.selectedActivities = [activity];
        eventDetailsSettings.set(normalizeEventDetailsSettings({
            lapTableColumnsBySportFamily: { running: [] },
        }));
        fixture.detectChanges();
        component.ngOnChanges();

        const runningGroup = component.activeLapColumnMenuGroup;
        if (!runningGroup) {
            throw new Error('Expected running lap column group');
        }
        component.onLapColumnMetricSearchInput(runningGroup, {
            target: { value: 'maximum heart rate' },
        } as unknown as Event);

        await component.onLapColumnSelectionChange(
            'running',
            createLapColumnSelectionChange([DataHeartRateMax.type]),
        );

        expect(component.activeLapColumnMenuGroup).toBe(runningGroup);
        expect(runningGroup.searchTerm).toBe('maximum heart rate');
        expect(runningGroup.selectedMetricTypes).toEqual([DataHeartRateMax.type]);
        expect(component.getColumns(activity, LapTypes.Manual)).toEqual([
            'selection',
            '#',
            DataHeartRateMax.type,
        ]);
    });

    it('keeps saved metrics checked and explains when the current laps have no data', () => {
        const activityWithHeartRate = createActivity([{
            ...createRenderableLap(LapTypes.Manual),
            getStat: (type: string) => type === DataHeartRateMax.type
                ? new DataHeartRateMax(175)
                : undefined,
        } as unknown as LapInterface]);
        const activityWithoutHeartRate = {
            ...createActivity([createRenderableLap(LapTypes.Manual)]),
            getID: () => 'activity-2',
        } as ActivityInterface;
        component.canCustomize = true;
        eventDetailsSettings.set(normalizeEventDetailsSettings({
            lapTableColumnsBySportFamily: { running: [DataHeartRateMax.type] },
        }));
        component.selectedActivities = [activityWithHeartRate];
        fixture.detectChanges();
        component.ngOnChanges();

        expect(component.lapColumnMenuGroups.find((group) => group.family === 'running')
            ?.metricAvailability[DataHeartRateMax.type]?.availableTableCount).toBe(1);

        component.selectedActivities = [activityWithoutHeartRate];
        component.ngOnChanges();

        const runningGroup = component.lapColumnMenuGroups.find((group) => group.family === 'running');
        expect(runningGroup?.selectedMetricTypes).toEqual([DataHeartRateMax.type]);
        expect(runningGroup?.selectedUnavailableMetricCount).toBe(1);
        expect(runningGroup?.metricAvailability[DataHeartRateMax.type]).toEqual({
            availableTableCount: 0,
            tableCount: 1,
            label: 'No data in current laps — hidden from the table',
        });
        expect(runningGroup?.metricAvailability[DataSpeedAvg.type]?.label).toBeNull();
        expect(component.getColumns(activityWithoutHeartRate, LapTypes.Manual))
            .not.toContain(DataHeartRateMax.type);
    });

    it('reports partial availability across the current lap tables without clearing saved metrics', () => {
        const activityWithHeartRate = createActivity([{
            ...createRenderableLap(LapTypes.Manual),
            getStat: (type: string) => type === DataHeartRateMax.type
                ? new DataHeartRateMax(175)
                : undefined,
        } as unknown as LapInterface]);
        const activityWithoutHeartRate = {
            ...createActivity([createRenderableLap(LapTypes.Manual)]),
            getID: () => 'activity-2',
        } as ActivityInterface;
        component.canCustomize = true;
        eventDetailsSettings.set(normalizeEventDetailsSettings({
            lapTableColumnsBySportFamily: { running: [DataHeartRateMax.type] },
        }));
        component.selectedActivities = [activityWithHeartRate, activityWithoutHeartRate];
        fixture.detectChanges();
        component.ngOnChanges();

        const runningGroup = component.lapColumnMenuGroups.find((group) => group.family === 'running');
        expect(runningGroup?.selectedMetricTypes).toEqual([DataHeartRateMax.type]);
        expect(runningGroup?.selectedUnavailableMetricCount).toBe(0);
        expect(runningGroup?.metricAvailability[DataHeartRateMax.type]).toEqual({
            availableTableCount: 1,
            tableCount: 2,
            label: 'Available in 1 of 2 lap tables',
        });
        expect(component.getColumns(activityWithHeartRate, LapTypes.Manual))
            .toContain(DataHeartRateMax.type);
        expect(component.getColumns(activityWithoutHeartRate, LapTypes.Manual))
            .not.toContain(DataHeartRateMax.type);
    });

    it('retains selected metrics when selecting a metric from a filtered column search', async () => {
        const activity = createActivity([createRenderableLap(LapTypes.Manual)]);
        const initialMetricTypes = [DataDuration.type, DataPaceAvg.type];
        component.canCustomize = true;
        component.selectedActivities = [activity];
        eventDetailsSettings.set(normalizeEventDetailsSettings({
            lapTableColumnsBySportFamily: { running: [] },
        }));
        fixture.detectChanges();
        component.ngOnChanges();

        await component.onLapColumnSelectionChange(
            'running',
            createLapColumnSelectionChange(initialMetricTypes),
        );
        updateLapTableColumns.mockClear();

        const runningGroup = component.lapColumnMenuGroups.find((group) => group.family === 'running');
        if (!runningGroup) {
            throw new Error('Expected running lap column group');
        }
        component.onLapColumnMetricSearchInput(runningGroup, {
            target: { value: 'maximum heart rate' },
        } as unknown as Event);

        await component.onLapColumnSelectionChange(
            'running',
            createLapColumnSelectionChange([DataHeartRateMax.type]),
        );

        expect(component.getColumnsToDisplay('Running')).toEqual([
            '#',
            ...initialMetricTypes,
            DataHeartRateMax.type,
        ]);
        expect(updateLapTableColumns).toHaveBeenCalledWith('running', [
            ...initialMetricTypes,
            DataHeartRateMax.type,
        ]);
    });

    it('retains metrics outside the search when deselecting a filtered metric', async () => {
        const activity = createActivity([createRenderableLap(LapTypes.Manual)]);
        const initialMetricTypes = [DataDuration.type, DataPaceAvg.type, DataHeartRateMax.type];
        component.canCustomize = true;
        component.selectedActivities = [activity];
        eventDetailsSettings.set(normalizeEventDetailsSettings({
            lapTableColumnsBySportFamily: { running: initialMetricTypes },
        }));
        fixture.detectChanges();
        component.ngOnChanges();

        const runningGroup = component.lapColumnMenuGroups.find((group) => group.family === 'running');
        if (!runningGroup) {
            throw new Error('Expected running lap column group');
        }
        component.onLapColumnMetricSearchInput(runningGroup, {
            target: { value: 'maximum heart rate' },
        } as unknown as Event);

        await component.onLapColumnSelectionChange(
            'running',
            createLapColumnSelectionChange([DataHeartRateMax.type], false),
        );

        expect(component.getColumnsToDisplay('Running')).toEqual([
            '#',
            DataDuration.type,
            DataPaceAvg.type,
        ]);
        expect(updateLapTableColumns).toHaveBeenCalledWith('running', [
            DataDuration.type,
            DataPaceAvg.type,
        ]);
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
        expect(component.activeLapColumnMenuGroup?.family).toBe('running');

        component.onLapColumnMenuSportFamilyChange('cycling');

        expect(component.activeLapColumnMenuGroup?.family).toBe('cycling');

        component.ngOnChanges();

        expect(component.activeLapColumnMenuGroup?.family).toBe('cycling');
    });

    it('filters lap metric groups by typed metric and group names', () => {
        const activity = {
            ...createActivity([createRenderableLap(LapTypes.Manual)]),
            type: 'Cycling',
        } as ActivityInterface;
        component.canCustomize = true;
        component.selectedActivities = [activity];
        component.ngOnChanges();

        const cyclingGroup = component.lapColumnMenuGroups.find((group) => group.family === 'cycling');
        if (!cyclingGroup) {
            throw new Error('Expected cycling lap column group');
        }

        component.onLapColumnMetricSearchInput(cyclingGroup, {
            target: { value: 'min speed' },
        } as unknown as Event);

        expect(cyclingGroup.searchTerm).toBe('min speed');
        expect(cyclingGroup.filteredMetricGroups).toEqual(expect.arrayContaining([expect.objectContaining({
            label: 'Speed',
            metrics: [{ type: DataSpeedMin.type, label: 'Minimum' }],
        })]));

        component.onLapColumnMetricSearchInput(cyclingGroup, {
            target: { value: 'not a metric' },
        } as unknown as Event);

        expect(cyclingGroup.filteredMetricGroups).toEqual([]);

        component.clearLapColumnMetricSearch(cyclingGroup);

        expect(cyclingGroup.searchTerm).toBe('');
        expect(cyclingGroup.filteredMetricGroups).toBe(cyclingGroup.metricGroups);
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

    it('selects only lap rows, updates the selected footer, and supports select all', () => {
        const activity = createActivity([120, 180].map((duration, index) => ({
            ...createRenderableLap(LapTypes.Manual),
            getDuration: () => new DataDuration(duration),
            getStat: (type: string) => type === DataHeartRateMax.type
                ? new DataHeartRateMax(index === 0 ? 160 : 180)
                : undefined,
        } as unknown as LapInterface)));
        component.selectedActivities = [activity];
        component.ngOnChanges();
        fixture.detectChanges();

        const table = component.lapTableGroups[0]?.tables[0];
        if (!table) {
            throw new Error('Expected a lap table');
        }
        const [averageRow, firstLapRow, secondLapRow] = table.dataSource.data;
        if (!averageRow || !firstLapRow || !secondLapRow) {
            throw new Error('Expected the average row and two lap rows');
        }

        component.toggleLapSelection(table, averageRow);
        expect(table.selectedCount).toBe(0);
        expect(table.selection.selected).toEqual([]);

        component.toggleLapSelection(table, firstLapRow);
        fixture.detectChanges();

        expect(table.selectedCount).toBe(1);
        expect(table.selectedSummaryLabel).toBe('Selected avg · 1');
        expect(table.selectedSummary[DataDuration.type]).toContain(' · 1/1');
        expect(table.allLapRowsSelected).toBe(false);
        expect(table.someLapRowsSelected).toBe(true);
        expect(fixture.nativeElement.querySelector('.lap-selected-summary-row')).toBeTruthy();

        component.toggleAllLapSelections(table);
        expect(table.selectedCount).toBe(2);
        expect(table.allLapRowsSelected).toBe(true);
        expect(table.someLapRowsSelected).toBe(false);

        component.toggleAllLapSelections(table);
        fixture.detectChanges();
        expect(table.selectedCount).toBe(0);
        expect(fixture.nativeElement.querySelector('.lap-selected-summary-row')?.getAttribute('hidden')).toBe('');
    });

    it('keeps lap selections isolated per table and preserves them across column refreshes', async () => {
        const running = createActivity([createRenderableLap(LapTypes.Manual)]);
        const cycling = {
            ...createActivity([createRenderableLap(LapTypes.Manual)]),
            getID: () => 'activity-2',
            type: 'Cycling',
        } as ActivityInterface;
        component.canCustomize = true;
        component.selectedActivities = [running, cycling];
        component.ngOnChanges();

        const runningTable = component.lapTableGroups[0]?.tables.find((table) => table.activity === running);
        const cyclingTable = component.lapTableGroups[0]?.tables.find((table) => table.activity === cycling);
        const runningLapRow = runningTable?.dataSource.data.find((row) => !row.isLapAverage);
        if (!runningTable || !cyclingTable || !runningLapRow) {
            throw new Error('Expected independent running and cycling lap tables');
        }

        component.toggleLapSelection(runningTable, runningLapRow);
        expect(runningTable.selectedCount).toBe(1);
        expect(cyclingTable.selectedCount).toBe(0);

        await component.onLapColumnSelectionChange(
            'running',
            createLapColumnSelectionChange([DataHeartRateMax.type]),
        );

        const refreshedRunningTable = component.lapTableGroups[0]?.tables.find((table) => table.activity === running);
        const refreshedCyclingTable = component.lapTableGroups[0]?.tables.find((table) => table.activity === cycling);
        expect(refreshedRunningTable?.selectedCount).toBe(1);
        expect(refreshedCyclingTable?.selectedCount).toBe(0);
    });

    it('clears a table selection once that activity or lap type no longer appears', () => {
        const activity = createActivity([createRenderableLap(LapTypes.Manual)]);
        component.selectedActivities = [activity];
        component.ngOnChanges();

        const table = component.lapTableGroups[0]?.tables[0];
        const lapRow = table?.dataSource.data.find((row) => !row.isLapAverage);
        if (!table || !lapRow) {
            throw new Error('Expected a selectable lap row');
        }
        component.toggleLapSelection(table, lapRow);
        expect(table.selectedCount).toBe(1);

        component.selectedActivities = [];
        component.ngOnChanges();
        component.selectedActivities = [activity];
        component.ngOnChanges();

        expect(component.lapTableGroups[0]?.tables[0]?.selectedCount).toBe(0);
    });

    it('should keep the metric search field within the lap column menu', () => {
        const styles = readFileSync(
            resolve(process.cwd(), 'src/app/components/event/laps/event.card.laps.component.css'),
            'utf8',
        );

        expect(styles).toContain('.lap-column-search-field');
        expect(styles).toContain('box-sizing: border-box;');
        expect(styles).toContain('width: calc(100% - 32px) !important;');
        expect(styles).toContain('.lap-column-availability-summary');
        expect(styles).toContain(".lap-selected-summary-row .mat-mdc-footer-cell");
        expect(styles).toContain("font-family: 'Barlow Condensed', 'Inter', sans-serif;");
    });

    it('renders checkbox-only lap selection and a sticky selected-summary footer', () => {
        const template = readFileSync(
            resolve(process.cwd(), 'src/app/components/event/laps/event.card.laps.component.html'),
            'utf8',
        );

        expect(template).toContain("column === 'selection' || column === '#'");
        expect(template).toContain('Select all laps in this table');
        expect(template).toContain("[attr.aria-label]=\"'Select lap ' + row['#']\"");
        expect(template).toContain("column === 'selection' && !row.isLapAverage");
        expect(template).toContain('toggleAllLapSelections(lapTable)');
        expect(template).toContain('toggleLapSelection(lapTable, row)');
        expect(template).toContain('lapTable.selectedSummaryLabel');
        expect(template).toContain('*matFooterRowDef="lapTable.columns; sticky: true"');
        expect(template).toContain('lap-selected-summary-row');
        expect(template).toContain('<app-data-type-icon [dataType]="column"></app-data-type-icon>');
        expect(template).toContain("[class.lap-index-cell]=\"column === '#'");
        expect(template).toContain("[class.lap-duration-cell]=\"column === 'Duration'");
        expect(template).toContain('lapColumnsMenu');
        expect(template).toContain('xPosition="before"');
        expect(template).toContain('qs-menu-panel-form qs-config-menu lap-column-menu-panel');
        expect(template).toContain('mat-button-toggle-group');
        expect(template).toContain('activeLapColumnMenuGroup');
        expect(template).toContain('Choose columns for {{ group.label.toLowerCase() }} laps');
        expect(template).toContain('Search metrics');
        expect(template).toContain('group.filteredMetricGroups');
        expect(template).toContain('group.selectedUnavailableMetricCount');
        expect(template).toContain('group.metricAvailability[metric.type]?.label');
        expect(template).toContain('unavailable in these laps and hidden from the table');
        expect(template).toContain('matListItemTitle');
        expect(template).toContain('matListItemLine');
        expect(template).toContain('No matching metrics.');
        expect(template).toContain('row.isLapAverage');
        expect(template).toContain('lap-average-row');
        expect(template).not.toContain('lap-header-averages');
        expect(template).toContain('lapTableGroup.tables');
        expect(template).toContain('lapTableGroups.length === 1');
        expect(template).toContain('*ngTemplateOutlet="lapTableGroupTables; context: { $implicit: lapTableGroup }"');
        expect(template).toContain('lap-tab-text');
        expect(template).toContain('lap-tab-icon');
        expect(template).not.toContain('getDataSource(');
        expect(template).not.toContain('getColumns(');
        expect(template).not.toContain('lapColumnMetricsMenu');
    });
});
